'use client';

/**
 * Logo — single source of truth for the Quickxilver brand mark across the app
 * (operator nav, storefront nav, auth brand panels). The browser-tab favicon is
 * wired separately via the App Router `app/icon.png` file convention.
 *
 * The artwork is the gold Quickxilver mark on a SOLID BLACK canvas (the black is
 * baked into the PNG, not transparent). So both variants sit in an obsidian chip
 * that matches the art's own background — the chip's black blends seamlessly into
 * the PNG edge-to-edge, and the rounded corners clip it into a self-contained
 * badge that reads cleanly on light nav, carbon nav and the gold auth panels.
 *
 *   variant="mark"   → symbol only (circular Q + lightning), a compact square
 *                      tile for nav bars. Default.
 *   variant="lockup" → the full horizontal logo (symbol + "Quickxilver" wordmark
 *                      + tagline) for wide brand panels. `size` is its height.
 */
const MARK = '/Quickxilver-logo.png';       // symbol only, gold on black (256×256)
const FULL = '/Quickxilver-logo-name.png';  // symbol + wordmark, gold on black (588×200)

// Both PNGs are shipped pre-cropped to their artwork and downsized for the web
// (full-res originals live in frontend/brand-assets/), so they render at their
// natural aspect — no CSS cropping needed.
export default function Logo({ variant = 'mark', size = 36, className = '' }) {
  if (variant === 'lockup') {
    return (
      <span
        className={`inline-flex items-center justify-center overflow-hidden rounded-2xl bg-slate-950 px-3 shadow-glow ring-1 ring-white/10 ${className}`}
        style={{ height: size + 16 }}
      >
        <img
          src={FULL}
          alt="Quickxilver"
          className="block w-auto object-contain"
          style={{ height: size }}
        />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-950 shadow-glow ring-1 ring-white/10 ${className}`}
      style={{ width: size, height: size }}
    >
      <img src={MARK} alt="Quickxilver" className="h-full w-full object-cover object-center" />
    </span>
  );
}
