# One dashboard, ordered by what an operator asks first: are customers served (edge), are deliveries
# moving (backlog, outcomes, queues), is the platform healthy (containers, data stores).

locals {
  solmira = "Solmira"

  # A time-series widget: `metrics` is a list of CloudWatch metric specifications.
  widgets = [
    {
      title = "Requests and server errors"
      stat  = "Sum"
      metrics = [
        ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", local.alb_dimension],
        ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", local.alb_dimension],
        ["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", "LoadBalancer", local.alb_dimension],
      ]
    },
    {
      title = "Response time (p95, p99)"
      metrics = [
        ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", local.alb_dimension, { stat = "p95", label = "p95" }],
        ["...", { stat = "p99", label = "p99" }],
      ]
    },
    {
      title = "Delivery backlog: how many are due, and how long the oldest has waited (s)"
      stat  = "Maximum"
      metrics = [
        [local.solmira, "DeliveriesDue", "Service", "dispatcher"],
        [local.solmira, "OldestDueAge", "Service", "dispatcher", { yAxis = "right" }],
      ]
    },
    {
      title = "Delivery attempts by result"
      stat  = "Sum"
      metrics = [
        [local.solmira, "Attempts", "Service", "dispatcher", "Result", "succeeded"],
        [local.solmira, "Attempts", "Service", "dispatcher", "Result", "retrying"],
        [local.solmira, "Attempts", "Service", "dispatcher", "Result", "failed"],
      ]
    },
    {
      title = "Dispatcher: in flight, secret decryption failures, deferred deliveries"
      stat  = "Maximum"
      metrics = [
        [local.solmira, "InFlight", "Service", "dispatcher"],
        [local.solmira, "SecretDecryptFailures", "Service", "dispatcher", { stat = "Sum" }],
        [local.solmira, "DeliveriesDeferred", "Service", "dispatcher", "Reason", "rate_limit", { stat = "Sum" }],
      ]
    },
    {
      title = "Outbox: events waiting, and how long the oldest has waited (s)"
      stat  = "Maximum"
      metrics = [
        [local.solmira, "OutboxUnpublished", "Service", "ingest-service"],
        [local.solmira, "OutboxOldestAge", "Service", "ingest-service", { yAxis = "right" }],
      ]
    },
    {
      title   = "Dead-letter queues"
      stat    = "Maximum"
      metrics = [for key, alarm in local.dead_letter_alarms : [local.solmira, "DeadLetterMessages", "Service", alarm.service, "Queue", alarm.queue]]
    },
    {
      title = "Messages accepted, rejected, rate limited (ingest)"
      stat  = "Sum"
      metrics = [
        [local.solmira, "MessagesAccepted", "Service", "ingest-service"],
        [local.solmira, "IngestRateLimited", "Service", "ingest-service"],
        [local.solmira, "MessagesReplayed", "Service", "ingest-service"],
      ]
    },
    {
      title   = "Containers: CPU (percent)"
      stat    = "Average"
      metrics = [for service in sort(keys(local.service_ports)) : ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", service]]
    },
    {
      title   = "Containers: memory (percent)"
      stat    = "Average"
      metrics = [for service in sort(keys(local.service_ports)) : ["AWS/ECS", "MemoryUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", service]]
    },
    {
      title = "PostgreSQL: CPU, connections"
      stat  = "Average"
      metrics = [
        ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.postgres.identifier],
        ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", aws_db_instance.postgres.identifier, { yAxis = "right" }],
      ]
    },
    {
      title = "PostgreSQL: free storage and memory (bytes)"
      stat  = "Minimum"
      metrics = [
        ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", aws_db_instance.postgres.identifier],
        ["AWS/RDS", "FreeableMemory", "DBInstanceIdentifier", aws_db_instance.postgres.identifier],
      ]
    },
    {
      title = "Redis: engine CPU, memory used (percent)"
      stat  = "Maximum"
      metrics = [
        ["AWS/ElastiCache", "EngineCPUUtilization", "ReplicationGroupId", aws_elasticache_replication_group.redis.id],
        ["AWS/ElastiCache", "DatabaseMemoryUsagePercentage", "ReplicationGroupId", aws_elasticache_replication_group.redis.id],
      ]
    },
    {
      title = "RabbitMQ: memory used, ready messages, CPU"
      stat  = "Maximum"
      metrics = [
        ["AWS/AmazonMQ", "RabbitMQMemUsed", "Broker", local.broker_node],
        ["AWS/AmazonMQ", "MessageCount", "Broker", local.broker_node, { yAxis = "right" }],
        ["AWS/AmazonMQ", "SystemCpuUtilization", "Broker", local.broker_node, { yAxis = "right" }],
      ]
    },
    {
      title = "DynamoDB attempt history: capacity, throttles, errors"
      stat  = "Sum"
      metrics = [
        ["AWS/DynamoDB", "ConsumedWriteCapacityUnits", "TableName", aws_dynamodb_table.attempts.name],
        ["AWS/DynamoDB", "ThrottledRequests", "TableName", aws_dynamodb_table.attempts.name],
        ["AWS/DynamoDB", "SystemErrors", "TableName", aws_dynamodb_table.attempts.name],
      ]
    },
    {
      title = "Firewall: allowed and blocked requests"
      stat  = "Sum"
      metrics = [
        ["AWS/WAFV2", "AllowedRequests", "WebACL", aws_wafv2_web_acl.main.name, "Region", var.region, "Rule", "ALL"],
        ["AWS/WAFV2", "BlockedRequests", "WebACL", aws_wafv2_web_acl.main.name, "Region", var.region, "Rule", "ALL"],
      ]
    },
  ]
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.name

  dashboard_body = jsonencode({
    widgets = [
      for index, widget in local.widgets : {
        type   = "metric"
        x      = (index % 3) * 8
        y      = floor(index / 3) * 6
        width  = 8
        height = 6
        properties = {
          title   = widget.title
          region  = var.region
          view    = "timeSeries"
          stacked = false
          period  = 60
          stat    = lookup(widget, "stat", "Average")
          metrics = widget.metrics
        }
      }
    ]
  })
}
