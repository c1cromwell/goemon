/**
 * Goemon "Ink & Seal" brand mark — the ink tile holding a seal-red square (hanko).
 * Matches docs/designs/goemon-mark.svg. Theme-aware: the tile follows the ink/paper
 * text color (via currentColor), the seal square stays seal-red.
 *
 * The rich faceted-shield lockup (docs/designs/goemon-lockup-*.png) is used on the
 * marketing/landing hero; this compact mark is for nav, favicons, and inline headers.
 */
export function BrandMark({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {/* ink tile — inherits text color so it reads on both themes */}
      <rect x="4" y="4" width="56" height="56" rx="16" fill="currentColor" />
      {/* seal-red square at the core */}
      <rect x="22" y="22" width="20" height="20" rx="6" fill="var(--accent, #b4362b)" />
    </svg>
  );
}
