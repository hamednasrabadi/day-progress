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

// Three app themes: a calm light, a softened "graphite" dark (the old pure-black
// #000 read as too harsh), and a VSCode-ish deep-navy "blue". blue counts as a
// dark theme (isDark: true) so status bars and every isDark branch behave.
export type ThemeMode = 'light' | 'dark' | 'blue' | 'sovereign';

export function getTheme(mode: ThemeMode | boolean): Theme {
  // Tolerate the legacy boolean (true→dark, false→light) so any caller that
  // hasn't moved to themeMode yet keeps working during the migration.
  const m: ThemeMode = mode === true ? 'dark' : mode === false ? 'light' : mode;
  switch (m) {
    case 'sovereign':
      // Hidden easter-egg theme — obsidian + amethyst. Only awakened by going far
      // beyond the Challenges unlock conditions; not selectable in Settings until then.
      return { bg: '#120A22', surface: '#1E1538', border: '#342856', textMain: '#EAE5F5', textSub: '#988BBC', danger: '#F43F5E', success: '#10B981', freeze: '#F59E0B', isDark: true };
    case 'blue':
      return { bg: '#0B1A2B', surface: '#122A40', border: '#1E3A52', textMain: '#E8F0F8', textSub: '#7FA0BC', danger: '#F43F5E', success: '#10B981', freeze: '#F59E0B', isDark: true };
    case 'dark':
      return { bg: '#121214', surface: '#1C1C20', border: '#2C2C30', textMain: '#F4F4F5', textSub: '#8A8A92', danger: '#F43F5E', success: '#10B981', freeze: '#F59E0B', isDark: true };
    default:
      return { bg: '#F8F9FA', surface: '#FFFFFF', border: '#E5E5EA', textMain: '#111111', textSub: '#888888', danger: '#F43F5E', success: '#10B981', freeze: '#F59E0B', isDark: false };
  }
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
