/**
 * Pure helpers for the course pages. Everything is derived from fields the
 * API returns — no invented metadata.
 */
import type { CourseStatus } from '../api';
import type { BadgeTone } from '../components/ui/Badge';

export type StatusFilter = 'active' | CourseStatus;

export const STATUS_LABEL: Record<CourseStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

export const COURSE_STATUS_TONE: Record<CourseStatus, BadgeTone> = {
  draft: 'warning',
  published: 'success',
  archived: 'neutral',
};

/** "37.5%" — one decimal place, trailing ".0" dropped; 0–1 ratio in. */
export function percentLabel(ratio: number): string {
  const v = Math.round(Math.max(0, Math.min(1, ratio)) * 1000) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;
}

interface Filterable {
  title: string;
  description: string;
  category: string;
  status: CourseStatus;
}

/**
 * Client-side search (title, description, category) plus status/category
 * filters. 'active' means draft + published — archived courses are only
 * listed when asked for.
 */
export function filterCourses<T extends Filterable>(
  courses: T[],
  opts: { query?: string; status?: StatusFilter | 'all'; category?: string },
): T[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  return courses.filter((c) => {
    if (opts.status === 'active' && c.status === 'archived') return false;
    if (opts.status && opts.status !== 'active' && opts.status !== 'all' && c.status !== opts.status) return false;
    if (opts.category && opts.category !== 'all' && c.category !== opts.category) return false;
    if (!q) return true;
    return [c.title, c.description, c.category].some((v) => v.toLowerCase().includes(q));
  });
}

/** Distinct categories, sorted, for the category filter. */
export function categoriesOf(courses: Array<{ category: string }>): string[] {
  return [...new Set(courses.map((c) => c.category))].sort((a, b) => a.localeCompare(b));
}

/**
 * Group an ordered resource list into consecutive sections by their label
 * ("Week 1", "Week 2" …). Order is preserved; unlabelled runs get label null.
 */
export function groupBySection<T extends { sectionLabel: string | null }>(items: T[]): Array<{ label: string | null; items: T[] }> {
  const groups: Array<{ label: string | null; items: T[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.label === item.sectionLabel) last.items.push(item);
    else groups.push({ label: item.sectionLabel, items: [item] });
  }
  return groups;
}

/** New id order after moving the item at `index` one place up (-1) or down (+1). */
export function moveItem(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** Lifecycle actions offered for a course in a given status (mirrors the API's rules). */
export function lifecycleActions(status: CourseStatus): Array<'publish' | 'draft' | 'archive' | 'restore'> {
  if (status === 'draft') return ['publish', 'archive'];
  if (status === 'published') return ['draft', 'archive'];
  return ['restore'];
}

/** Cover placeholder tone, stable per category (four calm palette tints). */
export const COVER_TONES = ['sky', 'lavender', 'amber', 'teal'] as const;
export function coverTone(category: string): (typeof COVER_TONES)[number] {
  let h = 0;
  for (const ch of category.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVER_TONES[h % COVER_TONES.length]!;
}

/** Client-side check before uploading a cover (the API validates again). */
export const COVER_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_COVER_BYTES = 2 * 1024 * 1024;
export function coverProblem(file: { type: string; size: number }): string | null {
  if (!COVER_TYPES.includes(file.type)) return 'Cover images must be PNG, JPEG or WebP.';
  if (file.size > MAX_COVER_BYTES) return 'Cover images are limited to 2 MB.';
  return null;
}
