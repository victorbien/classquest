import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  /** Small uppercase tag above the title, e.g. "YEAR 8 CURRICULUM". */
  eyebrow?: string;
  description?: ReactNode;
  /** Right-aligned actions (secondary + primary buttons). */
  actions?: ReactNode;
}

export function PageHeader({ title, eyebrow, description, actions }: PageHeaderProps) {
  return (
    <div className="cq-page-header">
      <div className="cq-page-header__text">
        {eyebrow && <span className="cq-eyebrow">{eyebrow}</span>}
        <h1 className="cq-page-title">{title}</h1>
        {description && <p className="cq-body">{description}</p>}
      </div>
      {actions && <div className="cq-page-header__actions">{actions}</div>}
    </div>
  );
}
