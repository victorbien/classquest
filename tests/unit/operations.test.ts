/**
 * Operations view-model: the page must label real API values honestly and
 * never claim an alarm transition LocalStack cannot prove.
 */
import { describe, it, expect } from 'vitest';
import {
  thresholdText,
  alarmView,
  serviceRows,
  overallHealth,
  assetStateCounts,
  storageCounts,
  share,
} from '../../apps/frontend/src/lib/operations.js';
import type { DashboardMetrics, HealthStatus } from '../../apps/frontend/src/api.js';

const metrics = (state: string, count: number, cloudTarget = 'localstack') =>
  ({
    requests: { total: 0, success: 0, clientErrors: 0, serverErrors: 0, avgLatencyMs: 0, http400LastMinute: count },
    alerting: { http400AlarmState: state, threshold: 50, periodSeconds: 60 },
    meta: { note: '', region: 'ap-southeast-2', cloudTarget },
  }) as unknown as Pick<DashboardMetrics, 'requests' | 'alerting' | 'meta'>;

describe('thresholdText', () => {
  it('renders the configured rule', () => {
    expect(thresholdText(50, 60)).toBe('More than 50 HTTP 400 responses within 1 minute');
    expect(thresholdText(10, 300)).toBe('More than 10 HTTP 400 responses within 5 minutes');
    expect(thresholdText(5, 30)).toBe('More than 5 HTTP 400 responses within 30 seconds');
  });
});

describe('alarmView', () => {
  it('within threshold on LocalStack: OK, with the limitation label', () => {
    const v = alarmView(metrics('OK', 3));
    expect(v).toMatchObject({ tone: 'success', breached: false, localstackLimitation: true });
  });

  it('threshold exceeded but alarm not ALARM: warns, never claims the alarm fired', () => {
    const v = alarmView(metrics('OK', 60));
    expect(v.tone).toBe('warning');
    expect(v.headline).toBe('Threshold exceeded');
    expect(v.headline).not.toMatch(/alarm/i);
    expect(v.detail).toContain('CloudWatch alarm state: OK');
    expect(v.localstackLimitation).toBe(true);
  });

  it('exactly at the threshold is not a breach (rule is "more than")', () => {
    expect(alarmView(metrics('OK', 50)).breached).toBe(false);
  });

  it('only reports a firing alarm when CloudWatch says ALARM', () => {
    const v = alarmView(metrics('ALARM', 60));
    expect(v).toMatchObject({ tone: 'danger', headline: 'CloudWatch alarm is in ALARM', localstackLimitation: false });
  });

  it('on AWS there is no LocalStack limitation label', () => {
    expect(alarmView(metrics('OK', 60, 'aws')).localstackLimitation).toBe(false);
  });

  it('unknown alarm state is neutral, not OK', () => {
    expect(alarmView(metrics('UNKNOWN', 0))).toMatchObject({ tone: 'neutral', headline: 'Alarm state unavailable' });
  });
});

describe('service health', () => {
  const health = (deps: HealthStatus['dependencies'], status: HealthStatus['status']): HealthStatus => ({
    tier: 'app-tier', status, cloudTarget: 'localstack', region: 'r', dependencies: deps,
  });

  it('maps core failures to unavailable and observability failures to degraded', () => {
    const rows = serviceRows(health({ mysql: true, s3: false, sqs: true, cloudwatch: false, sns: true }, 'degraded'));
    expect(Object.fromEntries(rows.map((r) => [r.key, r.state]))).toEqual({
      mysql: 'healthy', s3: 'unavailable', sqs: 'healthy', cloudwatch: 'degraded', sns: 'healthy',
    });
  });

  it('reports unknown when no report is available', () => {
    expect(serviceRows(null).every((r) => r.state === 'unknown')).toBe(true);
  });

  it('classifies the overall status, including degraded-observability', () => {
    expect(overallHealth(health({ mysql: true }, 'healthy'), false).label).toBe('Healthy');
    expect(overallHealth(health({ mysql: true }, 'degraded-observability'), false)).toMatchObject({ tone: 'warning', label: 'Degraded' });
    expect(overallHealth(health({ mysql: false }, 'degraded'), false)).toMatchObject({ tone: 'danger', label: 'Unavailable' });
    expect(overallHealth(null, true)).toMatchObject({ tone: 'danger', label: 'Unreachable' });
  });
});

describe('counts', () => {
  it('asset states keep a fixed order and total', () => {
    const { rows, total } = assetStateCounts({ completed: 4, failed: 1, processing: 1 });
    expect(rows.map((r) => `${r.state}:${r.count}`)).toEqual(['submitted:0', 'queued:0', 'processing:1', 'completed:4', 'failed:1']);
    expect(total).toBe(6);
  });
  it('storage tiers sum to the total', () => {
    expect(storageCounts({ STANDARD: 3, GLACIER: 1 })).toEqual({ standard: 3, glacier: 1, total: 4 });
    expect(storageCounts({})).toEqual({ standard: 0, glacier: 0, total: 0 });
  });
  it('share handles an empty whole', () => {
    expect(share(1, 4)).toBe(25);
    expect(share(0, 0)).toBe(0);
  });
});
