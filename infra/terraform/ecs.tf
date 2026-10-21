resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE"]
}

# Private DNS inside the VPC: services find identity-service by name to fetch the token signing keys.
resource "aws_service_discovery_private_dns_namespace" "internal" {
  name = "${var.environment}.${var.name_prefix}.internal"
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "identity" {
  name = "identity"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.internal.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config {}
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = local.service_ports
  name              = "/${var.name_prefix}/${var.environment}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.data.arn
}

locals {
  jwks_url = "http://identity.${aws_service_discovery_private_dns_namespace.internal.name}:${local.service_ports.identity}/api/v1/auth/.well-known/jwks.json"
  secret   = { for service, secret in aws_secretsmanager_secret.service : service => secret.arn }

  common_environment = {
    NODE_ENV                    = "production"
    LOG_LEVEL                   = "info"
    LOG_PRETTY                  = "false"
    METRICS_ENABLED             = "true"
    AWS_REGION                  = var.region
    NODE_EXTRA_CA_CERTS         = "/app/certs/rds-global-bundle.pem"
    OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318"
    OTEL_TRACES_SAMPLER_ARG     = tostring(var.trace_sample_ratio)
    TRACING_XRAY_IDS            = "true"
  }

  # What differs per service: settings, and the secrets it reads (key of a JSON secret, ARN suffix).
  service_environment = {
    web = { GATEWAY_INTERNAL_URL = "https://${var.domain_name}", HOSTNAME = "0.0.0.0" }
    identity = {
      APP_URL   = "https://${var.domain_name}"
      MAIL_FROM = var.mail_from
    }
    ingest = {
      IDENTITY_JWKS_URL  = local.jwks_url
      DYNAMODB_TABLE     = local.attempts_table
      SECRETS_KMS_KEY_ID = aws_kms_key.secrets.arn
    }
    dispatcher = {
      DYNAMODB_TABLE     = local.attempts_table
      SECRETS_KMS_KEY_ID = aws_kms_key.secrets.arn
      # One worker takes at most this many in flight; the cap per endpoint is across all workers.
      DISPATCH_PER_ENDPOINT = tostring(var.dispatcher_per_endpoint_cap)
      DISPATCH_CONCURRENCY  = "50"
      DATABASE_POOL_MAX     = "20"
    }
    notification = { IDENTITY_JWKS_URL = local.jwks_url }
    analytics    = { IDENTITY_JWKS_URL = local.jwks_url }
    audit        = { IDENTITY_JWKS_URL = local.jwks_url }
  }

  service_secrets = {
    web = {}
    identity = {
      DATABASE_URL    = "${local.secret.identity}:DATABASE_URL::"
      REDIS_URL       = "${local.secret.identity}:REDIS_URL::"
      RABBITMQ_URL    = "${local.secret.identity}:RABBITMQ_URL::"
      SMTP_URL        = var.smtp_url_secret_arn
      JWT_KEY_ID      = "${aws_secretsmanager_secret.identity_signing_keys.arn}:JWT_KEY_ID::"
      JWT_PRIVATE_KEY = "${aws_secretsmanager_secret.identity_signing_keys.arn}:JWT_PRIVATE_KEY::"
      JWT_PUBLIC_KEY  = "${aws_secretsmanager_secret.identity_signing_keys.arn}:JWT_PUBLIC_KEY::"
    }
    ingest = {
      DATABASE_URL = "${local.secret.ingest}:DATABASE_URL::"
      REDIS_URL    = "${local.secret.ingest}:REDIS_URL::"
      RABBITMQ_URL = "${local.secret.ingest}:RABBITMQ_URL::"
    }
    dispatcher = {
      DATABASE_URL = "${local.secret.dispatcher}:DATABASE_URL::"
      REDIS_URL    = "${local.secret.dispatcher}:REDIS_URL::"
    }
    notification = {
      DATABASE_URL = "${local.secret.notification}:DATABASE_URL::"
      REDIS_URL    = "${local.secret.notification}:REDIS_URL::"
      RABBITMQ_URL = "${local.secret.notification}:RABBITMQ_URL::"
    }
    analytics = {
      DATABASE_URL = "${local.secret.analytics}:DATABASE_URL::"
      REDIS_URL    = "${local.secret.analytics}:REDIS_URL::"
      RABBITMQ_URL = "${local.secret.analytics}:RABBITMQ_URL::"
    }
    audit = {
      DATABASE_URL = "${local.secret.audit}:DATABASE_URL::"
      REDIS_URL    = "${local.secret.audit}:REDIS_URL::"
      RABBITMQ_URL = "${local.secret.audit}:RABBITMQ_URL::"
    }
  }

  # The web server writes its page cache; every service writes /tmp.
  writable_paths = {
    web = ["/tmp", "/app/apps/web/.next/cache"]
  }
}

module "service" {
  source   = "./modules/service"
  for_each = local.service_ports

  name                   = each.key
  prefix                 = local.name
  region                 = var.region
  cluster_arn            = aws_ecs_cluster.main.arn
  subnet_ids             = [for subnet in aws_subnet.app : subnet.id]
  security_group_ids     = [local.service_security_group[each.key]]
  image                  = "${aws_ecr_repository.service[each.key].repository_url}:${var.image_tag}"
  port                   = each.value
  cpu                    = var.services[each.key].cpu
  memory                 = var.services[each.key].memory
  desired_count          = var.services[each.key].desired_count
  min_count              = var.services[each.key].min_count
  max_count              = var.services[each.key].max_count
  environment            = merge(local.common_environment, { PORT = tostring(each.value) }, local.service_environment[each.key])
  secrets                = local.service_secrets[each.key]
  execution_role_arn     = aws_iam_role.execution.arn
  task_role_arn          = aws_iam_role.task[each.key].arn
  log_group_name         = aws_cloudwatch_log_group.service[each.key].name
  target_group_arn       = try(aws_lb_target_group.service[each.key].arn, null)
  service_registry_arn   = each.key == "identity" ? aws_service_discovery_service.identity.arn : null
  adot_image             = var.adot_collector_image
  adot_config_secret_arn = aws_ssm_parameter.collector_config.arn
  writable_paths         = lookup(local.writable_paths, each.key, ["/tmp"])
  # The dispatcher finishes what is in flight before it stops (DELIVERY_TIMEOUT_MS is 30 s).
  stop_timeout_seconds = each.key == "dispatcher" ? 60 : 35
  autoscale_on_cpu     = each.key != "dispatcher"
}
