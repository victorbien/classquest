import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertTransition,
  isTerminal,
  nextStateAfterAttempt,
  sourcesFor,
  CLAIMABLE_STATES,
  InvalidJobTransitionError,
} from '../../packages/shared/src/domain/jobStateMachine.js';

describe('job state machine (report 3.7)', () => {
  it('allows the happy-path transitions', () => {
    expect(canTransition('submitted', 'queued')).toBe(true);
    expect(canTransition('queued', 'processing')).toBe(true);
    expect(canTransition('processing', 'completed')).toBe(true);
  });

  it('allows retry (processing -> queued) and failure paths', () => {
    expect(canTransition('processing', 'queued')).toBe(true);
    expect(canTransition('processing', 'failed')).toBe(true);
    expect(canTransition('queued', 'failed')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition('completed', 'processing')).toBe(false);
    expect(canTransition('failed', 'queued')).toBe(false);
    expect(canTransition('submitted', 'completed')).toBe(false);
  });

  it('assertTransition throws on invalid transitions', () => {
    expect(() => assertTransition('completed', 'queued')).toThrow(InvalidJobTransitionError);
    expect(() => assertTransition('submitted', 'queued')).not.toThrow();
  });

  it('identifies terminal states', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('processing')).toBe(false);
    expect(isTerminal('queued')).toBe(false);
  });

  describe('nextStateAfterAttempt (retry vs DLQ, report 10.10)', () => {
    it('completes on success', () => {
      expect(nextStateAfterAttempt(true, 1, 3)).toBe('completed');
    });
    it('retries while attempts remain', () => {
      expect(nextStateAfterAttempt(false, 1, 3)).toBe('queued');
      expect(nextStateAfterAttempt(false, 2, 3)).toBe('queued');
    });
    it('fails (terminal -> DLQ) when attempts are exhausted', () => {
      expect(nextStateAfterAttempt(false, 3, 3)).toBe('failed');
      expect(nextStateAfterAttempt(false, 4, 3)).toBe('failed');
    });
  });

  describe('sourcesFor (conditional DB updates)', () => {
    it('lists the states that may enter each target state', () => {
      expect(sourcesFor('queued').sort()).toEqual(['processing', 'submitted']);
      expect(sourcesFor('processing')).toEqual(['queued']);
      expect(sourcesFor('completed')).toEqual(['processing']);
      expect(sourcesFor('failed').sort()).toEqual(['processing', 'queued', 'submitted']);
    });
    it('never allows leaving a terminal state', () => {
      for (const to of ['submitted', 'queued', 'processing', 'completed', 'failed'] as const) {
        expect(sourcesFor(to)).not.toContain('completed');
        expect(sourcesFor(to)).not.toContain('failed');
      }
    });
  });

  it('claimable states exclude terminal states (no completed/failed -> processing)', () => {
    expect([...CLAIMABLE_STATES].sort()).toEqual(['processing', 'queued']);
  });
});
