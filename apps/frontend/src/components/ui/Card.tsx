import type { HTMLAttributes, ReactNode } from 'react';

type CardVariant = 'default' | 'compact' | 'flush' | 'callout';

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned header content, e.g. a "View all" link. */
  action?: ReactNode;
  variant?: CardVariant;
  children?: ReactNode;
}

/** White rounded surface with an optional title/subtitle/action header. */
export function Card({ title, subtitle, action, variant = 'default', className, children, ...rest }: CardProps) {
  const classes = ['cq-card', variant !== 'default' && `cq-card--${variant}`, className].filter(Boolean).join(' ');
  return (
    <section className={classes} {...rest}>
      {(title || action) && (
        <header className="cq-card__header">
          <div>
            {title && <h3 className="cq-card-title">{title}</h3>}
            {subtitle && <p className="cq-card__subtitle">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
