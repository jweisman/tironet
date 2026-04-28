## Email Forwarding (AWS SES + Terraform)

This project includes a simple email forwarding setup using AWS SES.

### Overview

Inbound email for a specific address (e.g. `support@sitename.org.il`) is:

1. Received by AWS SES
2. Stored in S3
3. Processed by a Lambda function
4. Forwarded to another email address

The original email is attached to the forwarded message as a `.eml` file.

---

## Configuration

All configuration is defined in `infra/terraform.tfvars`:

```hcl
aws_region       = "us-east-1"
domain_name      = "sitename.org.il"
zone_name        = "sitename.org.il"
recipient_email  = "support@sitename.org.il"
forward_to_email = "your@email.com"
from_email       = "forwarder@sitename.org.il"
bucket_name      = "tironet-inbound-email"
rule_set_name    = "default-inbound"
rule_name        = "forward-support"
s3_prefix        = "inbound"
```

Key variables
* `recipient_email` – the address that receives incoming mail
* `forward_to_email` – where the email is forwarded
* `from_email` – sender used by SES when forwarding (must be verified in SES)
* `aws_region` – must support SES receiving

### Usage
*Initial setup:*
```bash
cd infra
terraform init
terraform plan
terraform apply
```

*Updating*
To change configuration (e.g. forwarding address), update terraform.tfvars and run:
```bash
cd infra
terraform plan
terraform apply
```