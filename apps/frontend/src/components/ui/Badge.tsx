import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'callout';

/** Rounded pill. `upper` gives the small uppercase tag style ("PUBLISHED"). */
export function Badge({ tone = 'neutral', upper, children }: { tone?: BadgeTone; upper?: boolean; children: ReactNode }) {
  return <span className={`cq-badge cq-badge--${tone}${upper ? ' cq-badge--upper' : ''}`}>{children}</span>;
}

/** Pipeline/job status -> badge tone (shared by later phases). */
export const STATUS_TONE: Record<string, BadgeTone> = {
  submitted: 'info',
  queued: 'info',
  processing: 'callout',
  completed: 'success',
  failed: 'danger',
};
