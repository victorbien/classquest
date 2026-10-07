# Research Traceability Matrix

Maps the ClassQuest cloud architecture report (INFS803, Evans & Bien, S2 2026)
to the prototype. Every major decision traces to a **report section** or an
**explicitly documented prototype assumption**.

Status legend:
- **Implemented** — working in this prototype (on LocalStack where AWS is involved).
- **Simulated** — behaviour reproduced with a documented local stand-in.
- **Documented** — part of the report's production design; not provisioned by this repository.

## 1. Functional requirements

| # | Requirement | Report | Prototype component | Implementation | Status |
|---|-------------|--------|---------------------|----------------|--------|
| FR-1 | Role-scoped authentication (student/teacher/admin) | §2.3.6, §6.1 | `shared/auth/jwt.ts`; `/auth/login`, `/auth/me`; SPA route guards | JWT + bcrypt; role checks in the App Tier | Implemented |
| FR-2 | Teacher uploads documents/books/videos | §1.2, §2.3.2 | `routes/assets.ts`, `publish.ts`; **Publish Resource** / **Add Resource** page | Multipart upload via the Web Tier into a course the teacher manages | Implemented |
| FR-3 | Asset files in S3 under typed prefixes | §5.4.2 | `cloud/storage.ts`; `s3.tf` | `documents/` (documents, books) and `videos/` keys | Implemented |
| FR-4 | Metadata in MySQL (RDS) | §2.3.3, §5.3 | `db/migrate.ts`, `db/repositories.ts` | MySQL 8 container; 5.7-compatible schema | Implemented (container stands in for RDS) |
| FR-5 | Asynchronous processing via a queue | §2.3.2, §3.7 | `cloud/queue.ts`; `services/worker` | SQS; DB moved to `queued` before send; idempotent, state-machine-checked worker | Implemented |
| FR-6 | Retry, then dead-letter failed jobs | §10.10 | `messaging.tf`; `worker/processor.ts` | Two retries, `failed` on attempt 3, **native SQS redrive** (`maxReceiveCount=3`) to the DLQ | Implemented |
| FR-7 | List and open published resources | §3.7, §4.9.6 | `/courses/:id`, `/assets/:id`; **Course** page (students), **Library** (staff) | Presigned S3 URLs (5 min); students see completed resources of published courses only | Implemented |
| FR-8 | 5-year tiered lifecycle (Standard → Glacier → expire) | §2.3.4, §5.4.3–5.4.5 | `s3.tf`; `/demo/lifecycle-simulate` | Lifecycle rule provisioned; transition shown on demand | Implemented (rule) + Simulated (transition) |
| FR-9 | Dashboard of real metrics | §7, §15 | `/dashboard/metrics`, `/health`; **Operations** and **Teacher Dashboard** | Measured values from MySQL, SQS and CloudWatch only | Implemented |
| FR-10 | Alert on >50 HTTP 400/min | §2.2.8, §7.6–7.8 | `monitoring.tf`; `cloud/logs.ts`; `/demo/bad-request` | Access logs, metric filter, alarm and SNS action provisioned; Operations shows the App Tier's measured 400 count. LocalStack Community does not evaluate alarm state, and SNS email is not delivered locally | Implemented (resources) + Documented (alarm firing → SNS email) |
| FR-11 | Demo mode with labelled sample data | brief §18 | `routes/demo.ts`; `sample-data/`; Operations controls | Seed, induce failure, Glacier simulation, 400 burst; teacher/admin only; `DEMO_MODE` gated | Implemented |
| FR-12 | System status / health | §5.1.6, §7 | `/health`; web-tier `/healthz`; Operations | Per-dependency checks; 200 healthy / 200 degraded-observability / 503 degraded | Implemented |
| FR-13 | Students see their own progress | §1.2 (actor) | `resource_access`; `/me/progress`; **Home**, **Courses**, **My Progress** | Resources opened vs available, overall, by type and per course, recent opens — access only, not grades or mastery | Implemented |
| FR-14 | Courses group resources (prototype extension) | Prototype assumption A8 | `courses` table; `routes/courses.ts`; **My Courses**, **Course** pages | Draft/published/archived lifecycle, ordered resources with week/section labels, optional S3 cover; same S3/SQS pipeline | Implemented |

## 2. Non-functional requirements

| # | Requirement | Report | Prototype | Status |
|---|-------------|--------|-----------|--------|
| NFR-1 | High availability / no SPOF | §2.2.3, §3.5, §10.3 | Stateless tiers; multi-AZ and RDS failover are design only | Documented |
| NFR-2 | Horizontal scalability | §2.2.4, §10.2 | Scale workers by replica count | Implemented |
| NFR-3 | Elasticity under spikes | §2.2.4, §10.1 | SQS buffers uploads; add workers | Implemented |
| NFR-4 | Fault tolerance | §5.1.6, §10.10 | Retries, DLQ, idempotent worker, 503 on core failure | Implemented |
| NFR-5 | Security | §2.3.6, §6, §12.4 | JWT/RBAC, validation, presigned access; IAM provisioned but not enforced locally (`SECURITY.md`) | Implemented (app) / Documented (network, WAF, secrets) |
| NFR-6 | Observability | §7 | pino logs, CloudWatch logs/metrics, Operations page (`docs/OBSERVABILITY.md`) | Implemented |
| NFR-7 | Storage independent of compute | §2.3.4 | S3 | Implemented |
| NFR-8 | Reproducibility | §2.7 | `docker compose up` runs Terraform and the stack | Implemented |
| NFR-9 | Data residency ap-southeast-2 | §2.4, §3.2 | Region configured; runs locally | Documented |
| NFR-10 | Cost awareness | §11 | README cost note | Documented |

## 3. AWS service mapping

| Report service | Prototype realisation | Status |
|----------------|-----------------------|--------|
| Amazon S3 (lifecycle, versioning, BPA, SSE) | `s3.tf` on LocalStack; SDK calls | Implemented |
| Amazon SQS (+DLQ) | `messaging.tf` on LocalStack; worker | Implemented |
| Amazon SNS | Topic + email subscription on LocalStack; no email delivered; not triggered locally because the alarm is not evaluated | Implemented (resource) / Documented (delivery) |
| Amazon CloudWatch (logs, metric filter, alarm, metrics) | `monitoring.tf` on LocalStack; app and worker metrics | Implemented (alarm evaluation: AWS only) |
| AWS IAM / STS | Roles and instance profiles on LocalStack; demo `AssumeRole`; not enforced by LocalStack Community | Implemented (resources) / Documented (enforcement) |
| Amazon RDS for MySQL Multi-AZ | MySQL 8 container | Simulated |
| Route 53 / NLB / ALB | Web Tier container + Compose networking | Simulated / Documented |
| EC2 Auto Scaling | Containers scaled by replica count | Simulated |
| VPC, subnets, SG, NACL | One Docker network | Documented |
| AWS WAF & Shield | Web Tier rate limiting | Simulated / Documented |
| Secrets Manager | `.env` variables | Documented |
| CloudTrail / Config / GuardDuty | — | Documented |

The repository's Terraform provisions only the S3, SQS, SNS, CloudWatch and IAM
resources. Everything marked *Documented* is in the report's design only.

## 4. Documented prototype assumptions

- **A1** All content is synthetic `DEMO/SAMPLE` data; no real student data (§2.4).
- **A2** RDS is replaced by a MySQL 8 container with a 5.7-compatible schema (§5.3.2).
- **A3** LocalStack Community: alarm state is not evaluated, SNS email is not
  delivered, IAM is not enforced.
- **A4** Glacier transitions are simulated on demand; restore is not implemented.
- **A5** The production network/compute layer (§3–§5) is documented, not provisioned.
- **A6** Dashboards show only measured values; nothing is fabricated (brief §20).
- **A7** Student progress means resources opened — not grades, mastery or completion.
- **A8** Courses are a lightweight organising layer added for the prototype
  (not a report requirement): no enrolment, grading, quizzes, assignments,
  forums or certificates. Every published course is visible to every student.

## 5. Acceptance criteria

| AC | Description | Verified by |
|----|-------------|-------------|
| AC-1 | One-command provisioning on LocalStack | `docker compose up -d --build` (Terraform container) |
| AC-2 | Upload → queued → processing → completed → open | `tests/integration/stack.test.ts` (S3 + MySQL verified for document/book/video); `tests/e2e/workflow.test.ts`; `tests/unit/publish.test.ts` |
| AC-3 | Induced failure → retries → failed → DLQ | `tests/unit/processor.test.ts` (redrive contract); `tests/e2e/workflow.test.ts` (message found on the DLQ) |
| AC-4 | >50 HTTP 400/min recorded; alarm wiring present | `tests/e2e/workflow.test.ts`; `tests/unit/operations.test.ts`; `npm run demo:400-burst` |
| AC-5 | Dashboards show real values | `dashboard.ts`, `health.ts`; `tests/unit/operations.test.ts` |
| AC-6 | Standard → Glacier observable | `tests/integration/stack.test.ts` (S3 storage class, MySQL, metrics; re-run safe); Operations storage panel |
| AC-7 | Role-based access | `tests/unit/appTierAuthz.test.ts`; `tests/unit/navigation.test.ts`; `tests/api/appTier.test.ts` |
| AC-8 | Student progress recorded from real opens | `tests/integration/stack.test.ts` (rows + `/me/progress` vs MySQL, overall and per course); `tests/unit/appTierAuthz.test.ts`; `tests/integration/progressDb.test.ts` (opt-in) |
| AC-10 | Course lifecycle and visibility | `tests/unit/courses.test.ts`; `tests/integration/stack.test.ts` (draft → publish → archive vs MySQL/S3); `tests/integration/progressDb.test.ts` (migration, per-course aggregate); `tests/e2e/workflow.test.ts` |
| AC-9 | This matrix | this file |

`npm test` runs every suite; suites that need the Docker stack are reported as
skipped when it is not running. `npm run test:acceptance` runs only the live
suites and fails if the stack is unreachable.
