variable "aws_region" {
  description = "SES receiving region"
  type        = string
}

variable "domain_name" {
  description = "Domain handled by Route 53 and SES, e.g. example.com"
  type        = string
}

variable "zone_name" {
  description = "Route 53 hosted zone name, usually same as domain_name"
  type        = string
}

variable "recipient_email" {
  description = "Inbound address to match, e.g. info@example.com"
  type        = string
}

variable "forward_to_email" {
  description = "Destination email address to forward inbound mail to"
  type        = string
}

variable "from_email" {
  description = "Verified SES sender used by Lambda when forwarding, e.g. forwarder@example.com"
  type        = string
}

variable "bucket_name" {
  description = "S3 bucket name for raw inbound messages"
  type        = string
}

variable "rule_set_name" {
  description = "SES receipt rule set name"
  type        = string
  default     = "default-inbound"
}

variable "rule_name" {
  description = "SES receipt rule name"
  type        = string
  default     = "forward-inbound-email"
}

variable "s3_prefix" {
  description = "Optional prefix for stored messages"
  type        = string
  default     = "inbound/"
}