import type { DashboardMetrics } from '../../api';
import { assetStateCounts, share } from '../../lib/operations';
import { Badge, Card, ProgressBar, STATUS_TONE, StatCard } from '../ui';

const BAR_TONE = { completed: 'success', failed: 'danger', processing: 'primary', queued: 'primary', submitted: 'primary' } as const;

interface QueueCardProps {
  jobs: DashboardMetrics['jobs'];
  /** From /health: false when SQS is unreachable (the API then reports depth 0). */
  sqsHealthy: boolean | undefined;
}

/** Queue and job processing: SQS depth, active jobs, asset status breakdown. */
export function QueueCard({ jobs, sqsHealthy }: QueueCardProps) {
  const { rows, total } = assetStateCounts(jobs.byStatus);
  const depthKnown = sqsHealthy !== false;
  return (
    <Card title="Queue & job processing" subtitle="Amazon SQS main queue and the worker pipeline.">
      <div className="cq-mini-stats">
        <StatCard
          label="Main queue depth"
          icon="queue"
          value={depthKnown ? jobs.queueDepth : 'Unavailable'}
          unit={depthKnown ? (jobs.queueDepth === 1 ? 'message' : 'messages') : undefined}
          sub={depthKnown ? 'Approximate visible messages' : 'SQS is not responding'}
          tone={depthKnown ? 'primary' : 'danger'}
        />
        <StatCard label="Active jobs" icon="cpu" value={jobs.active} sub="Submitted, queued or processing" tone="callout" />
        <StatCard
          label="Avg processing"
          icon="clock"
          value={jobs.avgProcessingMs > 0 ? jobs.avgProcessingMs : '—'}
          unit={jobs.avgProcessingMs > 0 ? 'ms' : undefined}
          sub={jobs.avgProcessingMs > 0 ? 'Completed jobs, worker time' : 'No completed jobs timed yet'}
          tone="success"
        />
      </div>

      <h4 className="cq-section-label">Asset processing states <span className="cq-small">({total} assets)</span></h4>
      <ul className="cq-state-list">
        {rows.map((r) => (
          <li key={r.state} className="cq-state-row">
            <Badge tone={STATUS_TONE[r.state] ?? 'neutral'} upper>{r.state}</Badge>
            <ProgressBar value={share(r.count, total)} tone={BAR_TONE[r.state]} label={`${r.state} share of assets`} />
            <span className="cq-state-row__count">{r.count}</span>
          </li>
        ))}
      </ul>
      <p className="cq-small cq-footnote">
        Status counts come from MySQL. Dead-letter queue depth is not reported by this API — use the CLI check under
        Demonstration Controls.
      </p>
    </Card>
  );
}
