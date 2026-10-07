# Security Notes — ClassQuest Cloud Prototype

Security controls in the prototype, mapped to the INFS803 report (§6, §2.3.6,
§12.4). Items marked _production design_ describe the report's intended control
rather than something this repository runs.

## Authentication

- Users sign in at `POST /auth/login`; passwords are bcrypt-hashed in MySQL.
- The App Tier issues a JWT (`JWT_EXPIRES_IN`, default 1 h) carrying the
  user's id, role and display name.
- The SPA keeps the token in `localStorage`, validates it with `GET /auth/me`
  on load, and signs the user out on any `401`.
- **The Web Tier does not check tokens.** It proxies `/api/*` to the App Tier,
  which performs every authentication and authorisation check.

## Authorisation (enforced in the App Tier)

| Endpoint | Student | Teacher | Admin | Notes |
|----------|:-------:|:-------:|:-----:|-------|
| `GET /assets` | completed + published course only | all | all | |
| `GET /assets/:id` (presigned URL) | completed + published course only, else 404 | ✓ | ✓ | Student opens are recorded |
| `POST /assets` (upload) | — | own courses | any course | `courseId` required; archived courses refuse uploads (409) |
| `PATCH /assets/:id` | — | own courses | any course | Moving requires managing the target course too |
| `GET /courses` | published courses + own progress | own courses | all courses | |
| `POST /courses` | — | ✓ | ✓ | Creator is always the caller |
| `GET /courses/:id` | published only, else 404 | own courses (else 403) | ✓ | Students get completed resources only |
| `PATCH /courses/:id`, `PUT /courses/:id/order`, `PUT`/`DELETE /courses/:id/cover` | — | own courses (else 403) | ✓ | Lifecycle transitions validated (409) |
| `GET /jobs/:id`, `GET /assets/:id/job` | — | ✓ | ✓ | |
| `GET /dashboard/metrics` | — | ✓ | ✓ | |
| `GET /me/progress` | own data | — | — | |
| `POST /demo/seed`, `/demo/induce-failure`, `/demo/lifecycle-simulate` | — | ✓ | ✓ | Only when `DEMO_MODE=true` |
| `ALL /demo/bad-request` | open | open | open | Only when `DEMO_MODE=true`; always returns 400 |
| `GET /health` | open | open | open | Health probe |

Frontend route guards mirror this table for usability; they are not the
security boundary.

## Demo mode

- `DEMO_MODE` defaults to `true` for `CLOUD_TARGET=localstack` and `false` for
  `aws`. When off, every `/demo/*` route returns 404.
- Demo accounts are created at App Tier start-up **only if they do not exist**;
  existing accounts are never reset. No API response returns passwords.
- The demo credentials are public (README, login hint). Never enable demo mode
  in a real deployment.

## Service credentials and IAM

- AWS SDK clients use the default credential chain. Locally the dummy `test`
  keys are LocalStack placeholders, not secrets. No real keys are in the repo.
- Terraform creates `classquest-web-role` and `classquest-app-role` with
  instance profiles; the App Tier performs a demonstration `AssumeRole` at
  start-up.
- **Known gaps:** LocalStack Community does not enforce IAM, so these policies
  are not exercised locally. On real AWS the app role would also need
  `sns:CreateTopic`/`sns:Publish`, `cloudwatch:GetMetricStatistics`/
  `DescribeAlarms`, `sqs:ChangeMessageVisibility`, `sns:ListTopics` and
  `s3:DeleteObject` (replacing or removing a course cover) for the current
  code; the worker would use the app role or its own role.

## Input validation and data access

- zod schemas validate request bodies (course bodies are strict: unknown
  fields such as `creatorId` are rejected); uploads are checked against a
  per-type MIME allow-list and `MAX_UPLOAD_BYTES` (50 MB). Course covers must
  be PNG/JPEG/WebP and at most 2 MB. The MIME type is the one the client
  sends; file contents are not inspected.
- All SQL is parameterised (`packages/shared/src/db/repositories.ts`).
- Errors return `{ code, message, requestId }`; stack traces stay in logs.

## Data protection

- S3 Block Public Access, versioning and SSE (AES256) are set in Terraform.
  Files are retrieved only via presigned URLs valid for 5 minutes (course
  cover images: 15 minutes). The Web Tier CSP `img-src` allows the
  browser-facing S3 endpoint (`S3_PUBLIC_ENDPOINT`, or the regional S3 host on
  AWS) so cover images can be displayed.
- TLS, SSE-KMS and Secrets Manager are _production design_ (§6.8, §6.10,
  §6.12); the local stack runs over HTTP with secrets in `.env`.

## Network

- All containers share one Docker network. For local development and the
  automated tests, MySQL (3306), the App Tier (4000) and LocalStack (4566) are
  also published to the host, and the App Tier allows any CORS origin — so the
  Web Tier is not the only entry point locally. Private subnets, security
  groups and NACLs are _production design_ (§6.4–6.5).
- The Web Tier applies rate limiting (`RATE_LIMIT_MAX` per
  `RATE_LIMIT_WINDOW_MS`) as a stand-in for WAF/Shield (§6.11).

## Logging

- pino JSON logs redact passwords, the JWT secret, AWS secret keys and
  `Authorization` headers.

## Known prototype limitations

- JWT in `localStorage` (exposed to XSS); no refresh tokens.
- If `JWT_SECRET` or `MYSQL_PASSWORD` is unset, `packages/shared/src/config.ts`
  falls back to the known local demo values — for every target, including
  `aws`. Always set real values outside the local demo.
- No real TLS certificates; HTTP locally.
- WAF, Shield, GuardDuty, CloudTrail and Config are _production design_ only.

## Reporting

This is an academic prototype with no production data. For the real system,
report security issues to the ClassQuest security contact (not included here).
