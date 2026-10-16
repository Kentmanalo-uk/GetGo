/**
 * Shared pink gradient for icons. Mounted once (main.tsx); apply it to any
 * Phosphor icon with the ICON_GRADIENT class, which fills the icon's shapes
 * with the gradient instead of a flat color.
 */
export const ICON_GRADIENT = 'fill-[url(#getgo-pink-gradient)]';

export function IconGradientDefs() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" className="absolute">
      <defs>
        <linearGradient id="getgo-pink-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff7ab6" />
          <stop offset="55%" stopColor="#ff4f9a" />
          <stop offset="100%" stopColor="#d81b6a" />
        </linearGradient>
      </defs>
    </svg>
  );
}
