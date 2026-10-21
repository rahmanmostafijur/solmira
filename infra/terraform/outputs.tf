output "url" {
  description = "Where the console and the API are served."
  value       = "https://${var.domain_name}"
}

output "ecr_repositories" {
  description = "Repository to push each image to."
  value       = { for name, repository in aws_ecr_repository.service : name => repository.repository_url }
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "subnets_for_oneoff_tasks" {
  description = "Subnets and security group to run the bootstrap and migration tasks in."
  value = {
    subnets         = [for subnet in aws_subnet.app : subnet.id]
    security_groups = [aws_security_group.tasks_private.id]
  }
}

output "oneoff_task_definitions" {
  value = {
    bootstrap    = aws_ecs_task_definition.bootstrap.family
    migrate      = { for service, task in aws_ecs_task_definition.migrate : service => task.family }
    dead_letters = aws_ecs_task_definition.dead_letters.family
  }
}

output "signing_secrets_key_arn" {
  description = "The KMS key that wraps the data keys of webhook signing secrets."
  value       = aws_kms_key.secrets.arn
}

output "identity_signing_keys_secret" {
  description = "Fill this secret before the first deploy (docs/operations/first-deploy.md)."
  value       = aws_secretsmanager_secret.identity_signing_keys.name
}

output "alarm_topic_arn" {
  value = aws_sns_topic.alarms.arn
}

output "dashboard" {
  value = aws_cloudwatch_dashboard.main.dashboard_name
}
