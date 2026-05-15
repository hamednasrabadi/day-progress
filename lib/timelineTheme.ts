/**
 * Theme + small color helpers shared across Timeline + Habits.
 *
 * Why a separate file: theme used to live inside the 4000-line index.tsx; both
 * Habits and the extracted Timeline components need access. Pulling it out
 * makes them sibling consumers of the same module instead of one importing
 * from the other.
 */

export type Theme = {
  bg: string;
  surface: string;
  border: string;
  textMain: string;
  textSub: string;
  danger: string;
  success: string;
  freeze: string;
  isDark: boolean;
};

export function getTheme(dark: boolean): Theme {
  return dark
    ? { bg: '#000000', surface: '#0A0A0A', border: '#1A1A1A', textMain: '#FFFFFF', textSub: '#666666', danger: '#F43F5E', success: '#10B981', freeze: '#F59E0B', isDark: true }
    : { bg: '#F8F9FA', surface: '#FFFFFF', border: '#E5E5EA', textMain: '#111111', textSub: '#888888', danger: '#F43F5E', success: '#10B981', freeze: '#F59E0B', isDark: false };
}

/**
 * Convert a hex string (`#RRGGBB`) plus alpha 0..1 to an `rgba()` string.
 * Used everywhere we need translucent versions of theme/accent colors.
 */
export function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Darken a hex color by `amount` (0..1). Used for the active-block progress
 * fill — same family as the slab color, stronger weight.
 */
export function darken(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = Math.max(0, Math.floor(parseInt(h.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.floor(parseInt(h.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.floor(parseInt(h.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
