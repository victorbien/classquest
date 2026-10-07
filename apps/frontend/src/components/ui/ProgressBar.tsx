export type ProgressTone = 'primary' | 'success' | 'accent' | 'danger';

interface ProgressBarProps {
  /** 0-100; values outside the range are clamped. */
  value: number;
  tone?: ProgressTone;
  /** Show the percentage to the right of the track. */
  showLabel?: boolean;
  /** Accessible description, e.g. "Library coverage". */
  label: string;
}

export function ProgressBar({ value, tone = 'primary', showLabel, label }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={`cq-progress${tone !== 'primary' ? ` cq-progress--${tone}` : ''}`}>
      <div
        className="cq-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="cq-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      {showLabel && <span className="cq-progress__label">{pct}%</span>}
    </div>
  );
}
