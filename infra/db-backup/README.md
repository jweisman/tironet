# Neon DB Backup — AWS Infrastructure

Terraform config that provisions:
- S3 bucket with versioning, encryption, and public access blocked
- Lifecycle rule: immediate transition to Glacier Deep Archive, expiry at 180 days
- IAM user with write-only (`s3:PutObject`) access — no delete or read permissions

## Usage

```bash
terraform init
terraform apply -var="bucket_name=your-unique-bucket-name"
```

After apply, retrieve the IAM credentials for GitHub Actions:

```bash
terraform output aws_access_key_id
terraform output -raw aws_secret_access_key
```

Add these as secrets in **both** GitHub repos:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

## Security model

The IAM user has `s3:PutObject` only — no read, no delete. A leaked GitHub
secret can upload backups but cannot destroy them. Versioning protects against
accidental overwrites.

## Notes

- Glacier Deep Archive costs ~$0.00099/GB-month. Retrieval takes 12–48 hours.
- The 180-day expiry aligns with Glacier's 90-day minimum storage duration,
  so you're not paying for early deletion penalties.
- Use the unpooled (direct) Neon connection string for `pg_dump`, not the
  pooled one.
