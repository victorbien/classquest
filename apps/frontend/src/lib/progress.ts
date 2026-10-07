/** Pure helpers for the student pages and teacher dashboard. */

/** Whole-number percentage for a 0–1 ratio (clamped). */
export function percent(ratio: number): number {
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
}

/** opened / available as a whole percentage; 0 when nothing is available. */
export function coveragePercent(opened: number, available: number): number {
  return available > 0 ? percent(opened / available) : 0;
}

/** "Just now", "5 min ago", "3 h ago", "2 days ago", else a short date. */
export function formatRelative(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Not yet';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Display name without demo annotations: "Alex Rivers (DEMO student)" -> "Alex Rivers". */
export function cleanName(displayName: string): string {
  return displayName.replace(/\s*\([^)]*\)\s*/g, ' ').trim() || displayName;
}
