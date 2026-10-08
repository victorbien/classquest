# Variable values for a REAL AWS deployment.
# Copy to aws.tfvars and adjust. Provide credentials via environment or an
# assumed role (never hardcode keys here — report 6.10).
#
#   terraform apply -var-file=aws.tfvars
#
cloud_target = "aws"
aws_region   = "ap-southeast-2" # Sydney — trans-Tasman residency (report 3.2)
env_name     = "prod"

# Bucket names are globally unique — pick your own.
s3_bucket      = "classquest-media-assets-prod"
sqs_queue_name = "classquest-asset-processing"
sqs_dlq_name   = "classquest-asset-processing-dlq"
sns_topic_name = "classquest-admin-alerts"
cw_log_group   = "/aws/alb/classquest-prod"
cw_namespace   = "ClassQuest/Prototype"

# Real admin inbox — will receive an SNS subscription confirmation email.
admin_alert_email       = "sysadmin@your-domain.example"
http_400_threshold      = 50
http_400_period_seconds = 60
glacier_transition_days = 90
expiration_days         = 1825
