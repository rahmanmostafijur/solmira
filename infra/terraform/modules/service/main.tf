locals {
  full_name = "${var.prefix}-${var.name}"

  environment = [for key, value in var.environment : { name = key, value = value }]
  secrets     = [for key, value in var.secrets : { name = key, valueFrom = value }]

  volumes = { for index, path in var.writable_paths : "scratch-${index}" => path }

  log_options = {
    "awslogs-group"         = var.log_group_name
    "awslogs-region"        = var.region
    "awslogs-stream-prefix" = var.name
  }
}

resource "aws_ecs_task_definition" "this" {
  family                   = local.full_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  dynamic "volume" {
    for_each = local.volumes
    content {
      name = volume.key
    }
  }

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "app"
      image     = var.image
      essential = true

      portMappings = [{ containerPort = var.port, protocol = "tcp" }]
      environment  = local.environment
      secrets      = local.secrets

      # Read-only root: nothing the application needs is written to disk.
      readonlyRootFilesystem = true
      stopTimeout            = var.stop_timeout_seconds

      mountPoints = [for name, path in local.volumes : { sourceVolume = name, containerPath = path, readOnly = false }]

      logConfiguration = { logDriver = "awslogs", options = local.log_options }

      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:${var.port}/${var.name == "web" ? "healthz" : "health/live"} || exit 1"]
        interval    = 15
        timeout     = 3
        retries     = 3
        startPeriod = 30
      }

      dependsOn = [{ containerName = "collector", condition = "START" }]
    },
    {
      # Receives spans on localhost and forwards them to X-Ray. Not essential: losing it loses traces,
      # not the service.
      name      = "collector"
      image     = var.adot_image
      essential = false
      cpu       = 0

      secrets          = [{ name = "AOT_CONFIG_CONTENT", valueFrom = var.adot_config_secret_arn }]
      logConfiguration = { logDriver = "awslogs", options = merge(local.log_options, { "awslogs-stream-prefix" = "${var.name}-collector" }) }
    },
  ])
}

resource "aws_ecs_service" "this" {
  name            = var.name
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # A rolling deployment never takes capacity away, and a deployment that does not become healthy
  # rolls itself back (docs/operations/deploy.md).
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = var.target_group_arn == null ? null : 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = var.target_group_arn == null ? [] : [1]
    content {
      target_group_arn = var.target_group_arn
      container_name   = "app"
      container_port   = var.port
    }
  }

  dynamic "service_registries" {
    for_each = var.service_registry_arn == null ? [] : [1]
    content {
      registry_arn = var.service_registry_arn
    }
  }

  enable_execute_command = false
  propagate_tags         = "SERVICE"

  lifecycle {
    # The autoscaler owns the count after the first deployment.
    ignore_changes = [desired_count]
  }
}

resource "aws_appautoscaling_target" "this" {
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${element(split("/", var.cluster_arn), 1)}/${aws_ecs_service.this.name}"
  min_capacity       = var.min_count
  max_capacity       = var.max_count
}

resource "aws_appautoscaling_policy" "cpu" {
  count              = var.autoscale_on_cpu ? 1 : 0
  name               = "${local.full_name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension
  resource_id        = aws_appautoscaling_target.this.resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = var.cpu_target_percent
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
