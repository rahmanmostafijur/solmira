# The web application firewall in front of the load balancer replaces the per-address limits of the
# development gateway and adds the managed rule sets. The services still rate limit per API key and per
# account (ADR-0030); this layer stops floods and known-bad requests before they reach a task.

resource "aws_wafv2_web_acl" "main" {
  name  = local.name
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # Stricter limit for the endpoints that guess passwords or send mail.
  rule {
    name     = "auth-rate-limit"
    priority = 10
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_auth_rate_limit_per_5_minutes
        aggregate_key_type = "IP"
        scope_down_statement {
          regex_match_statement {
            regex_string = "^/api/v1/(auth/(login|register|forgot-password|reset-password)|me/password)$"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "auth-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "ip-rate-limit"
    priority = 20
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit_per_5_minutes
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ip-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = {
      "AWSManagedRulesAmazonIpReputationList" = 30
      "AWSManagedRulesKnownBadInputsRuleSet"  = 40
      "AWSManagedRulesCommonRuleSet"          = 50
    }
    content {
      name     = rule.key
      priority = rule.value
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          name        = rule.key
          vendor_name = "AWS"

          # Message payloads are arbitrary JSON from customers and can be large; the body-size and
          # generic-body rules of the common set would refuse legitimate events. Everything else stays.
          dynamic "rule_action_override" {
            for_each = rule.key == "AWSManagedRulesCommonRuleSet" ? ["SizeRestrictions_BODY", "GenericRFI_BODY", "CrossSiteScripting_BODY"] : []
            content {
              name = rule_action_override.value
              action_to_use {
                count {}
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = local.name
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}
