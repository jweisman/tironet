output "mx_record_value" {
  value = "10 ${local.inbound_smtp}"
}

output "s3_bucket_name" {
  value = aws_s3_bucket.mail.bucket
}

output "lambda_name" {
  value = aws_lambda_function.forwarder.function_name
}

output "receipt_rule_set" {
  value = aws_ses_receipt_rule_set.this.rule_set_name
}