/**
 * Job state machine (report 3.7, design.md §6).
 *
 *   submitted --enqueue--> queued --pickup--> processing --ok--> completed
 *                                             |-- retry --> queued
 *                                             '-- give up --> failed
 *
 * Invalid transitions are rejected so the async pipeline cannot enter an
 * inconsistent state (fault tolerance, report 10.10).
 */
import type { JobState } from './types.js';

const TRANSITIONS: Record<JobState, JobState[]> = {
  submitted: ['queued', 'failed'],
  queued: ['processing', 'failed'],
  processing: ['completed', 'failed', 'queued'], // queued = retry
  completed: [],
  failed: [],
};

export class InvalidJobTransitionError extends Error {
  constructor(from: JobState, to: JobState) {
    super(`Invalid job state transition: ${from} -> ${to}`);
    this.name = 'InvalidJobTransitionError';
  }
}

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new InvalidJobTransitionError(from, to);
  }
}

/** States from which `to` may be entered — used for conditional (race-safe) DB updates. */
export function sourcesFor(to: JobState): JobState[] {
  return (Object.keys(TRANSITIONS) as JobState[]).filter((from) => TRANSITIONS[from].includes(to));
}

/**
 * States a worker may claim a job from. `queued` is the normal case;
 * `processing` covers redelivery after a worker crashed mid-attempt (the
 * message reappears after its visibility timeout). Terminal states are never
 * claimable, so a completed/failed job can never return to processing.
 */
export const CLAIMABLE_STATES: readonly JobState[] = ['queued', 'processing'];

export function isTerminal(state: JobState): boolean {
  return TRANSITIONS[state].length === 0;
}

/**
 * Decide the next state after a processing attempt.
 * - success -> completed
 * - failure with attempts remaining -> queued (retry)
 * - failure with no attempts remaining -> failed (message goes to DLQ)
 */
export function nextStateAfterAttempt(
  success: boolean,
  attempts: number,
  maxAttempts: number,
): JobState {
  if (success) return 'completed';
  return attempts >= maxAttempts ? 'failed' : 'queued';
}
