variable "aws_region" {
  description = "AWS region for the S3 bucket"
  type        = string
  default     = "eu-central-1"
}

variable "bucket_name" {
  description = "Globally unique S3 bucket name for DB backups"
  type        = string
  # Example: "myapp-neon-db-backups-prod"
}

variable "iam_user_name" {
  description = "IAM user name for GitHub Actions"
  type        = string
  default     = "github-actions-neon-backup"
}
