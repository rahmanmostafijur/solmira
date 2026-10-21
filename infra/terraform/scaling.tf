# The dispatcher scales on how long deliveries wait, not on CPU: a worker waiting on slow receivers
# is idle and still behind. More workers also mean more requests in flight, so the per-endpoint cap
# (dispatcher_per_endpoint_cap) holds across all of them (ADR-0037).

locals {
  dispatcher_scaling = module.service["dispatcher"].autoscaling_resource_id
}

resource "aws_appautoscaling_policy" "dispatcher_out" {
  name               = "${local.name}-dispatcher-out"
  policy_type        = "StepScaling"
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = local.dispatcher_scaling

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 120
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_lower_bound = 0
      metric_interval_upper_bound = 60
      scaling_adjustment          = 1
    }
    step_adjustment {
      metric_interval_lower_bound = 60
      scaling_adjustment          = 3
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "dispatcher_scale_out" {
  alarm_name          = "${local.name}-dispatcher-scale-out"
  alarm_description   = "Deliveries have waited more than 30 seconds: add dispatcher workers."
  namespace           = "Solmira"
  metric_name         = "OldestDueAge"
  dimensions          = { Service = "dispatcher" }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 30
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_appautoscaling_policy.dispatcher_out.arn]
}

resource "aws_appautoscaling_policy" "dispatcher_in" {
  name               = "${local.name}-dispatcher-in"
  policy_type        = "StepScaling"
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = local.dispatcher_scaling

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 600
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = -1
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "dispatcher_scale_in" {
  alarm_name          = "${local.name}-dispatcher-scale-in"
  alarm_description   = "Almost nothing has waited for fifteen minutes: remove a dispatcher worker."
  namespace           = "Solmira"
  metric_name         = "DeliveriesDue"
  dimensions          = { Service = "dispatcher" }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 15
  threshold           = 20
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_appautoscaling_policy.dispatcher_in.arn]
}
