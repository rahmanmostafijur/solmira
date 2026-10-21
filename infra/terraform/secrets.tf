# What each service reads at start, as Secrets Manager secrets (encrypted with the data key). The
# task definitions reference single keys of these JSON documents; no secret is written into a task
# definition or an environment file.

locals {
  postgres_host = aws_db_instance.postgres.address

  # The RDS certificate authority bundle is in the images and trusted through NODE_EXTRA_CA_CERTS
  # (infra/docker/service.Dockerfile), so `verify-full` checks the server's identity.
  postgres_url = {
    for role in local.database_roles : role => (
      "postgres://${role}:${random_password.database[role].result}@${local.postgres_host}:5432/solmira_${
        role == "dispatcher_app" ? "ingest" : split("_", role)[0]
      }?sslmode=verify-full"
    )
  }

  redis_url    = "rediss://:${random_password.redis.result}@${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
  rabbitmq_url = replace(aws_mq_broker.rabbitmq.instances[0].endpoints[0], "amqps://", "amqps://solmira:${random_password.rabbitmq.result}@")

  # Connection settings per service. The dispatcher uses its own narrow role on the ingest database
  # and does not use the broker or run migrations.
  service_secret_values = {
    for service in concat(local.database_services, ["dispatcher"]) : service => merge(
      {
        DATABASE_URL = local.postgres_url[service == "dispatcher" ? "dispatcher_app" : "${service}_app"]
        REDIS_URL    = local.redis_url
      },
      service == "dispatcher" ? {} : {
        MIGRATION_DATABASE_URL = local.postgres_url["${service}_owner"]
        RABBITMQ_URL           = local.rabbitmq_url
      },
    )
  }
}

resource "aws_secretsmanager_secret" "service" {
  for_each   = local.service_secret_values
  name       = "${local.name}/${each.key}"
  kms_key_id = aws_kms_key.data.arn
}

resource "aws_secretsmanager_secret_version" "service" {
  for_each      = local.service_secret_values
  secret_id     = aws_secretsmanager_secret.service[each.key].id
  secret_string = jsonencode(each.value)
}

# The key pair identity-service signs access tokens with. It is created empty and filled by the
# operator (docs/operations/key-rotation.md), so the private key is never in the Terraform state.
resource "aws_secretsmanager_secret" "identity_signing_keys" {
  name        = "${local.name}/identity-signing-keys"
  description = "JSON with JWT_PRIVATE_KEY, JWT_PUBLIC_KEY and JWT_KEY_ID. Filled by the operator."
  kms_key_id  = aws_kms_key.data.arn
}

# The role passwords the bootstrap task needs to create the roles (docs/operations/first-deploy.md).
resource "aws_secretsmanager_secret" "bootstrap" {
  name       = "${local.name}/db-bootstrap"
  kms_key_id = aws_kms_key.data.arn
}

resource "aws_secretsmanager_secret_version" "bootstrap" {
  secret_id = aws_secretsmanager_secret.bootstrap.id
  secret_string = jsonencode({
    for role in local.database_roles : upper(role) => random_password.database[role].result
  })
}
