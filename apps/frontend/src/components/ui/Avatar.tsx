/** Initials avatar — no photos (demo data is synthetic; see sample-data/README.md). */

const TONES = [
  { bg: 'var(--cq-primary-tint)', fg: 'var(--cq-primary-strong)' },
  { bg: 'var(--cq-accent-tint)', fg: 'var(--cq-accent-strong)' },
  { bg: 'var(--cq-success-tint)', fg: 'var(--cq-success-strong)' },
  { bg: 'var(--cq-callout)', fg: 'var(--cq-callout-strong)' },
  { bg: 'var(--cq-danger-tint)', fg: 'var(--cq-danger-strong)' },
];

/**
 * "Ms. Henderson (DEMO teacher)" -> "H"; "Alex Rivers (DEMO student)" -> "AR".
 * Parenthetical notes and honorifics ending in "." are ignored.
 */
export function initialsOf(name: string): string {
  const words = name
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !w.endsWith('.'));
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join('') || '?';
}

function toneFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length]!;
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const tone = toneFor(name);
  return (
    <span
      className="cq-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: tone.bg, color: tone.fg }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
