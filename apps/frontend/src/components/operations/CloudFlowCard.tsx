import type { IconName } from '../../navigation';
import { Badge, Card, Icon } from '../ui';

interface Node {
  label: string;
  icon: IconName;
}

const REQUEST_FLOW: Node[] = [
  { label: 'Browser', icon: 'globe' },
  { label: 'Web Tier', icon: 'server' },
  { label: 'App Tier', icon: 'cpu' },
  { label: 'MySQL / S3', icon: 'database' },
];
const ASYNC_FLOW: Node[] = [
  { label: 'App Tier', icon: 'cpu' },
  { label: 'SQS', icon: 'queue' },
  { label: 'Worker', icon: 'cpu' },
  { label: 'Asset status updated', icon: 'check' },
];
const MONITORING_FLOW: Node[] = [
  { label: 'Web access logs', icon: 'document' },
  { label: 'CloudWatch metric', icon: 'operations' },
  { label: 'Alarm', icon: 'alert' },
  { label: 'SNS', icon: 'bell' },
];

function Flow({ nodes, designOnlyFrom }: { nodes: Node[]; designOnlyFrom?: number }) {
  return (
    <ol className="cq-flow">
      {nodes.map((n, i) => (
        <li
          key={`${n.label}-${i}`}
          className={`cq-flow__node${designOnlyFrom !== undefined && i >= designOnlyFrom ? ' cq-flow__node--design' : ''}`}
        >
          {i > 0 && (
            <span className="cq-flow__arrow" aria-hidden="true">
              <Icon name="arrow-right" size={16} />
            </span>
          )}
          <span className="cq-flow__chip">
            <Icon name={n.icon} size={16} />
            {n.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Static explanation of the architecture — no live data, no interaction. */
export function CloudFlowCard({ onLocalStack }: { onLocalStack: boolean }) {
  return (
    <Card title="How the cloud flow works" subtitle="Explanatory diagram of the three-tier design (static).">
      <div className="cq-flow-group">
        <span className="cq-eyebrow">Request path</span>
        <Flow nodes={REQUEST_FLOW} />
      </div>
      <div className="cq-flow-group">
        <span className="cq-eyebrow">Asynchronous processing</span>
        <Flow nodes={ASYNC_FLOW} />
      </div>
      <div className="cq-flow-group">
        <span className="cq-eyebrow">Monitoring &amp; alerting</span>
        <Flow nodes={MONITORING_FLOW} designOnlyFrom={onLocalStack ? 2 : undefined} />
        {onLocalStack && (
          <p className="cq-small cq-flow__legend">
            <Badge tone="callout" upper>Production design</Badge> Dashed steps run on AWS; LocalStack Community does not
            evaluate the alarm, so alarm → SNS is not demonstrated end to end locally.
          </p>
        )}
      </div>
    </Card>
  );
}
