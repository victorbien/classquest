# ----------------------------------------------------------------------
# Amazon S3 — media asset storage (report 5.4)
# documents/ pictures/ videos/ prefixes (5.4.2); 5-year tiered lifecycle
# (5.4.3-5.4.5); versioning (5.4.6); Block Public Access (5.4.7, 6.8).
# ----------------------------------------------------------------------

resource "aws_s3_bucket" "media" {
  bucket        = var.s3_bucket
  force_destroy = true # prototype convenience; NOT for production
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Block Public Access — assets are retrieved via presigned URLs only (report 5.4.7)
resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Server-side encryption at rest (report 6.8 / 6.12). LocalStack accepts AES256.
resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# 5-year tiered retention: Standard -> Glacier @90d -> expire @1825d (report 5.4.5)
/* resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "ClassQuest5YearMediaLifecycle"
    status = "Enabled"

    filter {} # whole bucket (report: Prefix = /)

    transition {
      days          = var.glacier_transition_days
      storage_class = "GLACIER"
    }

    expiration {
      days = var.expiration_days
    }

    # Keep noncurrent versions bounded (versioning is enabled above)
    noncurrent_version_expiration {
      noncurrent_days = var.expiration_days
    }
  }
} */
