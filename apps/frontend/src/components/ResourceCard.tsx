import type { Asset } from '../api';
import { useOpenResource } from '../lib/openResource';
import { fileKind, formatBytes, formatDate, TYPE_LABEL } from '../lib/assets';
import { Badge, Button, Icon, STATUS_TONE } from './ui';

interface ResourceCardProps {
  asset: Asset;
  /** Teachers/admins see pipeline status and S3 storage tier. */
  showPipeline: boolean;
  /** Called after the presigned URL was issued (e.g. to refresh progress). */
  onOpened?: (assetId: string) => void;
}

/**
 * Library card. Shows only real or derived information: type, title, demo
 * flag, created date, size, and — for staff — status and storage tier. The
 * thumbnail is a type-coloured placeholder (no real thumbnails exist).
 */
export function ResourceCard({ asset, showPipeline, onOpened }: ResourceCardProps) {
  const { open, openingId, errorId } = useOpenResource(onOpened);
  const opening = openingId === asset.id;
  const error = errorId === asset.id ? 'Could not open this resource. Please try again.' : null;
  const ready = asset.status === 'completed';

  const unavailableLabel =
    asset.status === 'failed' ? 'Processing failed' : asset.status === 'processing' ? 'Processing…' : 'Waiting to process';

  return (
    <article className="cq-resource">
      <div className={`cq-resource__thumb cq-resource__thumb--${asset.type}`} aria-hidden="true">
        <Icon name={asset.type} size={34} />
        <span className="cq-resource__kind">{fileKind(asset.contentType)}</span>
      </div>

      <div className="cq-resource__body">
        <div className="cq-resource__tags">
          <Badge tone="info" upper>{TYPE_LABEL[asset.type]}</Badge>
          {asset.isDemo && <Badge tone="warning" upper>Demo</Badge>}
        </div>

        <h3 className="cq-resource__title">{asset.title}</h3>
        <p className="cq-resource__course">
          <Icon name="course" size={14} /> {asset.courseTitle}
          {asset.sectionLabel && <> · {asset.sectionLabel}</>}
        </p>

        <p className="cq-resource__meta">
          <span>Added {formatDate(asset.createdAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatBytes(asset.sizeBytes)}</span>
        </p>

        {showPipeline && (
          <div className="cq-resource__status">
            <Badge tone={STATUS_TONE[asset.status] ?? 'neutral'} upper>{asset.status}</Badge>
            <Badge tone={asset.storageClass === 'GLACIER' ? 'neutral' : 'callout'} upper>
              {asset.storageClass === 'GLACIER' ? 'Glacier tier' : 'Standard tier'}
            </Badge>
          </div>
        )}

        <div className="cq-resource__actions">
          <Button
            block
            variant={ready ? 'primary' : 'secondary'}
            iconRight={ready ? 'external' : undefined}
            onClick={() => void open(asset.id)}
            disabled={!ready || opening}
            title={ready ? 'Open via a time-limited S3 link' : 'Available once processing completes'}
          >
            {opening ? 'Opening…' : ready ? 'Open Resource' : unavailableLabel}
          </Button>
        </div>
        {error && (
          <p className="cq-resource__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
