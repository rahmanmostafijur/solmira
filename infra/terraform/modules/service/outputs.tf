output "service_name" {
  value = aws_ecs_service.this.name
}

output "task_definition_family" {
  value = aws_ecs_task_definition.this.family
}

output "autoscaling_resource_id" {
  value = aws_appautoscaling_target.this.resource_id
}
