import type { HealthStatus } from '../../api';
import { overallHealth, serviceRows, type ServiceState } from '../../lib/operations';
import { Badge, Card } from '../ui';

const STATE_TONE: Record<ServiceState, 'success' | 'warning' | 'danger' | 'neutral'> = {
  healthy: 'success',
  degraded: 'warning',
  unavailable: 'danger',
  unknown: 'neutral',
};

/** Per-dependency health from GET /health. */
export function ServiceHealthCard({ health, unreachable }: { health: HealthStatus | null; unreachable: boolean }) {
  const overall = overallHealth(health, unreachable);
  const rows = serviceRows(unreachable ? null : health);
  return (
    <Card
      title="Service health"
      subtitle="Live checks from the App Tier health endpoint."
      action={<Badge tone={overall.tone} upper>{overall.label}</Badge>}
    >
      <p className={`cq-health-summary cq-health-summary--${overall.tone}`}>{overall.detail}</p>
      <ul className="cq-health-list">
        {rows.map((r) => (
          <li key={r.key} className="cq-health-row">
            <span className={`cq-health-dot cq-health-dot--${r.state}`} aria-hidden="true" />
            <div className="cq-health-row__text">
              <span className="cq-health-row__name">{r.label}</span>
              <span className="cq-small">
                {r.role} · {r.core ? 'core' : 'observability'}
              </span>
            </div>
            <Badge tone={STATE_TONE[r.state]} upper>{r.state}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
