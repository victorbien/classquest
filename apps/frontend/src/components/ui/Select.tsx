import { useId } from 'react';
import { Icon } from './Icon';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Visible label; when `hideLabel` is set it is used for screen readers only. */
  label: string;
  hideLabel?: boolean;
  disabled?: boolean;
}

/** Styled native <select> (keeps native keyboard/mobile behaviour). */
export function Select({ value, onChange, options, label, hideLabel, disabled }: SelectProps) {
  const id = useId();
  return (
    <div className="cq-select">
      <label htmlFor={id} className={hideLabel ? 'cq-visually-hidden' : 'cq-select__label'}>
        {label}
      </label>
      <div className="cq-select__control">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} />
      </div>
    </div>
  );
}
