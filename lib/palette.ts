/**
 * The app's color system — single source of truth for every color picker.
 *
 * One Apple-system family in two intensities:
 *   PALETTE           — Apple's system accent colors, shared by Tasks, Habits
 *                       and Notes (those three pickers are identical by
 *                       construction).
 *   PROJECT_PALETTE   — a 7-color spanning subset for the minimal one-row
 *                       project picker in the Tasks tab.
 *   CHALLENGE_PALETTE — "Deep Apple": the same hues deepened but kept HIGH
 *                       saturation, so Challenges reads premium instead of the
 *                       muddy/grey it looked before. (Mid lightness + mid
 *                       saturation = mud; deep + saturated = rich.)
 *
 * ── Data-safety contract ──────────────────────────────────────────────────
 * Every item (task / habit / note / challenge / project) stores its OWN color
 * as a literal hex string and renders it directly. These arrays only drive
 * what the PICKER offers — they are NOT a lookup table. So editing them never
 * migrates, validates, or rewrites stored data, and old/imported items keep
 * their exact hex (lib/backup.ts round-trips colors verbatim; lib/sanitize.ts
 * never touches them). The only visible effect of changing a palette is that
 * an item whose stored color isn't in the new set simply won't show a
 * highlighted swatch when edited — cosmetic, never a crash or data loss.
 *
 * Defaults are explicit constants (not PALETTE[0]) so the picker's ordering
 * can't silently change what new items default to.
 */

// Apple system accent colors (iOS dark variants) — vivid, proven on light + dark.
export const PALETTE = [
  // row 1
  '#FF453A', // red
  '#FF9F0A', // orange
  '#FFD60A', // yellow
  '#32D74B', // green
  '#66D4CF', // mint
  '#40C8E0', // teal
  // row 2
  '#64D2FF', // cyan
  '#0A84FF', // blue  ← DEFAULT_COLOR
  '#5E5CE6', // indigo
  '#BF5AF2', // purple
  '#FF375F', // pink
  '#AC8E68', // brown (warm neutral)
];

// Minimal one-row subset for the project picker — spans the spectrum.
export const PROJECT_PALETTE = [
  '#FF453A', // red
  '#FF9F0A', // orange
  '#32D74B', // green
  '#40C8E0', // teal
  '#0A84FF', // blue  ← DEFAULT_COLOR
  '#BF5AF2', // purple
  '#AC8E68', // brown
];

// "Deep Apple" — same hue family, deepened but still saturated, for Challenges.
export const CHALLENGE_PALETTE = [
  // row 1
  '#E01030', // deep red
  '#E85D04', // deep orange
  '#E0A500', // rich gold
  '#18A33E', // deep green
  '#0FAE9C', // deep mint
  '#0E8FA8', // deep teal
  // row 2
  '#1379C9', // ocean
  '#1A5FE0', // deep blue  ← CHALLENGE_DEFAULT
  '#4A3CD6', // deep indigo
  '#9A2FD0', // deep purple
  '#E01E5C', // deep rose
  '#8A5A2B', // deep brown
];

// Default selected color for a NEW task / habit / note — Apple blue, kept
// stable so the picker's ordering doesn't default new items to red. Member of
// PALETTE and PROJECT_PALETTE, so it shows as selected on open.
export const DEFAULT_COLOR = '#0A84FF';

// Default for a new challenge — deep blue from the premium set.
export const CHALLENGE_DEFAULT = '#1A5FE0';

// Muted slate for internal/placeholder items (e.g. void spacer tasks) that
// should read as colorless rather than picking up a vivid hue. Not shown in
// any picker.
export const NEUTRAL_COLOR = '#6E7B95';
