/**
 * Shared inline-markdown helpers for the Notes tab.
 *
 * Extracted out of notes.tsx so DiaryView (and any future view that needs to
 * render note bodies) can apply the same formatting rules — bold, highlights
 * (with optional named or hex colors), and URLs.
 *
 * Headings, bullets, and checkboxes still live in RichTextContent inside
 * notes.tsx because they're block-level concerns tied to that file's reader
 * UX (clickable checkboxes etc). Diary doesn't render checkboxes so it gets
 * the simpler inline-only renderer below.
 */

export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#FACC15',
  green:  '#4ADE80',
  blue:   '#60A5FA',
  pink:   '#F472B6',
  orange: '#FB923C',
  purple: '#A78BFA',
};
export const HIGHLIGHT_ALPHA = 0.32;
export const DEFAULT_HIGHLIGHT_COLOR = 'yellow';
export const HIGHLIGHT_NAMES = Object.keys(HIGHLIGHT_COLORS);

export function resolveHighlightColor(name?: string): string {
  if (!name) return HIGHLIGHT_COLORS[DEFAULT_HIGHLIGHT_COLOR];
  const trimmed = name.trim().toLowerCase();
  if (HIGHLIGHT_COLORS[trimmed]) return HIGHLIGHT_COLORS[trimmed];
  if (/^#?[0-9a-f]{6}$/i.test(trimmed)) return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return HIGHLIGHT_COLORS[DEFAULT_HIGHLIGHT_COLOR];
}

/**
 * Strip inline-markdown markers, leaving the visible text only. Used for
 * preview surfaces (note cards, search hits, vault rows) where rendering
 * styled spans inside truncated text doesn't pay off — `**bold**` reading as
 * literal asterisks in the preview is worse than just showing "bold" plain.
 *
 * Block-level markers (`# `, `- `, `[ ] `) are kept — those are line prefixes
 * the user reads as part of their note's structure (a heading still LOOKS
 * like a heading even in plain preview text), and stripping them would
 * change line meaning.
 */
export function stripInlineMarkdown(text: string): string {
  if (!text) return text;
  return text
    // Colored highlight: `=={color}content==` → content
    .replace(/==\{[^}]+\}([\s\S]+?)==/g, '$1')
    // Default highlight: `==content==` → content
    .replace(/==([\s\S]+?)==/g, '$1')
    // Bold: `**content**` → content
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1');
}

/**
 * Strip ALL markdown — inline AND block-level line prefixes. Used for the
 * tightest preview surfaces (note cards, diary entry preview lines) where
 * the user wanted a clean reading view, not a raw-syntax dump. The
 * checkbox prefix becomes "✓ " for checked and "○ " for unchecked so the
 * preview still hints at what the line is structurally.
 */
export function stripAllMarkdown(text: string): string {
  if (!text) return text;
  return stripInlineMarkdown(text)
    .split('\n')
    .map(line => {
      if (line.startsWith('# ')) return line.slice(2);
      if (line.startsWith('- ')) return line.slice(2);
      if (line.startsWith('[x] ') || line.startsWith('[X] ')) return `✓ ${line.slice(4)}`;
      if (line.startsWith('[ ] ')) return `○ ${line.slice(4)}`;
      return line;
    })
    .join('\n');
}

/**
 * Direction detection helper — reduces a line to the text whose first strong
 * character should decide its direction, so callers can run isRtl on the
 * content rather than on markup.
 *
 * 1) Strips a leading list/checkbox/heading marker ("[ ] ", "[x] ", "[X] ",
 *    "- ", "# "). CRITICAL for checked items: the "x" in "[x]" is a strong LTR
 *    character, so without this a checked Persian line ("[x] سلام") resolves
 *    LTR while its unchecked form ("[ ] سلام") resolves RTL — the item flips
 *    alignment the instant you tick it. The renderers slice these same markers
 *    off for display, so direction must be judged on the content, not the box.
 * 2) Strips the `{color}` spec inside highlights so a line whose highlight uses
 *    an English color name ("=={pink}سلام!==" → "==سلام!==") isn't pulled LTR
 *    by that color word; the highlighted content itself stays visible to isRtl.
 *
 * Bare "==" highlight markers and bold/italic markers are direction-neutral and
 * kept.
 */
export function lineDirectionText(line: string): string {
  return line
    .replace(/^(\[[ xX]\] |- |# )/, '')
    .replace(/==\{[^}]+\}/g, '==');
}
