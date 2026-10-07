/**
 * End-to-end test of the primary research workflow (report §3.7; AC-2/3/4).
 * Runs through the Web Tier (single public entry) against the full stack:
 *   login -> upload -> queue -> worker -> completed -> retrieve (presigned)
 *   plus induced failure -> retries -> failed -> native SQS redrive to the DLQ,
 *   and the HTTP-400 burst -> alarm.
 *
 * Requires the full Docker stack (`docker compose up -d --build`). Reported as
 * SKIPPED — not passed — when it is not reachable; setup failures fail it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SQSClient, GetQueueUrlCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { stackAvailable, urls } from '../helpers/infra.js';

const WEB = urls.WEB_TIER;
const available = await stackAvailable('E2E tests (tests/e2e)', ['webTier', 'appTier', 'localstack']);
let token = '';
let studentToken = '';
let courseId = '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed JSON from the live API
type Json = Record<string, any>;

async function api(path: string, init?: RequestInit) {
  return fetch(`${WEB}/api${path}`, init);
}

async function poll(path: string, token: string, pred: (b: Json) => boolean, tries = 30, delay = 2000) {
  for (let i = 0; i < tries; i++) {
    const r = await api(path, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const b = await r.json();
      if (pred(b)) return b;
    }
    await new Promise((res) => setTimeout(res, delay));
  }
  return null;
}

/** Find the message about `jobId` on the DLQ (native redrive target); returns its body. */
async function findInDlq(jobId: string, tries = 30, delayMs = 2000): Promise<string | null> {
  const sqs = new SQSClient({
    region: process.env.AWS_REGION ?? 'ap-southeast-2',
    endpoint: urls.LOCALSTACK,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  const { QueueUrl } = await sqs.send(
    new GetQueueUrlCommand({ QueueName: process.env.SQS_DLQ_NAME ?? 'classquest-asset-processing-dlq' }),
  );
  for (let i = 0; i < tries; i++) {
    // VisibilityTimeout 0 so unrelated DLQ messages are not hidden from others.
    const out = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: 0 }),
    );
    for (const m of out.Messages ?? []) {
      if (m.Body?.includes(jobId)) {
        await sqs.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: m.ReceiptHandle! }));
        return m.Body;
      }
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

async function loginAs(email: string, password: string): Promise<string> {
  const r = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(r.status, `login ${email}`).toBe(200);
  return (await r.json()).token;
}

describe.skipIf(!available)('E2E: primary workflow via the Web Tier (live stack)', () => {
  beforeAll(async () => {
    // Demo users exist from App Tier startup (DEMO_MODE); seeding needs a token.
    const login = await api('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@classquest.example', password: 'DemoTeacher123!' }),
    });
    expect(login.status, 'teacher login').toBe(200);
    token = (await login.json()).token;
    const seed = await api('/demo/seed', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(seed.status, 'demo seed').toBe(200);
    studentToken = await loginAs('student@classquest.example', 'DemoStudent123!');
    const course = await api('/courses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `E2E course ${Date.now().toString(36)}`, category: 'E2E', status: 'published' }),
    });
    expect(course.status, 'create course').toBe(201);
    courseId = (await course.json()).course.id;
  }, 60_000);

  it('Web Tier serves the SPA on deep links, branding assets, security headers and API 404s', async () => {
    for (const path of [
      '/', '/login', '/home', '/library', '/progress', '/dashboard', '/publish', '/operations',
      '/courses', '/courses/new', `/courses/${courseId}`, `/courses/${courseId}/edit`, `/courses/${courseId}/resources/new`,
    ]) {
      const r = await fetch(`${WEB}${path}`);
      expect(r.status, path).toBe(200);
      expect(r.headers.get('content-type'), path).toContain('text/html');
      expect(await r.text(), path).toContain('<div id="root">');
    }
    for (const asset of ['/brand/classquest-logo.png', '/favicon.png', '/apple-touch-icon.png']) {
      const r = await fetch(`${WEB}${asset}`);
      expect(r.status, asset).toBe(200);
      expect(r.headers.get('content-type'), asset).toContain('image/png');
    }
    const home = await fetch(`${WEB}/`);
    expect(home.headers.get('content-security-policy')).toContain("default-src 'self'");
    // Course covers load from time-limited S3 links, so img-src allows the S3 endpoint.
    expect(home.headers.get('content-security-policy')).toMatch(/img-src[^;]*(localhost:4566|amazonaws\.com)/);
    const missing = await api('/does-not-exist');
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('NOT_FOUND');
  });

  it('uploads an asset and processes it to completion, then retrieves it', async () => {

    const form = new FormData();
    form.append('courseId', courseId);
    form.append('title', 'E2E — sample document');
    form.append('type', 'document');
    form.append('file', new Blob([Buffer.from('e2e content')], { type: 'text/plain' }), 'e2e.txt');

    const upload = await api('/assets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    expect(upload.status).toBe(202);
    const { assetId, jobId } = await upload.json();
    expect(assetId).toBeTruthy();

    // Worker should drive the job to completed.
    const job = await poll(`/jobs/${jobId}`, token, (b) => b.state === 'completed' || b.state === 'failed');
    expect(job?.state).toBe('completed');

    // Retrieve as the student: the presigned URL serves the uploaded bytes.
    const detail = await api(`/assets/${assetId}`, { headers: { Authorization: `Bearer ${studentToken}` } });
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.asset.status).toBe('completed');
    const file = await fetch(body.downloadUrl);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe('e2e content');

    // The completed resource appears inside its (published) course for the student.
    const course = await (await api(`/courses/${courseId}`, { headers: { Authorization: `Bearer ${studentToken}` } })).json();
    expect(course.resources.map((x: Json) => x.id)).toEqual([assetId]);
    expect(course.progress).toMatchObject({ available: 1 });
  }, 90_000);

  it('induced failure: 3 attempts -> failed, then SQS redrive moves the message to the DLQ', async () => {
    const r = await api('/demo/induce-failure', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(202);
    const { jobId, assetId } = await r.json();

    // The worker retries up to maxReceiveCount (3) and marks the job failed
    // on the final attempt WITHOUT deleting the message...
    const job = await poll(`/jobs/${jobId}`, token, (b) => b.state === 'failed', 40, 2000);
    expect(job?.state).toBe('failed');
    expect(job?.attempts).toBe(3);

    // ...so on the next receive SQS's native redrive policy moves it to the DLQ.
    const dlqBody = await findInDlq(jobId);
    expect(dlqBody, 'message redriven to the DLQ').not.toBeNull();
    expect(JSON.parse(dlqBody!)).toMatchObject({ jobId, assetId, induceFailure: true });

    // A failed resource is never offered to students.
    const asStudent = { headers: { Authorization: `Bearer ${studentToken}` } };
    expect((await api(`/assets/${assetId}`, asStudent)).status).toBe(404);
    const list = await (await api('/assets', asStudent)).json();
    expect(list.assets.some((a: Json) => a.id === assetId)).toBe(false);
  }, 180_000);

  it('HTTP 400 burst: more than the threshold recorded, access logs in CloudWatch, alarm reported as-is', async () => {
    const before = await poll('/dashboard/metrics', token, () => true, 1);
    const threshold: number = before!.alerting.threshold;
    const burst = threshold + 10;
    // Fire the burst through the Web Tier (the single public entry).
    const statuses = await Promise.all(
      Array.from({ length: burst }, () => api('/demo/bad-request', { method: 'POST' }).then((r) => r.status)),
    );
    expect(statuses.filter((s) => s === 400)).toHaveLength(burst);

    // The App Tier's request log records more 400s in the last minute than the rule allows.
    const metrics = await poll('/dashboard/metrics', token, (b) => b.requests.http400LastMinute > threshold, 15, 2000);
    expect(metrics, 'recorded 400s exceed the threshold').not.toBeNull();
    expect(metrics!.requests.http400LastMinute).toBeGreaterThan(threshold);

    // The Web Tier wrote ALB-style access-log events with status_code 400 to CloudWatch Logs.
    const logs = new CloudWatchLogsClient({
      region: process.env.AWS_REGION ?? 'ap-southeast-2',
      endpoint: urls.LOCALSTACK,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    let found = 0;
    for (let i = 0; i < 15 && found < burst; i++) {
      const out = await logs.send(
        new FilterLogEventsCommand({ logGroupName: process.env.CW_LOG_GROUP ?? '/aws/alb/classquest-dev', startTime: Date.now() - 5 * 60_000 }),
      );
      found = (out.events ?? []).filter((e) => {
        try {
          const ev = JSON.parse(e.message ?? '{}');
          return ev.status_code === 400 && ev.path === '/api/demo/bad-request';
        } catch {
          return false;
        }
      }).length;
      if (found < burst) await new Promise((r) => setTimeout(r, 1000));
    }
    expect(found).toBeGreaterThanOrEqual(burst);

    // The alarm state is reported exactly as CloudWatch returns it. LocalStack
    // Community does not evaluate alarms, so it is not expected to read ALARM locally.
    expect(['OK', 'ALARM', 'INSUFFICIENT_DATA', 'UNKNOWN']).toContain(metrics!.alerting.http400AlarmState);
  }, 150_000);
});
