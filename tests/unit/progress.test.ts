/** Student-page helpers (pure TS). */
import { describe, it, expect } from 'vitest';
import { percent, coveragePercent, formatRelative, cleanName } from '../../apps/frontend/src/lib/progress.js';

describe('coverage', () => {
  it('rounds and clamps ratios', () => {
    expect(percent(0.4167)).toBe(42);
    expect(percent(1.3)).toBe(100);
    expect(percent(-1)).toBe(0);
  });
  it('is 0 when nothing is available (no division by zero)', () => {
    expect(coveragePercent(0, 0)).toBe(0);
    expect(coveragePercent(1, 4)).toBe(25);
    expect(coveragePercent(3, 3)).toBe(100);
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  it('describes recent times', () => {
    expect(formatRelative(null, now)).toBe('Not yet');
    expect(formatRelative('2026-10-06T11:59:30Z', now)).toBe('Just now');
    expect(formatRelative('2026-10-06T11:55:00Z', now)).toBe('5 min ago');
    expect(formatRelative('2026-10-06T09:00:00Z', now)).toBe('3 h ago');
    expect(formatRelative('2026-10-05T12:00:00Z', now)).toBe('1 day ago');
    expect(formatRelative('2026-10-03T12:00:00Z', now)).toBe('3 days ago');
  });
  it('falls back to a date after a week, and handles bad input', () => {
    expect(formatRelative('2026-09-01T12:00:00Z', now)).toMatch(/2026/);
    expect(formatRelative('not-a-date', now)).toBe('—');
  });
});

describe('cleanName', () => {
  it('drops demo annotations', () => {
    expect(cleanName('Alex Rivers (DEMO student)')).toBe('Alex Rivers');
    expect(cleanName('Ms. Henderson (DEMO teacher)')).toBe('Ms. Henderson');
    expect(cleanName('Plain Name')).toBe('Plain Name');
  });
});
