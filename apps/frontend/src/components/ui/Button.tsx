import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { IconName } from '../../navigation';
import { Icon } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger' | 'link';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  block?: boolean;
  iconLeft?: IconName;
  iconRight?: IconName;
  /** Icon-only button: `children` is used as the accessible label. */
  iconOnly?: IconName;
  children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  iconLeft,
  iconRight,
  iconOnly,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    'cq-btn',
    `cq-btn--${variant}`,
    size === 'sm' && 'cq-btn--sm',
    block && 'cq-btn--block',
    iconOnly && 'cq-btn--icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const iconSize = size === 'sm' ? 16 : 18;

  if (iconOnly) {
    return (
      <button type={type} className={classes} aria-label={typeof children === 'string' ? children : undefined} {...rest}>
        <Icon name={iconOnly} size={iconSize} />
      </button>
    );
  }
  return (
    <button type={type} className={classes} {...rest}>
      {iconLeft && <Icon name={iconLeft} size={iconSize} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
}
