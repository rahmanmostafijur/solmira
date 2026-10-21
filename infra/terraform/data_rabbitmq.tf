resource "random_password" "rabbitmq" {
  length  = 40
  special = false
}

# The event backbone (ADR-0029). The services declare their own exchanges and queues, so the broker
# holds no configuration of ours; losing it loses at most events in flight, which the outbox republishes.
# Audit logging exists only for ActiveMQ brokers; the RabbitMQ engine offers
# general logs, which are enabled. Administrative access to the broker is through IAM and CloudTrail.
#trivy:ignore:AWS-0070
resource "aws_mq_broker" "rabbitmq" {
  broker_name         = local.name
  engine_type         = "RabbitMQ"
  engine_version      = var.rabbitmq_engine_version
  host_instance_type  = var.rabbitmq_instance_type
  deployment_mode     = var.rabbitmq_cluster ? "CLUSTER_MULTI_AZ" : "SINGLE_INSTANCE"
  publicly_accessible = false
  subnet_ids          = var.rabbitmq_cluster ? [for subnet in aws_subnet.data : subnet.id] : [values(aws_subnet.data)[0].id]
  security_groups     = [aws_security_group.rabbitmq.id]

  auto_minor_version_upgrade = true
  apply_immediately          = false

  encryption_options {
    use_aws_owned_key = false
    kms_key_id        = aws_kms_key.data.arn
  }

  logs {
    general = true
  }

  user {
    username = "solmira"
    password = random_password.rabbitmq.result
  }

  maintenance_window_start_time {
    day_of_week = "SUNDAY"
    time_of_day = "05:00"
    time_zone   = "UTC"
  }
}
