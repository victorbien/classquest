/**
 * Inline stroke icons (24px grid, Lucide-style). Bundled with the app — no
 * icon font or CDN, which keeps the Web Tier's strict CSP intact.
 */
import type { IconName } from '../../navigation';

const PATHS: Record<IconName, string[]> = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5'],
  library: ['M4 19.5V5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2Z', 'M4 19.5A2 2 0 0 0 6 21h13', 'M9 7h6'],
  progress: ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
  dashboard: ['M4 4h7v7H4z', 'M13 4h7v4h-7z', 'M13 10h7v10h-7z', 'M4 13h7v7H4z'],
  publish: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'],
  operations: ['M3 12h4l3-8 4 16 3-8h4'],
  bell: ['M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'M21 21l-4.3-4.3'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  'chevron-down': ['M6 9l6 6 6-6'],
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  document: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z', 'M14 3v5h5', 'M9 13h6', 'M9 17h6'],
  book: ['M2 5h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2Z', 'M22 5h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7Z'],
  video: ['M3 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z', 'M17 10l5-3v10l-5-3'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  'upload-cloud': ['M7 18a5 5 0 0 1-.9-9.9A6 6 0 0 1 17.7 9 4.5 4.5 0 0 1 17 18', 'M12 12v9', 'M8.5 15.5 12 12l3.5 3.5'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  x: ['M6 6l12 12', 'M18 6 6 18'],
  alert: ['M12 3 2 21h20Z', 'M12 10v5', 'M12 18h.01'],
  refresh: ['M20 11a8 8 0 0 0-14.9-4', 'M4 4v4h4', 'M4 13a8 8 0 0 0 14.9 4', 'M20 20v-4h-4'],
  database: ['M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3Z', 'M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
  archive: ['M3 4h18v4H3z', 'M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8', 'M10 12h4'],
  queue: ['M4 6h16', 'M4 12h16', 'M4 18h10'],
  server: ['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M8 7h.01', 'M8 17h.01'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
  cpu: ['M7 7h10v10H7z', 'M10 3v4', 'M14 3v4', 'M10 17v4', 'M14 17v4', 'M3 10h4', 'M3 14h4', 'M17 10h4', 'M17 14h4'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  'arrow-right': ['M5 12h14', 'M13 6l6 6-6 6'],
  zap: ['M13 2 4 14h7l-1 8 9-12h-7Z'],
  snowflake: ['M12 2v20', 'M4.9 7l14.2 10', 'M4.9 17l14.2-10', 'M9 4l3 3 3-3', 'M9 20l3-3 3 3'],
  terminal: ['M4 17l6-6-6-6', 'M12 19h8'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5', 'M12 8h.01'],
  course: ['M22 9 12 4 2 9l10 5 10-5Z', 'M6 11.2V16c3.2 2.4 8.8 2.4 12 0v-4.8', 'M22 9v6'],
  plus: ['M12 5v14', 'M5 12h14'],
  edit: ['M4 20h4L19 9l-4-4L4 16v4Z', 'M13.5 6.5l4 4'],
  'arrow-up': ['M12 19V5', 'M6 11l6-6 6 6'],
  'arrow-down': ['M12 5v14', 'M18 13l-6 6-6-6'],
  'arrow-left': ['M19 12H5', 'M11 6l-6 6 6 6'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M15 9h.01'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 21a8 8 0 0 1 16 0'],
  layers: ['M12 3 2 8l10 5 10-5Z', 'M2 13l10 5 10-5'],
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
