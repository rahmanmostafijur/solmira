locals {
  images = concat(keys(local.service_ports), ["db-bootstrap"])
}

# Immutable tags: a tag always means the same image, so a rollback is a redeploy of an earlier tag.
resource "aws_ecr_repository" "service" {
  for_each             = toset(local.images)
  name                 = "${var.name_prefix}/${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.data.arn
  }
}

resource "aws_ecr_lifecycle_policy" "service" {
  for_each   = aws_ecr_repository.service
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 40 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 40 }
      action       = { type = "expire" }
    }]
  })
}
