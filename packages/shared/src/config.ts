/**
 * Centralised, validated configuration loaded from environment variables.
 * No secrets are hardcoded (report 6.10). A single module keeps the
 * LocalStack vs real-AWS switch in one place (report 7 mapping).
 */

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be a number`);
  return n;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

export interface AppConfig {
  cloudTarget: 'localstack' | 'aws';
  awsRegion: string;
  awsEndpointUrl: string | undefined;
  envName: string;

  s3Bucket: string;
  /** Browser-reachable S3 endpoint for presigned URLs (LocalStack: localhost). */
  s3PublicEndpoint: string | undefined;
  sqsQueueName: string;
  sqsDlqName: string;
  snsTopicName: string;
  cwLogGroup: string;
  cwNamespace: string;
  adminAlertEmail: string;

  mysql: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };

  jwtSecret: string;
  jwtExpiresIn: string;
  bcryptRounds: number;

  appTierPort: number;
  webTierPort: number;
  appTierUrl: string;

  worker: {
    /** Fallback only: the queue's redrive maxReceiveCount is authoritative when readable. */
    maxAttempts: number;
    pollWaitSeconds: number;
    visibilityTimeout: number;
    /** Seconds a failed message stays invisible before SQS redelivers (or redrives) it. */
    retryDelaySeconds: number;
  };

  http400: {
    threshold: number;
    periodSeconds: number;
  };

  rateLimit: {
    windowMs: number;
    max: number;
  };

  maxUploadBytes: number;

  /** Enables /demo/* and auto-creation of demo users. Defaults on for LocalStack only. */
  demoMode: boolean;
}

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) return cached;

  const endpoint = process.env.AWS_ENDPOINT_URL;

  cached = {
    cloudTarget: (env('CLOUD_TARGET', 'localstack') as 'localstack' | 'aws'),
    awsRegion: env('AWS_REGION', 'ap-southeast-2'),
    awsEndpointUrl: endpoint && endpoint !== '' ? endpoint : undefined,
    envName: env('ENV_NAME', 'dev'),

    s3Bucket: env('S3_BUCKET', 'classquest-media-assets-dev'),
    s3PublicEndpoint: process.env.S3_PUBLIC_ENDPOINT && process.env.S3_PUBLIC_ENDPOINT !== ''
      ? process.env.S3_PUBLIC_ENDPOINT
      : undefined,
    sqsQueueName: env('SQS_QUEUE_NAME', 'classquest-asset-processing'),
    sqsDlqName: env('SQS_DLQ_NAME', 'classquest-asset-processing-dlq'),
    snsTopicName: env('SNS_TOPIC_NAME', 'classquest-admin-alerts'),
    cwLogGroup: env('CW_LOG_GROUP', '/aws/alb/classquest-dev'),
    cwNamespace: env('CW_NAMESPACE', 'ClassQuest/Prototype'),
    adminAlertEmail: env('ADMIN_ALERT_EMAIL', 'sysadmin@classquest.example'),

    mysql: {
      host: env('MYSQL_HOST', 'localhost'),
      port: envNum('MYSQL_PORT', 3306),
      database: env('MYSQL_DATABASE', 'classquest'),
      user: env('MYSQL_USER', 'classquest_app'),
      password: env('MYSQL_PASSWORD', 'change-me-locally'),
    },

    jwtSecret: env('JWT_SECRET', 'local-dev-jwt-secret-change-me'),
    jwtExpiresIn: env('JWT_EXPIRES_IN', '1h'),
    bcryptRounds: envNum('BCRYPT_ROUNDS', 10),

    appTierPort: envNum('APP_TIER_PORT', 4000),
    webTierPort: envNum('WEB_TIER_PORT', 8080),
    appTierUrl: env('APP_TIER_URL', 'http://localhost:4000'),

    worker: {
      maxAttempts: envNum('WORKER_MAX_ATTEMPTS', 3),
      pollWaitSeconds: envNum('WORKER_POLL_WAIT_SECONDS', 5),
      visibilityTimeout: envNum('WORKER_VISIBILITY_TIMEOUT', 30),
      retryDelaySeconds: envNum('WORKER_RETRY_DELAY_SECONDS', 5),
    },

    http400: {
      threshold: envNum('HTTP_400_ALARM_THRESHOLD', 50),
      periodSeconds: envNum('HTTP_400_ALARM_PERIOD_SECONDS', 60),
    },

    rateLimit: {
      windowMs: envNum('RATE_LIMIT_WINDOW_MS', 60_000),
      max: envNum('RATE_LIMIT_MAX', 2000),
    },

    maxUploadBytes: envNum('MAX_UPLOAD_BYTES', 52_428_800),

    demoMode: envBool('DEMO_MODE', env('CLOUD_TARGET', 'localstack') === 'localstack'),
  };

  return cached;
}

/** For tests: clear the cached config so env changes take effect. */
export function resetConfigCache(): void {
  cached = undefined;
}
