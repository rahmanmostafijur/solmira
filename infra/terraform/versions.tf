terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  # State lives in S3 with a lock table (see README). Bucket, key and table are not written here:
  #   terraform init -backend-config=backend.hcl
  # `terraform init -backend=false` is enough to validate and to plan offline.
  backend "s3" {}
}

provider "aws" {
  region = var.region

  # Lets `terraform plan` run without an AWS account (continuous integration, review of a change):
  # nothing is read from AWS and nothing can be applied with the placeholder credentials.
  skip_credentials_validation = var.offline_plan
  skip_requesting_account_id  = var.offline_plan
  skip_metadata_api_check     = var.offline_plan

  default_tags {
    tags = local.tags
  }
}
