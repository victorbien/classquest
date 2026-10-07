/**
 * Official ClassQuest logo (supplied artwork, unaltered; transparent PNG in
 * public/brand). `onDark` places it on a small light tile so the navy ring
 * keeps its contrast on dark surfaces such as the sidebar.
 */
const LOGO_SRC = '/brand/classquest-logo.png';

export function Logo({ size = 32, onDark = false }: { size?: number; onDark?: boolean }) {
  const img = <img className="cq-logo" src={LOGO_SRC} width={size} height={size} alt="ClassQuest" draggable={false} />;
  return onDark ? <span className="cq-logo-tile">{img}</span> : img;
}
