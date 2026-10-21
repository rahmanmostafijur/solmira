variable "region" {
  description = "AWS region of the deployment."
  type        = string
  default     = "eu-west-1"
}

variable "account_id" {
  description = "The AWS account id, used in key policies. Passed in so planning needs no AWS call."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "The account id is twelve digits."
  }
}

variable "environment" {
  description = "Name of the environment, used in resource names."
  type        = string
  default     = "production"
}

variable "name_prefix" {
  description = "Prefix of every resource name."
  type        = string
  default     = "solmira"
}

variable "offline_plan" {
  description = "Plan without AWS access (placeholder credentials). Never set when applying."
  type        = bool
  default     = false
}

# ---- network ---------------------------------------------------------------------------------------

variable "availability_zones" {
  description = "Availability zones to spread across (two or three)."
  type        = list(string)
  validation {
    condition     = length(var.availability_zones) >= 2 && length(var.availability_zones) <= 3
    error_message = "Use two or three availability zones."
  }
}

variable "vpc_cidr" {
  description = "Address range of the VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "nat_gateway_per_az" {
  description = "One NAT gateway per zone (survives the loss of a zone) instead of one for all."
  type        = bool
  default     = true
}

variable "interface_endpoints" {
  description = "Create interface endpoints so image pulls, logs, secrets and keys do not use the NAT gateway. Each costs per zone and hour."
  type        = bool
  default     = true
}

# ---- edge ------------------------------------------------------------------------------------------

variable "domain_name" {
  description = "Public host name of the console and API, for example app.example.com."
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone that contains the domain name (certificate validation and the alias record)."
  type        = string
}

variable "waf_rate_limit_per_5_minutes" {
  description = "Requests one IP address may send in five minutes before it is blocked. Customer backends sending events share an address, so keep it high; per-key limits are in the application."
  type        = number
  default     = 30000
}

variable "waf_auth_rate_limit_per_5_minutes" {
  description = "The same for sign-in, registration and password reset."
  type        = number
  default     = 300
}

# ---- data stores -----------------------------------------------------------------------------------

variable "postgres_engine_version" {
  description = "RDS PostgreSQL major version."
  type        = string
  default     = "18"
}

variable "postgres_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.m7g.large"
}

variable "postgres_allocated_storage_gb" {
  description = "Initial storage; it grows on its own up to the maximum."
  type        = number
  default     = 100
}

variable "postgres_max_storage_gb" {
  description = "Storage autoscaling ceiling."
  type        = number
  default     = 1000
}

variable "postgres_multi_az" {
  description = "Standby in a second zone."
  type        = bool
  default     = true
}

variable "postgres_backup_retention_days" {
  description = "Days of automated backups and point-in-time recovery."
  type        = number
  default     = 14
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.small"
}

variable "redis_engine_version" {
  description = "Valkey version (ElastiCache). The services speak the Redis protocol."
  type        = string
  default     = "8.0"
}

variable "rabbitmq_engine_version" {
  description = "Amazon MQ for RabbitMQ version."
  type        = string
  default     = "3.13"
}

variable "rabbitmq_instance_type" {
  description = "Amazon MQ broker instance type."
  type        = string
  default     = "mq.m5.large"
}

variable "rabbitmq_cluster" {
  description = "Three-node cluster across zones (true) or a single instance (false, for a trial)."
  type        = bool
  default     = true
}

variable "attempt_retention_days" {
  description = "Days of delivery attempt history kept in DynamoDB (the TTL)."
  type        = number
  default     = 30
}

# ---- compute ---------------------------------------------------------------------------------------

variable "image_tag" {
  description = "Tag of the container images to run, for example a git commit. Tags are immutable."
  type        = string
}

variable "services" {
  description = "Per service: container size, number of tasks and the range autoscaling may use."
  type = map(object({
    cpu           = number
    memory        = number
    desired_count = number
    min_count     = number
    max_count     = number
  }))
  default = {
    web          = { cpu = 512, memory = 1024, desired_count = 2, min_count = 2, max_count = 6 }
    identity     = { cpu = 512, memory = 1024, desired_count = 2, min_count = 2, max_count = 6 }
    ingest       = { cpu = 1024, memory = 2048, desired_count = 2, min_count = 2, max_count = 10 }
    dispatcher   = { cpu = 1024, memory = 2048, desired_count = 2, min_count = 2, max_count = 12 }
    notification = { cpu = 512, memory = 1024, desired_count = 2, min_count = 2, max_count = 6 }
    analytics    = { cpu = 512, memory = 1024, desired_count = 2, min_count = 2, max_count = 6 }
    audit        = { cpu = 512, memory = 1024, desired_count = 2, min_count = 2, max_count = 6 }
  }
}

variable "dispatcher_per_endpoint_cap" {
  description = "Requests the dispatcher keeps in flight to one endpoint, across workers. Raise it only with the receivers' limits in mind (docs/performance)."
  type        = number
  default     = 10
}

variable "smtp_url_secret_arn" {
  description = "Secrets Manager secret holding the SMTP URL identity-service sends mail with (for example Amazon SES SMTP credentials)."
  type        = string
}

variable "mail_from" {
  description = "Sender address of system mail. Must be verified with the mail provider."
  type        = string
}

variable "adot_collector_image" {
  description = "AWS Distro for OpenTelemetry collector image, run beside every service to forward traces to X-Ray."
  type        = string
  default     = "public.ecr.aws/aws-observability/aws-otel-collector:v0.43.3"
}

variable "trace_sample_ratio" {
  description = "Share of new traces that are recorded (0 to 1). The sampler keeps the decision of a caller that already decided."
  type        = number
  default     = 0.1
}

# ---- operations ------------------------------------------------------------------------------------

variable "log_retention_days" {
  description = "Days application logs are kept."
  type        = number
  default     = 30
}

variable "alarm_email" {
  description = "Address that receives alarm notifications (confirm the subscription once)."
  type        = string
}
