import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError, type DashboardMetrics, type HealthStatus } from '../api';
import { PageHeader } from '../components/shell/PageHeader';
import { AlertStatusCard } from '../components/operations/AlertStatusCard';
import { ServiceHealthCard } from '../components/operations/ServiceHealthCard';
import { QueueCard } from '../components/operations/QueueCard';
import { StorageCard } from '../components/operations/StorageCard';
import { CloudFlowCard } from '../components/operations/CloudFlowCard';
import { DemoControls } from '../components/operations/DemoControls';
import { Badge, Button, Card, EmptyState, StatCard } from '../components/ui';

const POLL_MS = 5000;

/**
 * Operations (teacher/admin): the cloud demonstration page. Every number comes
 * from GET /dashboard/metrics or GET /health; nothing here is simulated.
 */
export function Operations() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthUnreachable, setHealthUnreachable] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const [m, h] = await Promise.allSettled([api.dashboard(), api.health()]);
    if (m.status === 'fulfilled') {
      setMetrics(m.value);
      setMetricsError(null);
    } else {
      setMetricsError((m.reason as ApiError)?.message ?? 'Metrics unavailable');
    }
    if (h.status === 'fulfilled') {
      setHealth(h.value);
      setHealthUnreachable(false);
    } else {
      setHealthUnreachable(true);
    }
    setUpdatedAt(new Date());
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const cloudTarget = metrics?.meta.cloudTarget ?? health?.cloudTarget;
  const region = metrics?.meta.region ?? health?.region;
  const onLocalStack = cloudTarget === 'localstack';

  return (
    <>
      <PageHeader
        eyebrow="Cloud operations"
        title="Operations"
        description="Service health, queue processing, storage state and HTTP 400 monitoring for the running ClassQuest platform, plus controls to demonstrate the architecture live."
        actions={
          <div className="cq-ops-meta">
            {onLocalStack && <Badge tone="callout" upper>LocalStack demo</Badge>}
            {region && <span className="cq-small">Region {region}</span>}
            <span className="cq-small" aria-live="polite">
              {updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Loading…'}
            </span>
            <Button variant="secondary" size="sm" iconLeft="refresh" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        }
      />

      {metricsError && metrics && (
        <p className="cq-stale" role="status">
          Showing the last values received — the latest metrics request failed: {metricsError}
        </p>
      )}

      {!metrics && metricsError ? (
        <Card className="cq-ops-section">
          <EmptyState
            icon="alert"
            title="Operational metrics are unavailable"
            description={metricsError}
            action={<Button variant="secondary" iconLeft="refresh" onClick={() => void load()}>Try again</Button>}
          />
        </Card>
      ) : !metrics ? (
        <Card className="cq-ops-section"><p className="cq-small">Loading operational metrics…</p></Card>
      ) : (
        <>
          <div className="cq-ops-section">
            <AlertStatusCard metrics={metrics} />
          </div>

          <section className="cq-ops-section" aria-labelledby="traffic-title">
            <h2 id="traffic-title" className="cq-section-title">Request traffic</h2>
            <p className="cq-small cq-section-note">All App Tier requests recorded since the database was created, including health checks.</p>
            <div className="cq-kpi-grid">
              <StatCard label="Total requests" icon="globe" value={metrics.requests.total.toLocaleString()} tone="primary" />
              <StatCard
                label="Successful"
                icon="check"
                value={metrics.requests.success.toLocaleString()}
                sub="2xx / 3xx responses"
                tone="success"
              />
              <StatCard
                label="Errors"
                icon="alert"
                value={(metrics.requests.clientErrors + metrics.requests.serverErrors).toLocaleString()}
                sub={`${metrics.requests.clientErrors.toLocaleString()} client (4xx) · ${metrics.requests.serverErrors.toLocaleString()} server (5xx)`}
                tone="danger"
              />
              <StatCard label="Avg latency" icon="clock" value={metrics.requests.avgLatencyMs} unit="ms" sub="App Tier response time" tone="callout" />
            </div>
          </section>
        </>
      )}

      <div className="cq-ops-columns cq-ops-section">
        <ServiceHealthCard health={health} unreachable={healthUnreachable} />
        {metrics && <QueueCard jobs={metrics.jobs} sqsHealthy={healthUnreachable ? undefined : health?.dependencies.sqs} />}
      </div>

      {metrics && (
        <div className="cq-ops-columns cq-ops-section">
          <StorageCard storage={metrics.storage} onLocalStack={onLocalStack} />
          <CloudFlowCard onLocalStack={onLocalStack} />
        </div>
      )}

      <div className="cq-ops-section">
        <DemoControls threshold={metrics?.alerting.threshold ?? null} onDone={() => void load()} />
      </div>
    </>
  );
}
