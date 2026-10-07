# ClassQuest — Cloud Computing Prototype

A working **proof-of-concept** of the AWS cloud architecture proposed in the
INFS803 report _Cloud Solution Architecture Report — On-Premises to AWS
Migration: ClassQuest_ (Evans & Bien, S2 2026).

ClassQuest is a lightweight course platform: **teachers create courses** and
publish documents, digital books and videos into them, and **students open**
the resources of published courses. The prototype runs the real AWS
service APIs (S3, SQS, SNS, CloudWatch, IAM/STS) against
[LocalStack](https://localstack.cloud) in Docker, provisioned with Terraform,
so the architecture can be operated and evaluated **without an AWS account or
any cloud cost**.

> Research prototype, not a production system. All content is synthetic
> `DEMO/SAMPLE` data. It demonstrates the feasibility of the design; it does not
> prove the research hypothesis.

---

## Quick start

Prerequisites: **Docker Desktop** (with Docker Compose) and **Node.js 20+**
(Node is only needed to run the automated tests on the host). No AWS account.

> New to the project on Windows? Follow the step-by-step
> [developer setup guide](./docs/LOCAL_SETUP.md) (PowerShell commands, expected
> containers, tests and troubleshooting).

**1. Clone and install**

```bash
git clone https://github.com/Sandwich-hye/classquest.git
cd classquest
npm ci            # host-side tooling for tests/lint; the stack itself builds in Docker
```

**2. Configure `.env`** — the defaults work for the LocalStack demo as-is.

```bash
cp .env.example .env              # Windows PowerShell: Copy-Item .env.example .env
```

**3. Start the stack**

```bash
docker compose up -d --build
docker compose ps                 # wait until app-tier and web-tier are "healthy"
```

Compose starts LocalStack and MySQL, runs Terraform once to provision the cloud
resources, then starts the App Tier (which migrates the database and creates
the demo accounts), the Worker and the Web Tier. The first run takes a few
minutes.

**4. Open ClassQuest** at **http://localhost:8080**

**5. Sign in with a demo account** (created automatically when `DEMO_MODE=true`,
the default for LocalStack):

| Role | Email | Password | Lands on |
|------|-------|----------|----------|
| Student | `student@classquest.example` | `DemoStudent123!` | Home |
| Teacher | `teacher@classquest.example` | `DemoTeacher123!` | Dashboard |
| Admin | `admin@classquest.example` | `DemoAdmin123!` | Operations |

**6. Demonstrate the main cloud workflow**

1. As the **teacher**, open **Operations → Demonstration Controls → Seed demo
   catalogue** (or run `npm run demo:seed`). This creates four sample courses
   (Cloud Computing, Applied Blockchain, Data Analytics and the draft
   Cybersecurity Essentials) and publishes their resources.
2. **My Courses → Create Course**, then **Add Resource**: pick a type, add a
   title, an optional week/section label and a file, and watch the pipeline go
   *Submitted → Queued → Processing → Completed*. Publish the course.
3. Sign in as the **student**, open a course from **Courses**, open a
   resource, then check **My Progress** (overall and per course).
4. Back in **Operations** as the teacher: *Induce processing failure*
   (retries → failed → DLQ), *Simulate Glacier lifecycle*, *Generate HTTP 400
   burst*.

The full scripted walkthrough is in [`DEMO.md`](./DEMO.md); the Windows
acceptance checklist is in [`docs/LOCAL_ACCEPTANCE.md`](./docs/LOCAL_ACCEPTANCE.md).

**7. Shut down / reset**

```bash
docker compose down        # stop, keep data
docker compose down -v     # stop and delete all data (MySQL + LocalStack)
```

---

## What the prototype does

| Role | Pages | What they can do |
|------|-------|------------------|
| Student | Home · Courses · My Progress | Browse **published** courses and open their **completed** resources; see which resources they have opened, overall and per course |
| Teacher | Dashboard · My Courses · Publish Resource · Operations | Create, edit, publish, return to draft and archive their own courses; add, order and edit resources; watch processing; run demo controls |
| Admin | Operations · Library | System health, monitoring and demo controls; browse every resource (admins may also manage any course through the API) |

**Courses.** A course (title, description, category, optional cover image,
teacher, status `draft | published | archived`) contains many resources in a
teacher-defined order, each with an optional week/section label. Uploading a
resource still runs the unchanged S3 → MySQL → SQS → Worker pipeline; the
upload just names its course. Students only see resources that are
**completed and in a published course**. Routes: `/courses`, `/courses/new`,
`/courses/:courseId`, `/courses/:courseId/edit`,
`/courses/:courseId/resources/new`. The old student `/library` URL redirects
to `/courses`; teachers and admins keep the all-resources Library at
`/library`.

Wrong-role routes redirect to the role's own landing page. The **backend** is
the real security boundary: every API route checks the JWT and role, and
teachers can only manage the courses they created.

**My Progress means "resources opened"** — recorded when a student obtains a
download link for a completed resource — reported overall, per resource type
and per course (e.g. *Cloud Computing: 3 / 8 resources opened, 37.5%*). It
does not represent grades, mastery or lesson completion.

## Architecture

```
Browser (React SPA)
      │  http://localhost:8080
      ▼
Web Tier   serves the SPA · rate limiting · ALB-style access logs → CloudWatch Logs
      │    proxies /api/* (does not check JWTs itself)
      ▼
App Tier   JWT + role checks · validation · business logic
   ├── MySQL 8        users, courses, assets, jobs, request metrics, resource_access
   ├── Amazon S3      resource files (presigned download links)        ← LocalStack
   └── Amazon SQS ──► Worker(s) ──► S3 read · MySQL status · CloudWatch metrics
          └── DLQ (native redrive after 3 receives)                    ← LocalStack
CloudWatch Logs ─ metric filter (HTTP 400) ─► Alarm ─► SNS              ← LocalStack
```

### Implemented in this prototype

- Three tiers plus a horizontally scalable worker, in Docker Compose.
- S3, SQS (+DLQ), SNS, CloudWatch Logs/metrics/alarm and IAM roles provisioned
  by **Terraform on LocalStack** (`infra/terraform`), exercised through real
  AWS SDK calls. MySQL 8 container stands in for RDS.
- JWT authentication, role-based authorisation, input validation, presigned S3
  access, retry + dead-letter handling, health checks, real measured metrics.

### Production AWS architecture described in the assignment report

The report's VPC with public/private subnets across two AZs, Route 53, NLB/ALB,
EC2 Auto Scaling, RDS Multi-AZ, NAT gateways, WAF/Shield, Secrets Manager and
CloudTrail are **documented, not provisioned**. This repository's Terraform
creates only the S3, SQS, SNS, CloudWatch and IAM resources listed above. See
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

### Known local limitations

- **CloudWatch alarm:** LocalStack Community does not evaluate alarm state from
  metric data, so the HTTP 400 alarm is not expected to move to `ALARM`
  locally. Operations shows the App Tier's own 400 count and labels this.
- **SNS:** the alarm → SNS path is the production design; email is never sent
  locally.
- **Glacier:** the 90-day lifecycle rule is configured, but locally the
  *Simulate Glacier lifecycle* control rewrites objects with the `GLACIER`
  storage class on demand. Restore/retrieval latency is not emulated.
- **IAM:** roles and policies are created, but LocalStack Community does not
  enforce IAM, and the app role does not yet list every action the app uses
  (see [`SECURITY.md`](./SECURITY.md)).
- **RDS:** a single MySQL container; Multi-AZ failover is described, not run.
- **Courses:** deliberately lightweight — no enrolment (every student sees
  every published course), grading, quizzes, assignments, forums or
  certificates. Resource ordering uses up/down arrows (no drag-and-drop).
  Existing resources from before courses were added live in a generated
  *General Library* course (see [`ARCHITECTURE.md`](./ARCHITECTURE.md) §8).

## Repository structure

```
apps/frontend/        React SPA (Vite + TypeScript)
services/web-tier/    Public entry: SPA, rate limit, access logs, /api proxy
services/app-tier/    API: auth, courses, assets, jobs, dashboard metrics, /me/progress, demo
services/worker/      SQS consumer: processing, retries, DLQ via redrive
packages/shared/      Config, logging, domain, DB + migrations, auth, AWS clients
infra/terraform/      S3 / SQS / SNS / CloudWatch / IAM (LocalStack or AWS target)
sample-data/          Synthetic DEMO/SAMPLE users, courses and resources
tests/                unit · api · integration · e2e (+ helper scripts)
docs/                 OBSERVABILITY.md · LOCAL_ACCEPTANCE.md
```

## Testing

| Suite | Files | Needs | Covers |
|-------|-------|-------|--------|
| **Unit** | `tests/unit` | nothing | Job state machine, schemas, worker idempotency and redrive contract, publish write order, route authorisation (in-process App Tier), course API rules (lifecycle, ownership, visibility, upload into a course, ordering, covers), demo gating and seed locking, open tracking, frontend route guards and view logic |
| **API** | `tests/api` | App Tier | Logins for all roles, invalid/expired tokens, role matrix, validation, demo auth, progress endpoint |
| **Integration** | `tests/integration/stack.test.ts`, `cloud.test.ts` | App Tier, LocalStack, MySQL | Terraform resources (redrive, SNS, alarm, metric filter); upload of document/book/video into a course verified in S3 and MySQL; course lifecycle (draft → publish → archive) with student visibility and per-course progress vs MySQL; cover images in S3; validation stores nothing; duplicate SQS delivery; library visibility and filters; presigned download bytes; `resource_access` rows and `/me/progress` vs the database; queue depth, storage tiers and alarm state vs SQS/MySQL/CloudWatch; Glacier simulation (incl. re-run); concurrent seeding |
| **E2E** | `tests/e2e` | Web Tier, App Tier, LocalStack | Through the public entry: SPA deep links and branding, upload → completed → student download, induced failure → retries → **real DLQ**, HTTP 400 burst → measured breach and CloudWatch access-log events |
| **Database** (opt-in) | `tests/integration/progressDb.test.ts` | a disposable MySQL database | Course migration from the pre-course schema, migration idempotency, `resource_access` aggregate overall and per course, draft/archived exclusion, student isolation, ordering, named-lock serialisation |

```bash
npm run test:unit         # no Docker needed
npm run test:all          # everything; live suites are SKIPPED (with a reason) if the stack is down
npm run test:acceptance   # live suites only; FAILS if any required service is unreachable
npm run test:api | test:integration | test:e2e
```

- Live suites never pass by returning early: they are reported as **skipped**
  with a `[SKIPPED] … not reachable` notice, or — under `test:acceptance` —
  **fail**.
- Test files run one at a time because the live suites share one stack.
- The database suite runs only when `TEST_MYSQL_DATABASE` names a disposable
  database (it deletes rows); see `docs/LOCAL_ACCEPTANCE.md`.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | Build all workspaces |
| `npm run typecheck` | Type-check shared, app-tier, web-tier, worker |
| `npm run lint` | ESLint (TypeScript) |
| `npm test` / `test:all` | All suites; live suites skipped with a reason if the stack is down |
| `npm run test:unit` / `test:api` / `test:integration` / `test:e2e` | One suite |
| `npm run test:acceptance` | Live suites only; fails if the Docker stack is unreachable |
| `npm run stack:up` / `stack:down` / `stack:logs` | `docker compose up -d --build` / `down -v` / `logs -f` |
| `npm run stack:scale-workers` | Run 3 workers (elasticity demo) |
| `npm run demo:seed` | Seed the demo courses and resources through the running stack |
| `npm run demo:400-burst` | Send 60 HTTP 400s through the Web Tier |

## Environment

`.env.example` documents every variable; the defaults suit LocalStack. Key
ones: `CLOUD_TARGET`, `AWS_ENDPOINT_URL`, `S3_BUCKET`, `SQS_QUEUE_NAME`,
`MYSQL_*`, `JWT_SECRET`, `DEMO_MODE`, `HTTP_400_ALARM_THRESHOLD`,
`WORKER_RETRY_DELAY_SECONDS`. Secrets are never committed; `.env` is
git-ignored.

## Estimated production cost (not incurred)

The report estimates ~**US$5,225/month** for the full production footprint,
reducible ~40–60% with Savings Plans (report §11). This prototype runs locally
and incurs no cloud cost.

## Further documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — design, diagrams, prototype vs production
- [`DEMO.md`](./DEMO.md) — scripted demonstration
- [`docs/LOCAL_SETUP.md`](./docs/LOCAL_SETUP.md) — Windows developer setup (PowerShell)
- [`docs/LOCAL_ACCEPTANCE.md`](./docs/LOCAL_ACCEPTANCE.md) — Windows acceptance checklist
- [`SECURITY.md`](./SECURITY.md) — controls and known gaps
- [`docs/OBSERVABILITY.md`](./docs/OBSERVABILITY.md) — logs, metrics, alerting
- [`RESEARCH_TRACEABILITY.md`](./RESEARCH_TRACEABILITY.md) — requirement → code mapping

## License

MIT (prototype / academic use).
