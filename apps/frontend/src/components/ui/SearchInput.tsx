import type { InputHTMLAttributes } from 'react';
import { Icon } from './Icon';

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  value: string;
  onChange: (value: string) => void;
  /** Accessible label (also used as placeholder when none is given). */
  label: string;
  /** Optional keyboard hint shown at the right edge, e.g. "/". */
  hint?: string;
}

export function SearchInput({ value, onChange, label, hint, placeholder, className, ...rest }: SearchInputProps) {
  return (
    <div className={`cq-search${className ? ` ${className}` : ''}`}>
      <Icon name="search" size={18} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder={placeholder ?? label}
        {...rest}
      />
      {hint && <kbd className="cq-search__hint">{hint}</kbd>}
    </div>
  );
}
