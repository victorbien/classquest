/** Course page view logic (pure helpers behind My Courses, Courses, Course Detail, My Progress). */
import { describe, it, expect } from 'vitest';
import {
  percentLabel,
  filterCourses,
  categoriesOf,
  groupBySection,
  moveItem,
  lifecycleActions,
  coverProblem,
  coverTone,
  COVER_TONES,
} from '../../apps/frontend/src/lib/courses.js';

const course = (title: string, status: 'draft' | 'published' | 'archived', category = 'Computer Science', description = '') =>
  ({ title, status, category, description });

describe('percentLabel', () => {
  it('shows one decimal place only when needed', () => {
    expect(percentLabel(3 / 8)).toBe('37.5%');
    expect(percentLabel(0)).toBe('0%');
    expect(percentLabel(1)).toBe('100%');
    expect(percentLabel(1 / 3)).toBe('33.3%');
    expect(percentLabel(0.5)).toBe('50%');
  });
  it('clamps out-of-range ratios', () => {
    expect(percentLabel(1.4)).toBe('100%');
    expect(percentLabel(-1)).toBe('0%');
  });
});

describe('filterCourses', () => {
  const list = [
    course('Cloud Computing', 'published', 'Computer Science', 'AWS core services'),
    course('Applied Blockchain', 'draft', 'Information Systems'),
    course('Old Course', 'archived', 'Computer Science'),
  ];

  it('"active" hides archived courses; a status shows only that status', () => {
    expect(filterCourses(list, { status: 'active' }).map((c) => c.title)).toEqual(['Cloud Computing', 'Applied Blockchain']);
    expect(filterCourses(list, { status: 'archived' }).map((c) => c.title)).toEqual(['Old Course']);
    expect(filterCourses(list, { status: 'draft' }).map((c) => c.title)).toEqual(['Applied Blockchain']);
  });

  it('searches title, description and category, case-insensitively, and filters by category', () => {
    expect(filterCourses(list, { query: 'aws' }).map((c) => c.title)).toEqual(['Cloud Computing']);
    expect(filterCourses(list, { query: 'INFORMATION' }).map((c) => c.title)).toEqual(['Applied Blockchain']);
    expect(filterCourses(list, { category: 'Computer Science', status: 'active' }).map((c) => c.title)).toEqual(['Cloud Computing']);
    expect(filterCourses(list, { query: '  ' })).toHaveLength(3);
  });

  it('lists distinct categories alphabetically', () => {
    expect(categoriesOf(list)).toEqual(['Computer Science', 'Information Systems']);
  });
});

describe('groupBySection', () => {
  it('groups consecutive resources by section label, preserving order', () => {
    const items = [
      { id: 1, sectionLabel: 'Week 1' },
      { id: 2, sectionLabel: 'Week 1' },
      { id: 3, sectionLabel: 'Week 2' },
      { id: 4, sectionLabel: null },
      { id: 5, sectionLabel: 'Week 1' },
    ];
    expect(groupBySection(items).map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Week 1', [1, 2]],
      ['Week 2', [3]],
      [null, [4]],
      ['Week 1', [5]],
    ]);
    expect(groupBySection([])).toEqual([]);
  });
});

describe('moveItem', () => {
  it('swaps with the neighbour and ignores moves past either end', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('lifecycleActions mirror the API transitions', () => {
  it('offers publish/return to draft/archive/restore as allowed', () => {
    expect(lifecycleActions('draft')).toEqual(['publish', 'archive']);
    expect(lifecycleActions('published')).toEqual(['draft', 'archive']);
    expect(lifecycleActions('archived')).toEqual(['restore']);
  });
});

describe('covers', () => {
  it('accepts PNG/JPEG/WebP up to 2 MB', () => {
    expect(coverProblem({ type: 'image/png', size: 1000 })).toBeNull();
    expect(coverProblem({ type: 'image/webp', size: 2 * 1024 * 1024 })).toBeNull();
    expect(coverProblem({ type: 'image/gif', size: 10 })).toMatch(/PNG, JPEG or WebP/);
    expect(coverProblem({ type: 'image/jpeg', size: 2 * 1024 * 1024 + 1 })).toMatch(/2 MB/);
  });
  it('gives each category a stable placeholder tone from the palette', () => {
    expect(coverTone('Data Science')).toBe(coverTone('data science'));
    expect(COVER_TONES).toContain(coverTone('Anything'));
  });
});
