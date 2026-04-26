output "bucket_name" {
  description = "S3 bucket name — use in your GitHub Actions workflow"
  value       = aws_s3_bucket.db_backups.bucket
}

output "bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.db_backups.arn
}

output "aws_access_key_id" {
  description = "Access key ID — add as GitHub Actions secret AWS_ACCESS_KEY_ID"
  value       = aws_iam_access_key.github_actions_backup.id
}

output "aws_secret_access_key" {
  description = "Secret access key — add as GitHub Actions secret AWS_SECRET_ACCESS_KEY"
  value       = aws_iam_access_key.github_actions_backup.secret
  sensitive   = true
}
