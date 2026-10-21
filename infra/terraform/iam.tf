data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }
}

# The execution role starts tasks: it pulls images, writes their logs and reads their secrets. The
# application cannot use it; it is not the task role.
resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid     = "ReadServiceSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      [for secret in aws_secretsmanager_secret.service : secret.arn],
      [
        aws_secretsmanager_secret.identity_signing_keys.arn,
        aws_secretsmanager_secret.bootstrap.arn,
        aws_db_instance.postgres.master_user_secret[0].secret_arn,
        var.smtp_url_secret_arn,
      ],
    )
  }
  statement {
    sid       = "ReadCollectorConfiguration"
    actions   = ["ssm:GetParameters"]
    resources = [aws_ssm_parameter.collector_config.arn]
  }
  statement {
    sid       = "DecryptSecrets"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.data.arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# One task role per service, each with only what that service calls.
resource "aws_iam_role" "task" {
  for_each           = local.service_ports
  name               = "${local.name}-${each.key}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "tracing" {
  statement {
    sid       = "SendTraces"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "tracing" {
  for_each = aws_iam_role.task
  name     = "send-traces"
  role     = each.value.id
  policy   = data.aws_iam_policy_document.tracing.json
}

# Wrapping and unwrapping the data keys of signing secrets: only for that purpose, enforced by the
# key service through the encryption context the application sends (ADR-0026, ADR-0038).
data "aws_iam_policy_document" "ingest" {
  statement {
    sid       = "ReadAttemptHistory"
    actions   = ["dynamodb:Query", "dynamodb:GetItem"]
    resources = [aws_dynamodb_table.attempts.arn, "${aws_dynamodb_table.attempts.arn}/index/gsi1"]
  }
  statement {
    sid       = "WrapSigningSecrets"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = concat([aws_kms_key.secrets.arn], var.signing_secrets_previous_key_arns)
    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:purpose"
      values   = ["webhook-signing-secret"]
    }
  }
}

resource "aws_iam_role_policy" "ingest" {
  name   = "ingest"
  role   = aws_iam_role.task["ingest"].id
  policy = data.aws_iam_policy_document.ingest.json
}

# The dispatcher can unwrap keys and write history, and cannot create keys or read history.
data "aws_iam_policy_document" "dispatcher" {
  statement {
    sid       = "WriteAttemptHistory"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.attempts.arn]
  }
  statement {
    sid       = "UnwrapSigningSecrets"
    actions   = ["kms:Decrypt"]
    resources = concat([aws_kms_key.secrets.arn], var.signing_secrets_previous_key_arns)
    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:purpose"
      values   = ["webhook-signing-secret"]
    }
  }
}

resource "aws_iam_role_policy" "dispatcher" {
  name   = "dispatcher"
  role   = aws_iam_role.task["dispatcher"].id
  policy = data.aws_iam_policy_document.dispatcher.json
}

# The one-off task that creates databases and roles.
resource "aws_iam_role" "bootstrap" {
  name               = "${local.name}-db-bootstrap-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}
