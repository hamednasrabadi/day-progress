/**
 * DiaryView — the diary's warm "Paper" reading surface.
 *
 * A different room from the Notes feed: cream by day / candle-lit by night,
 * serif type, and a calm vertical reading flow instead of stacked cards. The top
 * is a greeting + an inviting "today" door (→ the Mood-door composer); below,
 * entries flow under big serif date headers, each a clean text block carrying its
 * time, mood, and any photos/voice inline, set off by a mood-colored edge rather
 * than a boxy card. "On This Day" turns one-time use into a ritual.
 *
 * Sorted newest-first by the entry's own date (entryDate; createdAt for legacy
 * entries). Search narrows by substring and expands matches to full markdown.
 *
 * Self-skinned (Paper palette from isDarkMode) so the diary keeps its identity
 * regardless of the app theme — the Notes tab warms its own background to match.
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

const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) as string;

// Mirror of the mood lookup in notes.tsx — small enough to duplicate rather than
// thread through props. Keep in sync if the picker palette changes.
const MOOD_LOOKUP: Record<string, { label: string; icon: any; color: string }> = {
  'heart':      { label: 'Loved',  icon: 'heart',      color: '#F472B6' },
  'sun':        { label: 'Bright', icon: 'sun',        color: '#FACC15' },
  'cloud':      { label: 'Calm',   icon: 'cloud',      color: '#60A5FA' },
  'cloud-rain': { label: 'Rough',  icon: 'cloud-rain', color: '#94A3B8' },
  'moon':       { label: 'Heavy',  icon: 'moon',       color: '#A78BFA' },
};

const GREGORIAN_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SHAMSI_MONTHS = ['Farvardin','Ordibehesht','Khordad','Tir','Mordad','Shahrivar','Mehr','Aban','Azar','Dey','Bahman','Esfand'];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Same g2j the rest of notes.tsx uses — duplicated here so DiaryView is drop-in
// without coupling to the parent file's helpers.
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

// "Today", "Yesterday", a weekday for this week, or a formatted date for older.
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
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// "Tuesday, 12 Jun" — the dateline under the greeting.
function longToday(cal: CalendarSystem): string {
  const d = new Date();
  if (cal === 'shamsi') {
    const [, jm, jd] = g2j(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return `${DAY_NAMES[d.getDay()]}, ${jd} ${SHAMSI_MONTHS[jm - 1]}`;
  }
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${GREGORIAN_MONTHS[d.getMonth()]}`;
}

export function DiaryView({
  notes, isDarkMode, calSystem, onOpen, onLongPress, onCreate,
  activeAudioUri, setActiveAudioUri, searchQuery,
}: {
  notes: Note[];
  theme: { bg: string; surface: string; border: string; textMain: string; textSub: string };
  isDarkMode: boolean;
  calSystem: CalendarSystem;
  onOpen: (note: Note) => void;
  onLongPress: (note: Note) => void;
  onCreate: () => void;
  activeAudioUri: string | null;
  setActiveAudioUri: (uri: string | null) => void;
  searchQuery: string;
}) {
  // Warm "Paper" skin — cream by day, candle-lit by night.
  const C = isDarkMode
    ? { bg: '#17130E', raised: '#211B13', ink: '#EAE1D2', sub: '#9A8E7B', faint: '#6E6453', line: '#2E2619', accent: '#D9913F' }
    : { bg: '#F4EEE1', raised: '#FBF7EE', ink: '#2A2420', sub: '#6F6555', faint: '#A89D8B', line: '#E4DBC9', accent: '#A6552B' };
  const onAccent = isDarkMode ? '#17130E' : '#FFFFFF';
  // Theme shape MarkdownContent / AudioPlayer expect — mapped to the warm palette.
  const warmTheme = { bg: C.bg, surface: C.raised, border: C.line, textMain: C.ink, textSub: C.sub };

  const dateOf = (n: Note) => n.entryDate ?? n.createdAt;
  const sorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = q
      ? notes.filter(n => (n.title ?? '').toLowerCase().includes(q) || (n.content ?? '').toLowerCase().includes(q))
      : notes;
    return [...base].sort((a, b) => dateOf(b) - dateOf(a));
  }, [notes, searchQuery]);

  // "On This Day" — entries on this calendar date in previous years. Computed
  // BEFORE the empty-state early return so the hook count is stable.
  const onThisDay = useMemo(() => {
    if (searchQuery.trim()) return [];
    const now = new Date();
    const tm = now.getMonth(); const td = now.getDate(); const ty = now.getFullYear();
    return sorted
      .filter(n => { const d = new Date(dateOf(n)); return d.getMonth() === tm && d.getDate() === td && d.getFullYear() < ty; })
      .map(n => ({ note: n, yearsAgo: ty - new Date(dateOf(n)).getFullYear() }));
  }, [sorted, searchQuery]);

  if (sorted.length === 0) {
    const isFiltered = searchQuery.trim().length > 0;
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 34 }}>
        <Feather name={isFiltered ? 'search' : 'book-open'} size={50} color={C.faint} style={{ opacity: 0.5, marginBottom: 18 }} />
        <Text style={{ fontFamily: SERIF, color: C.ink, fontSize: 22, marginBottom: 8 }}>
          {isFiltered ? 'No matches.' : 'Your diary is empty.'}
        </Text>
        <Text style={{ color: C.sub, fontSize: 14, fontWeight: '500', textAlign: 'center', lineHeight: 21, marginBottom: 26 }}>
          {isFiltered ? 'Try a different search.' : 'Start with one line about today. Future-you will be glad you did.'}
        </Text>
        {!isFiltered && (
          <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onCreate(); }}
            style={{ backgroundColor: C.accent, paddingHorizontal: 26, paddingVertical: 14, borderRadius: 100 }}>
            <Text style={{ color: onAccent, fontSize: 14, fontWeight: '900', letterSpacing: 0.3 }}>Write today&apos;s entry</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const todayMs = startOfDay(Date.now());
  const hasTodayEntry = sorted.some(n => startOfDay(dateOf(n)) === todayMs);
  const showHome = !searchQuery.trim();

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 6, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        {/* ── HOME: greeting + the door into today ── */}
        {showHome && (
          <View style={{ marginBottom: 6 }}>
            <Text style={{ fontFamily: SERIF, fontStyle: 'italic', color: C.sub, fontSize: 15, marginBottom: 2 }}>{greeting()}.</Text>
            <Text style={{ color: C.faint, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 16 }}>{longToday(calSystem)}</Text>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onCreate(); }}
              activeOpacity={0.85}
              style={{ backgroundColor: C.raised, borderRadius: 22, borderWidth: 1, borderColor: C.line, paddingVertical: 22, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Today</Text>
                <Text style={{ fontFamily: SERIF, color: C.ink, fontSize: 20 }}>{hasTodayEntry ? 'Add another moment' : 'What’s on your mind?'}</Text>
              </View>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 12 }}>
                <Feather name="edit-3" size={18} color={onAccent} />
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* ── ON THIS DAY ── the ritual hook */}
        {onThisDay.length > 0 && (
          <View style={{ marginTop: 26, marginBottom: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Feather name="rotate-ccw" size={13} color={C.sub} />
              <Text style={{ color: C.sub, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' }}>On this day</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: C.line, marginLeft: 4 }} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
              {onThisDay.map(({ note, yearsAgo }) => {
                const titleRtl = isRtl(lineDirectionText(note.title || ''));
                const snippet = ((note.content || '').split('\n').find(l => l.trim()) || '').replace(/==\{[^}]+\}/g, '').replace(/[*=]/g, '').slice(0, 120);
                const snippetRtl = isRtl(lineDirectionText(snippet));
                return (
                  <Pressable key={note.id} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpen(note); }}
                    style={{ width: 240, backgroundColor: C.raised, borderRadius: 18, borderWidth: 1, borderColor: C.line, paddingVertical: 16, paddingHorizontal: 18 }}>
                    <Text style={{ color: C.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
                      {yearsAgo === 1 ? '1 year ago' : `${yearsAgo} years ago`}
                    </Text>
                    {note.title ? (
                      <Text numberOfLines={1} style={{ fontFamily: SERIF, color: C.ink, fontSize: 15, marginBottom: 4, textAlign: titleRtl ? 'right' : 'left', writingDirection: titleRtl ? 'rtl' : 'ltr' }}>{note.title}</Text>
                    ) : null}
                    {snippet ? (
                      <Text numberOfLines={2} style={{ fontFamily: SERIF, color: C.sub, fontSize: 13, lineHeight: 19, textAlign: snippetRtl ? 'right' : 'left', writingDirection: snippetRtl ? 'rtl' : 'ltr' }}>{snippet}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ── THE TIMELINE ── */}
        <View style={{ marginTop: showHome ? 26 : 4 }}>
          {sorted.map((note, idx) => {
            const dateMs = dateOf(note);
            const headerLabel = formatHeaderDate(dateMs, calSystem);
            const timeStr = formatTimeOfDay(dateMs);
            const prevHeader = idx > 0 ? formatHeaderDate(dateOf(sorted[idx - 1]), calSystem) : null;
            const showHeader = headerLabel !== prevHeader;
            const hasImages = (note.imageUris?.length ?? 0) > 0;
            const hasAudio = (note.audio?.length ?? 0) > 0;
            const m = note.mood ? MOOD_LOOKUP[note.mood] : null;
            return (
              <View key={note.id} style={{ marginBottom: 22 }}>
                {showHeader && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: idx > 0 ? 16 : 0, marginBottom: 12 }}>
                    <Text style={{ fontFamily: SERIF, color: C.ink, fontSize: 23 }}>{headerLabel}</Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: C.line }} />
                  </View>
                )}
                <Pressable
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpen(note); }}
                  onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress(note); }}
                  delayLongPress={400}
                  // A mood-colored left edge sets each entry off without a boxy
                  // card — calmer to read, and the diary's own register.
                  style={{ borderLeftWidth: 2, borderLeftColor: m ? m.color : C.line, paddingLeft: 16 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: note.title ? 6 : (note.content ? 10 : 0) }}>
                    <Text style={{ fontFamily: SERIF, color: C.sub, fontSize: 13 }}>{timeStr}</Text>
                    {note.isLocked && <Feather name="lock" size={11} color={C.faint} />}
                    {m ? <Text style={{ color: C.faint, fontSize: 12, fontWeight: '700' }}>· {m.label}</Text> : null}
                  </View>
                  {note.title ? (() => {
                    const titleRtl = isRtl(lineDirectionText(note.title || ''));
                    return (
                      <Text style={{ fontFamily: SERIF, color: C.ink, fontSize: 19, marginBottom: note.content ? 6 : 0, textAlign: titleRtl ? 'right' : 'left', writingDirection: titleRtl ? 'rtl' : 'ltr' }} numberOfLines={2}>{note.title}</Text>
                    );
                  })() : null}
                  {note.content ? (
                    searchQuery.trim() ? (
                      <MarkdownContent text={note.content} theme={warmTheme} accent={C.accent} fontSize={16} lineHeight={25} highlight={searchQuery} />
                    ) : (() => {
                      const stripped = stripAllMarkdown(note.content);
                      const firstNonEmpty = stripped.split('\n').find(l => l.trim()) || stripped;
                      const previewRtl = isRtl(lineDirectionText(firstNonEmpty));
                      return (
                        <Text numberOfLines={4} style={{ fontFamily: SERIF, color: C.ink, fontSize: 16, lineHeight: 25, textAlign: previewRtl ? 'right' : 'left', writingDirection: previewRtl ? 'rtl' : 'ltr' }}>{stripped}</Text>
                      );
                    })()
                  ) : null}
                  {hasImages && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 12 }}>
                      {note.imageUris!.map((uri, i) => (
                        <Image key={`${uri}-${i}`} source={{ uri }} contentFit="cover" style={{ width: 120, height: 120, borderRadius: 12, backgroundColor: C.line }} />
                      ))}
                    </ScrollView>
                  )}
                  {hasAudio && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, marginTop: 12 }}>
                      {note.audio!.map((memo) => (
                        <View key={memo.id} style={{ minWidth: 160 }}>
                          {memo.name ? <Text numberOfLines={1} style={{ color: C.sub, fontSize: 11, fontWeight: '700', marginBottom: 6, maxWidth: 220 }}>{memo.name}</Text> : null}
                          <AudioPlayer uri={memo.uri} durationStr={memo.duration} theme={warmTheme} activeAudioUri={activeAudioUri} setActiveAudioUri={setActiveAudioUri} />
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
