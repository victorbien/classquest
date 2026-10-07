variable "cloud_target" {
  description = "Where to provision: 'localstack' (demo) or 'aws' (real cloud)."
  type        = string
  default     = "localstack"
  validation {
    condition     = contains(["localstack", "aws"], var.cloud_target)
    error_message = "cloud_target must be 'localstack' or 'aws'."
  }
}

variable "aws_region" {
  description = "AWS region. Report targets ap-southeast-2 (Sydney) for trans-Tasman residency (report 3.2)."
  type        = string
  default     = "ap-southeast-2"
}

variable "localstack_endpoint" {
  description = "LocalStack endpoint used when cloud_target = localstack."
  type        = string
  default     = "http://localstack:4566"
}

variable "env_name" {
  description = "Environment name suffix (dev/test/prod)."
  type        = string
  default     = "dev"
}

variable "s3_bucket" {
  description = "Media asset bucket (report 5.4)."
  type        = string
  default     = "classquest-media-assets-dev"
}

variable "sqs_queue_name" {
  description = "Async asset-processing queue (report 3.7)."
  type        = string
  default     = "classquest-asset-processing"
}

variable "sqs_dlq_name" {
  description = "Dead-letter queue for poison messages (report 10.10)."
  type        = string
  default     = "classquest-asset-processing-dlq"
}

variable "sns_topic_name" {
  description = "Admin alert topic (report 7.8)."
  type        = string
  default     = "classquest-admin-alerts"
}

variable "cw_log_group" {
  description = "ALB-style access log group for the HTTP-400 metric filter (report 7.6)."
  type        = string
  default     = "/aws/alb/classquest-dev"
}

variable "cw_namespace" {
  description = "CloudWatch custom metric namespace."
  type        = string
  default     = "ClassQuest/Prototype"
}

variable "admin_alert_email" {
  description = "Admin email for SNS subscription (prod). Captured locally under LocalStack (report 7.8)."
  type        = string
  default     = "sysadmin@classquest.example"
}

variable "http_400_threshold" {
  description = "HTTP 400 errors per minute that trigger the alarm (report 2.2.8 / 7.7)."
  type        = number
  default     = 50
}

variable "http_400_period_seconds" {
  description = "Evaluation period for the HTTP-400 alarm."
  type        = number
  default     = 60
}

variable "glacier_transition_days" {
  description = "Days before objects transition Standard -> Glacier (report 5.4.5)."
  type        = number
  default     = 90
}

variable "expiration_days" {
  description = "Days before objects expire — 5-year retention (report 5.4.3)."
  type        = number
  default     = 1825
}

# ======================================================================
# Production deployment variables (aws target: VPC, EC2, RDS).
# Unused by the LocalStack target.
# ======================================================================

# ---- Network ----
variable "vpc_cidr" {
  description = "CIDR block for the production VPC (aws target)."
  type        = string
  default     = "10.20.0.0/16"
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to SSH to the EC2 instance (aws target). Lock this to your IP (e.g. 203.0.113.4/32)."
  type        = string
  default     = "0.0.0.0/0"
}

# ---- Compute (EC2) ----
variable "instance_type" {
  description = "EC2 instance type for the compute tier (aws target)."
  type        = string
  default     = "t3.medium"
}

variable "instance_disk_gb" {
  description = "Root EBS volume size (GiB) for the EC2 instance."
  type        = number
  default     = 30
}

variable "ec2_key_name" {
  description = "Existing EC2 key pair name for SSH. Leave empty to launch without an SSH key."
  type        = string
  default     = ""
}

variable "git_repo_url" {
  description = "Git repository the EC2 instance clones to build the app."
  type        = string
  default     = "https://github.com/victorbien/classquest.git"
}

variable "git_branch" {
  description = "Git branch the EC2 instance checks out."
  type        = string
  default     = "main"
}

# ---- Database (RDS for MySQL) ----
variable "db_instance_class" {
  description = "RDS instance class (aws target)."
  type        = string
  default     = "db.t3.micro"
}

variable "db_engine_version" {
  description = "RDS MySQL engine version."
  type        = string
  default     = "8.0"
}

variable "db_allocated_storage" {
  description = "Initial RDS storage in GiB."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Storage autoscaling ceiling in GiB."
  type        = number
  default     = 100
}

variable "db_multi_az" {
  description = "Enable RDS Multi-AZ for high availability (report 3.5). Doubles DB cost."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "Automated backup retention in days."
  type        = number
  default     = 7
}

variable "mysql_database" {
  description = "Application database name."
  type        = string
  default     = "classquest"
}

variable "mysql_user" {
  description = "Application / RDS master username."
  type        = string
  default     = "classquest_app"
}

variable "db_password" {
  description = "RDS master password (aws target). Supply via TF_VAR_db_password; never commit. Unused by the localstack target."
  type        = string
  sensitive   = true
  default     = "" # localstack target does not create RDS; aws target MUST override
}

# ---- Application secrets / tuning passed to the instance .env ----
variable "jwt_secret" {
  description = "JWT signing secret for the app (aws target). Supply via TF_VAR_jwt_secret; never commit. Unused by the localstack target."
  type        = string
  sensitive   = true
  default     = "" # localstack target does not use this; aws target MUST override
}

variable "max_upload_bytes" {
  description = "Maximum upload size in bytes."
  type        = number
  default     = 52428800
}
