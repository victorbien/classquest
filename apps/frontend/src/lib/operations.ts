/**
 * Operations view-model helpers (pure). Every value shown on the Operations
 * page comes from GET /dashboard/metrics or GET /health; these functions only
 * label and classify those values — they never produce numbers of their own.
 */
import type { DashboardMetrics, HealthStatus } from '../api';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

/** "More than 50 HTTP 400 responses within 1 minute" from the configured values. */
export function thresholdText(threshold: number, periodSeconds: number): string {
  const window =
    periodSeconds === 60
      ? '1 minute'
      : periodSeconds % 60 === 0
        ? `${periodSeconds / 60} minutes`
        : `${periodSeconds} seconds`;
  return `More than ${threshold} HTTP 400 responses within ${window}`;
}

export interface AlarmView {
  tone: Tone;
  headline: string;
  detail: string;
  /** Recorded 400s exceed the configured threshold (App Tier request log). */
  breached: boolean;
  /**
   * The CloudWatch alarm has not been observed in ALARM while running on
   * LocalStack, whose Community edition does not evaluate alarm state from
   * metric data — so a transition cannot be proven locally.
   */
  localstackLimitation: boolean;
}

export function alarmView(m: Pick<DashboardMetrics, 'requests' | 'alerting' | 'meta'>): AlarmView {
  const state = m.alerting.http400AlarmState;
  const count = m.requests.http400LastMinute;
  const breached = count > m.alerting.threshold;
  const onLocalStack = m.meta.cloudTarget === 'localstack';
  const localstackLimitation = onLocalStack && state !== 'ALARM';

  if (state === 'ALARM') {
    return {
      tone: 'danger',
      headline: 'CloudWatch alarm is in ALARM',
      detail: `CloudWatch reports the HTTP 400 alarm as firing. ${count} HTTP 400 responses were recorded by the App Tier in the last minute.`,
      breached,
      localstackLimitation,
    };
  }
  if (breached) {
    return {
      tone: 'warning',
      headline: 'Threshold exceeded',
      detail: `${count} HTTP 400 responses were recorded by the App Tier in the last minute. CloudWatch alarm state: ${state}.`,
      breached,
      localstackLimitation,
    };
  }
  if (state === 'UNKNOWN') {
    return {
      tone: 'neutral',
      headline: 'Alarm state unavailable',
      detail: `CloudWatch did not return an alarm state. ${count} HTTP 400 responses were recorded by the App Tier in the last minute.`,
      breached,
      localstackLimitation,
    };
  }
  return {
    tone: 'success',
    headline: 'Within threshold',
    detail: `${count} HTTP 400 responses were recorded by the App Tier in the last minute. CloudWatch alarm state: ${state}.`,
    breached,
    localstackLimitation,
  };
}

export type ServiceState = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

export interface ServiceRow {
  key: 'mysql' | 's3' | 'sqs' | 'cloudwatch' | 'sns';
  label: string;
  role: string;
  /** Core services gate the workflow; observability services are best-effort. */
  core: boolean;
  state: ServiceState;
}

const SERVICES: Array<Omit<ServiceRow, 'state'>> = [
  { key: 'mysql', label: 'MySQL', role: 'Metadata database (RDS stand-in)', core: true },
  { key: 's3', label: 'Amazon S3', role: 'Resource object storage', core: true },
  { key: 'sqs', label: 'Amazon SQS', role: 'Asynchronous processing queue', core: true },
  { key: 'cloudwatch', label: 'Amazon CloudWatch', role: 'Metrics, logs and alarms', core: false },
  { key: 'sns', label: 'Amazon SNS', role: 'Administrator alert topic', core: false },
];

/**
 * Per-service rows from /health. The API reports a boolean per dependency;
 * mirroring the backend's rule, a failed core service is "unavailable" and a
 * failed observability service is "degraded" (the app keeps serving).
 */
export function serviceRows(health: HealthStatus | null): ServiceRow[] {
  return SERVICES.map((s) => {
    const ok = health?.dependencies?.[s.key];
    const state: ServiceState = ok === undefined ? 'unknown' : ok ? 'healthy' : s.core ? 'unavailable' : 'degraded';
    return { ...s, state };
  });
}

export interface OverallHealth {
  tone: Tone;
  label: string;
  detail: string;
}

export function overallHealth(health: HealthStatus | null, unreachable: boolean): OverallHealth {
  if (unreachable || !health?.dependencies) {
    return { tone: 'danger', label: 'Unreachable', detail: 'The App Tier health endpoint did not respond.' };
  }
  if (health.status === 'healthy') {
    return { tone: 'success', label: 'Healthy', detail: 'All core and observability services responded.' };
  }
  if (health.status === 'degraded-observability') {
    return {
      tone: 'warning',
      label: 'Degraded',
      detail: health.note ?? 'Core services are healthy; an observability service (CloudWatch/SNS) is degraded.',
    };
  }
  return { tone: 'danger', label: 'Unavailable', detail: 'A core service (MySQL, S3 or SQS) is unavailable; uploads and processing are affected.' };
}

export const ASSET_STATES = ['submitted', 'queued', 'processing', 'completed', 'failed'] as const;

/** Asset status counts (GET /dashboard/metrics jobs.byStatus) with their total. */
export function assetStateCounts(byStatus: Record<string, number>) {
  const rows = ASSET_STATES.map((state) => ({ state, count: byStatus[state] ?? 0 }));
  return { rows, total: rows.reduce((n, r) => n + r.count, 0) };
}

/** Storage tier counts (GET /dashboard/metrics storage.byTier). */
export function storageCounts(byTier: Record<string, number>) {
  const standard = byTier.STANDARD ?? 0;
  const glacier = byTier.GLACIER ?? 0;
  return { standard, glacier, total: standard + glacier };
}

/** Share of `part` in `whole` as 0–100 (0 when the whole is empty). */
export function share(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}
