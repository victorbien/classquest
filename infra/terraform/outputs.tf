output "s3_bucket" {
  description = "Media asset bucket name."
  value       = aws_s3_bucket.media.id
}

output "sqs_queue_url" {
  description = "Asset-processing queue URL."
  value       = aws_sqs_queue.processing.id
}

output "sqs_dlq_url" {
  description = "Dead-letter queue URL."
  value       = aws_sqs_queue.dlq.id
}

output "sns_topic_arn" {
  description = "Admin alert topic ARN."
  value       = aws_sns_topic.admin_alerts.arn
}

output "cw_log_group" {
  description = "ALB access-log group name."
  value       = aws_cloudwatch_log_group.alb_access.name
}

output "http_400_alarm_name" {
  description = "HTTP-400 CloudWatch alarm name."
  value       = aws_cloudwatch_metric_alarm.http_400_high.alarm_name
}

output "app_role_arn" {
  description = "Application Tier IAM role ARN (credential-less access)."
  value       = aws_iam_role.app.arn
}

output "web_role_arn" {
  description = "Web Tier IAM role ARN (read-only)."
  value       = aws_iam_role.web.arn
}

# ======================================================================
# Production deployment outputs (aws target). Empty on the LocalStack target.
# ======================================================================

output "ec2_public_ip" {
  description = "Public IP of the compute instance (aws target)."
  value       = one(aws_instance.app[*].public_ip)
}

output "ec2_public_dns" {
  description = "Public DNS of the compute instance (aws target)."
  value       = one(aws_instance.app[*].public_dns)
}

output "app_url" {
  description = "URL to open the application once bootstrap finishes (aws target)."
  value       = local.is_aws ? "http://${one(aws_instance.app[*].public_ip)}" : null
}

output "rds_endpoint" {
  description = "RDS MySQL endpoint address (aws target)."
  value       = one(aws_db_instance.mysql[*].address)
}

output "vpc_id" {
  description = "Production VPC id (aws target)."
  value       = one(aws_vpc.main[*].id)
}
