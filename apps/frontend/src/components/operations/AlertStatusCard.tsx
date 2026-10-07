import type { DashboardMetrics } from '../../api';
import { alarmView, thresholdText } from '../../lib/operations';
import { Badge, Icon } from '../ui';

const ALARM_TONE = { OK: 'success', ALARM: 'danger', INSUFFICIENT_DATA: 'neutral', UNKNOWN: 'neutral' } as const;

/**
 * HTTP 400 monitoring (report §2.2.8 / §7.6–7.8). Shows the configured rule,
 * the CloudWatch alarm state and the App Tier's own count — and says plainly
 * when LocalStack cannot prove an alarm transition.
 */
export function AlertStatusCard({ metrics }: { metrics: DashboardMetrics }) {
  const view = alarmView(metrics);
  const state = metrics.alerting.http400AlarmState;
  return (
    <section className={`cq-alert-card cq-alert-card--${view.tone}`} aria-labelledby="alert-card-title">
      <div className="cq-alert-card__icon" aria-hidden="true">
        <Icon name={view.tone === 'success' ? 'check' : 'alert'} size={22} />
      </div>
      <div className="cq-alert-card__body">
        <span className="cq-eyebrow">HTTP 400 monitoring</span>
        <h2 id="alert-card-title" className="cq-alert-card__headline">{view.headline}</h2>
        <p className="cq-body">{view.detail}</p>

        <dl className="cq-alert-card__facts">
          <div>
            <dt>Alarm rule</dt>
            <dd>{thresholdText(metrics.alerting.threshold, metrics.alerting.periodSeconds)}</dd>
          </div>
          <div>
            <dt>CloudWatch alarm</dt>
            <dd>
              <Badge tone={ALARM_TONE[state as keyof typeof ALARM_TONE] ?? 'neutral'} upper>{state.replace('_', ' ')}</Badge>
            </dd>
          </div>
          <div>
            <dt>HTTP 400s, last 60 s</dt>
            <dd>
              <strong>{metrics.requests.http400LastMinute}</strong> <span className="cq-small">(App Tier request log)</span>
            </dd>
          </div>
          <div>
            <dt>SNS notification</dt>
            <dd className="cq-small">Alarm action → SNS admin topic (production design). Delivery is not reported by this API.</dd>
          </div>
        </dl>

        {view.localstackLimitation && (
          <p className="cq-limitation" role="note">
            <Badge tone="warning" upper>LocalStack demonstration limitation</Badge>
            <span>
              LocalStack Community does not evaluate CloudWatch alarm state from metric data, so the alarm is not
              expected to move to ALARM locally{view.breached ? ' even though the threshold has been exceeded' : ''}. The
              metric filter, alarm and SNS action are provisioned by Terraform and behave as designed on AWS.
            </span>
          </p>
        )}
      </div>
    </section>
  );
}
