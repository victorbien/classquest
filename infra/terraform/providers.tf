# ----------------------------------------------------------------------
# Provider configuration with dual targeting.
# When cloud_target = "localstack", all service endpoints point at
# LocalStack and credentials are the LocalStack dummy values ("test").
# When cloud_target = "aws", the endpoints block and LocalStack-only
# skip flags are dropped, and real AWS credentials are resolved from the
# standard AWS credential chain (environment variables, shared config,
# or an assumed role). NEVER hardcode real keys here (report 6.10).
# ----------------------------------------------------------------------

locals {
  is_localstack = var.cloud_target == "localstack"
}

provider "aws" {
  region = var.aws_region

  # LocalStack-only settings. For real AWS these are all disabled and the
  # SDK's default credential chain supplies real credentials.
  access_key                  = local.is_localstack ? "test" : null
  secret_key                  = local.is_localstack ? "test" : null
  skip_credentials_validation = local.is_localstack
  skip_metadata_api_check     = local.is_localstack
  skip_requesting_account_id  = local.is_localstack
  s3_use_path_style           = local.is_localstack

  # Endpoint overrides exist ONLY for LocalStack. The `dynamic` block emits
  # zero endpoints blocks when targeting real AWS, so the SDK resolves the
  # real regional endpoints instead.
  dynamic "endpoints" {
    for_each = local.is_localstack ? [1] : []
    content {
      iam        = var.localstack_endpoint
      sts        = var.localstack_endpoint
      sqs        = var.localstack_endpoint
      sns        = var.localstack_endpoint
      cloudwatch = var.localstack_endpoint
      logs       = var.localstack_endpoint
      ec2        = var.localstack_endpoint
      s3         = var.localstack_endpoint
    }
  }

  default_tags {
    tags = {
      Project     = "ClassQuest"
      Environment = var.env_name
      ManagedBy   = "Terraform"
      Source      = "INFS803-prototype"
    }
  }
}
