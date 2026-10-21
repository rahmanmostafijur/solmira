# Alerts, the collector's configuration and the trace sampling rule. Dashboards are in dashboard.tf.
# The metrics the application writes are in the Solmira namespace (ADR-0039); the others come from AWS.

resource "aws_sns_topic" "alarms" {
  name              = "${local.name}-alarms"
  kms_master_key_id = aws_kms_key.data.id
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Collector run beside every task: receives spans from the application on localhost and sends them to
# X-Ray. The attributes listed are searchable in X-Ray (correlation id ties a trace to the log lines and
# to the audit trail).
resource "aws_ssm_parameter" "collector_config" {
  name = "/${var.name_prefix}/${var.environment}/collector-config"
  type = "String"
  value = yamlencode({
    receivers = { otlp = { protocols = { http = { endpoint = "0.0.0.0:4318" } } } }
    processors = {
      batch = { timeout = "5s" }
    }
    exporters = {
      awsxray = {
        region             = var.region
        indexed_attributes = ["correlation.id", "organization.id", "endpoint.id", "delivery.id", "message.id"]
      }
    }
    service = {
      pipelines = {
        traces = { receivers = ["otlp"], processors = ["batch"], exporters = ["awsxray"] }
      }
    }
  })
}

resource "aws_xray_sampling_rule" "default" {
  rule_name      = "${local.name}-default"
  priority       = 1000
  version        = 1
  reservoir_size = 1
  fixed_rate     = var.trace_sample_ratio
  url_path       = "*"
  host           = "*"
  http_method    = "*"
  service_type   = "*"
  service_name   = "*"
  resource_arn   = "*"
}

locals {
  consumer_queues = {
    "ingest-service"       = ["ingest.fan-out"]
    "notification-service" = ["notification.endpoint-alerts"]
    "analytics-service"    = ["analytics.delivery-attempts"]
    "audit-service"        = ["audit.admin-actions"]
  }
  dead_letter_alarms = merge([
    for service, queues in local.consumer_queues : {
      for queue in queues : queue => { service = service, queue = queue }
    }
  ]...)

  alb_dimension = aws_lb.main.arn_suffix
}

# ---- the signals that mean customers are affected -----------------------------------------------------

# Deliveries are waiting longer than they should: the single best sign that the product is not doing its job.
resource "aws_cloudwatch_metric_alarm" "delivery_backlog_age" {
  alarm_name          = "${local.name}-delivery-backlog-age"
  alarm_description   = "The oldest due delivery has waited more than two minutes. Runbook: docs/operations/delivery-backlog.md"
  namespace           = "Solmira"
  metric_name         = "OldestDueAge"
  dimensions          = { Service = "dispatcher" }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 120
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "outbox_lag" {
  alarm_name          = "${local.name}-outbox-lag"
  alarm_description   = "Events wait in the outbox for more than a minute: they are not reaching the broker. Runbook: docs/operations/rabbitmq-failure.md"
  namespace           = "Solmira"
  metric_name         = "OutboxOldestAge"
  dimensions          = { Service = "ingest-service" }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 60
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "dead_letters" {
  for_each            = local.dead_letter_alarms
  alarm_name          = "${local.name}-dead-letters-${each.key}"
  alarm_description   = "Events no consumer could process are in the dead-letter queue ${each.key}. Runbook: docs/operations/dead-letter-queues.md"
  namespace           = "Solmira"
  metric_name         = "DeadLetterMessages"
  dimensions          = { Service = each.value.service, Queue = each.value.queue }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "secret_decrypt_failures" {
  alarm_name          = "${local.name}-secret-decrypt-failures"
  alarm_description   = "The dispatcher could not decrypt signing secrets: deliveries are deferred. Check KMS access and the key. Runbook: docs/operations/key-rotation.md"
  namespace           = "Solmira"
  metric_name         = "SecretDecryptFailures"
  dimensions          = { Service = "dispatcher" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}
