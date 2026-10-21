# The public entry point. It does what the development gateway (nginx) does: sends each path to its
# service. Rate limiting is in the web application firewall (waf.tf) and in the services.

# This bucket holds access logs only and expires them; access to it is recorded
# by CloudTrail data events at the account level (docs/security-review.md).
#trivy:ignore:AWS-0089
resource "aws_s3_bucket" "alb_logs" {
  bucket        = "${local.name}-alb-logs-${var.account_id}"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  bucket                  = aws_s3_bucket.alb_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Load balancer access logs can only be delivered to a bucket encrypted with
# S3-managed keys; a customer managed key is not supported by the service.
#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule {
    # Load balancer access logs support only S3-managed keys.
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration {
      days = 90
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

data "aws_elb_service_account" "main" {}

data "aws_iam_policy_document" "alb_logs" {
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.alb_logs.arn}/alb/AWSLogs/${var.account_id}/*"]
    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.main.arn]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.alb_logs.arn, "${aws_s3_bucket.alb_logs.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  policy = data.aws_iam_policy_document.alb_logs.json
}

# The console and the ingestion API are public by design. The exposure is
# limited to TLS 1.3, a firewall in front (waf.tf) and security groups that let only this load balancer
# reach the containers.
#trivy:ignore:AWS-0053
resource "aws_lb" "main" {
  name                       = local.name
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = [for subnet in aws_subnet.public : subnet.id]
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true
  idle_timeout               = 3600 # long-lived WebSocket connections (the delivery feed)

  access_logs {
    bucket  = aws_s3_bucket.alb_logs.id
    prefix  = "alb"
    enabled = true
  }

  depends_on = [aws_s3_bucket_policy.alb_logs]
}

# Every service except the dispatcher (a worker with no inbound traffic) has a target group.
resource "aws_lb_target_group" "service" {
  for_each             = { for name, port in local.service_ports : name => port if name != "dispatcher" }
  name                 = "${local.name}-${each.key}"
  port                 = each.value
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30

  health_check {
    path                = each.key == "web" ? "/healthz" : "/health/live"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-Res-2021-06"
  certificate_arn   = aws_acm_certificate_validation.main.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service["web"].arn
  }
}

locals {
  # The same map as the gateway (infra/docker/gateway): each API path goes to the service that owns it.
  routes = {
    identity     = ["/api/v1/auth/*", "/api/v1/me", "/api/v1/me/*", "/api/v1/organizations", "/api/v1/organizations/*"]
    identity_two = ["/api/v1/users/*", "/api/v1/roles/*", "/api/v1/permissions/*", "/api/v1/invitations/*"]
    ingest       = ["/api/v1/applications", "/api/v1/applications/*", "/api/v1/event-types", "/api/v1/event-types/*"]
    notification = ["/api/v1/notifications", "/api/v1/notifications/*", "/ws/*"]
    analytics    = ["/api/v1/analytics/*"]
    audit        = ["/api/v1/audit-logs", "/api/v1/audit-logs/*"]
  }
  route_target = {
    identity     = "identity"
    identity_two = "identity"
    ingest       = "ingest"
    notification = "notification"
    analytics    = "analytics"
    audit        = "audit"
  }
  route_priority = { for index, name in sort(keys(local.routes)) : name => 10 + index }
}

resource "aws_lb_listener_rule" "route" {
  for_each     = local.routes
  listener_arn = aws_lb_listener.https.arn
  priority     = local.route_priority[each.key]

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service[local.route_target[each.key]].arn
  }

  condition {
    path_pattern {
      values = each.value
    }
  }
}

# API paths nobody serves are an error, never the web application's page.
resource "aws_lb_listener_rule" "unknown_api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      status_code  = "404"
      message_body = "{\"error\":{\"code\":\"NOT_FOUND\",\"message\":\"No API route matches this path\"}}"
    }
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}
