/**
 * Library + Publish presentation helpers (pure TS): search/sort, derived
 * labels, and the job -> pipeline-stepper mapping.
 */
import { describe, it, expect } from 'vitest';
import {
  searchAndSort,
  fileKind,
  formatBytes,
  isTerminal,
} from '../../apps/frontend/src/lib/assets.js';
import { pipelineModel } from '../../apps/frontend/src/lib/pipeline.js';
import type { Asset } from '../../apps/frontend/src/api.js';

const asset = (id: string, title: string, createdAt: string): Asset => ({
  id, ownerId: 't', title, type: 'document', s3Key: 'k', sizeBytes: 1, contentType: 'text/plain',
  storageClass: 'STANDARD', status: 'completed', isDemo: false, createdAt,
});

const list = [
  asset('a', 'solar system', '2026-01-02T00:00:00Z'),
  asset('b', 'Algebra Basics', '2026-03-01T00:00:00Z'),
  asset('c', 'The Giver', '2026-02-01T00:00:00Z'),
];

describe('searchAndSort', () => {
  it('sorts newest first by default', () => {
    expect(searchAndSort(list, '', 'newest').map((a) => a.id)).toEqual(['b', 'c', 'a']);
  });
  it('sorts by title A–Z, case-insensitively', () => {
    expect(searchAndSort(list, '', 'title').map((a) => a.title)).toEqual(['Algebra Basics', 'solar system', 'The Giver']);
  });
  it('filters by title substring, case-insensitively, then sorts', () => {
    expect(searchAndSort(list, '  GIV ', 'newest').map((a) => a.id)).toEqual(['c']);
    expect(searchAndSort(list, 'e', 'title').map((a) => a.id)).toEqual(['b', 'a', 'c']);
    expect(searchAndSort(list, 'zzz', 'newest')).toEqual([]);
  });
  it('does not mutate the input', () => {
    const copy = [...list];
    searchAndSort(list, '', 'title');
    expect(list).toEqual(copy);
  });
});

describe('derived labels', () => {
  it('derives a short file kind from the MIME type', () => {
    expect(fileKind('application/pdf')).toBe('PDF');
    expect(fileKind('application/epub+zip')).toBe('EPUB');
    expect(fileKind('video/mp4')).toBe('MP4');
    expect(fileKind('application/octet-stream')).toBe('FILE');
  });
  it('formats sizes', () => {
    expect(formatBytes(24)).toBe('24 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(52_428_800)).toBe('50 MB');
  });
  it('knows terminal statuses', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('processing')).toBe(false);
  });
});

describe('pipelineModel (Submitted → Queued → Processing → Completed)', () => {
  const statuses = (m: ReturnType<typeof pipelineModel>) => m.steps.map((s) => `${s.label}:${s.status}`);

  it('queued: Submitted done, Queued current', () => {
    expect(statuses(pipelineModel({ state: 'queued', attempts: 0, error: null }))).toEqual([
      'Submitted:done', 'Queued:current', 'Processing:upcoming', 'Completed:upcoming',
    ]);
  });
  it('processing: first two done, Processing current', () => {
    expect(statuses(pipelineModel({ state: 'processing', attempts: 1, error: null }))).toEqual([
      'Submitted:done', 'Queued:done', 'Processing:current', 'Completed:upcoming',
    ]);
  });
  it('completed: every step done', () => {
    const m = pipelineModel({ state: 'completed', attempts: 1, error: null });
    expect(m.steps.every((s) => s.status === 'done')).toBe(true);
    expect(m.failed).toBe(false);
  });
  it('re-queued after a failed attempt is flagged as retrying', () => {
    const m = pipelineModel({ state: 'queued', attempts: 1, error: 'Induced failure' });
    expect(m.retrying).toBe(true);
    expect(m.steps[1]!.status).toBe('current');
  });
  it('failed after processing attempts ends on a red Failed final step', () => {
    const m = pipelineModel({ state: 'failed', attempts: 3, error: 'Induced failure' });
    expect(m.failed).toBe(true);
    expect(statuses(m)).toEqual(['Submitted:done', 'Queued:done', 'Processing:done', 'Failed:failed']);
  });
  it('failed before any attempt (enqueue failure) marks the Queued step as Failed', () => {
    expect(statuses(pipelineModel({ state: 'failed', attempts: 0, error: 'Enqueue failed' }))).toEqual([
      'Submitted:done', 'Failed:failed', 'Processing:upcoming', 'Completed:upcoming',
    ]);
  });
});
