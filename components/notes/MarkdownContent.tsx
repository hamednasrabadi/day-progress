/**
 * MarkdownContent — shared inline-markdown renderer for note bodies.
 *
 * Handles the same formatting that notes.tsx's RichTextContent does, but as a
 * standalone component so DiaryView can render entries with the same syntax
 * users type into the editor — bold (**text**), highlights (==text== or
 * =={color}text==), and URLs. Block-level elements supported:
 *
 *   "# heading"   → larger weight + size
 *   "- bullet"    → bulleted list item
 *   "[ ] todo"    → unchecked checkbox (readonly here; tap-to-toggle lives
 *                   in RichTextContent because it requires write access to
 *                   note state)
 *   "[x] done"    → checked checkbox, struck through
 *
 * Diary uses this; the regular-notes reader uses its own variant in notes.tsx
 * because that one hands users tap-to-toggle interactivity.
 */

import React from 'react';
import { Linking, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { HIGHLIGHT_ALPHA, resolveHighlightColor, lineDirectionText } from '../../lib/notesRichText';
import { isRtl } from '../../lib/rtl';

type Theme = {
  textMain: string;
  textSub: string;
  surface?: string;
};

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Wrap any case-insensitive match of `highlight` inside `content` with a
// search-match style. Returns an array of Text nodes — plain text segments
// alternating with highlighted segments. Used at the leaf level so search
// matches survive markdown rendering without breaking the parser.
function withSearchHighlight(content: string, highlight: string | undefined, theme: Theme, keyBase: string): React.ReactNode[] {
  if (!highlight || !content) return [<Text key={`${keyBase}-0`}>{content}</Text>];
  const q = highlight.trim().toLowerCase();
  if (!q) return [<Text key={`${keyBase}-0`}>{content}</Text>];
  const out: React.ReactNode[] = [];
  let cursor = 0;
  let k = 0;
  const lower = content.toLowerCase();
  while (cursor < content.length) {
    const idx = lower.indexOf(q, cursor);
    if (idx === -1) {
      out.push(<Text key={`${keyBase}-${k++}`}>{content.slice(cursor)}</Text>);
      break;
    }
    if (idx > cursor) out.push(<Text key={`${keyBase}-${k++}`}>{content.slice(cursor, idx)}</Text>);
    out.push(
      <Text key={`${keyBase}-${k++}`} style={{ backgroundColor: '#FACC15', color: '#000' }}>
        {content.slice(idx, idx + q.length)}
      </Text>
    );
    cursor = idx + q.length;
  }
  return out;
}

// Recursive inline parser — same shape as the one in notes.tsx so syntax is
// 1:1 between editor preview and diary view.
function parseInline(content: string, accent: string, theme: Theme, highlight?: string): React.ReactNode[] {
  const pattern = /(https?:\/\/[^\s]+)|\*\*([\s\S]+?)\*\*|==\{([^}]+)\}([\s\S]+?)==|==([\s\S]+?)==/g;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    if (m.index > cursor) {
      const plain = content.slice(cursor, m.index);
      out.push(<Text key={key++}>{withSearchHighlight(plain, highlight, theme, `mc-${key}`)}</Text>);
    }
    if (m[1]) {
      const url = m[1];
      out.push(
        <Text key={key++} style={{ color: accent, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(url)}>
          {withSearchHighlight(url, highlight, theme, `mc-${key}`)}
        </Text>
      );
    } else if (m[2] !== undefined) {
      // Inner spans inherit direction from the outer line's Text.
      // Setting writingDirection per-span overrides the parent and breaks
      // mixed-content paragraphs.
      out.push(<Text key={key++} style={{ fontWeight: '900' }}>{parseInline(m[2], accent, theme, highlight)}</Text>);
    } else if (m[3] !== undefined) {
      const colorHex = resolveHighlightColor(m[3]);
      out.push(<Text key={key++} style={{ backgroundColor: hexToRgba(colorHex, HIGHLIGHT_ALPHA), color: theme.textMain }}>{parseInline(m[4], accent, theme, highlight)}</Text>);
    } else if (m[5] !== undefined) {
      const colorHex = resolveHighlightColor();
      out.push(<Text key={key++} style={{ backgroundColor: hexToRgba(colorHex, HIGHLIGHT_ALPHA), color: theme.textMain }}>{parseInline(m[5], accent, theme, highlight)}</Text>);
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < content.length) {
    const tail = content.slice(cursor);
    out.push(<Text key={key++}>{withSearchHighlight(tail, highlight, theme, `mc-${key}`)}</Text>);
  }
  return out;
}

export function MarkdownContent({
  text, theme, accent, fontSize = 14, lineHeight = 21, color, numberOfLines, highlight,
}: {
  text: string;
  theme: Theme;
  accent: string;
  fontSize?: number;
  lineHeight?: number;
  color?: string;
  numberOfLines?: number;
  // Optional case-insensitive substring to highlight inside rendered text
  // — used for diary search hits. Passed through to leaf Text segments at
  // parse time so it survives markdown spans without breaking the parser.
  highlight?: string;
}) {
  const lines = text.split('\n');
  const visibleLines = numberOfLines ? lines.slice(0, numberOfLines) : lines;
  const baseColor = color || theme.textMain;

  return (
    <View>
      {visibleLines.map((line, i) => {
        const isCheckbox = line.startsWith('[ ] ');
        const isChecked = line.startsWith('[x] ') || line.startsWith('[X] ');
        const isBullet = line.startsWith('- ');
        const isHeading = line.startsWith('# ');
        // Strip highlight inner content before direction detection so a
        // mixed-language line ("==quote== چیزی") doesn't flip direction
        // because of the highlight's foreign content.
        const isLineRtl = isRtl(lineDirectionText(line));

        let content = line;
        if (isCheckbox || isChecked) content = content.slice(4);
        else if (isBullet || isHeading) content = content.slice(2);

        const parsed = parseInline(content, accent, theme, highlight);
        // Direction set ONCE on the outer Text via baseStyle. Inner spans
        // inherit. No wrapping View on plain/heading lines — keeping it
        // simple is what made the prior version work for mixed-content notes.
        const baseStyle = {
          fontSize: isHeading ? fontSize + 4 : fontSize,
          fontWeight: (isHeading ? '900' : '500') as '500' | '900',
          color: isHeading ? theme.textMain : baseColor,
          lineHeight: isHeading ? lineHeight + 6 : lineHeight,
          textAlign: (isLineRtl ? 'right' : 'left') as 'left' | 'right',
          writingDirection: (isLineRtl ? 'rtl' : 'ltr') as 'ltr' | 'rtl',
        };

        if (isHeading) {
          return <Text key={i} style={[baseStyle, { marginTop: i > 0 ? 6 : 0, marginBottom: 2 }]}>{parsed}</Text>;
        }
        if (isCheckbox || isChecked) {
          return (
            <View key={i} style={{ flexDirection: isLineRtl ? 'row-reverse' : 'row', alignItems: 'flex-start', marginTop: 4 }}>
              <Feather name={isChecked ? 'check-square' : 'square'} size={fontSize} color={isChecked ? accent : theme.textSub} style={{ marginTop: 3, marginHorizontal: 6, opacity: isChecked ? 1 : 0.6 }} />
              <Text style={[baseStyle, { flex: 1, color: isChecked ? theme.textSub : baseColor, textDecorationLine: isChecked ? 'line-through' : 'none' }]}>{parsed}</Text>
            </View>
          );
        }
        if (isBullet) {
          return (
            <View key={i} style={{ flexDirection: isLineRtl ? 'row-reverse' : 'row', alignItems: 'flex-start', marginTop: 2 }}>
              <Text style={[baseStyle, { marginHorizontal: 6, fontWeight: '900' }]}>•</Text>
              <Text style={[baseStyle, { flex: 1 }]}>{parsed}</Text>
            </View>
          );
        }
        return <Text key={i} style={baseStyle}>{parsed}</Text>;
      })}
    </View>
  );
}
