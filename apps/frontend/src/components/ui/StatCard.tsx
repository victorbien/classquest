import type { ReactNode } from 'react';
import type { IconName } from '../../navigation';
import { Icon } from './Icon';

export type StatTone = 'primary' | 'success' | 'warning' | 'danger' | 'callout';

interface StatCardProps {
  label: string;
  /** The measured value; pass a string such as "—" or "Unavailable" when unknown. */
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  icon?: IconName;
  tone?: StatTone;
}

/** KPI card: eyebrow label, tinted icon, large value with unit, sub-line. */
export function StatCard({ label, value, unit, sub, icon, tone = 'primary' }: StatCardProps) {
  return (
    <div className={`cq-stat cq-stat--${tone}`}>
      <div className="cq-stat__head">
        <span className="cq-eyebrow">{label}</span>
        {icon && (
          <span className="cq-stat__icon" aria-hidden="true">
            <Icon name={icon} size={18} />
          </span>
        )}
      </div>
      <div className="cq-stat__value">
        <span className="cq-kpi">{value}</span>
        {unit && <span className="cq-stat__unit">{unit}</span>}
      </div>
      {sub && <div className="cq-small cq-stat__sub">{sub}</div>}
    </div>
  );
}
