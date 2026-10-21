# Alarms on the data stores: database, cache, broker and the history table.

locals {
  postgres_alarms = {
    cpu = {
      metric      = "CPUUtilization"
      statistic   = "Average"
      threshold   = 80
      operator    = "GreaterThanThreshold"
      description = "The database CPU is above 80% for ten minutes."
    }
    storage = {
      metric      = "FreeStorageSpace"
      statistic   = "Minimum"
      threshold   = 20 * 1024 * 1024 * 1024
      operator    = "LessThanThreshold"
      description = "Less than 20 GiB of database storage is free (it grows on its own up to the maximum; check that it can)."
    }
    memory = {
      metric      = "FreeableMemory"
      statistic   = "Minimum"
      threshold   = 1024 * 1024 * 1024
      operator    = "LessThanThreshold"
      description = "The database has less than 1 GiB of memory to spare."
    }
    connections = {
      metric      = "DatabaseConnections"
      statistic   = "Maximum"
      threshold   = 400
      operator    = "GreaterThanThreshold"
      description = "More than 400 connections: the services' pools are larger than expected, or something leaks."
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "postgres" {
  for_each            = local.postgres_alarms
  alarm_name          = "${local.name}-postgres-${each.key}"
  alarm_description   = each.value.description
  namespace           = "AWS/RDS"
  metric_name         = each.value.metric
  dimensions          = { DBInstanceIdentifier = aws_db_instance.postgres.identifier }
  statistic           = each.value.statistic
  period              = 300
  evaluation_periods  = 2
  threshold           = each.value.threshold
  comparison_operator = each.value.operator
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "redis_memory" {
  alarm_name          = "${local.name}-redis-memory"
  alarm_description   = "The cache uses more than 80% of its memory."
  namespace           = "AWS/ElastiCache"
  metric_name         = "DatabaseMemoryUsagePercentage"
  dimensions          = { ReplicationGroupId = aws_elasticache_replication_group.redis.id }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  alarm_name          = "${local.name}-redis-cpu"
  alarm_description   = "The cache engine CPU is above 80%."
  namespace           = "AWS/ElastiCache"
  metric_name         = "EngineCPUUtilization"
  dimensions          = { ReplicationGroupId = aws_elasticache_replication_group.redis.id }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rabbitmq_memory" {
  alarm_name          = "${local.name}-rabbitmq-memory"
  alarm_description   = "The broker is close to its memory limit; it will block publishers when it reaches it. Runbook: docs/operations/rabbitmq-failure.md"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  evaluation_periods  = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions

  metric_query {
    id          = "used"
    expression  = "100 * mem / limit"
    label       = "Memory used, percent of the limit"
    return_data = true
  }
  metric_query {
    id = "mem"
    metric {
      namespace   = "AWS/AmazonMQ"
      metric_name = "RabbitMQMemUsed"
      dimensions  = { Broker = local.broker_node }
      period      = 300
      stat        = "Maximum"
    }
  }
  metric_query {
    id = "limit"
    metric {
      namespace   = "AWS/AmazonMQ"
      metric_name = "RabbitMQMemLimit"
      dimensions  = { Broker = local.broker_node }
      period      = 300
      stat        = "Maximum"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "rabbitmq_cpu" {
  alarm_name          = "${local.name}-rabbitmq-cpu"
  alarm_description   = "The broker CPU is above 80%."
  namespace           = "AWS/AmazonMQ"
  metric_name         = "SystemCpuUtilization"
  dimensions          = { Broker = local.broker_node }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "dynamodb_throttles" {
  alarm_name          = "${local.name}-dynamodb-throttles"
  alarm_description   = "Requests to the attempt history table are throttled. The history is derived data; deliveries are not affected, but the timeline may have gaps."
  namespace           = "AWS/DynamoDB"
  metric_name         = "ThrottledRequests"
  dimensions          = { TableName = aws_dynamodb_table.attempts.name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "dynamodb_errors" {
  alarm_name          = "${local.name}-dynamodb-system-errors"
  alarm_description   = "DynamoDB reports errors on its side for the attempt history table."
  namespace           = "AWS/DynamoDB"
  metric_name         = "SystemErrors"
  dimensions          = { TableName = aws_dynamodb_table.attempts.name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}
