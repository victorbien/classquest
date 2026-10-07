# Infrastructure as Code (Terraform)

Provisions the ClassQuest cloud resources described in the report, with **dual targeting**:
`localstack` (demo, default) and `aws` (real cloud). Infrastructure is kept separate from
application logic (brief §11).

## Resources created

Shared across both targets (localstack + aws):

| File | Resources | Report § |
|------|-----------|----------|
| `s3.tf` | S3 bucket, versioning, Block Public Access, SSE, 5-year lifecycle (Standard → Glacier @90d → expire @1825d) | §5.4 |
| `messaging.tf` | SQS processing queue + DLQ (redrive maxReceiveCount=3), SNS admin-alerts topic + email subscription | §3.7, §10.10, §7.8 |
| `monitoring.tf` | CloudWatch log group, HTTP-400 metric filter, alarm (>50/min) → SNS | §7.6–§7.8 |
| `iam.tf` | `classquest-web-role` (read-only), `classquest-app-role` (read/write), instance profiles — least privilege | §2.3.6, §6.2 |
| `providers.tf` | AWS provider with LocalStack endpoint overrides | §7 mapping |

Provisioned for the **`aws` target only** (guarded by `count = local.is_aws ? ... : 0`):

| File | Resources | Report § |
|------|-----------|----------|
| `network.tf` | VPC, 2 public + 2 private subnets (2 AZs), Internet Gateway, public route table, web + db security groups | §6.4–§6.5 |
| `rds.tf` | RDS for MySQL 8 (encrypted, private subnets, Multi-AZ optional) + db subnet group | §5.3, §3.5 |
| `compute.tf` | EC2 (Amazon Linux 2023) in a public subnet + cloud-init bootstrap that runs the Docker stack via its instance role | §3.4 |

See [`../../docs/AWS_SETUP.md`](../../docs/AWS_SETUP.md) for the full EC2 + RDS deployment walkthrough.

## Usage

LocalStack (default — this runs automatically inside `docker compose up`):

```bash
cd infra/terraform
terraform init
terraform apply -auto-approve -var-file=localstack.tfvars
```

Real AWS — EC2 + RDS (full walkthrough in [`docs/AWS_SETUP.md`](../../docs/AWS_SETUP.md)):

```bash
cp aws.tfvars.example aws.tfvars   # edit admin email + allowed_ssh_cidr
export TF_VAR_db_password=...       # PowerShell: $env:TF_VAR_db_password = "..."
export TF_VAR_jwt_secret=...        # PowerShell: $env:TF_VAR_jwt_secret  = "..."
terraform init
terraform workspace new aws         # isolate real-AWS state from the LocalStack default state
terraform apply -var-file=aws.tfvars
```

> Use a **separate workspace** for the aws target: this directory already holds
> LocalStack state in the `default` workspace, and the two must not share state.

> Never commit `aws.tfvars`, `*.tfstate`, or credentials. See the repo `.gitignore`.

## Notes / fidelity

- The `aws` target now provisions the VPC, subnets, security groups, RDS and a single EC2 instance
  running the Docker stack. Route 53, NLB/ALB, Auto Scaling and WAF/Shield from the report remain
  **documented** in `ARCHITECTURE.md` (and represented behaviourally by Docker Compose); moving the
  single EC2 instance to a Launch Template + Auto Scaling Group behind an ALB is the next step.
- `force_destroy = true` on the bucket, `skip_final_snapshot = true` and `deletion_protection = false`
  on RDS are prototype conveniences and must be reversed for production.
