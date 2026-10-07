import type { DashboardMetrics } from '../../api';
import { share, storageCounts } from '../../lib/operations';
import { Card, StatCard } from '../ui';

/** S3 storage tiers from GET /dashboard/metrics (storage.byTier). */
export function StorageCard({ storage, onLocalStack }: { storage: DashboardMetrics['storage']; onLocalStack: boolean }) {
  const { standard, glacier, total } = storageCounts(storage.byTier);
  const glacierLabel = onLocalStack ? 'Glacier (simulated)' : 'Glacier';
  return (
    <Card title="Storage overview" subtitle={<>Amazon S3 bucket <code className="cq-code">{storage.bucket}</code></>}>
      <div className="cq-mini-stats">
        <StatCard label="Standard" icon="archive" value={standard} unit={standard === 1 ? 'object' : 'objects'} tone="primary" />
        <StatCard label={glacierLabel} icon="snowflake" value={glacier} unit={glacier === 1 ? 'object' : 'objects'} tone="callout" />
        <StatCard label="Total assets" icon="database" value={total} tone="success" />
      </div>

      {total > 0 && (
        <div className="cq-tier-bar" role="img" aria-label={`${standard} Standard and ${glacier} ${glacierLabel} objects`}>
          <span className="cq-tier-bar__standard" style={{ width: `${share(standard, total)}%` }} />
          <span className="cq-tier-bar__glacier" style={{ width: `${share(glacier, total)}%` }} />
        </div>
      )}

      <p className="cq-small cq-footnote">
        Terraform lifecycle rule: Standard → Glacier after 90 days, expire after 5 years.
        {onLocalStack && (
          <> Locally, “Simulate Glacier lifecycle” rewrites objects with the GLACIER storage class on demand; Glacier retrieval latency and restore requests are not emulated.</>
        )}
      </p>
    </Card>
  );
}
