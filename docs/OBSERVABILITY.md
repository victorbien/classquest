# Observability — ClassQuest Cloud Prototype

Maps to report §7 (Monitoring, Alerting and Operational Management) and NFR-6.

## Logs

- **Application logs:** structured JSON via pino
  (`packages/shared/src/logger.ts`) with secret redaction (passwords, JWT
  secret, AWS secret key, `Authorization` headers).
- **ALB-style access logs:** the Web Tier writes one JSON event per request to
  CloudWatch Logs group `/aws/alb/classquest-<env>` (`AccessLogService`):
  `{ client_ip, method, path, status_code, latency_ms, request_id, user_agent }`.
  A failed log write never affects the request.
- **App Tier request log:** every API request is also stored in MySQL
  (`request_metrics`). The Operations page reads request totals and the
  "HTTP 400s in the last 60 s" count from here.

## Metrics (CloudWatch namespace `ClassQuest/Prototype`)

| Metric | Emitted by | Meaning |
|--------|------------|---------|
| `RequestCount` | App Tier middleware | API requests |
| `RequestLatencyMs` | App Tier middleware | Per-request latency |
| `SuccessCount` | App Tier middleware **and** worker | 2xx/3xx responses; successful jobs (shared name) |
| `ClientOrServerErrorCount` | App Tier middleware | 4xx/5xx responses |
| `AssetsSubmitted` | `POST /assets` | Uploads accepted |
| `ProcessingTimeMs` | Worker | Job processing time |
| `FailureCount` | Worker | Failed processing attempts |
| `QueueDepth` | Worker and `/dashboard/metrics` | Main queue backlog |
| `HTTP400ErrorCount` | Metric filter on access logs | Count of `status_code = 400` |

Metric writes are best-effort and never fail a request.

## The HTTP 400 alert pipeline (report §2.2.8, §7.6–§7.8)

```
Web Tier access log (JSON, status_code)  →  CloudWatch Logs /aws/alb/classquest-dev
  →  metric filter { $.status_code = 400 }  →  HTTP400ErrorCount
  →  alarm ClassQuest-HTTP400-HighErrorRate (Sum > 50 in 60 s)
  →  SNS classquest-admin-alerts  →  administrator email (production)
```

All of these resources are provisioned by Terraform on LocalStack. **LocalStack
Community does not evaluate alarm state from metric data**, so locally the alarm
is not expected to reach `ALARM` and no SNS notification is sent. The Operations
page therefore:

- shows the alarm state exactly as CloudWatch reports it;
- shows the App Tier's own measured 400 count and whether it exceeds the rule;
- labels the gap as a *LocalStack demonstration limitation* and never claims the
  alarm fired unless CloudWatch reports `ALARM`.

Trigger the pipeline with **Operations → Generate HTTP 400 burst** or
`npm run demo:400-burst`. Inspect the raw logs and alarm on LocalStack:

```bash
docker compose exec localstack awslocal logs filter-log-events --log-group-name /aws/alb/classquest-dev --filter-pattern "{ $.status_code = 400 }" --max-items 5
docker compose exec localstack awslocal cloudwatch describe-alarms --alarm-names ClassQuest-HTTP400-HighErrorRate
```

## Health

- `GET /health` (App Tier) checks MySQL, S3, SQS, CloudWatch and SNS:
  - `200 healthy` — everything responds;
  - `200 degraded-observability` — core services fine, CloudWatch or SNS down;
  - `503 degraded` — MySQL, S3 or SQS down.
- `GET /healthz` (Web Tier) reports edge liveness.
- **Operations** shows each dependency as healthy, degraded (observability) or
  unavailable (core), plus request traffic, queue depth, asset processing
  states, storage tiers and the alarm card — all measured values.
