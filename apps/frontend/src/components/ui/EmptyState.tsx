import type { ReactNode } from 'react';
import type { IconName } from '../../navigation';
import { Icon } from './Icon';

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon = 'inbox', action }: EmptyStateProps) {
  return (
    <div className="cq-empty">
      <span className="cq-empty__icon">
        <Icon name={icon} size={24} />
      </span>
      <h3 className="cq-card-title">{title}</h3>
      {description && <p className="cq-body cq-empty__desc">{description}</p>}
      {action && <div className="cq-empty__action">{action}</div>}
    </div>
  );
}
