/**
 * Pure helpers for presenting assets. Everything here is derived from fields
 * the backend already returns — no invented metadata.
 */
import type { Asset } from '../api';

export type AssetType = Asset['type'];
export type TypeFilter = 'all' | AssetType;
export type SortOrder = 'newest' | 'title';

export const TYPE_LABEL: Record<AssetType, string> = {
  document: 'Document',
  book: 'Book',
  video: 'Video',
};

/**
 * File formats each type accepts. Mirrors ALLOWED_CONTENT_TYPES in
 * packages/shared/src/domain/schemas.ts — used only for the file picker's
 * `accept` hint and help text; the backend remains the validator.
 */
export const ACCEPTED: Record<AssetType, { mime: string[]; extensions: string[] }> = {
  document: { mime: ['application/pdf', 'text/plain', 'application/msword', 'text/markdown'], extensions: ['PDF', 'TXT', 'DOC', 'MD'] },
  book: { mime: ['application/pdf', 'application/epub+zip'], extensions: ['PDF', 'EPUB'] },
  video: { mime: ['video/mp4', 'video/webm'], extensions: ['MP4', 'WEBM'] },
};

const KIND_BY_MIME: Record<string, string> = {
  'application/pdf': 'PDF',
  'text/plain': 'TXT',
  'text/markdown': 'MD',
  'application/msword': 'DOC',
  'application/epub+zip': 'EPUB',
  'video/mp4': 'MP4',
  'video/webm': 'WEBM',
};

/** Short file-kind label from a MIME type ("PDF", "MP4"); falls back to the subtype. */
export function fileKind(contentType: string): string {
  if (KIND_BY_MIME[contentType]) return KIND_BY_MIME[contentType]!;
  const sub = contentType.split('/')[1] ?? '';
  return sub && sub !== 'octet-stream' ? sub.toUpperCase().slice(0, 6) : 'FILE';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Client-side title search + sort over the list returned by GET /assets. */
export function searchAndSort(assets: Asset[], query: string, sort: SortOrder): Asset[] {
  const q = query.trim().toLowerCase();
  const matched = q ? assets.filter((a) => a.title.toLowerCase().includes(q)) : [...assets];
  return matched.sort((a, b) =>
    sort === 'title'
      ? a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      : Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export function isTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed';
}
