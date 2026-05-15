/**
 * RTL helpers — used across Timeline + Habits (and future Notes).
 *
 * Detection follows the FIRST-STRONG-CHARACTER rule: walk the string skipping
 * direction-neutral chars (whitespace, punctuation, digits, emojis); the first
 * letter we hit decides the direction. So "Hello سلام" reads LTR (H is Latin),
 * "سلام Hello" reads RTL (س is Arabic). Returning true on ANY RTL character
 * was annoying — a single Persian character mid-sentence flipped the whole
 * input.
 *
 * Coverage: Hebrew (U+0590..U+05FF), Arabic (U+0600..U+06FF), Arabic Supplement
 * (U+0750..U+077F). Persian shares the Arabic block.
 */

const RTL_RE = /[֐-׿؀-ۿݐ-ݿ]/;
const LTR_RE = /[A-Za-zÀ-ÿ]/;

export const isRtl = (text?: string): boolean => {
  if (!text) return false;
  for (const ch of text) {
    if (LTR_RE.test(ch)) return false;
    if (RTL_RE.test(ch)) return true;
    // Anything else (digits, whitespace, punctuation, emoji) is direction-
    // neutral — keep walking until we find a strong character.
  }
  return false;
};

export const rtlTextStyle = (text?: string) =>
  isRtl(text) ? { writingDirection: 'rtl' as const, textAlign: 'right' as const } : null;

export const rtlInputStyle = (text?: string) =>
  isRtl(text) ? { textAlign: 'right' as const, writingDirection: 'rtl' as const } : null;

export const persianSafeInputStyle = { includeFontPadding: false as const };
