/**
 * DiaryView — chronological journal rendering of diary-kind notes.
 *
 * Triggered from the Notes tab's Diary toggle. Distinct UX from the regular
 * notes feed:
 *   - Vertical timeline, no card stacking; each entry shows full content.
 *   - Big date header per entry ("Today · May 1, 2026"; "Yesterday"; or the
 *     formatted date for older entries).
 *   - Inline media (images side-by-side, audio chip count) — diary entries
 *     are read in-place, not opened into a reader modal.
 *   - Tap an entry to edit; long-press for status actions (archive/trash).
 *
 * Sorts purely by createdAt desc — simple chronological scroll, no grouping
 * by week/month. The date headers themselves provide enough rhythm.
 */

import React, { useMemo } from 'react';
import { Platform, Text, TouchableOpacity, View, ScrollView, Pressable } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import type { Note, CalendarSystem } from '../../store/useAppStore';
import { MarkdownContent } from './MarkdownContent';
import { AudioPlayer } from './AudioPlayer';
import { isRtl } from '../../lib/rtl';
import { lineDirectionText, stripAllMarkdown } from '../../lib/notesRichText';

// Mirror of the mood lookup in notes.tsx — small enough to duplicate rather
// than thread through props. Keep in sync if the picker palette changes.
const MOOD_LOOKUP: Record<string, { label: string; icon: any; color: string }> = {
  'heart':      { label: 'Loved',  icon: 'heart',      color: '#F472B6' },
  'sun':        { label: 'Bright', icon: 'sun',        color: '#FACC15' },
  'cloud':      { label: 'Calm',   icon: 'cloud',      color: '#60A5FA' },
  'cloud-rain': { label: 'Rough',  icon: 'cloud-rain', color: '#94A3B8' },
  'moon':       { label: 'Heavy',  icon: 'moon',       color: '#A78BFA' },
};

// Loose theme shape — DiaryView only uses the colors it actually paints, so
// we don't pull in the full timelineTheme `Theme` (which includes fields like
// freeze/isDark that the notes tab's local theme doesn't define).
type Theme = {
  bg: string;
  surface: string;
  border: string;
  textMain: string;
  textSub: string;
};

const GREGORIAN_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SHAMSI_MONTHS = ['Farvardin','Ordibehesht','Khordad','Tir','Mordad','Shahrivar','Mehr','Aban','Azar','Dey','Bahman','Esfand'];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Same g2j the rest of notes.tsx uses — duplicated here so DiaryView is
// drop-in without coupling to the parent file's helpers.
function g2j(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g_d_m.slice(0, gm).reduce((a, b) => a + b, 0);
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// "Today", "Yesterday", or a formatted date for older entries. Day-of-week is
// added for the "this week" range (2–6 days back) since "5 days ago" is less
// scannable than "Wednesday" when the entry's still in living memory.
function formatHeaderDate(ms: number, cal: CalendarSystem): string {
  const today = startOfDay(Date.now());
  const target = startOfDay(ms);
  const diffDays = Math.round((today - target) / 86400000);
  const d = new Date(ms);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 0 && diffDays < 7) return DAY_NAMES[d.getDay()];
  if (cal === 'shamsi') {
    const [jy, jm, jd] = g2j(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const sameYear = jy === g2j(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate())[0];
    return sameYear ? `${jd} ${SHAMSI_MONTHS[jm - 1]}` : `${jd} ${SHAMSI_MONTHS[jm - 1]} ${jy}`;
  }
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear
    ? `${d.getDate()} ${GREGORIAN_MONTHS[d.getMonth()]}`
    : `${d.getDate()} ${GREGORIAN_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTimeOfDay(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function DiaryView({
  notes, theme, isDarkMode, calSystem, onOpen, onLongPress, onCreate,
  activeAudioUri, setActiveAudioUri, searchQuery,
}: {
  notes: Note[];
  theme: Theme;
  isDarkMode: boolean;
  calSystem: CalendarSystem;
  onOpen: (note: Note) => void;
  onLongPress: (note: Note) => void;
  onCreate: () => void;
  // Audio coordination — lifted to the parent (notes.tsx) so a memo playing
  // inline in the diary pauses anything playing in the editor and vice versa.
  activeAudioUri: string | null;
  setActiveAudioUri: (uri: string | null) => void;
  // Live search filter from the Notes header — empty string means show all.
  searchQuery: string;
}) {
  // Strict chronological order by the entry's "about" date (entryDate when
  // set; falls back to createdAt for legacy entries written before
  // backdating support landed). Newest at the top so the diary opens on
  // "Today" by default. Optional search filter narrows the list by case-
  // insensitive substring on title or content.
  const dateOf = (n: Note) => n.entryDate ?? n.createdAt;
  const sorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = q
      ? notes.filter(n => (n.title ?? '').toLowerCase().includes(q) || (n.content ?? '').toLowerCase().includes(q))
      : notes;
    return [...base].sort((a, b) => dateOf(b) - dateOf(a));
  }, [notes, searchQuery]);

  // "On This Day" — entries written on this calendar date in previous years.
  // Day One's most-praised feature. Cheap to compute since entries are already
  // date-keyed. Computed BEFORE the empty-state early return below so the hook
  // count can't change when the diary flips between empty and non-empty (React:
  // "rendered fewer hooks than expected"). Match by month + day (ignoring year).
  const onThisDay = useMemo(() => {
    if (searchQuery.trim()) return [];
    const now = new Date();
    const tm = now.getMonth();
    const td = now.getDate();
    const ty = now.getFullYear();
    return sorted
      .filter(n => {
        const d = new Date(dateOf(n));
        return d.getMonth() === tm && d.getDate() === td && d.getFullYear() < ty;
      })
      .map(n => {
        const d = new Date(dateOf(n));
        const yearsAgo = ty - d.getFullYear();
        return { note: n, yearsAgo };
      });
  }, [sorted, searchQuery]);

  if (sorted.length === 0) {
    const isFiltered = searchQuery.trim().length > 0;
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
        <Feather name={isFiltered ? 'search' : 'book-open'} size={56} color={theme.textSub} style={{ opacity: 0.15, marginBottom: 18 }} />
        <Text style={{ color: theme.textMain, fontSize: 18, fontWeight: '900', marginBottom: 8, letterSpacing: -0.3 }}>
          {isFiltered ? 'No matches.' : 'Your diary is empty.'}
        </Text>
        <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 20, marginBottom: 28 }}>
          {isFiltered ? 'Try a different search.' : 'Capture a moment from today — a thought, a photo, a voice memo. Future-you will be glad you did.'}
        </Text>
        {!isFiltered && (
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onCreate(); }}
            style={{ backgroundColor: theme.textMain, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 100 }}
          >
            <Text style={{ color: theme.bg, fontSize: 14, fontWeight: '900', letterSpacing: 0.3 }}>Write today&apos;s entry</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // "Today" pull-to-write affordance — only when there's no entry for today
  // yet, and we're not in search mode (search results shouldn't be muddied by
  // a write-card sitting at top). Tapping creates a fresh diary entry. Same
  // empty-state hook on the home of every diary app worth using.
  const todayDate = new Date();
  const todayMs = (() => { const d = new Date(todayDate); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const hasTodayEntry = sorted.some(n => {
    const d = new Date(dateOf(n));
    d.setHours(0, 0, 0, 0);
    return d.getTime() === todayMs;
  });
  const showTodayCard = !searchQuery.trim() && !hasTodayEntry;

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
    >
      {/* "On This Day" — past entries written on the same calendar date in
          previous years. The hook that turns a one-time-use diary into a
          ritual. Hidden in search mode and when there are no past entries
          for today's date. */}
      {onThisDay.length > 0 && (
        <View style={{ marginBottom: 22 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Feather name="rotate-ccw" size={13} color={theme.textSub} />
            <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>
              On this day
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.border, marginLeft: 4 }} />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingRight: 4 }}
          >
            {onThisDay.map(({ note, yearsAgo }) => {
              const titleRtl = isRtl(lineDirectionText(note.title || ''));
              const previewSnippet = (() => {
                const stripped = (note.content || '').split('\n').find(l => l.trim()) || '';
                return stripped.replace(/==\{[^}]+\}/g, '').replace(/[*=]/g, '').slice(0, 120);
              })();
              const snippetRtl = isRtl(lineDirectionText(previewSnippet));
              return (
                <Pressable
                  key={note.id}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpen(note); }}
                  style={{
                    width: 240,
                    backgroundColor: theme.surface,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: theme.border,
                    paddingVertical: 16,
                    paddingHorizontal: 18,
                  }}
                >
                  <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
                    {yearsAgo === 1 ? '1 year ago' : `${yearsAgo} years ago`}
                  </Text>
                  {note.title ? (
                    <Text
                      numberOfLines={1}
                      style={{
                        color: theme.textMain,
                        fontSize: 15,
                        fontWeight: '800',
                        letterSpacing: -0.2,
                        marginBottom: 4,
                        textAlign: titleRtl ? 'right' : 'left',
                        writingDirection: titleRtl ? 'rtl' : 'ltr',
                      }}
                    >
                      {note.title}
                    </Text>
                  ) : null}
                  {previewSnippet ? (
                    <Text
                      numberOfLines={2}
                      style={{
                        color: theme.textSub,
                        fontSize: 13,
                        lineHeight: 18,
                        textAlign: snippetRtl ? 'right' : 'left',
                        writingDirection: snippetRtl ? 'rtl' : 'ltr',
                      }}
                    >
                      {previewSnippet}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {showTodayCard && (
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onCreate(); }}
          style={{
            backgroundColor: theme.surface,
            borderRadius: 22,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: theme.border,
            paddingVertical: 22,
            paddingHorizontal: 24,
            marginBottom: 22,
            // Slight cream wash so it reads as "fresh page" rather than
            // "another card." Both light/dark surfaces already lean warm
            // enough; we lean a touch further with a low-opacity overlay.
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
                Today
              </Text>
              <Text
                style={{
                  color: theme.textMain,
                  fontSize: 17,
                  fontWeight: '700',
                  letterSpacing: -0.3,
                }}
              >
                What&apos;s on your mind?
              </Text>
            </View>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.textMain, justifyContent: 'center', alignItems: 'center', marginLeft: 12 }}>
              <Feather name="edit-3" size={18} color={theme.bg} />
            </View>
          </View>
        </Pressable>
      )}
      {sorted.map((note, idx) => {
        const dateMs = dateOf(note);
        const headerLabel = formatHeaderDate(dateMs, calSystem);
        const timeStr = formatTimeOfDay(dateMs);
        const prevHeader = idx > 0 ? formatHeaderDate(dateOf(sorted[idx - 1]), calSystem) : null;
        const showHeader = headerLabel !== prevHeader;
        const hasImages = (note.imageUris?.length ?? 0) > 0;
        const hasAudio = (note.audio?.length ?? 0) > 0;
        return (
          <View key={note.id} style={{ marginBottom: 22 }}>
            {showHeader && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, marginTop: idx > 0 ? 14 : 0 }}>
                <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 }}>
                  {headerLabel}
                </Text>
                {note.mood && MOOD_LOOKUP[note.mood] ? (
                  (() => {
                    const m = MOOD_LOOKUP[note.mood!];
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}>
                        <Feather name={m.icon} size={11} color={m.color} />
                        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '800', letterSpacing: 0.2 }}>{m.label}</Text>
                      </View>
                    );
                  })()
                ) : null}
                <View style={{ flex: 1, height: 1, backgroundColor: theme.border, marginLeft: 4 }} />
              </View>
            )}
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpen(note); }}
              onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress(note); }}
              delayLongPress={400}
              // Diary "page" styling — softer corners, warmer cream-toned
              // surface, gentler border. Different visual register from the
              // notes-tab card so users feel "this is for reading", not "this
              // is a memo." Uses the same theme tokens so dark/light still
              // work, just shifted to a less austere shape.
              style={{
                backgroundColor: theme.surface,
                borderRadius: 22,
                borderWidth: 1,
                borderColor: theme.border,
                paddingVertical: 22,
                paddingHorizontal: 24,
                shadowColor: '#000',
                shadowOpacity: 0.04,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 1,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: note.title ? 8 : (note.content ? 12 : 0) }}>
                <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>
                  {timeStr}
                </Text>
                {note.isLocked && <Feather name="lock" size={11} color={theme.textSub} />}
              </View>
              {note.title ? (
                (() => {
                  const titleRtl = isRtl(lineDirectionText(note.title || ''));
                  return (
                    <Text
                      style={{
                        color: theme.textMain,
                        fontSize: 18,
                        fontWeight: '900',
                        letterSpacing: -0.3,
                        marginBottom: note.content ? 8 : 0,
                        textAlign: titleRtl ? 'right' : 'left',
                        writingDirection: titleRtl ? 'rtl' : 'ltr',
                      }}
                      numberOfLines={2}
                    >
                      {note.title}
                    </Text>
                  );
                })()
              ) : null}
              {note.content ? (
                searchQuery.trim() ? (
                  // Search mode → expand to full markdown so the user can read
                  // the matched context without tapping into the reader. The
                  // `highlight` prop paints the active query yellow inside the
                  // body. Each line keeps its own direction.
                  <MarkdownContent
                    text={note.content}
                    theme={theme}
                    accent="#8B5CF6"
                    fontSize={15}
                    lineHeight={23}
                    highlight={searchQuery}
                  />
                ) : (
                  // Collapsed preview — single Text node with stripped
                  // markdown, truly capped at 4 VISUAL lines (not source
                  // lines, so a long first line can't blow up the card).
                  // Direction taken from the first non-empty line so the
                  // common case (a single-language entry) reads correctly;
                  // mixed-direction snippets fall back to natural BiDi
                  // within a 4-line preview, which is fine for browsing.
                  (() => {
                    const stripped = stripAllMarkdown(note.content);
                    const firstNonEmpty = stripped.split('\n').find(l => l.trim()) || stripped;
                    const previewRtl = isRtl(lineDirectionText(firstNonEmpty));
                    return (
                      <Text
                        numberOfLines={4}
                        style={{
                          color: theme.textMain,
                          fontSize: 15,
                          fontWeight: '500',
                          lineHeight: 23,
                          textAlign: previewRtl ? 'right' : 'left',
                          writingDirection: previewRtl ? 'rtl' : 'ltr',
                        }}
                      >
                        {stripped}
                      </Text>
                    );
                  })()
                )
              ) : null}
              {hasImages && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, marginTop: 12 }}
                >
                  {note.imageUris!.map((uri, i) => (
                    <Image
                      key={`${uri}-${i}`}
                      source={{ uri }}
                      contentFit="cover"
                      style={{ width: 120, height: 120, borderRadius: 12, backgroundColor: theme.border }}
                    />
                  ))}
                </ScrollView>
              )}
              {hasAudio && (
                // Horizontal scroll — same treatment as photos. Stacked
                // vertical players ate ~50px per memo; horizontal lets a
                // 5-memo entry sit in one row instead of five. Each memo
                // keeps its full pill (play / progress / duration) so the
                // user can listen without tapping through to the reader.
                // Custom names render as a compact label above the pill,
                // single-line ellipsized so a long name can't blow up the
                // card. Tap stops at the player — Pressable below is the
                // entry-open trigger; AudioPlayer's own onPress handles
                // playback.
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 10, marginTop: 12 }}
                >
                  {note.audio!.map((memo) => (
                    <View key={memo.id} style={{ minWidth: 160 }}>
                      {memo.name ? (
                        <Text
                          numberOfLines={1}
                          style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', marginBottom: 6, maxWidth: 220 }}
                        >
                          {memo.name}
                        </Text>
                      ) : null}
                      <AudioPlayer
                        uri={memo.uri}
                        durationStr={memo.duration}
                        theme={theme}
                        activeAudioUri={activeAudioUri}
                        setActiveAudioUri={setActiveAudioUri}
                      />
                    </View>
                  ))}
                </ScrollView>
              )}
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}
