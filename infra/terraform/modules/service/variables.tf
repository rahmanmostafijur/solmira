variable "name" {
  description = "Service name, for example ingest."
  type        = string
}

variable "prefix" {
  description = "Resource name prefix (project and environment)."
  type        = string
}

variable "region" {
  type = string
}

variable "cluster_arn" {
  type = string
}

variable "subnet_ids" {
  description = "Private subnets the tasks run in."
  type        = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "image" {
  description = "Full image reference, with the tag."
  type        = string
}

variable "port" {
  type = number
}

variable "cpu" {
  type = number
}

variable "memory" {
  type = number
}

variable "desired_count" {
  type = number
}

variable "min_count" {
  type = number
}

variable "max_count" {
  type = number
}

variable "environment" {
  description = "Plain environment variables of the container."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Environment variables filled from Secrets Manager, as name to value-from reference."
  type        = map(string)
  default     = {}
}

variable "execution_role_arn" {
  description = "Role ECS uses to pull the image, write logs and read the secrets."
  type        = string
}

variable "task_role_arn" {
  description = "Role the application runs as."
  type        = string
}

variable "log_group_name" {
  type = string
}

variable "target_group_arn" {
  description = "Load balancer target group, or null for a service nothing sends traffic to."
  type        = string
  default     = null
}

variable "service_registry_arn" {
  description = "Service discovery entry, or null."
  type        = string
  default     = null
}

variable "adot_image" {
  type = string
}

variable "adot_config_secret_arn" {
  description = "SSM parameter with the collector configuration."
  type        = string
}

variable "writable_paths" {
  description = "Directories the application writes to. The root file system is read-only; each of these is an empty scratch volume that goes with the task."
  type        = list(string)
  default     = ["/tmp"]
}

variable "stop_timeout_seconds" {
  description = "Time a task has to finish its work after the stop signal (at most 120)."
  type        = number
  default     = 35
}

variable "cpu_target_percent" {
  description = "Average CPU the autoscaler aims for."
  type        = number
  default     = 60
}

variable "autoscale_on_cpu" {
  description = "Scale on CPU. The dispatcher scales on its backlog instead (observability.tf)."
  type        = bool
  default     = true
}
