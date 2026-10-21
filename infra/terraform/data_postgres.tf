resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = [for subnet in aws_subnet.data : subnet.id]
}

resource "aws_db_parameter_group" "postgres" {
  name_prefix = "${local.name}-"
  family      = "postgres${var.postgres_engine_version}"
  description = "Solmira PostgreSQL settings"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
  parameter {
    name  = "log_connections"
    value = "1"
  }
  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

data "aws_iam_policy_document" "rds_monitoring_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rds_monitoring" {
  name               = "${local.name}-rds-monitoring"
  assume_role_policy = data.aws_iam_policy_document.rds_monitoring_assume.json
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# One instance, five databases (one per service, ADR-0012). The master credentials are generated and
# kept by RDS in Secrets Manager; the services never see them. They run as the per-service roles that
# the bootstrap task creates (docs/operations/first-deploy.md).
# The services connect with per-role passwords from Secrets Manager (verify-full
# TLS). Database IAM authentication would need the services to refresh a token every fifteen
# minutes; it is on the list in docs/security-review.md.
#trivy:ignore:AWS-0176
resource "aws_db_instance" "postgres" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = var.postgres_engine_version
  instance_class = var.postgres_instance_class

  allocated_storage     = var.postgres_allocated_storage_gb
  max_allocated_storage = var.postgres_max_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.data.arn

  db_name                       = "postgres"
  username                      = "solmira_admin"
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.data.arn

  multi_az               = var.postgres_multi_az
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.postgres.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.postgres.name
  ca_cert_identifier     = "rds-ca-rsa2048-g1"
  network_type           = "IPV4"

  backup_retention_period    = var.postgres_backup_retention_days
  backup_window              = "02:00-03:00"
  maintenance_window         = "sun:03:30-sun:04:30"
  copy_tags_to_snapshot      = true
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${local.name}-final"
  auto_minor_version_upgrade = true

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.data.arn
  performance_insights_retention_period = 7
  monitoring_interval                   = 60
  monitoring_role_arn                   = aws_iam_role.rds_monitoring.arn
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]

  lifecycle {
    prevent_destroy = true
  }
}

# One password per database role. They are in the state (encrypted at rest, see README) and in Secrets
# Manager, from where the tasks read them as environment secrets.
resource "random_password" "database" {
  for_each = toset(local.database_roles)
  length   = 40
  special  = false
}
