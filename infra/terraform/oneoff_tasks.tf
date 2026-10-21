# One-off tasks, started by hand or by the deployment pipeline with `aws ecs run-task`:
#   db-bootstrap   creates the databases and roles (once per environment)
#   migrate-<svc>  applies a service's migrations as its schema-owner role (every deploy that has any)
# They use a role with no permissions of its own: they need the database and nothing else.

resource "aws_cloudwatch_log_group" "oneoff" {
  name              = "/${var.name_prefix}/${var.environment}/oneoff"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.data.arn
}

locals {
  oneoff_log = {
    logDriver = "awslogs"
    options = {
      "awslogs-group"         = aws_cloudwatch_log_group.oneoff.name
      "awslogs-region"        = var.region
      "awslogs-stream-prefix" = "task"
    }
  }
}

resource "aws_ecs_task_definition" "migrate" {
  for_each                 = toset(local.database_services)
  family                   = "${local.name}-migrate-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.bootstrap.arn

  container_definitions = jsonencode([
    {
      name                   = "migrate"
      image                  = "${aws_ecr_repository.service[each.key].repository_url}:${var.image_tag}"
      essential              = true
      command                = ["node", "dist/database/migrate.js"]
      readonlyRootFilesystem = true
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "NODE_EXTRA_CA_CERTS", value = "/app/certs/rds-global-bundle.pem" },
      ]
      secrets          = [{ name = "MIGRATION_DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.service[each.key].arn}:MIGRATION_DATABASE_URL::" }]
      logConfiguration = local.oneoff_log
    },
  ])
}

# Creates every database and role (infra/aws/db-bootstrap): the master credentials are read from the
# secret RDS keeps, the role passwords from the bootstrap secret.
resource "aws_ecs_task_definition" "bootstrap" {
  family                   = "${local.name}-db-bootstrap"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.bootstrap.arn

  container_definitions = jsonencode([
    {
      name      = "bootstrap"
      image     = "${aws_ecr_repository.service["db-bootstrap"].repository_url}:${var.image_tag}"
      essential = true
      environment = [
        { name = "PGHOST", value = aws_db_instance.postgres.address },
        { name = "PGPORT", value = "5432" },
        { name = "PGDATABASE", value = "postgres" },
        { name = "PGSSLMODE", value = "verify-full" },
        { name = "PGSSLROOTCERT", value = "/certs/rds-global-bundle.pem" },
      ]
      secrets = concat(
        [
          { name = "PGUSER", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:username::" },
          { name = "PGPASSWORD", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:password::" },
        ],
        [for role in local.database_roles : { name = "ROLE_PASSWORD_${upper(role)}", valueFrom = "${aws_secretsmanager_secret.bootstrap.arn}:${upper(role)}::" }],
      )
      logConfiguration = local.oneoff_log
    },
  ])
}
