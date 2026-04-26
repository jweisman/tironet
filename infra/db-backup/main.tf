terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# -------------------------------------------------------
# S3 Bucket
# -------------------------------------------------------

resource "aws_s3_bucket" "db_backups" {
  bucket = var.bucket_name

  tags = {
    Purpose = "neon-db-backups"
  }
}

resource "aws_s3_bucket_public_access_block" "db_backups" {
  bucket = aws_s3_bucket.db_backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "db_backups" {
  bucket = aws_s3_bucket.db_backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "db_backups" {
  bucket = aws_s3_bucket.db_backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# -------------------------------------------------------
# Lifecycle Policy: transition to Glacier Deep Archive
# immediately, expire after 180 days
# -------------------------------------------------------

resource "aws_s3_bucket_lifecycle_configuration" "db_backups" {
  bucket = aws_s3_bucket.db_backups.id

  rule {
    id     = "glacier-deep-archive"
    status = "Enabled"

    filter {} # applies rule to all objects in the bucket

    transition {
      days          = 0
      storage_class = "DEEP_ARCHIVE"
    }

    expiration {
      days = 180
    }

    # Also expire old versions of objects (from versioning)
    noncurrent_version_expiration {
      noncurrent_days = 180
    }
  }
}

# -------------------------------------------------------
# IAM User (write-only access for GitHub Actions)
# -------------------------------------------------------

resource "aws_iam_user" "github_actions_backup" {
  name = var.iam_user_name

  tags = {
    Purpose = "neon-db-backup-github-actions"
  }
}

resource "aws_iam_user_policy" "github_actions_backup" {
  name = "neon-backup-write-only"
  user = aws_iam_user.github_actions_backup.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.db_backups.arn}/*"
      }
    ]
  })
}

resource "aws_iam_access_key" "github_actions_backup" {
  user = aws_iam_user.github_actions_backup.name
}
