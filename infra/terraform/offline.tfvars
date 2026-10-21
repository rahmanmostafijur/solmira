# Placeholder values for `terraform plan` without an AWS account (continuous integration, review).
# Nothing here is real, and nothing can be applied with it: the credentials are placeholders too.
offline_plan       = true
region             = "eu-west-1"
account_id         = "123456789012"
availability_zones = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]

domain_name     = "app.example.com"
route53_zone_id = "Z0123456789ABCDEFGHIJ"
image_tag       = "0000000"

smtp_url_secret_arn = "arn:aws:secretsmanager:eu-west-1:123456789012:secret:solmira/smtp-AbCdEf"
mail_from           = "Solmira <no-reply@example.com>"
alarm_email         = "oncall@example.com"
