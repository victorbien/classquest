/**
 * Shared helpers for the live-stack suites: API calls as each demo role,
 * direct MySQL access, AWS SDK clients pointed at LocalStack, and polling.
 * Resource names default to .env.example / Terraform values.
 */
import mysql from 'mysql2/promise';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { CLOUDWATCH_PROTOCOL } from '../../packages/shared/src/cloud/clients.js';
import { mysqlConfig, urls } from './infra.js';

export const names = {
  bucket: process.env.S3_BUCKET ?? 'classquest-media-assets-dev',
  queue: process.env.SQS_QUEUE_NAME ?? 'classquest-asset-processing',
  dlq: process.env.SQS_DLQ_NAME ?? 'classquest-asset-processing-dlq',
  topic: process.env.SNS_TOPIC_NAME ?? 'classquest-admin-alerts',
  logGroup: process.env.CW_LOG_GROUP ?? '/aws/alb/classquest-dev',
  alarm: 'ClassQuest-HTTP400-HighErrorRate',
};

const awsConfig = {
  region: process.env.AWS_REGION ?? 'ap-southeast-2',
  endpoint: urls.LOCALSTACK,
  forcePathStyle: true,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
export const s3 = new S3Client(awsConfig);
export const sqs = new SQSClient(awsConfig);
export const sns = new SNSClient(awsConfig);
export const cloudwatch = new CloudWatchClient({ ...awsConfig, protocol: CLOUDWATCH_PROTOCOL });
export const logs = new CloudWatchLogsClient(awsConfig);

export async function queueUrl(name: string): Promise<string> {
  return (await sqs.send(new GetQueueUrlCommand({ QueueName: name }))).QueueUrl!;
}

let pool: mysql.Pool | undefined;
export function db(): mysql.Pool {
  return (pool ??= mysql.createPool({ ...mysqlConfig, connectionLimit: 2 }));
}
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed rows/JSON in tests
export type Row = Record<string, any>;
export async function rows(sql: string, params: unknown[] = []): Promise<Row[]> {
  const [r] = await db().query(sql, params);
  return r as Row[];
}

export const DEMO = {
  student: { email: 'student@classquest.example', password: 'DemoStudent123!' },
  teacher: { email: 'teacher@classquest.example', password: 'DemoTeacher123!' },
  admin: { email: 'admin@classquest.example', password: 'DemoAdmin123!' },
} as const;
export type DemoRole = keyof typeof DEMO;

/** Request against a base URL (App Tier directly, or Web Tier + /api). */
export async function call(
  base: string,
  path: string,
  opts: { method?: string; token?: string; json?: unknown; form?: FormData } = {},
): Promise<{ status: number; body: Row }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  const res = await fetch(`${base}${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  const text = await res.text();
  let parsed: Row = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

export async function login(base: string, role: DemoRole): Promise<{ token: string; sub: string }> {
  const r = await call(base, '/auth/login', { json: DEMO[role] });
  if (r.status !== 200) throw new Error(`login as ${role} failed: HTTP ${r.status}`);
  const me = await call(base, '/auth/me', { token: r.body.token });
  return { token: r.body.token, sub: me.body.user.sub };
}

/** Poll `fn` until `pred` holds; returns the last value (caller asserts). */
export async function waitFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, tries = 30, delayMs = 1000): Promise<T> {
  let v = await fn();
  for (let i = 1; i < tries && !pred(v); i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    v = await fn();
  }
  return v;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A file part for multipart uploads. */
export function fileForm(fields: Record<string, string>, file?: { name: string; type: string; data: Buffer }): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (file) form.append('file', new Blob([file.data], { type: file.type }), file.name);
  return form;
}
