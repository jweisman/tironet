provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "aws_route53_zone" "this" {
  name         = var.zone_name
  private_zone = false
}

locals {
  lambda_name   = "ses-forwarder"
  inbound_smtp  = "inbound-smtp.${var.aws_region}.amazonaws.com"
  object_prefix = trim(var.s3_prefix, "/")
  object_key    = "${local.object_prefix}/"
}

resource "aws_route53_record" "ses_inbound_mx" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.domain_name
  type    = "MX"
  ttl     = 300

  records = [
    "10 ${local.inbound_smtp}"
  ]
}

resource "aws_s3_bucket" "mail" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "mail" {
  bucket = aws_s3_bucket.mail.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "lambda_role" {
  name               = "ses-forwarder-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "lambda_policy" {
  statement {
    sid    = "ReadInboundMail"
    effect = "Allow"
    actions = [
      "s3:GetObject"
    ]
    resources = [
      "${aws_s3_bucket.mail.arn}/*"
    ]
  }

  statement {
    sid    = "SendViaSES"
    effect = "Allow"
    actions = [
      "ses:SendRawEmail",
      "ses:SendEmail"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "WriteLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "lambda_inline" {
  name   = "ses-forwarder-lambda-policy"
  role   = aws_iam_role.lambda_role.id
  policy = data.aws_iam_policy_document.lambda_policy.json
}

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/lambda/index.mjs"
  output_path = "${path.module}/lambda.zip"
}

resource "aws_lambda_function" "forwarder" {
  function_name = local.lambda_name
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  timeout       = 30
  memory_size   = 256

  environment {
    variables = {
      MAIL_BUCKET     = aws_s3_bucket.mail.bucket
      MAIL_PREFIX     = local.object_prefix
      FORWARD_TO      = var.forward_to_email
      FROM_EMAIL      = var.from_email
      EXPECT_RECIPIENT = var.recipient_email
    }
  }
}

resource "aws_lambda_permission" "allow_ses" {
  statement_id  = "AllowExecutionFromSES"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.forwarder.function_name
  principal     = "ses.amazonaws.com"
}

resource "aws_s3_bucket_policy" "allow_ses_put" {
  bucket = aws_s3_bucket.mail.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSESPuts"
        Effect = "Allow"
        Principal = {
          Service = "ses.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.mail.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

resource "aws_ses_receipt_rule_set" "this" {
  rule_set_name = var.rule_set_name
}

resource "aws_ses_active_receipt_rule_set" "this" {
  rule_set_name = aws_ses_receipt_rule_set.this.rule_set_name
}

resource "aws_ses_receipt_rule" "forward_rule" {
  name          = var.rule_name
  rule_set_name = aws_ses_receipt_rule_set.this.rule_set_name
  recipients    = [var.recipient_email]
  enabled       = true
  scan_enabled  = true
  tls_policy    = "Optional"

  s3_action {
    position          = 1
    bucket_name       = aws_s3_bucket.mail.bucket
    object_key_prefix = local.object_prefix
  }

  lambda_action {
    position        = 2
    function_arn    = aws_lambda_function.forwarder.arn
    invocation_type = "Event"
  }

  depends_on = [
    aws_s3_bucket_policy.allow_ses_put,
    aws_lambda_permission.allow_ses
  ]
}