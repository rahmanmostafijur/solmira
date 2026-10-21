# Who may talk to whom. Rules name security groups, not address ranges, so they follow the tasks.
#
# Two groups of containers:
#   tasks          may reach the internet: the dispatcher delivers to addresses customers choose, web
#                  calls its own public address, identity sends mail.
#   tasks_private  reach only the VPC and the S3 and DynamoDB gateway endpoints: ingest, notification,
#                  analytics and audit have no reason to talk to the internet, so a compromise of one
#                  cannot call out.

locals {
  internet_services = ["web", "identity", "dispatcher"]
  service_security_group = {
    for service in keys(local.service_ports) :
    service => contains(local.internet_services, service) ? aws_security_group.tasks.id : aws_security_group.tasks_private.id
  }
  task_groups = {
    tasks         = aws_security_group.tasks.id
    tasks_private = aws_security_group.tasks_private.id
  }
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Internet-facing load balancer"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from anywhere"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP, only to redirect to HTTPS"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_tasks" {
  for_each                     = local.service_ports
  security_group_id            = aws_security_group.alb.id
  description                  = "To the ${each.key} tasks"
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
  referenced_security_group_id = local.service_security_group[each.key]
}

resource "aws_security_group" "tasks" {
  name        = "${local.name}-tasks"
  description = "Containers that may reach the internet"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "tasks_private" {
  name        = "${local.name}-tasks-private"
  description = "Containers that reach only the VPC and the AWS gateway endpoints"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  for_each                     = local.service_ports
  security_group_id            = local.service_security_group[each.key]
  description                  = "The load balancer to ${each.key}"
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_ingress_rule" "identity_jwks" {
  for_each                     = local.task_groups
  security_group_id            = aws_security_group.tasks.id
  description                  = "Services fetch the token signing keys from identity (${each.key})"
  ip_protocol                  = "tcp"
  from_port                    = local.service_ports.identity
  to_port                      = local.service_ports.identity
  referenced_security_group_id = each.value
}

# The dispatcher must reach any address a customer registers; web must reach its own
# public address and identity the mail provider. The checks that keep the dispatcher away from private
# networks are in the application (ADR-0028, ADR-0031), and the data tier accepts only these groups.
#trivy:ignore:AWS-0104
resource "aws_vpc_security_group_egress_rule" "tasks_out" {
  security_group_id = aws_security_group.tasks.id
  description       = "Outbound: webhook deliveries, mail, AWS APIs, data stores"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "private_to_vpc" {
  security_group_id = aws_security_group.tasks_private.id
  description       = "Data stores, other services and the interface endpoints, inside the VPC"
  ip_protocol       = "-1"
  cidr_ipv4         = var.vpc_cidr
}

resource "aws_vpc_security_group_egress_rule" "private_to_gateway_endpoints" {
  for_each = {
    s3       = aws_vpc_endpoint.s3.prefix_list_id
    dynamodb = aws_vpc_endpoint.dynamodb.prefix_list_id
  }
  security_group_id = aws_security_group.tasks_private.id
  description       = "${each.key} through its gateway endpoint (image layers, the attempt history)"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = each.value
}

resource "aws_security_group" "endpoints" {
  name        = "${local.name}-vpc-endpoints"
  description = "Interface endpoints"
  vpc_id      = aws_vpc.main.id
}

# The three groups below accept connections from both groups of containers, on one port each.
locals {
  data_ports = {
    postgres = { group = aws_security_group.postgres.id, port = 5432, label = "PostgreSQL" }
    redis    = { group = aws_security_group.redis.id, port = 6379, label = "the Redis protocol" }
    rabbitmq = { group = aws_security_group.rabbitmq.id, port = 5671, label = "AMQP over TLS" }
    endpoint = { group = aws_security_group.endpoints.id, port = 443, label = "HTTPS to the AWS interface endpoints" }
  }
  data_access = merge([
    for store, details in local.data_ports : {
      for group_name, group_id in local.task_groups : "${store}-${group_name}" => merge(details, { source = group_id })
    }
  ]...)
}

resource "aws_vpc_security_group_ingress_rule" "data_from_tasks" {
  for_each                     = local.data_access
  security_group_id            = each.value.group
  description                  = "${each.value.label} from the containers"
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
  referenced_security_group_id = each.value.source
}

resource "aws_security_group" "postgres" {
  name        = "${local.name}-postgres"
  description = "RDS PostgreSQL"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "ElastiCache"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "rabbitmq" {
  name        = "${local.name}-rabbitmq"
  description = "Amazon MQ for RabbitMQ"
  vpc_id      = aws_vpc.main.id
}
