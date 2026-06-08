import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, Redirect } from 'expo-router';
import { FEATURE_IDS, useIsUnlocked, useIsNew, useDaysSinceInstall } from '../../lib/unlocks';
import { getTheme } from '../../lib/timelineTheme';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, Pressable, Dimensions,
  Platform, Modal, TextInput, Animated, Easing,
  StatusBar, TouchableWithoutFeedback, LayoutAnimation, UIManager, BackHandler, Switch
} from 'react-native';
import { GestureHandlerRootView, ScrollView as GHScrollView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  BottomSheetModal, BottomSheetModalProvider, BottomSheetBackdrop,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import Svg, { Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
// Keyboard avoidance: use react-native-keyboard-controller's KeyboardAvoidingView
// (same as habits.tsx / todo.tsx) — RN's built-in one with behavior=undefined on
// Android fails to lift inputs inside full-screen Modals (e.g. the Ledger's add row).
import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useSharedValue, useAnimatedProps, useAnimatedStyle, withTiming, withDelay, withSequence, withSpring, withRepeat, cancelAnimation, interpolate, Easing as ReEasing, runOnJS, FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { useAppStore, Task, Habit, CalendarSystem, Challenge, Achievement, AchievementId, Milestone, NoteEntry, DeadState, ChallengeUrgency, UrgencyStyle, NarratorTone, Note, ChallengeLink, LedgerEntry, LedgerSource, Stake, StakeKind, inferChallengeCadence, makeLedgerEntry } from '../../store/useAppStore';
import { calculateGlobalStrength } from '../../lib/habitScore';
import { isRtl } from '../../lib/rtl';
import { PresetPickerSheet } from '../../components/challenges/PresetPickerSheet';
import { SovereignUnlockButton } from '../../components/SovereignUnlockButton';
import { SovereignCeremony } from '../../components/SovereignCeremony';
import { ChallengePreset, CHALLENGE_PRESETS } from '../../lib/challengePresets';
import { syncChallengeNotifications } from '../../lib/challengeNotifications';
import { consecutiveDaysEndingToday, computeChain } from '../../lib/challengeChain';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try { UIManager.setLayoutAnimationEnabledExperimental(true); } catch (e) {}
}

const { width } = Dimensions.get('window');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const L1_COLOR = '#F43F5E';
const L2_COLOR = '#F59E0B';
const L3_COLOR = '#8B5CF6';

type NarratorMoment ={ lines: string[]; dismissLabel: string; achievementId?: AchievementId; tone: NarratorTone; firstTime?: boolean; };

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Curated 18-color palette — full spectrum at jewel saturation, no
// muted tones. Ordered as a rainbow arc so the picker reads as a
// continuous gradient rather than a random grid; the slate at the end
// is the only non-spectrum slot, kept as a "premium / no-color" choice
// for users who want the card to feel like graphite rather than candy.
const COLORS = [
  '#EF4444', // red
  '#F97316', // orange
  '#F59E0B', // amber
  '#84CC16', // lime
  '#22C55E', // green
  '#10B981', // emerald
  '#14B8A6', // teal
  '#06B6D4', // cyan
  '#0EA5E9', // sky
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#A855F7', // purple
  '#D946EF', // fuchsia
  '#EC4899', // pink
  '#F43F5E', // rose
  '#BE185D', // wine
  '#0F172A', // slate (premium near-black)
];
// Expanded icon set — picked to span the kinds of challenges users
// actually create (movement, reading, writing, focus, social, sleep,
// money, exploration). Rendered in a horizontal scroll using the
// gesture-handler-aware ScrollView so the side-swipe doesn't fight
// the bottom-sheet's vertical pan handler.
const ICONS: (keyof typeof Feather.glyphMap)[] = [
  'activity', 'navigation-2', 'zap', 'target',
  'crosshair', 'shield', 'book-open', 'edit-3',
  'pen-tool', 'feather', 'code', 'headphones',
  'heart', 'users', 'map', 'compass',
  'moon', 'sunrise',
];

// Deadline quick picks — common durations so the user doesn't have to
// open the calendar and count days. Tapping a chip stamps the deadline
// at end-of-day N days from now; the chip stays selected so the user
// can see at a glance which preset they chose.
const DEADLINE_QUICK_PICKS: { label: string; days: number }[] = [
  { label: '1 week',   days: 7 },
  { label: '2 weeks',  days: 14 },
  { label: '30 days',  days: 30 },
  { label: '60 days',  days: 60 },
  { label: '90 days',  days: 90 },
];
const SHAMSI_MONTHS = ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'];
const GREG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WDAYS_FA = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// ─── SHAMSI ENGINE ───
function getShamsiDateParts(date: Date) { const jdm = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29]; let gy = date.getFullYear() - 1600, gm = date.getMonth(), gd = date.getDate() - 1; let g_day_no = 365 * gy + Math.floor((gy + 3) / 4) - Math.floor((gy + 99) / 100) + Math.floor((gy + 399) / 400); for (let i = 0; i < gm; ++i) g_day_no += [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i]; if (gm > 1 && ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0))) g_day_no++; g_day_no += gd; let j_day_no = g_day_no - 79; let j_np = Math.floor(j_day_no / 12053); j_day_no %= 12053; let jy = 979 + 33 * j_np + 4 * Math.floor(j_day_no / 1461); j_day_no %= 1461; if (j_day_no >= 366) { jy += Math.floor((j_day_no - 1) / 365); j_day_no = (j_day_no - 1) % 365; } let i = 0; for (i; i < 11 && j_day_no >= jdm[i]; ++i) j_day_no -= jdm[i]; return { year: jy, month: i + 1, day: j_day_no + 1 }; }
function getShamsiMonthDays(y: number, m: number) { if (m <= 6) return 31; if (m <= 11) return 30; const ly = [1, 5, 9, 13, 17, 22, 26, 30]; return ly.includes(y % 33) ? 30 : 29; }
function shamsiToGregorian(jy: number, jm: number, jd: number) {
  let gy = jy + 621; let leapJ = (((jy + 38) * 31) % 128) <= 31; let leapG = (gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0);
  let marchDay = 21; if ((leapJ && !leapG) || (jy % 33 === 1)) marchDay = 22; else if (leapG && !leapJ) marchDay = 20;
  let days = 0; for (let i = 1; i < jm; i++) days += i <= 6 ? 31 : 30; days += jd - 1;
  let d = new Date(gy, 2, marchDay); d.setDate(d.getDate() + days); return d;
}

// ─── URGENCY & HELPERS ───
function daysUntil(ts?: number) { if (!ts) return null; return Math.ceil((ts - Date.now()) / 86400000); }
function formatDeadline(ts?: number, cal: CalendarSystem = 'gregorian') { if (!ts) return 'NO LIMIT'; const d = daysUntil(ts)!; if (d < 0) return `${Math.abs(d)}D OVERDUE`; if (d === 0) return 'TODAY'; if (d === 1) return 'TOMORROW'; if (d <= 14) return `${d} DAYS LEFT`; const dt = new Date(ts); if (cal === 'shamsi') { const s = getShamsiDateParts(dt); return `${SHAMSI_MONTHS[s.month - 1]} ${s.day}`; } return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase(); }
// Full-form date used by the schedule header in the edit modal — sentence
// case, month-day-year. Always shows the year so the user knows whether
// "Mar 22" means this year or next.
function formatDeadlineFull(ts: number, cal: CalendarSystem = 'gregorian') {
  const dt = new Date(ts);
  if (cal === 'shamsi') {
    const s = getShamsiDateParts(dt);
    return `${SHAMSI_MONTHS[s.month - 1]} ${s.day}, ${s.year}`;
  }
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
// Note-entry date label — small, all-caps, used as the eyebrow above
// each journal entry. Shows the date in the user's calendar system,
// abbreviated month, and year so old entries are clearly old.
function formatNoteDate(ts: number, cal: CalendarSystem = 'gregorian') {
  const dt = new Date(ts);
  if (cal === 'shamsi') {
    const s = getShamsiDateParts(dt);
    return `${SHAMSI_MONTHS[s.month - 1].slice(0, 3).toUpperCase()} ${s.day}, ${s.year}`;
  }
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
}
// Ledger timestamp — date + time, sentence case, calendar-aware. Recent events
// read relative ("Today 3:47 PM" / "Yesterday …"); older ones get weekday +
// month/day so a long history stays scannable.
function formatLedgerStamp(ts: number, cal: CalendarSystem = 'gregorian') {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(ts); b.setHours(0, 0, 0, 0);
  const diff = Math.round((a.getTime() - b.getTime()) / 86400000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  const wd = WDAYS_EN[d.getDay()].slice(0, 3);
  if (cal === 'shamsi') {
    const s = getShamsiDateParts(d);
    return `${wd}, ${SHAMSI_MONTHS[s.month - 1].slice(0, 3)} ${s.day} · ${time}`;
  }
  return `${wd}, ${GREG_MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()} · ${time}`;
}
function getUrgencyLevel(ts?: number, override?: UrgencyStyle): ChallengeUrgency { if (!ts) return 'none'; const d = daysUntil(ts)!; if (d > 14) return 'none'; if (override && override !== 'auto') return override as ChallengeUrgency; if (d <= 3) return 'haemorrhage'; if (d <= 7) return 'static'; return 'none'; }
function urgencyColor(level: ChallengeUrgency) { if (level === 'static') return L2_COLOR; if (level === 'haemorrhage') return L1_COLOR; return 'transparent'; }
function shouldBeDead(c: Challenge) { if (c.deadState !== 'active' && c.deadState !== 'resurrected') return false; if (!c.deadlineTs || c.current >= c.target) return false; return Date.now() > c.deadlineTs; }

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Consecutive-day counting now lives in lib/challengeChain.ts
// (`consecutiveDaysEndingToday`) as the single source of truth, shared with the
// cadence-aware chain used by the cards/detail view.

// Quiet, human copy for a line that didn't hold — no surveillance theatre, no
// "OPERATOR INACTION". A single honest sentence and a short cause. `label` is
// kept (sentence case now) for surfaces that still show a heading.
const DEAD_MESSAGES: { label: string; text: string; cause: string }[] = [
  { label: 'This one slipped', text: 'The deadline came. The work didn’t. It happens — the day just gets away.', cause: 'Deadline passed' },
  { label: 'It got away', text: 'You meant to. The days ran out before you got back to it.', cause: 'Ran out of time' },
  { label: 'Set down', text: 'Somewhere along the way this stopped being the thing. That’s allowed.', cause: 'Let go' },
];
function getDeadMessage(c: Challenge) {
  if (c.current === 0) return { label: 'Never started', text: 'You drew this line and never stepped to it. Not once.', cause: 'Never started' };
  const idx = Math.floor(Math.abs(c.createdAt % DEAD_MESSAGES.length));
  return { ...DEAD_MESSAGES[idx] };
}

const EXISTENTIAL_OVERRIDES = new Set<AchievementId>(['first_blood', 'initiation', 'recidivist', 'you_were_watched', 'cleared', 'the_long_game', 'ghost']);
const NARRATOR_CHAR_SPEED: Record<NarratorTone, number> = { cold: 12, existential: 42, clinical: 20 };
const NARRATOR_LINE_PAUSE: Record<NarratorTone, number> = { cold: 120, existential: 520, clinical: 240 };

const ACHIEVEMENT_DEFS: Omit<Achievement, 'unlockedAt'>[] = [
  { id: 'cleared', sym: '◈', name: 'CLEARED' }, { id: 'first_blood', sym: '◆', name: 'FIRST BLOOD' },
  { id: 'risen', sym: '†', name: 'RISEN' }, { id: 'centurion', sym: 'C', name: 'CENTURION' },
  { id: 'last_second', sym: '⚡', name: 'LAST SECOND' }, { id: 'early_finish', sym: '◈', name: 'EARLY FINISH' },
  { id: 'initiation', sym: '∅', name: 'INITIATION' }, { id: 'second_chance', sym: '↩', name: 'SECOND CHANCE' },
  { id: 'recidivist', sym: '✕', name: 'RECIDIVIST' }, { id: 'graveyard_grows', sym: '☽', name: 'THE GRAVEYARD GROWS' },
  { id: 'clean_record', sym: '□', name: 'CLEAN RECORD' }, { id: 'insomniac', sym: '◉', name: 'INSOMNIAC' },
  { id: 'midnight_owl', sym: '◑', name: 'MIDNIGHT OWL' }, { id: 'obsessive', sym: '|', name: 'OBSESSIVE' },
  { id: 'witness', sym: '◎', name: 'WITNESS' }, { id: 'narrator_noticed', sym: '▶', name: 'THE NARRATOR NOTICED' },
  { id: 'you_were_watched', sym: '◇', name: 'YOU WERE WATCHED' }, { id: 'archaeologist', sym: '⟳', name: 'ARCHAEOLOGIST' },
  { id: 'architect', sym: '△', name: 'ARCHITECT' }, { id: 'momentum', sym: '»', name: 'MOMENTUM' },
  { id: 'the_long_game', sym: '∞', name: 'THE LONG GAME' }, { id: 'ghost', sym: '◌', name: 'GHOST' },
];

const ACHIEVEMENT_NARRATION: Record<AchievementId, { lines: string[]; dismiss: string; tone: NarratorTone; hint: string }> = {
  cleared: { lines: ["You earned this.", "Most people don't."], dismiss: 'CONTINUE', tone: 'existential', hint: 'Unlock tab' },
  first_blood: { lines: ["The first one is always the hardest.", "You will remember this one."], dismiss: 'CONTINUE', tone: 'existential', hint: 'Complete first challenge' },
  risen: { lines: ["You came back.", "Most people don't.", "That is being noted."], dismiss: 'NOTED', tone: 'cold', hint: 'Complete resurrected' },
  centurion: { lines: ["One hundred.", "Not a coincidence you chose that number.", "We both know what it means."], dismiss: 'CONTINUE', tone: 'existential', hint: 'Target 100' },
  last_second: { lines: ["Some people need the wall to move.", "The deadline was real.", "So were you."], dismiss: 'CONTINUE', tone: 'cold', hint: 'Under 24h' },
  early_finish: { lines: ["That is not discipline.", "That is hunger.", "There is a difference."], dismiss: 'CONTINUE', tone: 'clinical', hint: '7+ days before' },
  initiation: { lines: ["Your first failure is recorded.", "Everyone who has ever built anything", "has a file that looks like this."], dismiss: 'I UNDERSTAND', tone: 'existential', hint: 'First death' },
  second_chance: { lines: ["You chose to try again.", "The system noted it.", "Don't waste it."], dismiss: "I WON'T", tone: 'cold', hint: 'Resurrect' },
  recidivist: { lines: ["The second death is worse than the first.", "You knew what this was.", "You chose it anyway."], dismiss: 'I KNOW', tone: 'existential', hint: 'Die again' },
  graveyard_grows: { lines: ["Three now.", "The pattern is yours to interpret."], dismiss: 'NOTED', tone: 'clinical', hint: 'Third burial' },
  clean_record: { lines: ["The graveyard is empty.", "You are in rare company.", "Don't look away now."], dismiss: "I WON'T", tone: 'existential', hint: 'Empty 30 days' },
  insomniac: { lines: ["The work you do when no one is watching", "is the only work that counts."], dismiss: 'CONTINUE', tone: 'existential', hint: 'Log midnight–4am' },
  midnight_owl: { lines: ["Three times now.", "The night knows you better than the day does."], dismiss: 'CONTINUE', tone: 'existential', hint: 'Log after midnight 3x' },
  obsessive: { lines: ["Seven consecutive days.", "That is not habit.", "That is identity."], dismiss: 'CONTINUE', tone: 'existential', hint: '7 days in a row' },
  witness: { lines: ["Five.", "Look at what you've built."], dismiss: 'CONTINUE', tone: 'existential', hint: '5+ completions' },
  narrator_noticed: { lines: ["You felt it too."], dismiss: 'CONTINUE', tone: 'existential', hint: 'Trigger fourth-wall' },
  you_were_watched: { lines: ["You've been here long enough", "to stop being a visitor."], dismiss: 'CONTINUE', tone: 'existential', hint: '5 achievements' },
  archaeologist: { lines: ["You changed your mind.", "That takes more honesty than it sounds."], dismiss: 'CONTINUE', tone: 'clinical', hint: 'Restore trash' },
  architect: { lines: ["Five directives issued.", "You are building something.", "Whether it stands is still unknown."], dismiss: 'CONTINUE', tone: 'cold', hint: '5th challenge' },
  momentum: { lines: ["Two in seven days.", "You are not stopping.", "Good."], dismiss: 'CONTINUE', tone: 'cold', hint: '2 completed in 7 days' },
  the_long_game: { lines: ["Ninety days.", "You held onto something most people drop in the first week.", "That is rare. That is real."], dismiss: 'CONTINUE', tone: 'existential', hint: '90+ day challenge' },
  ghost: { lines: ["You remember all of them.", "That matters more than you think."], dismiss: 'CONTINUE', tone: 'existential', hint: 'Open graveyard 5+ buried' },
};

// Achievement importance — used by queueNarrator to pick a single
// narration when multiple unlock from the same event (e.g., a first-
// completion that's also a centurion). Higher = more important.
// The existential / structurally-rare ones win; meta-achievements
// like 'narrator_noticed' rank lowest so they never beat a real
// progression milestone.
const ACHIEVEMENT_IMPORTANCE: Record<AchievementId, number> = {
  cleared:           100, // tab unlocked, lifetime moment
  first_blood:        95, // first completion ever
  the_long_game:      90, // 90+ days kept
  centurion:          85, // target = 100
  risen:              80, // resurrected → completed
  last_second:        70, // under 24h
  early_finish:       65, // 7+ days early
  obsessive:          60, // 7-day streak
  witness:            55, // 5 completions
  ghost:              50, // graveyard 5+ buried
  clean_record:       50, // 30 empty days
  architect:          45, // 5 challenges
  momentum:           45, // 2 in 7 days
  insomniac:          35, // log midnight–4am
  midnight_owl:       35, // 3× midnight log
  recidivist:         30, // second death
  graveyard_grows:    30, // 3 buried
  initiation:         25, // first death
  second_chance:      25, // resurrect
  archaeologist:      20, // restore trash
  you_were_watched:   15, // 5 achievements (meta)
  narrator_noticed:   10, // fourth-wall trigger (meta)
};

// ─── UI COMPONENTS ───

// Calendar picker — same visual register as the one in the Tasks tab:
// single rounded container, fixed-height (32px) cells instead of square
// aspect-ratio rows, no padding-to-multiple-of-7 trailing cells, no
// loose marginBottom underneath. Tighter than the previous version,
// with the date numbers hugging the bottom edge of the grid.
const CalendarPicker = ({ value, onChange, theme, calSystem = 'gregorian' }: { value?: number; onChange: (ts: number | undefined) => void; theme: any; calSystem?: CalendarSystem; }) => {
  const isShamsi = calSystem === 'shamsi';
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const initV = () => { if (value) { if (isShamsi) { const s = getShamsiDateParts(new Date(value)); return { y: s.year, m: s.month }; } const d = new Date(value); return { y: d.getFullYear(), m: d.getMonth() + 1 }; } if (isShamsi) { const s = getShamsiDateParts(today); return { y: s.year, m: s.month }; } return { y: today.getFullYear(), m: today.getMonth() + 1 }; };
  const init = useMemo(initV, [value]);
  const [viewYear, setViewYear] = useState(init.y); const [viewMonth, setViewMonth] = useState(init.m);
  const prevM = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); };
  const nextM = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); };

  // Days-in-month + weekday offset for the first of the viewed month —
  // the only two values we need to lay out the grid.
  const grid = useMemo(() => {
    if (isShamsi) {
      const dim = getShamsiMonthDays(viewYear, viewMonth);
      const firstGreg = shamsiToGregorian(viewYear, viewMonth, 1);
      const offset = (firstGreg.getDay() - 6 + 7) % 7;
      return { dim, offset };
    }
    return {
      dim: new Date(viewYear, viewMonth, 0).getDate(),
      offset: new Date(viewYear, viewMonth - 1, 1).getDay(),
    };
  }, [isShamsi, viewYear, viewMonth]);

  const monthLabel = isShamsi ? `${SHAMSI_MONTHS[viewMonth - 1]} ${viewYear}` : `${GREG_MONTHS[viewMonth - 1]} ${viewYear}`;
  const wdays = isShamsi ? ['Sa','Su','Mo','Tu','We','Th','Fr'] : ['Su','Mo','Tu','We','Th','Fr','Sa'];

  // Convert a day-of-month (in the active calendar) into a Gregorian
  // Date at local midnight — the canonical timestamp we hand back.
  const toDate = (d: number): Date => {
    if (isShamsi) { const gd = shamsiToGregorian(viewYear, viewMonth, d); gd.setHours(0,0,0,0); return gd; }
    return new Date(viewYear, viewMonth - 1, d);
  };

  return (
    <View style={{ backgroundColor: theme.bg, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: theme.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <TouchableOpacity onPress={prevM} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Feather name="chevron-left" size={18} color={theme.textMain} /></TouchableOpacity>
        <Text style={{ color: theme.textMain, fontWeight: '900', fontSize: 13 }}>{monthLabel}</Text>
        <TouchableOpacity onPress={nextM} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Feather name="chevron-right" size={18} color={theme.textMain} /></TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {wdays.map((d, i) => <Text key={i} style={{ width: '14.28%', textAlign: 'center', color: theme.textSub, fontSize: 10, fontWeight: '900', paddingVertical: 4 }}>{d}</Text>)}
        {Array.from({ length: grid.offset }).map((_, i) => <View key={`b${i}`} style={{ width: '14.28%', height: 32 }} />)}
        {Array.from({ length: grid.dim }, (_, i) => i + 1).map(d => {
          const gd = toDate(d);
          const isPast = gd.getTime() < today.getTime();
          const isToday = gd.getTime() === today.getTime();
          const isSelected = !!value && new Date(value).setHours(0,0,0,0) === gd.getTime();
          return (
            <TouchableOpacity
              key={d}
              disabled={isPast}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                // Stamp the deadline at the END of the chosen day
                // (23:59:59.999) — the user's mental model is "this is
                // the last day," not "this is the moment the deadline
                // fires." With the old midnight stamp, picking today
                // marked the challenge dead the instant it was set.
                const end = new Date(gd);
                end.setHours(23, 59, 59, 999);
                onChange(isSelected ? undefined : end.getTime());
              }}
              style={{ width: '14.28%', height: 32, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: isSelected ? theme.textMain : 'transparent', opacity: isPast ? 0.25 : 1 }}
            >
              <Text style={{ color: isSelected ? theme.bg : theme.textMain, fontWeight: isSelected || isToday ? '900' : '600', fontSize: 13 }}>{d}</Text>
              {isToday && !isSelected && <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.textMain, marginTop: 1 }} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const DeadCardOverlay = ({ challenge, theme, onReview }: { challenge: Challenge; theme: any; onReview: () => void; }) => {
  const isPermanent = challenge.deadState === 'resurrected';
  const pct = Math.round(Math.min(1, challenge.current / challenge.target) * 100);
  const isDark = theme.isDark;
  const msg = getDeadMessage(challenge);
  const titleRtl = isRtl(challenge.title);
  // Calm graphite, theme-aware. No scan-line, no case-ID, no monospace —
  // a quiet record, not a surveillance readout. The eyebrow stays muted unless
  // the line is permanently closed (a second death), which earns a soft red.
  const accent = isPermanent ? L1_COLOR : theme.textSub;
  return (
    <View style={[StyleSheet.absoluteFill, { borderRadius: 18, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, zIndex: 20, overflow: 'hidden', padding: 16, justifyContent: 'space-between' }]}>
      <View>
        <Text style={{ color: accent, fontSize: 9, fontWeight: '900', letterSpacing: 2, marginBottom: 8, opacity: isPermanent ? 1 : 0.8 }}>{isPermanent ? 'CLOSED' : 'DIDN’T HOLD'}</Text>
        <Text numberOfLines={1} style={{ color: theme.textMain, fontSize: 16, fontWeight: '800', letterSpacing: -0.3, marginBottom: 6, opacity: 0.92, textAlign: titleRtl ? 'right' : 'left', writingDirection: titleRtl ? 'rtl' : 'ltr' }}>{challenge.title}</Text>
        <Text numberOfLines={2} style={{ color: theme.textSub, fontSize: 12, fontWeight: '500', lineHeight: 17 }}>{msg.text}</Text>
        {challenge.punishment ? (
          <Text numberOfLines={1} style={{ color: isPermanent ? L1_COLOR : '#F59E0B', fontSize: 11, fontWeight: '700', marginTop: 6 }}>On the line: {challenge.punishment}</Text>
        ) : null}
      </View>
      <View>
        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600', marginBottom: 6 }}>Reached {pct}% · {challenge.current}/{challenge.target} {challenge.unit}</Text>
        <View style={{ height: 3, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
          <View style={{ height: '100%', width: `${Math.max(2, pct)}%`, backgroundColor: isPermanent ? hexToRgba(L1_COLOR, 0.5) : theme.textSub, borderRadius: 2 }} />
        </View>
        <TouchableOpacity
          onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); onReview(); }}
          style={{ backgroundColor: isPermanent ? hexToRgba(L1_COLOR, isDark ? 0.1 : 0.08) : theme.bg, borderRadius: 10, borderWidth: 1, borderColor: isPermanent ? hexToRgba(L1_COLOR, 0.3) : theme.border, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Text style={{ color: isPermanent ? L1_COLOR : theme.textMain, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 }}>{isPermanent ? 'Bury it' : 'Review'}</Text>
          {!isPermanent && <Feather name="arrow-right" size={13} color={theme.textSub} />}
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ── ACTIVITY RING CARD ──────────────────────────────────────────────────
// A colored ring with the percent at its center, a title + meta column
// on the right, and a chevron that flips when the card is open.
//   Tap        → toggle inline expand (pace + −1 / +1 LOG controls).
//   Long-press → open the add/edit sheet (full editor: title, target,
//                deadline, milestones, habit links, trash, etc).
// Dead and resurrected challenges render the existing DeadCardOverlay
// with a fixed-height container — no expand, no progress controls.
// Pace projection — extracted so both the card's deadline subtitle and the
// full-screen detail view can share the same formatting. Cadence-aware: what
// "on pace" means differs by how the challenge is meant to be worked.
function computePace(challenge: Challenge, theme: any) {
  if (challenge.current >= challenge.target) return { text: 'Target reached.', color: theme.success };
  const cadence = challenge.cadence ?? 'cumulative';
  const daysLeft = challenge.deadlineTs
    ? Math.max(0, Math.ceil((challenge.deadlineTs - Date.now()) / 86400000))
    : null;

  // One-shot — there's no rate to project; it's done in a single act.
  if (cadence === 'oneshot') {
    if (daysLeft === null) return { text: 'Do it once.', color: theme.textSub };
    if (daysLeft === 0) return { text: 'Last day to do it.', color: theme.danger };
    return { text: `${daysLeft}d to do it.`, color: theme.textSub };
  }

  // Daily — the target IS a day count; pace is "can you still log every
  // remaining day to the line?" rather than an extrapolated rate.
  if (cadence === 'daily') {
    const remaining = Math.max(0, challenge.target - challenge.current);
    if (daysLeft === null) return { text: `${remaining} ${remaining === 1 ? 'day' : 'days'} to go.`, color: theme.textSub };
    if (remaining > daysLeft) return { text: `Behind · ${remaining - daysLeft}d short at one a day.`, color: theme.danger };
    const slack = daysLeft - remaining;
    if (slack === 0) return { text: 'On track · every remaining day counts.', color: theme.textSub };
    return { text: `On track · ${slack}d of slack.`, color: theme.success };
  }

  // Cumulative — extrapolate the current rate (the original projection).
  if (challenge.current === 0) return { text: 'Awaiting first log.', color: theme.textSub };
  const elapsedDays = Math.max(1, (Date.now() - challenge.createdAt) / 86400000);
  const ratePerDay = challenge.current / elapsedDays;
  const remaining = challenge.target - challenge.current;
  const projectedDays = Math.ceil(remaining / ratePerDay);
  if (daysLeft === null) return { text: `~${projectedDays}d remaining at current rate.`, color: theme.textSub };
  const buffer = daysLeft - projectedDays;
  if (buffer >= 0) return { text: `Pace optimal · ${buffer}d buffer.`, color: theme.success };
  return { text: `Off pace · projected ${Math.abs(buffer)}d late.`, color: theme.danger };
}

const ActivityRingCard = React.memo(({
  challenge, theme, calSystem, onPress, onLongPress, onReview,
}: {
  challenge: Challenge;
  theme: any;
  calSystem: CalendarSystem;
  onPress: () => void;
  onLongPress: () => void;
  onReview: () => void;
}) => {
  const isDead = challenge.deadState === 'dead' || challenge.deadState === 'resurrected';
  const progress = Math.min(1, challenge.current / challenge.target);
  const isDone = progress >= 1;
  // Auto-urgency. The data field on Challenge stays so a future
  // surface could override; we deliberately don't expose the picker
  // anymore — the deadline-distance heuristic in `getUrgencyLevel`
  // is the only signal that matters in practice.
  const urgLevel = isDead || isDone ? 'none' as ChallengeUrgency : getUrgencyLevel(challenge.deadlineTs, challenge.urgencyStyle);
  const urgCol = urgencyColor(urgLevel);

  // Static urgency uses the "Drift" treatment from the art-tab sandbox —
  // a continuous ±0.5px translateX sine drift, 4s period, running only
  // while urgLevel === 'static'. There is no coloured border for Static;
  // the drift IS the signal, paired with the amber deadline text below.
  // For the other states the value stays at 0 (no transform). Native
  // driver keeps the loop off the JS thread.
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (urgLevel !== 'static') {
      drift.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1,  duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(drift, { toValue: -1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [urgLevel, drift]);
  const driftTranslateX = drift.interpolate({ inputRange: [-1, 1], outputRange: [-0.5, 0.5] });

  // Deadline label — sentence case to match the rest of the card,
  // honors the user's calendar system (Shamsi or Gregorian).
  const deadlineLabel = useMemo(() => {
    if (!challenge.deadlineTs) return 'No deadline';
    const days = Math.ceil((challenge.deadlineTs - Date.now()) / 86400000);
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days <= 14) return `${days} days left`;
    const dt = new Date(challenge.deadlineTs);
    if (calSystem === 'shamsi') {
      const s = getShamsiDateParts(dt);
      return `${SHAMSI_MONTHS[s.month - 1]} ${s.day}`;
    }
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, [challenge.deadlineTs, calSystem]);

  // Ring is the small "tile-corner" size now that cards are 2-column
  // grid tiles rather than full-width rows. 50px / 5px stroke matches
  // the art-tab Strip candidate that won round 14.
  const ringSize = 50;
  const stroke = 5;
  const radius = (ringSize - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);
  const percent = Math.round(progress * 100);

  // 7-day log strip — pinned to the bottom edge of every grid tile.
  // Computed from challenge.logDates (a Set of 'YYYY-MM-DD' strings),
  // memoised so the strip doesn't rebuild while the user spam-taps +1
  // (current changes, logDates only when a fresh day flips). Includes
  // an `isToday` flag so the rightmost cell can show an outline when
  // today hasn't been logged yet — the user's most useful at-a-glance
  // signal on the tab.
  const last7 = useMemo(() => {
    const logs = challenge.logDates || [];
    const set = new Set(logs);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out: { logged: boolean; isToday: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ logged: set.has(str), isToday: i === 0 });
    }
    return out;
  }, [challenge.logDates]);

  if (isDead) {
    // Fixed-height container so DeadCardOverlay (absoluteFill) has
    // room for header + body + progress bar + REVIEW button.
    return (
      <TouchableOpacity activeOpacity={0.96} onPress={onReview} style={{ marginBottom: 12 }}>
        <View style={{ height: 195, borderRadius: 18, overflow: 'hidden', position: 'relative', backgroundColor: '#0A0A0A' }}>
          <DeadCardOverlay challenge={challenge} theme={theme} onReview={onReview} />
        </View>
      </TouchableOpacity>
    );
  }

  // Border treatment per urgency — none/static get a neutral thin
  // border (Static's signal is the drift animation above, not colour);
  // haemorrhage replaces the uniform border with a 3px coloured left
  // tab and no border on the other sides. Mirrors the art-tab
  // "Haemorrhage · Edge" candidate. The deadline text below keeps the
  // urgency colour either way, so the category is still readable from
  // the typographic accent even when the border weight is symmetric.
  const isHaem = urgLevel === 'haemorrhage';
  const borderStyle = isHaem
    ? {
        borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0,
        borderLeftWidth: 3, borderLeftColor: L1_COLOR,
      }
    : { borderWidth: 1, borderColor: theme.border };
  const titleIsRtl = isRtl(challenge.title);
  // Grid Strip tile (round 14 winner from the art-tab sandbox). Vertical
  // layout: small ring (top-left), title (2 lines max), days-left, then
  // the 7-day log strip pinned to the bottom edge via flex spacer. The
  // outer Animated.View carries the Drift transform when urgLevel ==
  // 'static'; the Edge treatment (3px left tab) lives on borderStyle.
  // No marginBottom — the parent grid's row spacing is provided by the
  // surrounding View's `gap`.
  return (
    <Animated.View style={{ transform: [{ translateX: driftTranslateX }] }}>
    <TouchableOpacity
      activeOpacity={0.96}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={{
        backgroundColor: theme.surface,
        borderRadius: 14,
        padding: 14,
        minHeight: 152,
        ...borderStyle,
      }}
    >
      <View style={{ width: ringSize, height: ringSize, justifyContent: 'center', alignItems: 'center' }}>
        <Svg width={ringSize} height={ringSize} style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={ringSize / 2} cy={ringSize / 2} r={radius}
            stroke={theme.border} strokeWidth={stroke} fill="none"
          />
          <Circle cx={ringSize / 2} cy={ringSize / 2} r={radius}
            stroke={challenge.color} strokeWidth={stroke} fill="none"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </Svg>
        <View style={{ position: 'absolute', alignItems: 'center' }}>
          <Text style={{ color: theme.textMain, fontSize: 12, fontWeight: '700', letterSpacing: -0.3 }}>
            {percent}%
          </Text>
        </View>
      </View>
      <Text
        style={{
          color: theme.textMain, fontSize: 13.5, fontWeight: '700', letterSpacing: -0.2,
          marginTop: 10,
          textAlign: titleIsRtl ? 'right' : 'left',
          writingDirection: titleIsRtl ? 'rtl' : 'ltr',
        }}
        numberOfLines={2}
      >
        {challenge.title}
      </Text>
      <Text
        style={{
          color: urgLevel !== 'none' ? urgCol : theme.textSub,
          fontSize: 11,
          fontWeight: urgLevel !== 'none' ? '700' : '500',
          marginTop: 4,
          textAlign: titleIsRtl ? 'right' : 'left',
        }}
      >
        {deadlineLabel}
      </Text>
      {/* Flex spacer pushes the strip to the bottom edge regardless of
          how many title lines the card needs, so every strip anchors at
          the same place across the grid row. */}
      <View style={{ flex: 1, minHeight: 8 }} />
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {last7.map((d, i) => (
          <View key={i} style={{
            flex: 1, height: 9, borderRadius: 2,
            backgroundColor: d.logged ? challenge.color : 'transparent',
            borderColor: d.isToday && !d.logged ? theme.textMain : theme.border,
            borderWidth: d.logged ? 0 : (d.isToday ? 1.5 : 1),
          }} />
        ))}
      </View>
    </TouchableOpacity>
    </Animated.View>
  );
}, (prev, next) => (
  prev.challenge.id === next.challenge.id &&
  prev.challenge.current === next.challenge.current &&
  prev.challenge.target === next.challenge.target &&
  prev.challenge.deadState === next.challenge.deadState &&
  prev.challenge.deadlineTs === next.challenge.deadlineTs &&
  prev.challenge.title === next.challenge.title &&
  prev.challenge.color === next.challenge.color &&
  prev.challenge.unit === next.challenge.unit &&
  // logDates reference changes when a new day is added (the store
  // builds a new array via spread). Reference equality is enough — the
  // store never mutates the existing array in place.
  prev.challenge.logDates === next.challenge.logDates &&
  prev.theme === next.theme &&
  prev.calSystem === next.calSystem
));

// ── ROSTER: shared bits ──────────────────────────────────────────────────
// Short deadline label for the Roster (sentence case, calendar-aware).
function rosterDeadline(c: Challenge, calSystem: CalendarSystem): string {
  if (!c.deadlineTs) return 'No deadline';
  const d = Math.ceil((c.deadlineTs - Date.now()) / 86400000);
  if (d < 0) return `${Math.abs(d)}d over`;
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d <= 14) return `${d}d left`;
  const dt = new Date(c.deadlineTs);
  if (calSystem === 'shamsi') { const s = getShamsiDateParts(dt); return `${SHAMSI_MONTHS[s.month - 1].slice(0, 3)} ${s.day}`; }
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
// Cadence-aware one-liner — what this challenge's progress MEANS right now.
function rosterStatus(c: Challenge, chain: ReturnType<typeof computeChain>): string {
  if (c.current >= c.target) return 'Line held.';
  const cadence = c.cadence ?? 'cumulative';
  if (cadence === 'daily') return chain.current > 0 ? `${chain.current}-day chain` : (c.current > 0 ? 'Chain broken' : 'Start the chain');
  if (cadence === 'oneshot') return 'One and done';
  return `${c.current} of ${c.target} ${c.unit}`;
}

// ── ROSTER CARD ──────────────────────────────────────────────────────────
// The chosen design (BOLD, from the art-tab studies). A full-width band whose
// fill is a REVERSED gradient — soft where the title sits (so text stays
// clean), hottest at the leading edge: the front of the progress reads like a
// wavefront. On mount the fill (and the bright leading edge) sweep up from 0,
// staggered down the list. The status line under the title rides a
// high-contrast neutral so it never muddies. Done → a check; ≤72h → red.
const ROSTER_LO = 0.10, ROSTER_HI = 0.80; // BOLD alpha range
// Roster card — UI-thread only (reanimated): staggered entrance, a scaleX
// gradient fill (no JS-thread `width` animation = no list jank), a counting %,
// press feedback, and the prototype's TAP-TO-LOG (+1) interaction. The top card
// is the "hero" and gets a gentle breathing wash + a slow light sheen. Tap to
// log progress; long-press opens the full detail view (which holds Edit).
const RosterCard = React.memo(({ challenge, theme, calSystem, index, hero, onBump, onOpen }: {
  challenge: Challenge; theme: any; calSystem: CalendarSystem; index: number; hero: boolean; onBump: () => void; onOpen: () => void;
}) => {
  const c = challenge;
  const pct = Math.min(1, c.current / c.target);
  const done = c.current >= c.target;
  const chain = useMemo(() => computeChain(c), [c.logDates, c.cadence]);
  const titleRtl = isRtl(c.title);
  const isDark = theme.isDark;
  const daysLeft = c.deadlineTs ? Math.ceil((c.deadlineTs - Date.now()) / 86400000) : null;
  const knife = !done && daysLeft !== null && daysLeft >= 0 && daysLeft <= 3;
  const resurrected = !!c.resurrectedBefore;  // brought back from the dead once
  const metaCol = done ? c.color : knife ? theme.danger : hexToRgba(theme.textMain, isDark ? 0.74 : 0.82);
  const meta = `${rosterStatus(c, chain)}${done ? '' : ` · ${rosterDeadline(c, calSystem)}`}`;

  const fill = useSharedValue(0);   // 0→pct, drives the bar + the counting %
  const press = useSharedValue(0);  // finger-down scale
  const pop = useSharedValue(0);    // kick on each log
  const breathe = useSharedValue(0);
  const sheen = useSharedValue(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      fill.value = withDelay(index * 70 + 120, withTiming(pct, { duration: 800, easing: ReEasing.out(ReEasing.cubic) }));
      if (hero) {
        breathe.value = withRepeat(withSequence(
          withTiming(1, { duration: 1700, easing: ReEasing.inOut(ReEasing.ease) }),
          withTiming(0, { duration: 1700, easing: ReEasing.inOut(ReEasing.ease) }),
        ), -1, false);
        sheen.value = withRepeat(withSequence(
          withTiming(1, { duration: 1000, easing: ReEasing.in(ReEasing.quad) }),
          withTiming(1, { duration: 3200 }),
          withTiming(0, { duration: 0 }),
        ), -1, false);
      }
      return;
    }
    // a log happened (c.current changed) — spring the fill + kick the card
    fill.value = withSpring(pct, { damping: 15, stiffness: 150 });
    pop.value = withSequence(withTiming(1, { duration: 110 }), withTiming(0, { duration: 260 }));
  }, [c.current, c.target]);

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(press.value, [0, 1], [1, 0.97]) + pop.value * 0.04 }] }));
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));
  const heroGlow = useAnimatedStyle(() => ({ opacity: 0.05 + breathe.value * 0.10 }));
  const sheenStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheen.value, [0, 0.12, 0.88, 1], [0, 0.08, 0.08, 0]),
    transform: [{ translateX: interpolate(sheen.value, [0, 1], [-180, 460]) }, { rotate: '18deg' }],
  }));
  const pctProps = useAnimatedProps(() => ({ text: `${Math.round(fill.value * 100)}%`, defaultValue: `${Math.round(fill.value * 100)}%` } as any));

  return (
    <Reanimated.View
      entering={FadeInDown.delay(index * 70).springify().damping(15).stiffness(140)}
      exiting={FadeOut.duration(280)} layout={LinearTransition.springify().damping(18)}
      style={{ marginBottom: 10 }}
    >
      <Pressable onPress={onBump} onLongPress={onOpen} delayLongPress={300}
        onPressIn={() => { press.value = withTiming(1, { duration: 90 }); }}
        onPressOut={() => { press.value = withTiming(0, { duration: 170 }); }}
      >
        <Reanimated.View style={[{ height: 92, borderRadius: 16, overflow: 'hidden', backgroundColor: hexToRgba(c.color, isDark ? 0.07 : 0.09), justifyContent: 'center' }, cardStyle]}>
          {/* progress fill — scaleX from the left edge (UI-thread, no layout) */}
          <Reanimated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%', transformOrigin: 'left' }, fillStyle]}>
            <LinearGradient colors={[hexToRgba(c.color, ROSTER_LO), hexToRgba(c.color, ROSTER_HI)] as [string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          </Reanimated.View>
          {/* hero: breathing wash + slow light sheen */}
          {hero && <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.color }, heroGlow]} />}
          {hero && <Reanimated.View pointerEvents="none" style={[{ position: 'absolute', top: -30, bottom: -30, width: 36, backgroundColor: '#FFFFFF' }, sheenStyle]} />}

          <View style={{ paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <Text numberOfLines={1} style={{ color: theme.textMain, fontSize: 17, fontWeight: '800', letterSpacing: -0.3, flexShrink: 1, textAlign: titleRtl ? 'right' : 'left', writingDirection: titleRtl ? 'rtl' : 'ltr' }}>{c.title}</Text>
                {resurrected ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: hexToRgba(c.color, 0.18), paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
                    <Feather name="rotate-ccw" size={9} color={c.color} />
                    <Text style={{ color: c.color, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>RISEN</Text>
                  </View>
                ) : null}
              </View>
              <Text style={{ color: metaCol, fontSize: 12, fontWeight: '700' }}>{meta}</Text>
            </View>
            {done ? <Feather name="check" size={26} color={c.color} /> : (
              <View style={{ alignItems: 'flex-end' }}>
                <ReanimatedTextInput editable={false} pointerEvents="none" underlineColorAndroid="transparent" animatedProps={pctProps}
                  style={{ color: theme.textMain, fontSize: 26, fontWeight: '900', letterSpacing: -1, padding: 0, margin: 0, minWidth: 72, textAlign: 'right' }} />
                <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700' }}>{c.current}/{c.target}</Text>
              </View>
            )}
          </View>
        </Reanimated.View>
      </Pressable>
    </Reanimated.View>
  );
}, (p, n) => p.challenge === n.challenge && p.theme === n.theme && p.calSystem === n.calSystem && p.index === n.index && p.hero === n.hero);

const CompletionBurst = ({ color, visible }: { color: string; visible: boolean }) => {
  const anims = useRef(Array.from({ length: 12 }, () => new Animated.Value(0))).current;
  useEffect(() => { if (!visible) return; Animated.parallel(anims.map((a, i) => Animated.sequence([Animated.delay(i * 25), Animated.spring(a, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true })]))).start(); const t = setTimeout(() => Animated.parallel(anims.map(a => Animated.timing(a, { toValue: 0, duration: 400, useNativeDriver: true }))).start(), 1400); return () => clearTimeout(t); }, [visible]);
  if (!visible) return null;
  return (<View style={StyleSheet.absoluteFill} pointerEvents="none">{anims.map((anim, i) => { const angle = (i / 12) * Math.PI * 2; return <Animated.View key={i} style={{ position: 'absolute', top: '45%', left: '45%', width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity: anim, transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * 90] }) }, { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * 90] }) }, { scale: anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1.6, 0.5] }) }] }} />; })}</View>);
};

// The narrator — reframed. No typewriter, no blinking cursor, no monospace.
// A letter set in serif that fades in one line at a time, with a long beat of
// stillness between lines and the dismiss word arriving last. The app pausing
// the world to say one true thing. Used only for the rare, earned moments.
const SERIF = Platform.OS === 'ios' ? 'Georgia' : 'serif';
const NarratorCeremony = ({ moment, theme, onDone }: { moment: NarratorMoment; theme: any; onDone: () => void }) => {
  const ach = moment.achievementId ? ACHIEVEMENT_DEFS.find(a => a.id === moment.achievementId) : null;
  const effectiveTone = (moment.achievementId && EXISTENTIAL_OVERRIDES.has(moment.achievementId)) ? 'existential' as NarratorTone : moment.tone;
  // The pause is the beat BETWEEN lines appearing (not a typing speed).
  // Existential lingers; everything has a generous floor so nothing rushes.
  const linePause = Math.max(750, NARRATOR_LINE_PAUSE[effectiveTone] * 2.4);
  const linesKey = moment.lines.join('|');

  const symAnim = useRef(new Animated.Value(0)).current;
  const btnAnim = useRef(new Animated.Value(0)).current;
  // One opacity value per line; rebuilt when the moment's lines change.
  const lineAnims = useMemo(() => moment.lines.map(() => new Animated.Value(0)), [linesKey]);

  useEffect(() => {
    symAnim.setValue(0); btnAnim.setValue(0); lineAnims.forEach(a => a.setValue(0));
    const seq = Animated.sequence([
      Animated.timing(symAnim, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(350),
      Animated.stagger(linePause, lineAnims.map(a => Animated.timing(a, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }))),
      Animated.timing(btnAnim, { toValue: 1, duration: 600, delay: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    seq.start();
    return () => seq.stop();
  }, [linesKey, moment.achievementId]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center', padding: 44 }}>
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} />
      {ach && (
        <Animated.View style={{ marginBottom: 40, opacity: symAnim, transform: [{ scale: symAnim.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }], alignItems: 'center' }}>
          <Text style={{ fontSize: 50, color: theme.textMain, fontWeight: '400', textAlign: 'center' }}>{ach.sym}</Text>
          {!moment.firstTime && (<Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 3, color: theme.textSub, textAlign: 'center', marginTop: 14, opacity: 0.7 }}>{ach.name}</Text>)}
        </Animated.View>
      )}
      <View style={{ width: '100%' }}>
        {moment.lines.map((line, i) => (
          <Animated.Text
            key={i}
            style={{
              opacity: lineAnims[i],
              transform: [{ translateY: lineAnims[i].interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
              fontFamily: SERIF, color: theme.textMain, fontSize: 18, fontWeight: '400',
              lineHeight: 29, letterSpacing: 0.2, textAlign: 'center', marginBottom: 7,
            }}
          >
            {line}
          </Animated.Text>
        ))}
      </View>
      <Animated.View style={{ position: 'absolute', bottom: 60, opacity: btnAnim }}>
        <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onDone(); }} hitSlop={{ top: 20, bottom: 20, left: 40, right: 40 }}>
          <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '900', letterSpacing: 2.5 }}>{moment.dismissLabel}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const CompletionCeremony = ({ visible, challenge, isFirst, wasResurrected, theme, onDone, onAchievementQueue }: { visible: boolean; challenge: Challenge | null; isFirst: boolean; wasResurrected: boolean; theme: any; onDone: () => void; onAchievementQueue: (ids: AchievementId[]) => void; }) => {
  const [displayNum, setDisplayNum] = useState(0);
  const [typedText, setTypedText] = useState('');
  const [typingDone, setTypingDone] = useState(false);
  const fadeAnims = useRef(Array.from({ length: 5 }, () => new Animated.Value(0))).current;
  const btnAnim = useRef(new Animated.Value(0)).current;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alive = useRef(false);
  const isCenturion = challenge?.target === 100;
  const daysLeft = challenge?.deadlineTs ? daysUntil(challenge.deadlineTs) : null;

  useEffect(() => {
    if (!visible || !challenge) return;
    alive.current = true; setDisplayNum(0); setTypedText(''); setTypingDone(false);
    fadeAnims.forEach(a => a.setValue(0)); btnAnim.setValue(0);
    timers.current.forEach(clearTimeout); timers.current = [];
    const add = (fn: () => void, ms: number) => { const t = setTimeout(() => { if (alive.current) fn(); }, ms); timers.current.push(t); };
    add(() => { let n = 0; const step = () => { if (!alive.current) return; n += Math.ceil((challenge.current - n) * 0.15) || 1; if (n >= challenge.current) { setDisplayNum(challenge.current); } else { setDisplayNum(n); add(step, 40); } }; step(); }, 300);
    // Wax-seal drop was removed — even after dropping its inner glyph,
    // the empty colored ring still felt like a placeholder hanging in
    // the middle of the screen. The hero count + colored divider +
    // typed title carries the moment on its own.
    add(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 900);
    // The typed line shows the challenge's own title — no more
    // "FIRST BLOOD" / "OBJECTIVE COMPLETE" theatre on the completion
    // screen. The first-completion / resurrection narrations still
    // play afterwards via NarratorCeremony, where they belong.
    const label = challenge.title;
    add(() => { let i = 0; const typeChar = () => { if (!alive.current) return; if (i < label.length) { i++; setTypedText(label.slice(0, i)); add(typeChar, 40); } else { setTypingDone(true); add(() => Animated.timing(btnAnim, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(), 500); } }; typeChar(); }, 1500);
    Animated.stagger(120, fadeAnims.map(a => Animated.timing(a, { toValue: 1, duration: 600, useNativeDriver: true }))).start();
    const achIds: AchievementId[] = [];
    if (isCenturion) achIds.push('centurion');
    if (daysLeft !== null && daysLeft >= 7) achIds.push('early_finish');
    else if (daysLeft !== null && daysLeft >= 0 && daysLeft < 1) achIds.push('last_second');
    if (achIds.length > 0) add(() => onAchievementQueue(achIds), 2400);
    return () => { alive.current = false; timers.current.forEach(clearTimeout); };
  }, [visible, challenge?.id]);

  if (!visible || !challenge) return null;
  return (
    <Modal visible animationType="fade" transparent={false}>
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center', padding: 44 }}>
        <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} />
        <CompletionBurst color={challenge.color} visible={visible} />
        <Animated.View style={{ opacity: fadeAnims[0], alignItems: 'center', marginBottom: 32 }}>
          <Text style={{ fontSize: Math.min(90, width * 0.22), fontWeight: '900', color: challenge.color, letterSpacing: -4 }}>{displayNum}</Text>
          <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '800', letterSpacing: 2, marginTop: 4, opacity: 0.7 }}>OF {challenge.target} {challenge.unit.toUpperCase()}</Text>
        </Animated.View>

        {/* Wax seal removed entirely — even with no inner glyph, the
            empty colored ring read as a placeholder. The hero number,
            colored divider line below, and typed title carry the
            moment without it. */}
        <Animated.View style={{ opacity: fadeAnims[1], width: '100%', height: 2, backgroundColor: challenge.color, marginBottom: 32 }} />
        <Animated.View style={{ opacity: fadeAnims[2] }}>
          <Text
            style={{
              color: theme.textMain, fontSize: 20, letterSpacing: -0.4,
              textAlign: 'center', fontWeight: '700', paddingHorizontal: 16,
              writingDirection: isRtl(challenge.title) ? 'rtl' : 'ltr',
            }}
          >
            {typedText}
            {!typingDone ? <Text style={{ color: theme.textSub, opacity: 0.5 }}>▌</Text> : null}
          </Text>
        </Animated.View>
        {typingDone && challenge.reward && (<Animated.View style={{ opacity: fadeAnims[3], marginTop: 24, padding: 16, borderWidth: 1, borderColor: theme.border, borderRadius: 8 }}><Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 2, marginBottom: 4, opacity: 0.7 }}>REWARD</Text><Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '700', opacity: 0.85 }}>{challenge.reward}</Text></Animated.View>)}
        <Animated.View style={{ position: 'absolute', bottom: 60, opacity: btnAnim, transform: [{ translateY: btnAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
          <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onDone(); }} hitSlop={{ top: 20, bottom: 20, left: 40, right: 40 }}>
            <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '900', letterSpacing: 2.5 }}>CONTINUE</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

const AchievementsScreen = ({ visible, achievements, theme, onClose, onTrigger }: { visible: boolean; achievements: Achievement[]; theme: any; onClose: () => void; onTrigger: (id: AchievementId, firstTime: boolean) => void; }) => {
  // Locked achievements stay HIDDEN entirely. The user's spec is that
  // achievements should appear only after they're earned — discovery
  // by surprise, not a checklist. We show a single quiet line at the
  // bottom acknowledging more exist, without naming or hinting at them.
  const unlocked = achievements.filter(a => a.unlockedAt).sort((a, b) => (b.unlockedAt || 0) - (a.unlockedAt || 0));
  const lockedCount = ACHIEVEMENT_DEFS.length - unlocked.length;
  const isDark = theme.isDark;
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 24, paddingBottom: 16 }}>
          <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 }}>Dossier</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="x" size={22} color={theme.textSub} /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {unlocked.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 }}>
              <Feather name="award" size={36} color={theme.textSub} style={{ opacity: 0.18, marginBottom: 18 }} />
              <Text style={{ color: theme.textMain, fontSize: 16, fontWeight: '900', textAlign: 'center', marginBottom: 6 }}>Empty so far.</Text>
              <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 18, opacity: 0.85 }}>Achievements appear here as you earn them. Their names won’t be shown until you do.</Text>
            </View>
          ) : (
            <>
              {/* Trophy-room summary header — large numeral + small
                  caption, anchoring the screen as a destination rather
                  than a settings list. */}
              <View style={{ alignItems: 'center', paddingVertical: 12, marginBottom: 22 }}>
                <Text style={{ fontSize: 56, fontWeight: '900', color: theme.textMain, letterSpacing: -2, fontVariant: ['tabular-nums'] }}>{unlocked.length}</Text>
                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 2, marginTop: 4, opacity: 0.7 }}>
                  OF {ACHIEVEMENT_DEFS.length} EARNED
                </Text>
              </View>
              {/* Surface-card rows with 44×44 monogram tiles. Tap to
                  replay narration. */}
              {unlocked.map(a => {
                const unlockedDate = a.unlockedAt
                  ? new Date(a.unlockedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
                  : '';
                return (
                  <TouchableOpacity
                    key={a.id}
                    onPress={() => onTrigger(a.id, false)}
                    activeOpacity={0.85}
                    style={{ flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 8, borderRadius: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}
                  >
                    <View style={{ width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}>
                      <Text style={{ fontSize: 22, color: theme.textMain }}>{a.sym}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '900', letterSpacing: 0.5 }}>{a.name}</Text>
                      {/* Trigger hint — what the user did to earn this.
                          Sourced from ACHIEVEMENT_NARRATION's `hint`
                          field so each row tells a clear story without
                          opening the narration. */}
                      <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '500', marginTop: 4, lineHeight: 17 }}>
                        {ACHIEVEMENT_NARRATION[a.id]?.hint || ''}
                      </Text>
                      {unlockedDate ? (
                        <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginTop: 6, opacity: 0.6 }}>
                          {unlockedDate}
                        </Text>
                      ) : null}
                    </View>
                    <Feather name="play" size={11} color={theme.textSub} style={{ opacity: 0.4 }} />
                  </TouchableOpacity>
                );
              })}
              {lockedCount > 0 ? (
                <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', textAlign: 'center', marginTop: 24, opacity: 0.4, letterSpacing: 0.5 }}>
                  {lockedCount} more, hidden until earned.
                </Text>
              ) : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

// ── LOCK THRESHOLDS ──────────────────────────────────────────────────────
// Top-level constants so they're shared between the gate's "is unlocked"
// check and the LockScreen's progress bars — single source of truth.
// Tweak these if the unlock pace needs adjusting; nothing else changes.
const LOCK_FOCUS_HOURS = 6;
const LOCK_TASKS = 10;
const LOCK_HABIT_SCORE = 30;
const LOCK_PROMISES_KEPT = 1;
// Sovereign easter egg — extra needed PAST each requirement to awaken the hidden theme
// (~double the unlock bar). Strength uses peak-ever so an off day can't melt the progress.
const OVER_FOCUS = 4;     // 6 → 10 hrs
const OVER_TASKS = 10;    // 10 → 20
const OVER_HABIT = 20;    // 30 → 50 (peak strength)
const OVER_PROMISE = 2;   // 1 → 3
const SOVEREIGN_ACCENT = '#A855F7';
const SOVEREIGN_ACCENT_SOFT = '#C9A8FF';
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Earned action — filled & lifted when all four conditions are met, ghosted
// while locked, and confirmed (green, "UNLOCKED") the moment it's tapped.
const EarnedButton = ({ theme, allMet, unlocked, sovereign, onPress }: { theme: any; allMet: boolean; unlocked: boolean; sovereign?: boolean; onPress: () => void }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const press = (to: number) => Animated.spring(scale, { toValue: to, friction: 6, tension: 220, useNativeDriver: true }).start();
  // Overreached all four → swap the calm pill for the electric amethyst UNLOCK. Pressing it
  // awakens Sovereign (the caller's onPress handles that).
  if (sovereign && !unlocked) {
    return (
      <View style={{ marginTop: 30, alignSelf: 'stretch' }}>
        <SovereignUnlockButton onPress={onPress} />
      </View>
    );
  }
  const lifted = allMet || unlocked;
  const bg = unlocked ? '#10B981' : allMet ? theme.textMain : 'transparent';
  const fg = unlocked ? '#FFFFFF' : allMet ? theme.bg : theme.textSub;
  const icon = unlocked ? 'check' : allMet ? 'unlock' : 'lock';
  return (
    <Animated.View style={{
      marginTop: 30, alignSelf: 'stretch', transform: [{ scale }],
      shadowColor: lifted ? bg : 'transparent', shadowOpacity: lifted ? 0.35 : 0,
      shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: lifted ? 5 : 0,
    }}>
      <TouchableOpacity
        disabled={!allMet || unlocked} activeOpacity={0.9} onPress={onPress}
        onPressIn={() => { if (allMet && !unlocked) press(0.96); }} onPressOut={() => press(1)}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
          paddingVertical: 17, borderRadius: 14, backgroundColor: bg,
          borderWidth: lifted ? 0 : 1.5, borderColor: theme.border,
        }}
      >
        <Feather name={icon} size={15} color={fg} />
        <Text style={{ fontSize: 13, fontWeight: '900', letterSpacing: 3, color: fg }}>{unlocked ? 'UNLOCKED' : 'UNLOCK'}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

// LockScreen — the day-3 "Earn access" gate, reskinned to the Ring treatment:
// one aggregate focal (n/4) over per-condition rows, each with a progress bar
// and (while its feature is still locked) a hint on how to unlock it. On mount
// the ring arc and rows fill in a staggered sweep; tapping the earned button
// hands off to a full-screen unlock ceremony, which opens the gate when done.

// Full-screen unlock ceremony — the "Fuse". A spark races around the ring,
// drawing it to full, then a soft green pop + the earned statement, and the
// gate opens. The ring draw + orbiting spark run on reanimated's UI thread
// (the same ReanimatedCircle / useAnimatedProps path the challenge-detail ring
// uses) so the sweep stays smooth even while the gate flip is prepared. The
// backdrop holds on theme.bg and only the content fades at the end — since the
// unlocked tab shares theme.bg, that hand-off reads as one continuous surface.
// No flash. Self-timed (~3.3s); plays once.
const UnlockCeremony = ({ theme, onDone }: { theme: any; onDone: () => void }) => {
  const GREEN = '#10B981';
  const size = 124, stroke = 7, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const backdrop = useSharedValue(0);   // screen fade-in (held up)
  const sealIn = useSharedValue(0);     // ring entrance
  const fuse = useSharedValue(0);       // 0→1 ring draw + spark orbit
  const pop = useSharedValue(0);        // soft green shockwave on ignite
  const pulse = useSharedValue(0);      // ring pulse on ignite
  const reveal = useSharedValue(0);     // statement
  const content = useSharedValue(1);    // whole-group fade-out at the end
  const [burst, setBurst] = useState(false);

  // Fired (on the JS thread) the instant the fuse closes the loop.
  const ignite = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setBurst(true);
    pop.value = withTiming(1, { duration: 620, easing: ReEasing.out(ReEasing.cubic) });
    pulse.value = withSequence(withSpring(1, { damping: 5, stiffness: 240 }), withSpring(0, { damping: 10, stiffness: 150 }));
    reveal.value = withDelay(140, withTiming(1, { duration: 600, easing: ReEasing.out(ReEasing.cubic) }));
  };

  useEffect(() => {
    backdrop.value = withTiming(1, { duration: 450, easing: ReEasing.out(ReEasing.cubic) });
    sealIn.value = withDelay(150, withSpring(1, { damping: 13, stiffness: 130 }));
    fuse.value = withDelay(450, withTiming(1, { duration: 1450, easing: ReEasing.inOut(ReEasing.cubic) }, (finished) => {
      'worklet';
      if (finished) runOnJS(ignite)();
    }));
    const tickA = setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), 950);
    const tickB = setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), 1450);
    // Hold long enough to actually read all three lines (ACCESS EARNED ·
    // Challenges. · earned, not given.) before the content fades and the gate
    // opens. The text lands ~2.6s in, so end ~5s ≈ 2.4s of comfortable reading.
    const end = setTimeout(() => {
      content.value = withTiming(0, { duration: 600, easing: ReEasing.in(ReEasing.cubic) }, (finished) => {
        'worklet';
        if (finished) runOnJS(onDone)();
      });
    }, 5000);
    return () => {
      clearTimeout(tickA); clearTimeout(tickB); clearTimeout(end);
      cancelAnimation(backdrop); cancelAnimation(sealIn); cancelAnimation(fuse);
      cancelAnimation(pop); cancelAnimation(pulse); cancelAnimation(reveal); cancelAnimation(content);
    };
  }, []);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: content.value }));
  const ringBoxStyle = useAnimatedStyle(() => ({ opacity: sealIn.value, transform: [{ scale: interpolate(sealIn.value, [0, 1], [0.6, 1]) + pulse.value * 0.07 }] }));
  const popStyle = useAnimatedStyle(() => ({ opacity: interpolate(pop.value, [0, 0.1, 1], [0, 0.5, 0]), transform: [{ scale: interpolate(pop.value, [0, 1], [1, 2.5]) }] }));
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: circ * (1 - fuse.value) } as any));
  const sparkContainerStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${fuse.value * 360}deg` }] }));
  const sparkStyle = useAnimatedStyle(() => ({ opacity: interpolate(fuse.value, [0, 0.05, 0.95, 1], [0, 1, 1, 0]) }));
  const revealStyle = useAnimatedStyle(() => ({ opacity: reveal.value, transform: [{ translateY: interpolate(reveal.value, [0, 1], [14, 0]) }] }));

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => {}}>
      <Reanimated.View style={[{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }, backdropStyle]}>
        <Reanimated.View style={[{ alignItems: 'center' }, contentStyle]}>
          <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', marginBottom: 46 }}>
            <Reanimated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: GREEN }, popStyle]} />
            <Reanimated.View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, ringBoxStyle]}>
              <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                <Circle cx={size / 2} cy={size / 2} r={r} stroke={hexToRgba(theme.textMain, 0.12)} strokeWidth={stroke} fill="none" />
                <ReanimatedCircle cx={size / 2} cy={size / 2} r={r} stroke={GREEN} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${circ}`} animatedProps={ringProps} />
              </Svg>
              <Reanimated.View style={[{ position: 'absolute', width: 0, height: 0, top: size / 2, left: size / 2 }, sparkContainerStyle]}>
                <Reanimated.View style={[{ position: 'absolute', width: 13, height: 13, borderRadius: 7, backgroundColor: '#FFFFFF', top: -r - 6.5, left: -6.5, shadowColor: GREEN, shadowOpacity: 0.9, shadowRadius: 8 }, sparkStyle]} />
              </Reanimated.View>
            </Reanimated.View>
            <CompletionBurst color={GREEN} visible={burst} />
          </View>
          <Reanimated.View style={[{ alignItems: 'center' }, revealStyle]}>
            <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 4, color: theme.textSub, marginBottom: 16 }}>ACCESS EARNED</Text>
            <Text style={{ fontSize: 44, fontWeight: '900', letterSpacing: -1.5, color: theme.textMain, textAlign: 'center' }}>Challenges.</Text>
            <Text style={{ fontSize: 13, fontWeight: '500', fontStyle: 'italic', color: theme.textSub, marginTop: 12, textAlign: 'center' }}>earned, not given.</Text>
          </Reanimated.View>
        </Reanimated.View>
      </Reanimated.View>
    </Modal>
  );
};

const LockScreen = ({ focusHrs, tasksDone, habitScore, habitPeak, promisesKept, deepWorkUnlocked, promiseUnlocked, strengthUnlocked, onUnlock, theme }: {
  focusHrs: number;
  tasksDone: number;
  habitScore: number;
  habitPeak: number;
  promisesKept: number;
  // Whether the FEATURE each condition measures is itself unlocked yet. A
  // condition whose feature is still locked can't be progressed — instead of
  // a dead 0/10 bar we show a hint on how to unlock that feature first. Tasks
  // are core, so that condition is never hidden.
  deepWorkUnlocked: boolean;
  promiseUnlocked: boolean;
  strengthUnlocked: boolean;
  onUnlock: () => void;
  theme: any;
}) => {
  const isDark = theme.isDark;
  const focusPct = Math.min(1, focusHrs / LOCK_FOCUS_HOURS);
  const tasksPct = Math.min(1, tasksDone / LOCK_TASKS);
  const habitPct = Math.min(1, habitScore / LOCK_HABIT_SCORE);
  const promisePct = Math.min(1, promisesKept / LOCK_PROMISES_KEPT);
  // Sovereign overreach fractions (0..1 toward the hidden target). 0 while the feature is
  // locked. Strength uses habitPeak (peak-ever) so a later dip can't melt the progress.
  const focusOver = clamp01((focusHrs - LOCK_FOCUS_HOURS) / OVER_FOCUS);
  const tasksOver = clamp01((tasksDone - LOCK_TASKS) / OVER_TASKS);
  const habitOver = clamp01((habitPeak - LOCK_HABIT_SCORE) / OVER_HABIT);
  const promiseOver = clamp01((promisesKept - LOCK_PROMISES_KEPT) / OVER_PROMISE);
  // Per-condition hints, shown only while the underlying feature is locked.
  // Copy mirrors the real unlock thresholds: Deep Work + Promise both gate on
  // 4 active tasks (lib/unlockTriggers.ts); Strength on dayConqueredEver — a
  // fully conquered day (every scheduled habit done) with 3+ habits
  // (isDayConquered in lib/habitScore.ts).
  const focusHint = deepWorkUnlocked ? undefined : 'This requires four active tasks to unlock.';
  const promiseHint = promiseUnlocked ? undefined : 'This requires four active tasks to unlock.';
  const habitHint = strengthUnlocked ? undefined : 'This requires completing every habit on a day with three or more to unlock.';

  // One row per condition — mirrors the original Bar's display + met logic. A
  // locked feature's condition can never count as met: its bar stays empty and
  // shows the hint, so the gate holds until the user unlocks that feature.
  const conds = [
    { key: 'focus',   label: 'Deep work',      pct: focusPct,   display: `${Math.round(focusHrs * 10) / 10} / ${LOCK_FOCUS_HOURS} hrs`,            met: !focusHint && focusPct >= 1,     over: focusHint ? 0 : focusOver,     locked: !!focusHint,   hint: focusHint },
    { key: 'tasks',   label: 'Tasks done',     pct: tasksPct,   display: `${Math.min(tasksDone, LOCK_TASKS)} / ${LOCK_TASKS}`,                     met: tasksPct >= 1,                   over: tasksOver,                     locked: false,         hint: undefined as string | undefined },
    { key: 'habit',   label: 'Habit strength', pct: habitPct,   display: `${Math.min(habitScore, LOCK_HABIT_SCORE)} / ${LOCK_HABIT_SCORE}`,         met: !habitHint && habitPct >= 1,     over: habitHint ? 0 : habitOver,     locked: !!habitHint,   hint: habitHint },
    { key: 'promise', label: 'Promises kept',  pct: promisePct, display: `${Math.min(promisesKept, LOCK_PROMISES_KEPT)} / ${LOCK_PROMISES_KEPT}`,  met: !promiseHint && promisePct >= 1, over: promiseHint ? 0 : promiseOver, locked: !!promiseHint, hint: promiseHint },
  ];
  const metCount = conds.filter(c => c.met).length;
  const allMet = metCount === 4;
  const frac = metCount / 4;
  // Sovereign trigger — overreaching ALL FOUR conditions awakens the hidden theme. The four
  // over-fractions latch (monotonic counters + peak strength), so this fires when the last
  // one completes. Permanent once set; the awakening ceremony will hook in here next.
  const allOverreached = conds.every((c) => !c.locked && c.over >= 1);
  const setSovereignAwakened = useAppStore((s) => s.setSovereignAwakened);
  const size = 132, stroke = 6, r = (size - stroke) / 2, circ = 2 * Math.PI * r;

  const ringAnim = useRef(new Animated.Value(0)).current;
  const barAnims = useRef([0, 0, 0, 0].map(() => new Animated.Value(0))).current;
  const [displayCount, setDisplayCount] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [ceremony, setCeremony] = useState(false);
  const [sovereignCeremony, setSovereignCeremony] = useState(false);

  // Mount sweep: the ring arc draws 0 → n/4 while each row's bar fills with a
  // per-row stagger. useNativeDriver:false — we animate the SVG stroke offset
  // and layout widths (percentage strings).
  useEffect(() => {
    const sweep = Animated.parallel([
      Animated.timing(ringAnim, { toValue: 1, duration: 1000, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.stagger(90, barAnims.map(a => Animated.timing(a, { toValue: 1, duration: 850, delay: 150, easing: Easing.out(Easing.cubic), useNativeDriver: false }))),
    ]);
    sweep.start();
    return () => sweep.stop();
  }, []);

  // Count the focal number up in step with the ring sweep.
  useEffect(() => {
    let last = -1;
    const id = ringAnim.addListener(({ value }) => {
      const n = Math.round(value * metCount);
      if (n !== last) { last = n; setDisplayCount(n); }
    });
    return () => ringAnim.removeListener(id);
  }, [metCount]);

  // The listener above only fires while ringAnim is animating — i.e. during the
  // one-time mount sweep. Once it rests at 1 it never fires again, so a later
  // metCount change (the user meets/un-meets a condition on another tab, then
  // returns to this freezeOnBlur tab) moves the ring + bars but leaves the focal
  // number stale until an app restart remounts the screen. Snap the number to
  // the true count on any real change; the mount count-up still plays first.
  const prevMet = useRef(metCount);
  useEffect(() => {
    if (prevMet.current !== metCount) {
      prevMet.current = metCount;
      setDisplayCount(metCount);
    }
  }, [metCount]);

  // Tapping the earned button confirms it (the button morphs to "UNLOCKED"),
  // then hands off to the full-screen ceremony, which opens the gate when done.
  const handleUnlock = () => {
    if (!allMet || ceremony) return;
    setUnlocked(true);
    setCeremony(true);
  };

  // Overreached all four → tapping the electric UNLOCK awakens Sovereign (the deliberate
  // "rise"), grants the theme, then plays the full-screen awakening ceremony, which unlocks
  // challenges when it finishes.
  const handleAwaken = () => {
    if (!allOverreached || ceremony || sovereignCeremony) return;
    setSovereignAwakened(true);
    setSovereignCeremony(true);
  };

  const ringColor = allMet || unlocked ? '#10B981' : theme.textMain;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 32, paddingVertical: 48, flexGrow: 1, justifyContent: 'center' }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 3, color: theme.textSub, marginBottom: 6 }}>EARN ACCESS</Text>
          <Text style={{ fontSize: 13, color: theme.textSub, lineHeight: 20 }}>Four conditions, met at once.</Text>
          <View style={{ width: size, height: size, marginVertical: 28, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
              <Circle cx={size / 2} cy={size / 2} r={r} stroke={hexToRgba(theme.textMain, 0.1)} strokeWidth={stroke} fill="none" />
              <AnimatedCircle
                cx={size / 2} cy={size / 2} r={r} stroke={ringColor} strokeWidth={stroke} fill="none" strokeLinecap="round"
                strokeDasharray={`${circ}`}
                strokeDashoffset={ringAnim.interpolate({ inputRange: [0, 1], outputRange: [circ, circ * (1 - frac)] })}
              />
            </Svg>
            <Text style={{ fontSize: 40, fontWeight: '900', color: theme.textMain, fontVariant: ['tabular-nums'] }}>{displayCount}<Text style={{ fontSize: 18, fontWeight: '800', color: theme.textSub }}> / 4</Text></Text>
          </View>
          <View style={{ alignSelf: 'stretch', gap: 18 }}>
            {conds.map((c, i) => {
              const col = c.locked ? theme.textSub : c.met ? '#10B981' : theme.textMain;
              return (
                <View key={c.key} style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    {/* fixed-width icon column so labels align across met / overreached / locked */}
                    <View style={{ width: 16, alignItems: 'center' }}>
                      {c.locked
                        ? <Feather name="lock" size={12} color={theme.textSub} />
                        : allMet && c.over >= 1
                          ? <View style={{ width: 15, height: 15, borderRadius: 4.5, backgroundColor: SOVEREIGN_ACCENT, alignItems: 'center', justifyContent: 'center' }}><Feather name="check" size={10} color="#FFFFFF" /></View>
                          : c.met
                            ? <Feather name="check" size={13} color="#10B981" />
                            : <View style={{ width: 13, height: 13, borderRadius: 7, borderWidth: 1.5, borderColor: theme.textSub }} />}
                    </View>
                    <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: c.met ? theme.textMain : theme.textSub }}>{c.label}</Text>
                    {/* count stays capped at the requirement — the overshoot is never shown */}
                    <Text style={{ fontSize: 12, fontWeight: '700', color: c.met ? '#10B981' : theme.textSub, fontVariant: ['tabular-nums'] }}>{c.locked ? 'Locked' : c.display}</Text>
                  </View>
                  {/* hairline + amethyst overreach (Sovereign hint): only AFTER all four are met, push one past its requirement */}
                  <View style={{ height: 8, justifyContent: 'center' }}>
                    {!c.locked && allMet && c.over > 0 && <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${c.over * 100}%`, backgroundColor: hexToRgba(SOVEREIGN_ACCENT, 0.18), borderRadius: 4 }} />}
                    <View style={{ height: 2, backgroundColor: hexToRgba(theme.textMain, isDark ? 0.1 : 0.08), overflow: 'hidden' }}>
                      {!c.locked && <Animated.View style={{ height: '100%', width: barAnims[i].interpolate({ inputRange: [0, 1], outputRange: ['0%', `${c.pct * 100}%`] }), backgroundColor: col }} />}
                      {!c.locked && allMet && c.over > 0 && <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${c.over * 100}%`, backgroundColor: SOVEREIGN_ACCENT }} />}
                    </View>
                    {!c.locked && allMet && c.over > 0 && c.over < 1 && <View style={{ position: 'absolute', left: `${c.over * 100}%`, top: '50%', width: 4, height: 4, borderRadius: 2, marginLeft: -2, marginTop: -2, backgroundColor: SOVEREIGN_ACCENT_SOFT }} />}
                  </View>
                  {c.locked && c.hint ? <Text style={{ fontSize: 11, color: theme.textSub, marginTop: 2, lineHeight: 16, opacity: 0.85 }}>{c.hint}</Text> : null}
                </View>
              );
            })}
          </View>
          <EarnedButton theme={theme} allMet={allMet} unlocked={unlocked} sovereign={allOverreached} onPress={allOverreached ? handleAwaken : handleUnlock} />
        </View>
      </ScrollView>
      {/* Mutually exclusive — overreach plays the Sovereign ceremony, never both. */}
      {sovereignCeremony
        ? <SovereignCeremony onDone={() => { setSovereignCeremony(false); onUnlock(); }} />
        : ceremony ? <UnlockCeremony theme={theme} onDone={onUnlock} /> : null}
    </SafeAreaView>
  );
};

// Wrapper that owns the metric computation. Mounted only when the tab
// is locked — once unlocked, this component (and all its expensive
// reductions over tasks/habits/sessions) never instantiates. Cuts the
// "challenges tab takes a while to open" cost for unlocked users.
const LockGate = ({ onUnlock, theme }: { onUnlock: () => void; theme: any }) => {
  const deepWorkSessions = useAppStore(s => s.deepWorkSessions);
  const promiseStats = useAppStore(s => s.promiseStats);
  const allHabits = useAppStore(s => s.habits);
  // Each condition measures a feature that may itself still be locked. We pass
  // these down so the LockScreen can hint at how to unlock the feature instead
  // of showing a condition the user has no way to make progress on yet.
  const deepWorkUnlocked = useIsUnlocked(FEATURE_IDS.DEEP_WORK);
  const promiseUnlocked = useIsUnlocked(FEATURE_IDS.PROMISE);
  const strengthUnlocked = useIsUnlocked(FEATURE_IDS.STRENGTH_SCORE);

  const focusHrs = useMemo(
    () => deepWorkSessions.reduce((acc, s) => acc + (s.durationMs || 0), 0) / 3_600_000,
    [deepWorkSessions]
  );
  // Sticky lifetime completed-task count from the store — NOT a filter over the
  // live list, so deleting/sweeping a done task no longer reverts this gate's
  // progress; only un-checking a task lowers it. (Was: tasks.filter(...).length.)
  const tasksDone = useAppStore(s => s.tasksCompletedCount ?? 0);
  const habitScore = useMemo(() => {
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return calculateGlobalStrength(allHabits, todayStr);
  }, [allHabits]);
  const promisesKept = promiseStats.keptTotal;
  // Peak-ever strength for the Sovereign overreach — bump the stored peak from the current
  // value, and pass the higher of the two down (so a later dip can't lower the over-fraction).
  const peakStored = useAppStore((s) => s.peakHabitStrength ?? 0);
  const notePeakStrength = useAppStore((s) => s.notePeakStrength);
  useEffect(() => { notePeakStrength(habitScore); }, [habitScore, notePeakStrength]);
  const habitPeak = Math.max(peakStored, habitScore);

  return (
    <LockScreen
      focusHrs={focusHrs}
      tasksDone={tasksDone}
      habitScore={habitScore}
      habitPeak={habitPeak}
      promisesKept={promisesKept}
      deepWorkUnlocked={deepWorkUnlocked}
      promiseUnlocked={promiseUnlocked}
      strengthUnlocked={strengthUnlocked}
      onUnlock={onUnlock}
      theme={theme}
    />
  );
};

// ── DAY-2 TEASER ────────────────────────────────────────────────────────────
// The ONE sanctioned exception to "locked UI is completely absent": on day 2 the
// Challenges tab appears as a visible-but-locked teaser — a shimmering line (the
// "Line" motif) over a quiet countdown to the day-3 reveal. Calm + typographic,
// not gamified, no terminal chrome (per the Challenges redesign's locked
// aesthetic). The countdown is cosmetic — the real reveal is driven by the
// CHALLENGES_TAB trigger at daysSinceInstall>=3 (lib/unlockTriggers.ts). First
// pass on copy/visual — expect a taste tune.
// Day-2 teaser, pared down to ONE thing: a bare 24h countdown ticking down to
// the reveal. No title, no shimmer, no copy — just the timer. (revealAt =
// first-seen + 24h, stamped in app/_layout; null only in the beat before that.)
const ChallengeTeaser = ({ theme, revealAt, onReveal }: { theme: any; revealAt: number | null; onReveal?: () => void }) => {
  const [now, setNow] = useState(() => Date.now());
  const firedRef = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      // The instant we cross the boundary, tell the parent to reveal — so the
      // countdown transitions live instead of freezing at 00:00:00.
      if (revealAt != null && n >= revealAt && !firedRef.current) {
        firedRef.current = true;
        onReveal?.();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [revealAt, onReveal]);
  const msLeft = revealAt != null ? Math.max(0, revealAt - now) : null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const text = msLeft == null ? '--:--:--'
    : `${pad(Math.floor(msLeft / 3_600_000))}:${pad(Math.floor((msLeft % 3_600_000) / 60_000))}:${pad(Math.floor((msLeft % 60_000) / 1000))}`;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
        <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 4, color: theme.textSub, marginBottom: 18 }}>UNLOCKS IN</Text>
        <Text style={{ fontSize: 52, fontWeight: '900', letterSpacing: 1, color: theme.textMain, fontVariant: ['tabular-nums'] }}>{text}</Text>
      </View>
    </SafeAreaView>
  );
};

// ── GRAVEYARD SCREEN ────────────────────────────────────────────────
// Promoted from a tab inside the Storage sheet to its own full-screen
// surface — the Graveyard is a place you visit, not a drawer. Each
// buried challenge becomes a portrait "case file" card with a case ID,
// title, cause-of-death line, and a clinical dead-message. An ambient
// scan-line crawls across the entire screen at 1% opacity to echo the
// surveillance aesthetic of the bury ceremony.
//
// Tapping a case file routes to the existing ReviewModal, which lets
// the user resurrect (one final chance, new deadline) or leave it. The
// resurrect path is the "take it back" interaction the redesign spec
// asks for, without rebuilding it.
// ── GRAVEYARD ────────────────────────────────────────────────────────────
// Rebuilt from scratch. A quiet place you visit, not a surveillance console —
// each buried line gets a dignified "headstone": its name, a one-line epitaph
// in its own words, how far it got, when it was set down, and a calm way to
// bring it back. No scan-line, no case-ID, no monospace, no blood-red. The
// flow is unchanged: tapping a stone opens the Review sheet (resurrect / leave).
const GraveyardScreen = ({ visible, challenges, theme, onClose, onTap, onDelete }: { visible: boolean; challenges: Challenge[]; theme: any; onClose: () => void; onTap: (c: Challenge) => void; onDelete: (c: Challenge) => void; }) => {
  const isDark = theme.isDark;
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 28, fontWeight: '900', color: theme.textMain, letterSpacing: -1 }}>Graveyard.</Text>
            <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginTop: 6 }}>
              {challenges.length === 0 ? 'Nothing buried yet.' : `${challenges.length} buried · remembered, not deleted`}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
            <Feather name="x" size={22} color={theme.textSub} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {challenges.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 90, paddingHorizontal: 24 }}>
              <Feather name="moon" size={34} color={theme.textSub} style={{ opacity: 0.16, marginBottom: 18 }} />
              <Text style={{ color: theme.textMain, fontSize: 16, fontWeight: '800', textAlign: 'center', marginBottom: 6 }}>The graveyard is empty.</Text>
              <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '500', textAlign: 'center', lineHeight: 19, opacity: 0.9 }}>What you bury rests here. Not deleted — remembered.</Text>
            </View>
          ) : (
            challenges.map(c => {
              const buriedDate = c.buriedAt ? new Date(c.buriedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
              const msg = getDeadMessage(c);
              const pct = Math.round(Math.min(1, c.current / c.target) * 100);
              const titleRtl = isRtl(c.title);
              const muted = hexToRgba(c.color, isDark ? 0.55 : 0.6);
              return (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onTap(c); }}
                  onLongPress={() => onDelete(c)}
                  delayLongPress={3000}
                  activeOpacity={0.85}
                  style={{ marginBottom: 12, backgroundColor: theme.surface, borderRadius: 18, borderWidth: 1, borderColor: theme.border, padding: 20 }}
                >
                  {/* Name + when it was set down */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: muted }} />
                    <Text
                      numberOfLines={1}
                      style={{ flex: 1, color: theme.textMain, fontSize: 17, fontWeight: '800', letterSpacing: -0.3, opacity: 0.92, textAlign: titleRtl ? 'right' : 'left', writingDirection: titleRtl ? 'rtl' : 'ltr' }}
                    >
                      {c.title}
                    </Text>
                    {buriedDate ? <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600' }}>{buriedDate}</Text> : null}
                  </View>

                  {/* Epitaph — its own quiet words */}
                  <Text style={{ color: theme.textSub, fontSize: 13.5, fontWeight: '500', fontStyle: 'italic', lineHeight: 20, marginBottom: 14 }}>
                    {msg.text}
                  </Text>

                  {/* How far it got */}
                  <View style={{ height: 3, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                    <View style={{ height: '100%', width: `${Math.max(2, pct)}%`, backgroundColor: muted, borderRadius: 2 }} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600' }}>Reached {pct}% · {c.current}/{c.target} {c.unit}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Text style={{ color: theme.textMain, fontSize: 12, fontWeight: '700', opacity: 0.8 }}>Bring it back</Text>
                      <Feather name="arrow-right" size={13} color={theme.textSub} />
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const LINK_INCREMENT_MAX = 99;

const HabitLinkModal = ({ visible, challenge, habits, theme, insets, onSave, onClose }: { visible: boolean; challenge: Challenge | null; habits: Habit[]; theme: any; insets: { bottom: number }; onSave: (id: string, links: ChallengeLink[]) => void; onClose: () => void; }) => {
  // Full link config now, not just a set of ids: each linked habit carries
  // whether it auto-advances the challenge and by how much.
  const [links, setLinks] = useState<ChallengeLink[]>([]);
  useEffect(() => { if (challenge) setLinks((challenge.links || []).map(l => ({ ...l }))); }, [challenge?.id]);
  const active = habits.filter(h => h.status === 'active');
  const linkFor = (id: string) => links.find(l => l.habitId === id);
  const toggleLink = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLinks(p => p.some(l => l.habitId === id)
      ? p.filter(l => l.habitId !== id)
      : [...p, { habitId: id, autoAdvance: true, increment: 1 }]);
  };
  const setAuto = (id: string, v: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLinks(p => p.map(l => l.habitId === id ? { ...l, autoAdvance: v } : l));
  };
  const bumpIncrement = (id: string, delta: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLinks(p => p.map(l => l.habitId === id
      ? { ...l, increment: Math.max(1, Math.min(LINK_INCREMENT_MAX, l.increment + delta)) }
      : l));
  };
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlayBottom}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.bottomSheet, { backgroundColor: theme.surface, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, 20) + 16 }]}>
          <View style={[styles.modalDragHandle, { backgroundColor: theme.border }]} />
          <Text style={[styles.modalSectionTitle, { color: theme.textMain }]}>Link Habits</Text>
          <Text style={{ color: theme.textSub, fontSize: 13, marginBottom: 20, lineHeight: 19 }}>Completing a linked habit can advance this challenge. Choose whether it does, and by how much.</Text>
          <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
            {active.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                <Feather name="activity" size={32} color={theme.textSub} style={{ opacity: 0.3, marginBottom: 12 }} />
                <Text style={{ color: theme.textSub, fontSize: 14, textAlign: 'center' }}>No active habits yet.</Text>
              </View>
            ) : active.map(h => {
              const link = linkFor(h.id);
              const isLinked = !!link;
              return (
                <View key={h.id} style={{ borderRadius: 12, borderWidth: 1, marginBottom: 8, backgroundColor: isLinked ? h.color + '18' : theme.bg, borderColor: isLinked ? h.color : theme.border, overflow: 'hidden' }}>
                  {/* Header — tap to link / unlink the habit. */}
                  <TouchableOpacity onPress={() => toggleLink(h.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
                    <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: h.color + '25', justifyContent: 'center', alignItems: 'center' }}>
                      <Feather name={h.icon as any} size={15} color={h.color} />
                    </View>
                    <Text style={{ color: isLinked ? theme.textMain : theme.textSub, fontWeight: '700', flex: 1, fontSize: 14 }}>{h.title}</Text>
                    <View style={[styles.linkCheckbox, { borderColor: isLinked ? h.color : theme.border, backgroundColor: isLinked ? h.color : 'transparent' }]}>
                      {isLinked && <Feather name="check" size={10} color="#FFF" />}
                    </View>
                  </TouchableOpacity>
                  {/* Config — only for linked habits. Auto-advance toggle, then an
                      increment stepper when auto-advance is on. */}
                  {isLinked && link ? (
                    <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
                      <View style={{ height: 1, backgroundColor: theme.border, opacity: 0.6 }} />
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '600' }}>Auto-advance on completion</Text>
                        <Switch value={link.autoAdvance} onValueChange={(v) => setAuto(h.id, v)} trackColor={{ true: h.color }} thumbColor="#FFF" />
                      </View>
                      {link.autoAdvance ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600' }}>Advances by</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                            <TouchableOpacity onPress={() => bumpIncrement(h.id, -1)} disabled={link.increment <= 1} style={{ width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: theme.border, justifyContent: 'center', alignItems: 'center', opacity: link.increment <= 1 ? 0.4 : 1 }}>
                              <Feather name="minus" size={14} color={theme.textMain} />
                            </TouchableOpacity>
                            <Text style={{ color: theme.textMain, fontSize: 16, fontWeight: '900', minWidth: 28, textAlign: 'center' }}>{link.increment}</Text>
                            <TouchableOpacity onPress={() => bumpIncrement(h.id, 1)} disabled={link.increment >= LINK_INCREMENT_MAX} style={{ width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: theme.border, justifyContent: 'center', alignItems: 'center', opacity: link.increment >= LINK_INCREMENT_MAX ? 0.4 : 1 }}>
                              <Feather name="plus" size={14} color={theme.textMain} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '500', opacity: 0.8, fontStyle: 'italic' }}>Linked for reference — won’t move this challenge.</Text>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
            <View style={{ height: 20 }} />
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10 }}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Text style={{ color: theme.textSub, fontWeight: '800' }}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { if (challenge) { onSave(challenge.id, links); onClose(); } }} style={[styles.saveBtn, { backgroundColor: theme.textMain }]}><Text style={[styles.saveBtnText, { color: theme.bg }]}>Save Links</Text></TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const ReviewModal = ({ visible, challenge, theme, insets, calSystem, onResurrect, onBury, onClose }: { visible: boolean; challenge: Challenge | null; theme: any; insets: { bottom: number }; calSystem: CalendarSystem; onResurrect: (id: string, ts: number) => void; onBury: (id: string) => void; onClose: () => void; }) => {
  const [newTs, setNewTs] = useState<number | undefined>();
  // Bring-back is once per challenge, and never from the graveyard. `isPermanent`
  // hides the Resurrect button when the goal already used its one life
  // (resurrectedBefore — survives burial) OR is already buried. A buried goal
  // just rests in the graveyard: no bring-back, no re-bury.
  const buried = challenge?.deadState === 'buried';
  const isPermanent = buried || challenge?.deadState === 'resurrected' || !!challenge?.resurrectedBefore;
  useEffect(() => { if (visible) setNewTs(undefined); }, [visible]);
  if (!challenge) return null;
  const pct = Math.round(Math.min(1, challenge.current / challenge.target) * 100);
  const msg = getDeadMessage(challenge);
  const titleRtl = isRtl(challenge.title);
  const isDark = theme.isDark;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlayBottom}>
        <TouchableWithoutFeedback onPress={onClose}><View style={StyleSheet.absoluteFill} /></TouchableWithoutFeedback>
        <View style={[styles.bottomSheet, { backgroundColor: theme.surface, borderColor: theme.border, maxHeight: '92%', paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={[styles.modalDragHandle, { backgroundColor: theme.border }]} />
          <View style={{ marginBottom: 22 }}>
            <Text numberOfLines={2} style={{ color: theme.textMain, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, textAlign: titleRtl ? 'right' : 'left', writingDirection: titleRtl ? 'rtl' : 'ltr' }}>{challenge.title}</Text>
            <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', marginTop: 4 }}>{isPermanent ? 'This one didn’t make it.' : 'The deadline passed. Your call.'}</Text>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
            {/* What happened — its own quiet words, the stake you set, how far it got. */}
            <View style={{ backgroundColor: theme.bg, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 18, marginBottom: 20 }}>
              <Text style={{ color: theme.textSub, fontSize: 13.5, fontWeight: '500', fontStyle: 'italic', lineHeight: 20, marginBottom: 14 }}>{msg.text}</Text>
              {challenge.punishment ? (
                <Text style={{ color: '#F59E0B', fontSize: 12, fontWeight: '700', marginBottom: 14 }}>On the line: {challenge.punishment}</Text>
              ) : null}
              <View style={{ height: 3, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                <View style={{ height: '100%', width: `${Math.max(2, pct)}%`, backgroundColor: theme.textSub, borderRadius: 2 }} />
              </View>
              <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600' }}>Reached {pct}% · {challenge.current}/{challenge.target} {challenge.unit}</Text>
            </View>
            {!isPermanent && (
              <>
                <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 12 }}>BRING IT BACK — PICK A NEW DEADLINE</Text>
                <CalendarPicker value={newTs} onChange={setNewTs} theme={theme} calSystem={calSystem} />
                <TouchableOpacity disabled={!newTs} onPress={() => { if (newTs) { onResurrect(challenge.id, newTs); onClose(); } }} style={[styles.saveBtn, { backgroundColor: newTs ? L3_COLOR : theme.border, alignItems: 'center', marginTop: 14, marginBottom: 12, paddingVertical: 16 }]}>
                  <Text style={{ color: newTs ? '#FFF' : theme.textSub, fontWeight: '800', fontSize: 15 }}>Resurrect</Text>
                  <Text style={{ color: newTs ? 'rgba(255,255,255,0.65)' : theme.textSub, fontSize: 11, fontWeight: '600', marginTop: 2 }}>One more attempt.</Text>
                </TouchableOpacity>
              </>
            )}
            {!buried && (
              <TouchableOpacity onPress={() => { onBury(challenge.id); onClose(); }} style={[styles.saveBtn, { backgroundColor: hexToRgba(L1_COLOR, isDark ? 0.08 : 0.06), borderWidth: 1, borderColor: hexToRgba(L1_COLOR, 0.22), alignItems: 'center', paddingVertical: 16, marginBottom: 20 }]}>
                <Text style={{ color: L1_COLOR, fontWeight: '800', fontSize: 15 }}>Bury it</Text>
                <Text style={{ color: hexToRgba(L1_COLOR, 0.5), fontSize: 11, fontWeight: '600', marginTop: 2 }}>Move to the graveyard — remembered, not gone.</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const SoftDeleteOverlay = ({ visible, title, subtitle, confirmLabel, cancelLabel, onConfirm, onCancel, theme }: { visible: boolean; title: string; subtitle?: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void; onCancel: () => void; theme: any; }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(fadeAnim, { toValue: visible ? 1 : 0, duration: visible ? 300 : 200, useNativeDriver: true }).start(); }, [visible]);
  if (!visible) return null;
  const isDark = theme.isDark;
  return (
    <Animated.View style={{ position: 'absolute', inset: 0, backgroundColor: isDark ? 'rgba(0,0,0,0.93)' : 'rgba(255,255,255,0.94)', zIndex: 300, justifyContent: 'center', alignItems: 'center', padding: 44, opacity: fadeAnim }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 2, color: theme.textSub, marginBottom: 22 }}>HOLD ON</Text>
      <Text
        style={{
          fontSize: 19, fontWeight: '800', color: theme.textMain,
          textAlign: 'center', letterSpacing: -0.3,
          marginBottom: subtitle ? 10 : 34,
          writingDirection: isRtl(title) ? 'rtl' : 'ltr',
        }}
      >
        {title}
      </Text>
      {subtitle && <Text style={{ fontSize: 13, color: theme.textSub, fontWeight: '500', textAlign: 'center', lineHeight: 20, marginBottom: 34 }}>{subtitle}</Text>}
      <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); onConfirm(); }} style={{ marginBottom: 18, paddingHorizontal: 34, paddingVertical: 14, borderWidth: 1, borderColor: hexToRgba(L1_COLOR, 0.4), borderRadius: 12 }}><Text style={{ color: L1_COLOR, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>{confirmLabel}</Text></TouchableOpacity>
      <TouchableOpacity onPress={onCancel} hitSlop={{ top: 15, bottom: 15, left: 30, right: 30 }}><Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>{cancelLabel}</Text></TouchableOpacity>
    </Animated.View>
  );
};

const GraveyardBuryOverlay = ({ visible, challenge, onConfirm, onCancel, theme }: { visible: boolean; challenge: Challenge | null; onConfirm: () => void; onCancel: () => void; theme: any; }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: visible ? 1 : 0, duration: visible ? 360 : 200, useNativeDriver: true }).start();
  }, [visible]);
  if (!visible || !challenge) return null;
  const msg = getDeadMessage(challenge);
  const pct = Math.round(Math.min(1, challenge.current / challenge.target) * 100);
  const isDark = theme.isDark;
  const titleRtl = isRtl(challenge.title);
  return (
    <Animated.View style={{ position: 'absolute', inset: 0, backgroundColor: theme.bg, zIndex: 300, opacity: fadeAnim }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: 36 }}>
        <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 2.5, marginBottom: 22 }}>BURY THIS</Text>
        <Text numberOfLines={2} style={{ color: theme.textMain, fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginBottom: 10, textAlign: titleRtl ? 'right' : 'left', writingDirection: titleRtl ? 'rtl' : 'ltr' }}>{challenge.title}</Text>
        <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: '500', fontStyle: 'italic', lineHeight: 21, marginBottom: 28 }}>{msg.text}</Text>
        <View style={{ height: 3, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
          <View style={{ height: '100%', width: `${Math.max(2, pct)}%`, backgroundColor: theme.textSub, borderRadius: 2 }} />
        </View>
        <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>Reached {pct}% · {challenge.current}/{challenge.target} {challenge.unit}</Text>
        <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '500', opacity: 0.8, marginBottom: 44 }}>It moves to the graveyard. You can still find it there.</Text>
        <TouchableOpacity onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 200); onConfirm(); }} style={{ paddingVertical: 16, borderWidth: 1, borderColor: hexToRgba(L1_COLOR, 0.35), borderRadius: 12, alignItems: 'center', marginBottom: 14 }}><Text style={{ color: L1_COLOR, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 }}>Bury it</Text></TouchableOpacity>
        <TouchableOpacity onPress={onCancel} style={{ paddingVertical: 12, alignItems: 'center' }}><Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>Leave it</Text></TouchableOpacity>
      </SafeAreaView>
    </Animated.View>
  );
};

const AchievedModal = ({ visible, challenges, theme, insets, onClose, onMarkIncomplete, onMoveToTrash }: { visible: boolean; challenges: Challenge[]; theme: any; insets: { bottom: number }; onClose: () => void; onMarkIncomplete: (c: Challenge) => void; onMoveToTrash: (c: Challenge) => void; }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  // Local undo-confirmation target. Routed through the existing
  // SoftDeleteOverlay so the dialog visually matches the rest of the
  // tab's destructive-action confirmations (the prior version used
  // the platform Alert which felt out of place).
  const [undoTarget, setUndoTarget] = useState<Challenge | null>(null);
  const achieved = challenges.filter(c => c.deadState === 'achieved').sort((a, b) => (b.achievedAt || 0) - (a.achievedAt || 0));
  const isDark = theme.isDark;
  // Podium tints — gold / silver / bronze for the top 3 most-recent
  // achievements. Replaced the medal emoji 🥇🥈🥉 (which clashed with
  // the otherwise monochrome Feather-icon UI) with a circular badge
  // showing a colored "1/2/3" rank number — same visual hierarchy,
  // more-consistent typography.
  const PODIUM = ['#F59E0B', '#9CA3AF', '#CD7C2F'];
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 24, paddingBottom: 16 }}>
          <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 }}>Achieved</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="x" size={22} color={theme.textSub} /></TouchableOpacity>
        </View>
        {achieved.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Feather name="award" size={48} color={theme.textSub} style={{ marginBottom: 16, opacity: 0.3 }} /><Text style={{ color: theme.textSub, fontSize: 14, fontWeight: '700' }}>Nothing completed yet.</Text></View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 60) }} showsVerticalScrollIndicator={false}>
            {achieved.map((c, idx) => {
              const isExp = expanded === c.id;
              const ad = c.achievedAt ? new Date(c.achievedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
              return (<View key={c.id} style={{ marginBottom: 12 }}>
                <TouchableOpacity activeOpacity={0.85} onPress={() => setExpanded(isExp ? null : c.id)} style={{ padding: 20, borderRadius: 18, borderWidth: 1, borderColor: hexToRgba(c.color, 0.38), backgroundColor: theme.surface, borderLeftWidth: 3, borderLeftColor: c.color }}>
                  {idx < 3 && (
                    <View style={{ position: 'absolute', top: 16, right: 16, width: 22, height: 22, borderRadius: 11, backgroundColor: hexToRgba(PODIUM[idx], 0.15), borderWidth: 1, borderColor: hexToRgba(PODIUM[idx], 0.4), justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ fontSize: 11, fontWeight: '900', color: PODIUM[idx] }}>{idx + 1}</Text>
                    </View>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: hexToRgba(c.color, 0.12), justifyContent: 'center', alignItems: 'center' }}>
                      <Feather name="check" size={14} color={c.color} />
                    </View>
                    {/* Right padding reserves space under the podium
                        medal (top:16/right:16, 22 wide) on the top 3
                        cards. LTR titles already ellipsized before
                        hitting the medal because the truncation cuts
                        from the right; RTL titles start AT the right
                        edge of this container though, so the first
                        Persian character was sitting directly under
                        the medal. The padding pushes both directions
                        clear with no visible cost in LTR. */}
                    <View style={{ flex: 1, paddingRight: idx < 3 ? 30 : 0 }}>
                      <Text
                        style={{
                          color: theme.textMain, fontSize: 14, fontWeight: '900', letterSpacing: 0.2,
                          textAlign: isRtl(c.title) ? 'right' : 'left',
                          writingDirection: isRtl(c.title) ? 'rtl' : 'ltr',
                        }}
                        numberOfLines={1}
                      >
                        {c.title}{c.wasResurrected ? <Text style={{ color: theme.success, fontSize: 12 }}> †</Text> : null}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 8 }}><Text style={{ color: c.color, fontSize: 28, fontWeight: '900', letterSpacing: -1.5 }}>{c.current}</Text><Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600' }}>/{c.target} {c.unit}</Text></View>
                  <Text style={{ color: c.color, fontSize: 9, fontWeight: '900' }}>{ad ? 'COMPLETED ' + ad : 'COMPLETED'}</Text>
                </TouchableOpacity>
                {isExp && <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, paddingHorizontal: 2 }}>
                  {/* Edit button removed — editing a completed challenge
                      doesn't make sense from this list; the Dossier is a
                      record, not an editor. Undo is the only mutation
                      available, and it now confirms before applying. */}
                  <TouchableOpacity
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setUndoTarget(c); }}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 }}
                  >
                    <Feather name="rotate-ccw" size={12} color={theme.textSub} />
                    <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '800' }}>Undo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setExpanded(null); onMoveToTrash(c); }} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(244,63,94,0.3)', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 }}><Feather name="trash-2" size={12} color={L1_COLOR} /><Text style={{ color: L1_COLOR, fontSize: 11, fontWeight: '800' }}>Trash</Text></TouchableOpacity>
                </View>}
              </View>);
            })}
          </ScrollView>
        )}
        {/* Undo confirmation — same overlay pattern as Trash / Delete-
            Forever flows, kept inside AchievedModal so the achieved
            list stays visible behind the dim. */}
        <SoftDeleteOverlay
          visible={!!undoTarget}
          title={undoTarget?.title || ''}
          subtitle={undoTarget ? `Last log undone. Goes back to ${Math.max(0, (undoTarget.current || 0) - 1)} / ${undoTarget.target} ${undoTarget.unit}.` : undefined}
          confirmLabel="UNDO IT."
          cancelLabel="Keep it."
          onConfirm={() => {
            if (undoTarget) {
              setExpanded(null);
              const target = undoTarget;
              setUndoTarget(null);
              onMarkIncomplete(target);
            }
          }}
          onCancel={() => setUndoTarget(null)}
          theme={theme}
        />
      </SafeAreaView>
    </Modal>
  );
};

// Animated wrappers — module-level so they're not recreated per render.
// Driving the SVG circle and the count/percent text via Reanimated
// shared values runs the visual updates on the UI thread, completely
// bypassing React's render cycle. That's the only way to reliably show
// "tap +1, count goes up by 1" under spam-tap conditions: React 18's
// automatic batching coalesces fast successive state updates into one
// commit, so any visual driven by React state will occasionally jump
// by 2+ units. A shared value mutated synchronously on each tap snaps
// the visual immediately and the store update can sync at its own pace.
const ReanimatedCircle = Reanimated.createAnimatedComponent(Circle);
const ReanimatedTextInput = Reanimated.createAnimatedComponent(TextInput);

// ─── DETAIL VIEW SUB-COMPONENTS (memoized) ─────────────────────────────
// Extracted so the heavy static sections (30-day strip, milestones list,
// description) don't re-render on every +1 tap. The `current` field
// changes each tick which forces the parent ChallengeDetailView to
// re-render, but these sub-trees only depend on data that stays stable
// across taps. Without these, spam-tapping the LOG button stacked
// commits and visually "merged" two taps into one (+2) because each
// render's commit ran past the next tap's arrival.

type LogCell = { str: string; logged: boolean; isToday: boolean };

const DetailLogStrip = React.memo(({ last30, color, theme, loggedCount }: {
  last30: LogCell[]; color: string; theme: any; loggedCount: number;
}) => (
  <View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }}>
        LAST 30 DAYS
      </Text>
      <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '700', opacity: 0.6 }}>
        {loggedCount} logged
      </Text>
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      {last30.map(cell => (
        <View
          key={cell.str}
          style={{
            flex: 1,
            aspectRatio: 0.5,
            marginHorizontal: 1,
            borderRadius: 3,
            backgroundColor: cell.logged ? color : 'transparent',
            borderColor: cell.isToday && !cell.logged ? theme.textMain : theme.border,
            borderWidth: cell.logged ? 0 : (cell.isToday ? 1.5 : 1),
          }}
        />
      ))}
    </View>
  </View>
));

const DetailDescription = React.memo(({ description, theme }: {
  description: string; theme: any;
}) => {
  if (!description.trim()) return null;
  const rtl = isRtl(description);
  return (
    <View>
      <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }}>
        DESCRIPTION
      </Text>
      <Text
        style={{
          color: theme.textMain, fontSize: 15, lineHeight: 23, fontWeight: '500',
          textAlign: rtl ? 'right' : 'left',
          writingDirection: rtl ? 'rtl' : 'ltr',
        }}
      >
        {description}
      </Text>
    </View>
  );
});

const DetailMilestones = React.memo(({ milestones, color, theme, onToggle }: {
  milestones: Milestone[]; color: string; theme: any; onToggle: (id: string) => void;
}) => {
  if (!milestones || milestones.length === 0) return null;
  return (
    <View>
      <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }}>
        MILESTONES
      </Text>
      {milestones.map((m, idx) => {
        const mRtl = isRtl(m.text);
        const isLast = idx === milestones.length - 1;
        return (
          <TouchableOpacity
            key={m.id}
            onPress={() => onToggle(m.id)}
            style={{ flexDirection: mRtl ? 'row-reverse' : 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: theme.border }}
            activeOpacity={0.7}
          >
            <View style={{
              width: 20, height: 20,
              borderRadius: 6,
              borderWidth: 2,
              borderColor: m.completed ? color : theme.border,
              backgroundColor: m.completed ? color : 'transparent',
              justifyContent: 'center', alignItems: 'center',
              marginRight: mRtl ? 0 : 14,
              marginLeft: mRtl ? 14 : 0,
            }}>
              {m.completed && <Feather name="check" size={11} color="#FFF" />}
            </View>
            <Text style={{
              color: m.completed ? theme.textSub : theme.textMain,
              fontSize: 15, fontWeight: '500', flex: 1,
              textDecorationLine: m.completed ? 'line-through' : 'none',
              textAlign: mRtl ? 'right' : 'left',
              writingDirection: mRtl ? 'rtl' : 'ltr',
            }}>
              {m.text}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

// Source tags for non-manual ledger entries. Manual/bulk logs are the user's
// own taps, so they read plain (no tag); habit + deep-work advances earn a
// quiet label so the history shows where the progress came from.
const LEDGER_SOURCE_LABEL: Record<LedgerSource, string> = { manual: '', bulk: '', habit: 'Habit', deepwork: 'Deep work' };

const DetailLedger = React.memo(({ ledger, theme, calSystem, color }: {
  ledger: LedgerEntry[]; theme: any; calSystem: CalendarSystem; color: string;
}) => {
  const entries = useMemo(() => [...(ledger || [])].sort((a, b) => b.ts - a.ts), [ledger]);
  if (entries.length === 0) return null;
  const MAX = 20;
  const shown = entries.slice(0, MAX);
  const hidden = entries.length - shown.length;
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }}>HISTORY</Text>
        <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '700', opacity: 0.6 }}>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </Text>
      </View>
      {shown.map((e, i) => {
        const positive = e.delta >= 0;
        const srcLabel = LEDGER_SOURCE_LABEL[e.source];
        return (
          <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: i === shown.length - 1 ? 0 : 1, borderBottomColor: theme.border }}>
            <Text style={{ color: positive ? color : theme.textSub, fontSize: 15, fontWeight: '900', minWidth: 40 }}>
              {positive ? '+' : ''}{e.delta}
            </Text>
            <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '600', flex: 1 }}>
              {formatLedgerStamp(e.ts, calSystem)}
            </Text>
            {srcLabel ? (
              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, opacity: 0.7 }}>{srcLabel}</Text>
            ) : null}
          </View>
        );
      })}
      {hidden > 0 ? (
        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600', opacity: 0.5, marginTop: 10 }}>+{hidden} earlier</Text>
      ) : null}
    </View>
  );
});

// ─── CHALLENGE DETAIL VIEW ──────────────────────────────────────────────
// Full-screen surface for a single challenge. Mirrors the Notes-tab
// reader pattern: chevron-back + Edit button at top, ScrollView body
// underneath. Shows the ring + meta header, ±1 LOG controls, a 30-day
// log strip, description, milestones, and dated notes (add here, edit
// recent ones, but remove only via the add/edit sheet).
const ChallengeDetailView = ({
  challenge, theme, calSystem, insets, onClose, onEdit, onProgress,
  onCustomLog, onToggleMilestone, onAddNote, onEditNote, onRemoveNote,
}: {
  challenge: Challenge | null;
  theme: any;
  calSystem: CalendarSystem;
  insets: { bottom: number };
  onClose: () => void;
  onEdit: () => void;
  onProgress: (delta: number) => void;
  onCustomLog: () => void;
  onToggleMilestone: (milestoneId: string) => void;
  onAddNote: (text: string) => void;
  onEditNote: (noteId: string, newText: string) => void;
  onRemoveNote: (noteId: string) => void;
}) => {
  const [newNote, setNewNote] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Reset transient state when the user opens a different challenge,
  // closes the view, or the challenge is unmounted by the parent.
  useEffect(() => {
    setNewNote('');
    setEditingNoteId(null);
    setEditingText('');
  }, [challenge?.id]);

  // ── Optimistic shared value ───────────────────────────────────────────
  // Drives the count text, percent text, and ring's strokeDashoffset on
  // the UI thread. Mutated synchronously in handlePlus/handleMinus so
  // every tap visually advances by one regardless of React's batching.
  //
  // Resync rule: ONLY on challenge.id change (i.e., a different
  // challenge opens). Watching challenge.current would clobber our
  // optimistic mutations every time the store catches up — under
  // batching, the committed `current` lags behind sharedCount.value,
  // so the effect would reset the visual to a stale value.
  const ringSize = 132;
  const ringStroke = 10;
  const ringRadius = (ringSize - ringStroke) / 2;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const sharedCount = useSharedValue(challenge?.current ?? 0);
  // What we expect challenge.current to settle to once every committed
  // tap has flushed. Bumped synchronously in onTapCommit/handleMinus —
  // NOT in the worklet — so it always reflects taps that have crossed
  // back to the JS thread, regardless of whether the 60ms flush has
  // fired yet. The resync effect compares against this instead of
  // sharedCount.value to tell our own pending writes apart from
  // external mutations.
  const expectedCurrentRef = useRef(challenge?.current ?? 0);
  // Resync when a different challenge opens.
  useEffect(() => {
    if (challenge) {
      sharedCount.value = challenge.current;
      expectedCurrentRef.current = challenge.current;
    }
  }, [challenge?.id, sharedCount]);
  // External-change resync. Only fires when challenge.current diverges
  // from what our committed taps expect — i.e. the bulk custom-log
  // modal or another component mutated the store. Our own onProgress
  // flushes land at challenge.current === expectedCurrentRef.current
  // and are skipped here, so the optimistic sharedCount.value never
  // gets pulled backward by a stale store value showing up between a
  // worklet bump and its runOnJS commit (the cause of the visible
  // "+1, -1" jump under spam-tap).
  useEffect(() => {
    if (!challenge) return;
    if (challenge.current === expectedCurrentRef.current) return;
    expectedCurrentRef.current = challenge.current;
    sharedCount.value = challenge.current;
  }, [challenge?.current, sharedCount]);

  const target = challenge?.target ?? 1;
  const color = challenge?.color ?? '#10B981';
  const ringAnimProps = useAnimatedProps(() => {
    const p = Math.min(1, Math.max(0, sharedCount.value / target));
    return { strokeDashoffset: ringCircumference * (1 - p) } as any;
  }, [target, ringCircumference]);
  // defaultValue must be dynamic so the FIRST render shows the actual
  // count (not literal '0' — that was the regression that made the
  // detail view flash 0% / 0/X on open).
  const countAnimProps = useAnimatedProps(() => {
    const v = String(Math.round(sharedCount.value));
    return { text: v, defaultValue: v } as any;
  });
  const percentAnimProps = useAnimatedProps(() => {
    const p = String(Math.round((sharedCount.value / target) * 100));
    return { text: p, defaultValue: p } as any;
  }, [target]);

  // Spam-resilience: each tap mutates the Reanimated shared value
  // synchronously (visual is instant) and accumulates a pending delta.
  // The actual store commit is deferred to a 60 ms idle window so a
  // burst of taps becomes ONE updateProgress call instead of N.
  //
  // updateProgress is heavy — it walks intents, checks dead-state
  // transitions, runs achievement detection, and persists. Calling it
  // per-tap was blocking the JS thread enough to drop ~half of rapid
  // touches. Batching keeps the JS thread free for the touch system.
  // Per-tap haptic still fires in handlePlus/handleMinus directly so
  // the user feels every tap regardless of when the store catches up.
  const pendingDeltaRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushNow = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const delta = pendingDeltaRef.current;
    pendingDeltaRef.current = 0;
    if (delta !== 0) onProgress(delta);
  }, [onProgress]);
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(flushNow, 60);
  }, [flushNow]);

  // The minus button stays on JS-thread / TouchableOpacity since it
  // isn't spam-tapped — single discrete decrements. Same accumulate +
  // schedule-flush pattern as the tap gesture's commit path.
  const handleMinus = useCallback(() => {
    if (!challenge) return;
    if (sharedCount.value <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sharedCount.value = sharedCount.value - 1;
    pendingDeltaRef.current -= 1;
    expectedCurrentRef.current -= 1;
    scheduleFlush();
  }, [scheduleFlush, sharedCount]);

  // ── +1 LOG button: native Tap + LongPress (gesture-handler) ──────────
  //
  // Every previous attempt to fix spam-tap drops kept the recognition
  // logic on the JS thread (TouchableOpacity → Pressable → raw
  // responder API). They all leak ~half the taps under a fast burst
  // because RN's JS responder system has to arbitrate every touch
  // against the parent ScrollView's pan recognizer, and that round-
  // trip falls behind under load — the ScrollView claims/terminates
  // every other touch (see facebook/react-native#36710, #27355).
  //
  // The fix is to push recognition to the native gesture system via
  // react-native-gesture-handler. Gesture.Tap runs activation entirely
  // on the UI thread, with no per-touch JS round-trip; bursts at 10+
  // Hz register cleanly. The ScrollView around us also has to be the
  // gesture-handler ScrollView (GHScrollView) so the two recognizers
  // negotiate natively instead of via the JS responder.
  //
  //   Tap       maxDistance(10)  — slide off > 10px → cancel, no commit
  //   Tap       maxDuration(350) — held longer → falls through to LongPress
  //   LongPress minDuration(350) — fires onCustomLog
  //   Exclusive — long-press wins if held; otherwise tap commits at release
  //
  // The shared value is bumped on the UI thread inside the worklet so
  // the visual updates instantly. runOnJS schedules the haptic +
  // pending-delta accumulation + flush on the JS side; that work no
  // longer gates the recognizer.
  const onTapCommit = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pendingDeltaRef.current += 1;
    expectedCurrentRef.current += 1;
    scheduleFlush();
  }, [scheduleFlush]);
  const onLongPress = useCallback(() => {
    // Commit any pending taps before opening the modal — the modal
    // reads the current count from the store, so it'd see a stale
    // value if we left a batch un-flushed.
    flushNow();
    onCustomLog();
  }, [flushNow, onCustomLog]);
  const tapGesture = useMemo(() =>
    Gesture.Tap()
      .maxDuration(350)
      .maxDistance(10)
      .numberOfTaps(1)
      .onEnd((_e, success) => {
        'worklet';
        if (!success) return;
        if (sharedCount.value >= target) return;
        sharedCount.value = sharedCount.value + 1;
        runOnJS(onTapCommit)();
      }),
    [target, sharedCount, onTapCommit]
  );
  const longPressGesture = useMemo(() =>
    Gesture.LongPress()
      .minDuration(350)
      .maxDistance(10)
      .onStart(() => {
        'worklet';
        runOnJS(onLongPress)();
      }),
    [onLongPress]
  );
  const composedGesture = useMemo(
    () => Gesture.Exclusive(longPressGesture, tapGesture),
    [longPressGesture, tapGesture]
  );

  useEffect(() => () => {
    // Flush any pending batched delta on unmount so taps captured in
    // the last 60 ms window aren't lost when the user dismisses the
    // view.
    flushNow();
  }, [flushNow]);

  // 30-day log strip + notes — memoized ABOVE the early return so the hook
  // order never changes between renders (challenge is null only before the
  // detail sheet has a selection). Null-safe so they're inert when empty.
  const logDates = challenge?.logDates || [];
  const last30 = useMemo(() => {
    const result: { str: string; logged: boolean; isToday: boolean }[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const set = new Set(logDates);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      result.push({ str, logged: set.has(str), isToday: i === 0 });
    }
    return result;
  }, [logDates]);
  const loggedInLast30 = useMemo(
    () => last30.reduce((n, c) => n + (c.logged ? 1 : 0), 0),
    [last30]
  );
  const notes = useMemo(
    () => (challenge?.noteEntries || []).slice().sort((a, b) => b.createdAt - a.createdAt),
    [challenge?.noteEntries]
  );

  if (!challenge) return null;

  const isDark = theme.isDark;
  const progress = Math.min(1, challenge.current / challenge.target);
  const isDone = challenge.current >= challenge.target;
  const percent = Math.round(progress * 100);
  const pace = computePace(challenge, theme);

  // Deadline label — same logic as the card; sentence case, calendar-aware.
  const deadlineLabel = (() => {
    if (!challenge.deadlineTs) return 'No deadline';
    const days = Math.ceil((challenge.deadlineTs - Date.now()) / 86400000);
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days <= 14) return `${days} days left`;
    const dt = new Date(challenge.deadlineTs);
    if (calSystem === 'shamsi') {
      const s = getShamsiDateParts(dt);
      return `${SHAMSI_MONTHS[s.month - 1]} ${s.day}`;
    }
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  })();

  // Note edit window — entries older than this become read-only, so the journal
  // log reads like a record rather than a scratchpad. (last30 / loggedInLast30 /
  // notes are memoized above the early return so the hook order stays stable.)
  const NOTE_EDIT_WINDOW_MS = 3 * 86400000;

  const startEdit = (noteId: string, text: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingNoteId(noteId);
    setEditingText(text);
  };
  const cancelEdit = () => {
    setEditingNoteId(null);
    setEditingText('');
  };
  const saveEdit = () => {
    if (!editingNoteId || !editingText.trim()) { cancelEdit(); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onEditNote(editingNoteId, editingText.trim());
    cancelEdit();
  };
  const submitNew = () => {
    if (!newNote.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onAddNote(newNote.trim());
    setNewNote('');
  };

  // Card Stack — recessed page bg, each section sits on its own
  // surface card. The hero card uses the "underline" treatment: title
  // gets a short 3px color rule below it, tying it to the ring's color
  // without painting any chrome. This is the design picked from the
  // art-tab sandbox after iterating through frames, glows, washes, and
  // brand-colored cards — typographic accent beat all of those.
  const pageBg = isDark ? '#050505' : '#EFEFF1';
  const cardStyle = {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1, borderColor: theme.border,
    padding: 22, marginBottom: 14,
    overflow: 'hidden' as const,
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {/* GestureHandlerRootView is required INSIDE the Modal — RN
          Modals render in a separate native window on iOS, outside
          the screen-level root view, so gestures (Gesture.Tap on the
          LOG button) wouldn't fire without their own root here. */}
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: pageBg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

          {/* Header — back chevron on left, Edit pill on right. No
              bottom border now: the recessed page bg + floating cards
              already provide the visual separation. */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 }}>
            <TouchableOpacity onPress={onClose} hitSlop={15} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Feather name="chevron-left" size={22} color={theme.textMain} />
              <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: '700' }}>Challenges</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onEdit} style={{ backgroundColor: theme.surface, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100, borderWidth: 1, borderColor: theme.border }}>
              <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 13 }}>Edit</Text>
            </TouchableOpacity>
          </View>

          {/* KeyboardAvoidingView + persist-on-tap so the Add-note input
              and edit textareas stay reachable when the keyboard is up,
              dragging the scroll never closes the keyboard, and an
              explicit tap on empty content does. */}
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          {/* Gesture-handler ScrollView — the +1 LOG button uses
              Gesture.Tap, which only negotiates cleanly with the
              native gesture system. Plain RN ScrollView would still
              steal touches via the JS responder under spam. */}
          <GHScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 24) + 80 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
          >
            {/* Hero card — ring + count driven by a Reanimated shared
                value so they update on the UI thread, immediately, on
                every tap. React state-based numerals would batch under
                spam-tap and visually merge two taps into +2. The
                action row lives inside the same card so the press
                target is anchored to the same surface as the count. */}
            <View style={cardStyle}>
              <View style={{ alignItems: 'center', paddingTop: 8 }}>
                <View style={{ width: ringSize, height: ringSize, justifyContent: 'center', alignItems: 'center' }}>
                  <Svg width={ringSize} height={ringSize} style={{ transform: [{ rotate: '-90deg' }] }}>
                    <Circle cx={ringSize / 2} cy={ringSize / 2} r={ringRadius}
                      stroke={theme.border} strokeWidth={ringStroke} fill="none"
                    />
                    <ReanimatedCircle cx={ringSize / 2} cy={ringSize / 2} r={ringRadius}
                      stroke={color} strokeWidth={ringStroke} fill="none"
                      strokeDasharray={`${ringCircumference}`}
                      strokeLinecap="round"
                      animatedProps={ringAnimProps}
                    />
                  </Svg>
                  <View style={{ position: 'absolute', alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                      <ReanimatedTextInput
                        editable={false}
                        defaultValue={String(percent)}
                        animatedProps={percentAnimProps}
                        style={{ color: theme.textMain, fontSize: 36, fontWeight: '800', letterSpacing: -1.5, padding: 0, textAlign: 'center', minWidth: 60 }}
                      />
                      <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: '700', marginLeft: 2 }}>%</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 2 }}>
                      <ReanimatedTextInput
                        editable={false}
                        defaultValue={String(challenge.current)}
                        animatedProps={countAnimProps}
                        style={{ color: theme.textSub, fontSize: 11, fontWeight: '600', padding: 0, textAlign: 'center', minWidth: 24 }}
                      />
                      <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600' }}> / {challenge.target}</Text>
                    </View>
                  </View>
                </View>
                {/* Title — given an explicit full width and 2 line cap.
                    Without `width: '100%'` the parent's alignItems:center
                    shrinks the Text container around its longest measured
                    word, which truncates Persian and other RTL strings
                    even at small lengths. */}
                <Text
                  style={{
                    color: theme.textMain, fontSize: 22, fontWeight: '700',
                    letterSpacing: -0.5, marginTop: 18, textAlign: 'center',
                    width: '100%',
                    writingDirection: isRtl(challenge.title) ? 'rtl' : 'ltr',
                  }}
                  numberOfLines={2}
                >
                  {challenge.title}
                </Text>
                {/* Underline — the 3e treatment. A short 3px rule in
                    the challenge color, sitting between the title and
                    the meta. Pulls color into the typography without
                    painting frames around the card. */}
                <View style={{ height: 3, width: 36, backgroundColor: challenge.color, borderRadius: 2, marginTop: 10 }} />
                <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '500', marginTop: 8 }}>
                  {deadlineLabel}
                </Text>
                <Text style={{ color: pace.color, fontSize: 12, fontWeight: '600', marginTop: 6 }}>
                  {pace.text}
                </Text>
              </View>

              {/* Action — same ±1 / LOG ONE row, now anchored inside
                  the hero card. */}
              {isDone ? (
                <View style={{
                  height: 54, borderRadius: 14,
                  backgroundColor: hexToRgba(challenge.color, 0.12),
                  borderWidth: 1, borderColor: hexToRgba(challenge.color, 0.35),
                  justifyContent: 'center', alignItems: 'center',
                  flexDirection: 'row', gap: 8, marginTop: 22,
                }}>
                  <Feather name="check" size={16} color={challenge.color} />
                  <Text style={{ color: challenge.color, fontSize: 13, fontWeight: '700', letterSpacing: 1.5 }}>COMPLETE</Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
                  <TouchableOpacity
                    onPress={handleMinus}
                    disabled={challenge.current === 0}
                    activeOpacity={0.85}
                    style={{ width: 60, height: 54, borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, justifyContent: 'center', alignItems: 'center', opacity: challenge.current === 0 ? 0.4 : 1 }}
                  >
                    <Feather name="minus" size={20} color={theme.textMain} />
                  </TouchableOpacity>
                  {/* +1 LOG — wrapped in GestureDetector so tap and
                      long-press are recognized natively on the UI
                      thread. See the gesture composition above for
                      the full rationale and behavior matrix. */}
                  <GestureDetector gesture={composedGesture}>
                    <View
                      style={{
                        flex: 1, height: 54, borderRadius: 14,
                        backgroundColor: challenge.color,
                        justifyContent: 'center', alignItems: 'center',
                        flexDirection: 'row', gap: 10,
                      }}
                    >
                      <Feather name="plus" size={20} color="#FFF" />
                      <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '700', letterSpacing: 1.5 }}>LOG ONE</Text>
                    </View>
                  </GestureDetector>
                </View>
              )}
            </View>

            {/* 30-day log strip — extracted into a memoized component
                that only re-renders when its data changes. Per-tap
                challenge.current updates leave its props identical, so
                React.memo's shallow check skips the whole 30-cell map. */}
            <View style={cardStyle}>
              <DetailLogStrip last30={last30} color={challenge.color} theme={theme} loggedCount={loggedInLast30} />
            </View>

            {challenge.description && challenge.description.trim() ? (
              <View style={cardStyle}>
                <DetailDescription description={challenge.description || ''} theme={theme} />
              </View>
            ) : null}

            {challenge.milestones && challenge.milestones.length > 0 ? (
              <View style={cardStyle}>
                <DetailMilestones milestones={challenge.milestones || []} color={challenge.color} theme={theme} onToggle={onToggleMilestone} />
              </View>
            ) : null}

            {/* History ledger — every logged event with its amount + time.
                Hidden until there's at least one entry. */}
            {challenge.ledger && challenge.ledger.length > 0 ? (
              <View style={cardStyle}>
                <DetailLedger ledger={challenge.ledger} theme={theme} calSystem={calSystem} color={challenge.color} />
              </View>
            ) : null}

            {/* Notes — dated journal entries. Adding happens here; the
                ×-remove control is intentionally only on the edit sheet
                so this surface stays focused on writing. Entries are
                editable for 3 days after creation; older ones turn
                read-only so the log reads as a record. */}
            <View style={cardStyle}>
              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 12 }}>
                NOTES
              </Text>
              {notes.length > 0 ? notes.map(entry => {
                const isEditing = editingNoteId === entry.id;
                const isEditable = Date.now() - entry.createdAt < NOTE_EDIT_WINDOW_MS;
                return (
                  <View key={entry.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 }}>
                        {formatNoteDate(entry.createdAt, calSystem)}
                      </Text>
                      {!isEditing ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                          {isEditable ? (
                            <TouchableOpacity onPress={() => startEdit(entry.id, entry.text)} hitSlop={10}>
                              <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700' }}>Edit</Text>
                            </TouchableOpacity>
                          ) : (
                            <Feather name="lock" size={11} color={theme.textSub} style={{ opacity: 0.4 }} />
                          )}
                          {/* Remove — moved here from the edit sheet, which
                              no longer exposes notes at all. Tap deletes
                              the entry; no confirmation since the parent
                              keeps the noteEntries array on the challenge
                              and this is reversible until next save. */}
                          <TouchableOpacity
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              onRemoveNote(entry.id);
                            }}
                            hitSlop={10}
                          >
                            <Feather name="x" size={13} color={theme.textSub} />
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                    {isEditing ? (
                      <View>
                        <TextInput
                          value={editingText}
                          onChangeText={setEditingText}
                          multiline
                          autoFocus
                          style={{
                            color: theme.textMain,
                            fontSize: 15, fontWeight: '500', lineHeight: 22,
                            paddingVertical: 8, paddingHorizontal: 0,
                            minHeight: 60, textAlignVertical: 'top',
                            textAlign: isRtl(editingText) ? 'right' : 'left',
                            writingDirection: isRtl(editingText) ? 'rtl' : 'ltr',
                          }}
                        />
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
                          <TouchableOpacity onPress={cancelEdit} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.border }}>
                            <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={saveEdit} disabled={!editingText.trim()} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: editingText.trim() ? theme.textMain : theme.border }}>
                            <Text style={{ color: editingText.trim() ? theme.bg : theme.textSub, fontSize: 12, fontWeight: '700' }}>Save</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <Text
                        style={{
                          color: theme.textMain, fontSize: 15, fontWeight: '500', lineHeight: 22,
                          textAlign: isRtl(entry.text) ? 'right' : 'left',
                          writingDirection: isRtl(entry.text) ? 'rtl' : 'ltr',
                        }}
                      >
                        {entry.text}
                      </Text>
                    )}
                  </View>
                );
              }) : (
                <Text style={{ color: theme.textSub, fontSize: 13, fontStyle: 'italic', opacity: 0.6, marginBottom: 12 }}>
                  No notes yet.
                </Text>
              )}

              {/* Add input — paragraph-weight, hairline border, plus
                  a circular Add button. Same shape as the inline note
                  composer in the edit sheet so the user encounters one
                  consistent gesture. */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 14 }}>
                <TextInput
                  value={newNote}
                  onChangeText={setNewNote}
                  multiline
                  placeholder={notes.length === 0 ? 'Why this matters. From you to you.' : 'Add a note for today…'}
                  placeholderTextColor={theme.border}
                  style={{
                    color: theme.textMain,
                    fontSize: 15, fontWeight: '500', lineHeight: 22,
                    paddingVertical: 10, paddingHorizontal: 0,
                    minHeight: 44, textAlignVertical: 'top',
                    flex: 1,
                    borderBottomWidth: 1, borderBottomColor: theme.border,
                    textAlign: isRtl(newNote) ? 'right' : 'left',
                    writingDirection: isRtl(newNote) ? 'rtl' : 'ltr',
                  }}
                />
                <TouchableOpacity
                  onPress={submitNew}
                  disabled={!newNote.trim()}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: newNote.trim() ? theme.textMain : theme.border, justifyContent: 'center', alignItems: 'center', marginBottom: 6 }}
                >
                  <Feather name="plus" size={16} color={newNote.trim() ? theme.bg : theme.textSub} />
                </TouchableOpacity>
              </View>
            </View>
          </GHScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
};


// The React.memo'd cards above are anonymous arrows; give them display names
// (React DevTools + react/display-name).
ActivityRingCard.displayName = 'ActivityRingCard';
RosterCard.displayName = 'RosterCard';
DetailLogStrip.displayName = 'DetailLogStrip';
DetailDescription.displayName = 'DetailDescription';
DetailMilestones.displayName = 'DetailMilestones';
DetailLedger.displayName = 'DetailLedger';

// ── THE LEDGER ──────────────────────────────────────────────────────────────
// Rewards to claim, punishments to pay. Reads/writes the store; stakes are
// auto-collected from won/buried challenges (see ChallengesScreen) and added by
// hand. Empty sections hide; the header entry hides entirely when it's empty.
const LEDGER_REWARD = '#F59E0B';
const LEDGER_PUNISH = '#F43F5E';

const LEDGER_VOID = '#10B981';  // a punishment forgiven (came back and won)
const LedgerRow = ({ item, theme, note, voided, onToggle, onRemove }: { item: Stake; theme: any; note?: string; voided?: boolean; onToggle: () => void; onRemove: () => void }) => {
  const color = item.kind === 'reward' ? LEDGER_REWARD : LEDGER_PUNISH;
  const settled = item.done || !!voided;
  const mark = voided ? LEDGER_VOID : color;
  return (
    <Reanimated.View entering={FadeInDown.duration(220)} exiting={FadeOut.duration(150)} layout={LinearTransition.springify().damping(20)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 }}>
      <TouchableOpacity onPress={onToggle} disabled={!!voided} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.7}
        style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: mark, backgroundColor: settled ? mark : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {settled ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: settled ? theme.textSub : theme.textMain, textDecorationLine: settled ? 'line-through' : 'none' }}>{item.text}</Text>
        {note ? <Text style={{ fontSize: 11, fontWeight: '600', fontStyle: 'italic', color: voided ? LEDGER_VOID : theme.textSub, marginTop: 2 }}>{note}</Text> : null}
      </View>
      {item.done && !voided ? <Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 1.5, color }}>{item.kind === 'reward' ? 'CLAIMED' : 'PAID'}</Text> : null}
      <TouchableOpacity onPress={onRemove} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} activeOpacity={0.6}>
        <Feather name="x" size={16} color={theme.textSub} />
      </TouchableOpacity>
    </Reanimated.View>
  );
};

const LedgerModal = ({ visible, theme, insets, onClose }: { visible: boolean; theme: any; insets: { bottom: number }; onClose: () => void }) => {
  const stakes = useAppStore(s => s.stakes);
  const addStake = useAppStore(s => s.addStake);
  const toggleStake = useAppStore(s => s.toggleStake);
  const removeStake = useAppStore(s => s.removeStake);
  const challenges = useAppStore(s => s.challenges) as Challenge[];
  const [kind, setKind] = useState<StakeKind>('reward');
  const [text, setText] = useState('');
  // The footer's safe-area paddingBottom (home-indicator clearance) would stack on
  // top of the keyboard lift, leaving the add-bar floating ~34px above the keyboard.
  // Collapse it toward a flush gap as the keyboard rises (progress 0→1), so the bar
  // sits right on the keyboard top. Same pattern as todo.tsx's sheetBottomPadStyle.
  const restPadBottom = Math.max(insets.bottom, 16);
  const kbAnim = useReanimatedKeyboardAnimation();
  const footerPadStyle = useAnimatedStyle(() => ({
    paddingBottom: restPadBottom - (restPadBottom - 10) * kbAnim.progress.value,
  }));
  const bySettled = (a: Stake, b: Stake) => (a.done ? 1 : 0) - (b.done ? 1 : 0);
  const rewards = stakes.filter(s => s.kind === 'reward').sort(bySettled);
  const punishments = stakes.filter(s => s.kind === 'punishment').sort(bySettled);
  const empty = stakes.length === 0;
  const allSettled = !empty && stakes.every(s => s.done);
  const add = () => { if (!text.trim()) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); addStake(kind, text); setText(''); };
  const onToggle = (id: string) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); toggleStake(id); };

  // A punishment carries its source challenge's fate: resurrected & ongoing →
  // "on trial"; came back and won → voided (no punishment owed).
  const punishNote = (stake: Stake): { note: string; voided: boolean } | null => {
    if (!stake.sourceId) return null;
    const ch = challenges.find(c => c.id === stake.sourceId);
    if (!ch) return null;
    if (ch.deadState === 'achieved') return { note: 'Came back — no punishment owed.', voided: true };
    if (ch.deadState === 'active' && ch.resurrectedBefore) return { note: 'On trial — resurrected, not yet settled.', voided: false };
    return null;
  };

  const section = (title: string, sub: string, color: string, items: Stake[]) => {
    if (!items.length) return null;
    const left = items.filter(i => !i.done).length;
    return (
      <Reanimated.View layout={LinearTransition.springify().damping(20)} style={{ marginBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14, marginBottom: 2 }}>
          <Feather name={title === 'REWARDS' ? 'gift' : 'alert-triangle'} size={12} color={color} />
          <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1.5, color: theme.textMain }}>{title}</Text>
          <Text style={{ fontSize: 10, fontWeight: '700', color: theme.textSub }}>· {left ? `${left} ${sub}` : 'all settled'}</Text>
        </View>
        {items.map(it => {
          const n = it.kind === 'punishment' ? punishNote(it) : null;
          return <LedgerRow key={it.id} item={it} theme={theme} note={n?.note} voided={n?.voided} onToggle={() => onToggle(it.id)} onRemove={() => removeStake(it.id)} />;
        })}
      </Reanimated.View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>
        <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontSize: 30, fontWeight: '900', letterSpacing: -1, color: theme.textMain }}>The Ledger</Text>
              <Text style={{ fontSize: 13, fontWeight: '500', color: theme.textSub, marginTop: 4 }}>Promises to keep, and debts to pay.</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
              <Feather name="x" size={26} color={theme.textMain} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {empty ? (
              <View style={{ alignItems: 'center', paddingVertical: 72 }}>
                <Text style={{ fontSize: 18, fontWeight: '800', color: theme.textMain }}>The slate is clean.</Text>
                <Text style={{ fontSize: 13, color: theme.textSub, marginTop: 6 }}>Set a stake below.</Text>
              </View>
            ) : (
              <>
                {section('REWARDS', 'to claim', LEDGER_REWARD, rewards)}
                {section('PUNISHMENTS', 'to pay', LEDGER_PUNISH, punishments)}
                {allSettled ? <Text style={{ fontSize: 12, fontWeight: '700', fontStyle: 'italic', color: theme.textSub, textAlign: 'center', marginTop: 20 }}>Every debt paid, every prize claimed.</Text> : null}
              </>
            )}
          </ScrollView>
          <Reanimated.View style={[{ paddingHorizontal: 24, paddingTop: 14, borderTopWidth: 1, borderColor: theme.border, gap: 10 }, footerPadStyle]}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['reward', 'punishment'] as StakeKind[]).map(k => {
                const active = kind === k;
                const c = k === 'reward' ? LEDGER_REWARD : LEDGER_PUNISH;
                return (
                  <TouchableOpacity key={k} onPress={() => setKind(k)} activeOpacity={0.8}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5, borderColor: active ? c : theme.border, backgroundColor: active ? hexToRgba(c, 0.14) : 'transparent' }}>
                    <Feather name={k === 'reward' ? 'gift' : 'alert-triangle'} size={13} color={active ? c : theme.textSub} />
                    <Text style={{ fontSize: 12, fontWeight: '800', color: active ? c : theme.textSub }}>{k === 'reward' ? 'Reward' : 'Punishment'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TextInput value={text} onChangeText={setText} onSubmitEditing={add} returnKeyType="done"
                placeholder={kind === 'reward' ? 'A reward worth earning…' : 'A debt worth avoiding…'} placeholderTextColor={theme.textSub}
                style={{ flex: 1, fontSize: 15, fontWeight: '600', color: theme.textMain, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 12 }} />
              <TouchableOpacity onPress={add} activeOpacity={0.85} disabled={!text.trim()}
                style={{ width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: text.trim() ? (kind === 'reward' ? LEDGER_REWARD : LEDGER_PUNISH) : theme.border }}>
                <Feather name="plus" size={22} color={text.trim() ? '#FFFFFF' : theme.textSub} />
              </TouchableOpacity>
            </View>
          </Reanimated.View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

// ─── MAIN SCREEN ───
export default function ChallengesScreen() {
  const insets = useSafeAreaInsets();

  // Clean store selectors — no more (s as any) casts
  const isDarkMode = useAppStore(s => s.isDarkMode);
  const themeMode = useAppStore(s => s.themeMode);
  const calSystem = useAppStore(s => s.calendarType) as CalendarSystem;
  const toggleCalendar = useAppStore(s => s.toggleCalendar);
  const allHabits = useAppStore(s => s.habits) as Habit[];
  const challenges = useAppStore(s => s.challenges) as Challenge[];
  const setChallenges = useAppStore(s => s.setChallenges);
  const achievements = useAppStore(s => s.achievements) as Achievement[];
  const setAchievements = useAppStore(s => s.setAchievements);

  // ── First-open seed control ──────────────────────────────────────────
  // We DON'T seed demo challenges anymore — the empty state below leads
  // the user to either Build their own or Start from a preset, which is
  // both more honest and avoids the old bug where deleting the seeded
  // trio just respawned them on next mount.
  //
  // The `challengesSeeded` flag still gets stamped here so any future
  // seed logic (e.g. one auto-suggested onboarding challenge) only fires
  // on a truly-fresh install, never on a user who has actively cleared
  // their list.
  const challengesSeeded = useAppStore(s => s.challengesSeeded);
  const setChallengesSeeded = useAppStore(s => s.setChallengesSeeded);
  useEffect(() => {
    if (!challengesSeeded) setChallengesSeeded(true);
  }, [challengesSeeded, setChallengesSeeded]);

  // (DEV usage-simulation seed removed for ship — the tab starts empty.)

  // ── Challenge deadline notifications ──────────────────────────────────────
  // Full resync (cancel + reschedule) whenever any live deadline meaningfully
  // changes. The signature folds in id / deadline / state / done-ness / whether
  // a consequence exists, so create, edit, resurrect, bury, trash, complete, or
  // editing the stake all retrigger it — and nothing else does (a +1 tap that
  // doesn't cross a boundary leaves the signature unchanged). See
  // lib/challengeNotifications.ts for the schedule (T-3d / T-1d / expiry).
  const challengeNotifSignature = useMemo(
    () => challenges.map(c => `${c.id}:${c.deadlineTs || 0}:${c.deadState}:${c.current >= c.target ? 1 : 0}:${(c.punishment || '').trim() ? 1 : 0}`).join('|'),
    [challenges]
  );
  useEffect(() => {
    syncChallengeNotifications(useAppStore.getState().challenges as Challenge[]);
  }, [challengeNotifSignature]);

  // ── Lock-screen gating ────────────────────────────────────────────────
  // Just the bool here. The actual metric computation lives inside
  // <LockGate/> (rendered only when !challengesUnlocked) so unlocked
  // users don't pay the cost of summing deep-work hours, filtering
  // tasks, and walking every habit's history on every mount.
  const challengesUnlocked = useAppStore(s => s.challengesUnlocked);
  const setChallengesUnlocked = useAppStore(s => s.setChallengesUnlocked);
  // "Show me everything" returning users bypass the conditions gate — unlockAll
  // sets allFeaturesUnlocked but not the legacy challengesUnlocked flag.
  const allFeaturesUnlocked = useAppStore(s => s.allFeaturesUnlocked);
  // New progressive-unlock gate for the whole tab (day 3). Replaces the legacy
  // criteria LockGate below. markDotSeen clears the tab-icon dot once the user
  // opens the tab.
  const daysSinceInstall = useDaysSinceInstall();
  // Reveal is anchored to INSTALL, not to when the user first opens the tab: the
  // teaser runs day 2→3 and the conditions appear at the day-3 boundary (install
  // + 3 days), so someone who returns days later finds it already revealed instead
  // of a fresh 24h wait. revealReached flips live (via the teaser's onReveal) so
  // the countdown never just sits at 00:00:00 needing a tab reopen.
  const installDate = useAppStore(s => s.installDate);
  // Optional explicit reveal timestamp — set ONLY by the Lab → Dev "Preview
  // reveal (8s)" button so the countdown + reveal animation can be tested without
  // waiting days. null in normal use, so the reveal falls back to the
  // install-anchored day-3 boundary below.
  const revealOverride = useAppStore(s => s.challengesTeaserSeenAt);
  const revealAt = useMemo(() => {
    if (revealOverride != null) return revealOverride;
    if (!installDate) return null;
    const [iy, im, idy] = installDate.split('-').map(Number);
    return new Date(iy, im - 1, idy + 3).getTime(); // local midnight of install + 3 days
  }, [installDate, revealOverride]);
  const [revealReached, setRevealReached] = useState(() => revealAt != null && Date.now() >= revealAt);
  useEffect(() => {
    // Resync whenever revealAt changes (install load, or the dev override) so a
    // freshly-set future revealAt drops us back to the teaser. The live crossing
    // while the user is watching is handled by ChallengeTeaser.onReveal.
    if (revealAt != null) setRevealReached(Date.now() >= revealAt);
  }, [revealAt]);
  const markDotSeen = useAppStore(s => s.markDotSeen);
  const milestonesUnlocked = useIsUnlocked(FEATURE_IDS.MILESTONES);
  const linkedHabitsUnlocked = useIsUnlocked(FEATURE_IDS.LINKED_HABITS);
  const linkedHabitsIsNew = useIsNew(FEATURE_IDS.LINKED_HABITS);
  const capsuleLockUnlocked = useIsUnlocked(FEATURE_IDS.CAPSULE_LOCK);
  const stakes = useAppStore(s => s.stakes);
  const addStake = useAppStore(s => s.addStake);
  const ledgerUnlocked = useAppStore(s => s.ledgerUnlocked);
  const setLedgerUnlocked = useAppStore(s => s.setLedgerUnlocked);
  // Stakes still needing action (excludes settled + punishments voided by a comeback).
  const ledgerUnsettled = useMemo(() => stakes.filter(s => {
    if (s.done) return false;
    if (s.kind === 'punishment' && s.sourceId) { const ch = challenges.find(c => c.id === s.sourceId); if (ch?.deadState === 'achieved') return false; }
    return true;
  }).length, [stakes, challenges]);
  useFocusEffect(useCallback(() => { markDotSeen(FEATURE_IDS.CHALLENGES_TAB); }, [markDotSeen]));

  // The Ledger unlocks the first time any challenge ends (won or dead) and stays
  // unlocked. A won challenge drops its reward to claim; a dead one (deadline
  // passed) drops its punishment to pay — kept even if it's later resurrected.
  // Dedup'd by challenge id so each contributes at most one reward / punishment.
  useEffect(() => {
    if (!ledgerUnlocked && challenges.some(c => c.deadState === 'achieved' || c.deadState === 'dead' || c.deadState === 'buried')) setLedgerUnlocked(true);
    const seen = new Set(useAppStore.getState().stakes.filter(s => s.sourceId).map(s => `${s.sourceId}:${s.kind}`));
    challenges.forEach(c => {
      const reward = c.reward?.trim();
      const punishment = c.punishment?.trim();
      if (c.deadState === 'achieved' && reward && !seen.has(`${c.id}:reward`)) { addStake('reward', reward, c.id); seen.add(`${c.id}:reward`); }
      if ((c.deadState === 'dead' || c.deadState === 'buried') && punishment && !seen.has(`${c.id}:punishment`)) { addStake('punishment', punishment, c.id); seen.add(`${c.id}:punishment`); }
    });
  }, [challenges, addStake, ledgerUnlocked, setLedgerUnlocked]);

  // Roster load-sweep replay. The navigator caches this screen, so the cards'
  // mount animation only plays the first time. Bump a key on every focus so the
  // 0→value sweep replays each time the tab is opened — skipping the very first
  // focus (which coincides with mount, where the animation already runs) so it
  // doesn't double-fire.
  const [rosterAnimKey, setRosterAnimKey] = useState(0);
  const rosterFirstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (rosterFirstFocus.current) { rosterFirstFocus.current = false; return; }
    setRosterAnimKey(k => k + 1);
  }, []));

  // Full-screen detail view target. Tapping a card opens this view;
  // long-pressing the card jumps straight to the add/edit sheet. The
  // inline expand pattern was removed — the detail view carries
  // everything it had plus the 30-day strip, description, and notes.
  const [detailChallengeId, setDetailChallengeId] = useState<string | null>(null);
  const [editingChallenge, setEditingChallenge] = useState<Challenge | null>(null);
  // Habit-link target (was previously bound to selectedChallenge).
  // Set when the user taps "Link Habits" inside the edit sheet.
  const [habitLinkChallenge, setHabitLinkChallenge] = useState<Challenge | null>(null);
  // Custom-log target (was previously bound to selectedChallenge).
  // Set when the user long-presses the inline +1 LOG button.
  const [customLogChallenge, setCustomLogChallenge] = useState<Challenge | null>(null);

  // Modals & Bottom Sheets
  const [reviewChallenge, setReviewChallenge] = useState<Challenge | null>(null);
  const [achievedVisible, setAchievedVisible] = useState(false);
  const [achievementsVisible, setAchievementsVisible] = useState(false);
  // Add/edit is now a full-screen Modal (matching the Notes/Tasks
  // editors), not a bottom sheet. Visibility is controlled by state
  // so it stacks correctly above the detail view modal — the previous
  // BottomSheetModal would render in a portal that ended up behind
  // the detail view.
  const [addEditOpen, setAddEditOpen] = useState(false);
  const presetsSheetRef = useRef<BottomSheetModal>(null);
  const storageSheetRef = useRef<BottomSheetModal>(null);
  // Close the storage when leaving this tab — a sheet shouldn't linger open across
  // a tab switch. useFocusEffect's cleanup runs on blur.
  useFocusEffect(useCallback(() => () => storageSheetRef.current?.dismiss(), []));
  // Graveyard is now its own full-screen surface, not a tab in the
  // storage sheet. Storage becomes trash-only — kept as a sheet because
  // trash actions (restore / delete forever) are transactional.
  const [graveyardOpen, setGraveyardOpen] = useState(false);

  const [completionCeremony, setCompletionCeremony] = useState<{ challenge: Challenge; isFirst: boolean; wasResurrected: boolean } | null>(null);
  const [currentNarrator, setCurrentNarrator] = useState<NarratorMoment | null>(null);

  const [softDeleteTarget, setSoftDeleteTarget] = useState<Challenge | null>(null);
  const [softDeleteMode, setSoftDeleteMode] = useState<'trash' | 'forever' | null>(null);
  const [purgeAllVisible, setPurgeAllVisible] = useState(false);
  const [graveyardBuryTarget, setGraveyardBuryTarget] = useState<Challenge | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);

  // Form State
  const [title, setTitle] = useState(''); const [targetV, setTargetV] = useState(''); const [unit, setUnit] = useState('');
  // Static "what is this challenge about" copy. Captured once near
  // the top of the form; doesn't grow over time.
  const [description, setDescription] = useState('');
  // Notes are date-stamped entries — a journal of context the user
  // added over time. Adding happens in the full-screen detail view;
  // the edit sheet only lets the user remove entries via the × icon.
  const [noteEntries, setNoteEntries] = useState<NoteEntry[]>([]);
  const [urgencyStyle, setUrgencyStyle] = useState<UrgencyStyle>('auto'); const [reward, setReward] = useState(''); const [punishment, setPunishment] = useState('');
  const [milestones, setMilestones] = useState<Milestone[]>([]); const [newMs, setNewMs] = useState(''); const [color, setColor] = useState(COLORS[0]); const [icon, setIcon] = useState<keyof typeof Feather.glyphMap>('target');
  // Custom-amount logger — opened by long-pressing the inline +1 LOG
  // button on a card's expanded view. "Hidden power" pattern: tap
  // logs +1, hold to log a bulk amount. Visibility is derived from
  // customLogChallenge being non-null; the value lives in its own
  // state so it persists across re-renders while the modal is open.
  const [customLogValue, setCustomLogValue] = useState('');
  const [calOpen, setCalOpen] = useState(false);
  const [deadlineTs, setDeadlineTs] = useState<number | undefined>();
  // ── Capsule-locked finish ──
  // A sealed note that auto-unlocks when this challenge transitions to 'achieved'.
  // Empty content + capsuleEnabled=false means no capsule on this challenge.
  const [capsuleEnabled, setCapsuleEnabled] = useState(false);
  const [capsuleMessage, setCapsuleMessage] = useState('');

  const theme = useMemo(() => getTheme(themeMode), [themeMode]);
  const renderBackdrop = useCallback((props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.6} />, []);

  useFocusEffect(useCallback(() => {
    const onBackPress = () => {
      if (customLogChallenge) { setCustomLogChallenge(null); return true; }
      if (habitLinkChallenge) { setHabitLinkChallenge(null); return true; }
      if (reviewChallenge) { setReviewChallenge(null); return true; }
      if (achievedVisible) { setAchievedVisible(false); return true; }
      if (achievementsVisible) { setAchievementsVisible(false); return true; }
      if (detailChallengeId) { setDetailChallengeId(null); return true; }
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [customLogChallenge, habitLinkChallenge, reviewChallenge, achievedVisible, achievementsVisible, detailChallengeId]));

  const saveChallenges = (next: Challenge[], animate = false) => {
    // Animation is opt-in. The ease-in-out used to fire on every
    // progress tick, which queued LayoutAnimations for the entire
    // active list — rapid +1 taps would drop because each one was
    // waiting on the previous animation cycle. Now only structural
    // changes (add / remove / state transition) opt into the smooth
    // animation; field updates snap.
    if (animate) {
      try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch (e) {}
    }
    setChallenges(next);
  };

  const isAchUnlocked = useCallback((id: AchievementId, achs: Achievement[]) => achs.some(a => a.id === id && a.unlockedAt), []);
  const queueNarrator = useCallback((ids: AchievementId[], currentAchs: Achievement[], firstTime = true) => {
    // Single-narration policy: when multiple achievements unlock —
    // either from one event or from two events arriving close in time
    // — show only ONE narration. The winner is decided by
    // ACHIEVEMENT_IMPORTANCE; the rest unlock silently and live in
    // the dossier.
    //
    // We set `currentNarrator` directly instead of pushing through
    // an intermediate queue + drain effect. The queue indirection
    // cost 2-3 extra render frames before the modal mounted and felt
    // like noticeable lag — the narration appeared a beat after the
    // action that triggered it.
    const toPlay = firstTime ? ids.filter(id => !isAchUnlocked(id, currentAchs)) : ids;
    if (!toPlay.length) return;
    const top = toPlay.reduce((best, id) =>
      (ACHIEVEMENT_IMPORTANCE[id] || 0) > (ACHIEVEMENT_IMPORTANCE[best] || 0) ? id : best
    , toPlay[0]);
    const newImp = ACHIEVEMENT_IMPORTANCE[top] || 0;
    const narr = ACHIEVEMENT_NARRATION[top];
    const item = { lines: narr.lines, dismissLabel: narr.dismiss, achievementId: top, tone: narr.tone, firstTime };
    setCurrentNarrator(prev => {
      // Already-playing narration wins by default — never interrupt
      // mid-typing. Only allow replacement if the new candidate is
      // strictly more important; otherwise drop it silently.
      if (!prev) return item;
      const prevImp = prev.achievementId ? (ACHIEVEMENT_IMPORTANCE[prev.achievementId] || 0) : -1;
      return newImp > prevImp ? item : prev;
    });
  }, [isAchUnlocked]);

  // ── Capsule reconciler ──
  // Idempotent guard: any time an 'achieved' challenge gains a linked
  // capsule, ensure the note has its `unlockDate` set so the Notes tab
  // surfaces it in "Ready for extraction" mode. We DO NOT touch
  // isSealed — only the user's tap (via handleOpenCapsule in notes.tsx)
  // drops isSealed and archives the note.
  //
  // Memoized into a string key so the effect ONLY re-runs when an
  // achievement-with-capsule actually changes — not on every progress
  // tick on an unrelated active challenge. Previously it ran every time
  // `challenges` array reference changed (every increment).
  const capsuleReconcileKey = useMemo(
    () => challenges
      .filter(c => c.deadState === 'achieved' && c.linkedCapsuleNoteId)
      .map(c => `${c.id}:${c.achievedAt || ''}`)
      .join('|'),
    [challenges]
  );
  useEffect(() => {
    if (!capsuleReconcileKey) return;
    const achieved = useAppStore.getState().challenges.filter(c => c.deadState === 'achieved' && c.linkedCapsuleNoteId);
    if (achieved.length === 0) return;
    const notes = useAppStore.getState().notes as Note[];
    const addOrUpdateNote = useAppStore.getState().addOrUpdateNote;
    for (const c of achieved) {
      const n = notes.find(x => x.id === c.linkedCapsuleNoteId);
      if (n && n.isSealed && !n.unlockDate) {
        addOrUpdateNote({ ...n, unlockDate: c.achievedAt || Date.now() });
      }
    }
  }, [capsuleReconcileKey]);

  const handleAchievementQueue = useCallback((ids: AchievementId[]) => {
    // Use getState() — avoids stale closure on achievements
    const currentAchs = useAppStore.getState().achievements as Achievement[];
    let updated = [...currentAchs]; const newIds: AchievementId[] = [];
    for (const id of ids) {
      if (!updated.some(a => a.id === id && a.unlockedAt)) {
        const def = ACHIEVEMENT_DEFS.find(d => d.id === id);
        if (def) { updated.push({ ...def, unlockedAt: Date.now() }); newIds.push(id); }
      }
    }
    const unlocked = updated.filter(a => a.unlockedAt).length;
    if (unlocked >= 5 && !updated.some(a => a.id === 'you_were_watched' && a.unlockedAt)) {
      const def = ACHIEVEMENT_DEFS.find(d => d.id === 'you_were_watched');
      if (def) { updated.push({ ...def, unlockedAt: Date.now() }); newIds.push('you_were_watched'); }
    }
    setAchievements(updated); queueNarrator(newIds, currentAchs, true);
  }, [setAchievements, queueNarrator]);

  const checkDeadTransition = (c: Challenge): Challenge => {
    if (shouldBeDead(c)) {
      // Resurrected challenges come back as 'active' (see handleResurrect). If a
      // previously-resurrected one dies again it's a recidivist — and dead for
      // good: resurrectedBefore keeps the bring-back button hidden from here on.
      if (c.resurrectedBefore) setTimeout(() => handleAchievementQueue(['recidivist']), 100);
      return { ...c, deadState: 'dead' };
    }
    if (c.current >= c.target && c.deadState === 'active') return { ...c, deadState: 'achieved', achievedAt: Date.now() };
    return c;
  };

  const openAddEditSheet = useCallback((task?: Challenge) => {
    if (task) {
      setEditingChallenge(task); setTitle(task.title); setTargetV(task.target.toString()); setUnit(task.unit);
      setDescription(task.description || '');
      setDeadlineTs(task.deadlineTs); setUrgencyStyle(task.urgencyStyle || 'auto'); setReward(task.reward || ''); setPunishment(task.punishment || ''); setMilestones(task.milestones || []); setColor(task.color); setIcon(task.icon); setCalOpen(false);
      // Hydrate notes — prefer the new dated entries; if the challenge
      // only has the legacy `note` string, migrate it to a single entry
      // stamped at the challenge's createdAt so the user sees it dated.
      if (task.noteEntries && task.noteEntries.length > 0) {
        setNoteEntries(task.noteEntries);
      } else if (task.note?.trim()) {
        setNoteEntries([{ id: 'legacy_' + task.id, text: task.note.trim(), createdAt: task.createdAt }]);
      } else {
        setNoteEntries([]);
      }
      // Capsule state is intentionally NOT rehydrated when one already
      // exists — the section is hidden in the edit sheet and the seal
      // is set-once. Reset the form fields to their defaults so any
      // stale state from a previous open doesn't accidentally bleed
      // into the save logic.
      setCapsuleEnabled(false);
      setCapsuleMessage('');
    } else {
      setEditingChallenge(null); setTitle(''); setTargetV(''); setUnit('');
      setDescription('');
      setNoteEntries([]);
      setDeadlineTs(undefined); setUrgencyStyle('auto'); setReward(''); setPunishment(''); setMilestones([]); setNewMs(''); setColor(COLORS[0]); setIcon('target'); setCalOpen(false);
      setCapsuleEnabled(false); setCapsuleMessage('');
    }
    setAddEditOpen(true);
  }, []);

  // Pick a preset → create the challenge directly. No editor stop-over,
  // no second confirmation. The preset's explainer becomes the private
  // `note` so the user retains the context of why they took it. They
  // can still edit name, target, deadline, milestones from the active
  // card afterward — but the default flow is "tap, it's done".
  const openWithPreset = useCallback((preset: ChallengePreset) => {
    const now = Date.now();
    const newChallenge: Challenge = {
      id: 'c_' + now.toString(36),
      title: preset.name,
      icon: preset.icon,
      color: preset.color,
      current: 0,
      target: preset.target,
      unit: preset.unit,
      deadlineTs: now + preset.durationDays * 86400000,
      urgencyStyle: 'auto',
      createdAt: now,
      milestones: (preset.milestones || []).map(m => ({ ...m })),
      links: [],
      ledger: [],
      cadence: inferChallengeCadence(preset.target, preset.unit),
      deadState: 'active',
      // The preset's explainer becomes the static description — it's
      // a description of the rule, not a journal entry, so it belongs
      // in `description` rather than getting an artificial date stamp.
      description: preset.explainer,
      presetId: preset.id,
    };
    const next = [...(useAppStore.getState().challenges as Challenge[]), newChallenge];
    setChallenges(next);
    presetsSheetRef.current?.dismiss();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [setChallenges]);

  // ── One-active-preset-at-a-time gate ─────────────────────────────────
  // The one-at-a-time rule applies to PRESETS specifically. A user can
  // have any number of custom challenges running in parallel — those
  // are their own ambitions and we don't gate them. But preset picks
  // are limited to one active at a time, both because the catalogue is
  // designed to thin out (each picked preset disappears) and because
  // running ten different cult challenges at once is exactly the
  // anti-pattern this app is built against.
  const hasActivePreset = useMemo(
    () => (challenges as Challenge[]).some(c => !!c.presetId && (c.deadState === 'active' || c.deadState === 'resurrected')),
    [challenges]
  );
  // The blocked-state is now communicated via the in-list dashed row
  // ("Preset slot occupied · finish or bury current"), so a tap on
  // any stale entry-point just no-ops with a warning haptic — the
  // user already sees the status and doesn't need a modal interrupt.
  const handleOpenPresets = useCallback(() => {
    if (hasActivePreset) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    presetsSheetRef.current?.present();
  }, [hasActivePreset]);
  const handleOpenAddSheet = useCallback(() => {
    openAddEditSheet();
  }, [openAddEditSheet]);

  const handleSaveChallenge = useCallback(async () => {
    if (!title.trim() || !targetV.trim()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const data = { title, description, target: parseInt(targetV) || 100, unit: unit || 'Units', noteEntries, note: undefined, deadlineTs, urgencyStyle, reward, punishment, milestones, color, icon };
    const currentChallenges = useAppStore.getState().challenges as Challenge[];
    const wantsCapsule = capsuleEnabled && capsuleMessage.trim().length > 0;

    // Resolve the challenge ID up front so a fresh capsule note can reference it.
    const challengeId = editingChallenge ? editingChallenge.id : Date.now().toString();

    // ── Sync the capsule note (create / update / clear) ─────────────────────────
    const addOrUpdateNote = useAppStore.getState().addOrUpdateNote;
    const existingNoteId = editingChallenge?.linkedCapsuleNoteId;
    let linkedCapsuleNoteId: string | undefined = existingNoteId;

    if (existingNoteId) {
      // A capsule has already been sealed for this challenge. The UI
      // for it is hidden in the edit sheet (the user shouldn't be
      // reminded that a future-self message is waiting), and the seal
      // is set-once — no edit, no remove. Skip all capsule mutations.
    } else if (wantsCapsule) {
      const noteId = `cap_${challengeId}`;
      const existingNote = (useAppStore.getState().notes as Note[]).find(n => n.id === noteId);
      const capsuleNote: Note = {
        id: noteId,
        title: `Finish line — ${title.trim()}`,
        group: 'capsules',
        content: capsuleMessage.trim(),
        color,
        createdAt: existingNote?.createdAt ?? Date.now(),
        isPinned: false,
        isLocked: false,
        order: existingNote?.order ?? -Date.now(),
        status: 'active',
        isSealed: true,
        // No date — it unlocks on the challenge event, not the calendar.
        unlockOnChallengeId: challengeId,
      };
      addOrUpdateNote(capsuleNote);
      linkedCapsuleNoteId = noteId;
    }

    const enrichedData = { ...data, linkedCapsuleNoteId };

    if (editingChallenge) {
      saveChallenges(currentChallenges.map(c => c.id === editingChallenge.id ? checkDeadTransition({ ...c, ...enrichedData }) : c));
    } else {
      const newC: Challenge = { id: challengeId, current: 0, createdAt: Date.now(), links: [], ledger: [], cadence: inferChallengeCadence(data.target, data.unit), deadState: 'active', logDates: [], ...enrichedData } as any;
      saveChallenges([...currentChallenges, newC], true);
      // Monotonic unlock counter — first challenge unlocks MILESTONES.
      useAppStore.getState().incrementTotalChallengesCreated();
      if (currentChallenges.length + 1 >= 5) handleAchievementQueue(['architect']);
    }
    setEditingChallenge(null);
    setAddEditOpen(false);
  }, [title, description, targetV, unit, noteEntries, deadlineTs, urgencyStyle, reward, punishment, milestones, color, icon, editingChallenge, handleAchievementQueue, capsuleEnabled, capsuleMessage]);

  const updateProgress = useCallback((challengeId: string, amount: number, source: LedgerSource = 'manual') => {
    const currentChallenges = useAppStore.getState().challenges as Challenge[];
    const challenge = currentChallenges.find(c => c.id === challengeId);
    if (!challenge) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (amount > 0) {
      const today = todayDateStr();
      useAppStore.getState().autoCheckIntentsForChallenge(challengeId, today);
    }
    const was = challenge.current >= challenge.target;
    const next = Math.max(0, Math.min(challenge.target, challenge.current + amount));
    const now = Date.now();
    const todayStr = todayDateStr();
    const existingLogs: string[] = (challenge as any).logDates || [];
    const newLogDates = existingLogs.includes(todayStr) ? existingLogs : [...existingLogs, todayStr];
    // Ledger: record the delta actually applied (clamping at 0/target can make
    // it smaller than `amount`); a no-op change writes nothing.
    const appliedDelta = next - challenge.current;
    const newLedger = appliedDelta !== 0
      ? [...(challenge.ledger || []), makeLedgerEntry(appliedDelta, source)]
      : (challenge.ledger || []);

    if (!was && next >= challenge.target) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const currentAchs = useAppStore.getState().achievements as Achievement[];
      const isFirst = !currentAchs.some(a => a.id === 'first_blood' && a.unlockedAt);
      const wasRes = !!(challenge.wasResurrected || challenge.deadState === 'resurrected');
      const updated = checkDeadTransition({ ...challenge, current: next, lastLoggedAt: now, wasResurrected: wasRes || undefined, logDates: newLogDates, ledger: newLedger } as any);
      saveChallenges(currentChallenges.map(c => c.id === (updated as any).id ? updated : c), true);
      setDetailChallengeId(prev => prev === challengeId ? null : prev);

      if (challenge.linkedCapsuleNoteId) {
        const notes = useAppStore.getState().notes as Note[];
        const linked = notes.find(n => n.id === challenge.linkedCapsuleNoteId);
        if (linked && linked.isSealed && !linked.unlockDate) {
          useAppStore.getState().addOrUpdateNote({ ...linked, unlockDate: now });
        }
      }

      const achievementIds: AchievementId[] = isFirst ? ['first_blood', 'narrator_noticed'] : [];
      if (wasRes) achievementIds.push('risen');
      if (now - challenge.createdAt >= 90 * 24 * 60 * 60 * 1000) achievementIds.push('the_long_game');
      const recentlyCompleted = currentChallenges.filter(c => c.deadState === 'achieved' && c.achievedAt && now - c.achievedAt < SEVEN_DAYS_MS);
      if (recentlyCompleted.length >= 1) achievementIds.push('momentum');

      setCompletionCeremony({ challenge: { ...challenge, current: next }, isFirst, wasResurrected: wasRes });
      if (achievementIds.length > 0) handleAchievementQueue(achievementIds);
    } else {
      const updated = checkDeadTransition({ ...challenge, current: next, lastLoggedAt: now, logDates: newLogDates, ledger: newLedger } as any);
      saveChallenges(currentChallenges.map(c => c.id === (updated as any).id ? updated : c));

      const hr = new Date().getHours();
      const achievementIds: AchievementId[] = [];
      if (hr >= 0 && hr < 4) achievementIds.push('insomniac');
      const consecutiveDays = consecutiveDaysEndingToday(newLogDates);
      if (consecutiveDays >= 7) achievementIds.push('obsessive');
      if (achievementIds.length > 0) handleAchievementQueue(achievementIds);
    }
  }, [handleAchievementQueue]);

  const addMs = () => { if (!newMs.trim()) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMilestones(p => [...p, { id: Date.now().toString(), text: newMs.trim(), completed: false }]); setNewMs(''); };

  const requestTrash = useCallback((c: Challenge) => { setSoftDeleteTarget(c); setSoftDeleteMode('trash'); }, []);
  const confirmTrash = useCallback(() => {
    if (!softDeleteTarget) return;
    saveChallenges((useAppStore.getState().challenges as Challenge[]).map(c => c.id === softDeleteTarget.id ? { ...c, deadState: 'trash' as DeadState, deletedAt: Date.now() } : c), true);
    setDetailChallengeId(null); setSoftDeleteTarget(null); setSoftDeleteMode(null);
  }, [softDeleteTarget]);
  const requestDeleteForever = useCallback((c: Challenge) => { setSoftDeleteTarget(c); setSoftDeleteMode('forever'); }, []);
  const confirmDeleteForever = useCallback(() => {
    if (!softDeleteTarget) return;
    saveChallenges((useAppStore.getState().challenges as Challenge[]).filter(c => c.id !== softDeleteTarget.id), true);
    setSoftDeleteTarget(null); setSoftDeleteMode(null);
  }, [softDeleteTarget]);
  const restoreFromTrash = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    saveChallenges((useAppStore.getState().challenges as Challenge[]).map(c => c.id === id ? { ...c, deadState: 'active' as DeadState, deletedAt: undefined } : c), true);
    handleAchievementQueue(['archaeologist']);
  }, [handleAchievementQueue]);
  // Bulk-purge the whole trash — the "Purge all" counterpart to per-item
  // Delete Forever. Confirmed through the same SoftDeleteOverlay.
  const confirmPurgeAll = useCallback(() => {
    saveChallenges((useAppStore.getState().challenges as Challenge[]).filter(c => c.deadState !== 'trash'), true);
    setPurgeAllVisible(false);
  }, []);

  const requestBury = useCallback((id: string) => {
    const c = (useAppStore.getState().challenges as Challenge[]).find(x => x.id === id);
    if (c) setGraveyardBuryTarget(c);
  }, []);
  const confirmBury = useCallback(() => {
    if (!graveyardBuryTarget) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const currentChallenges = useAppStore.getState().challenges as Challenge[];
    saveChallenges(currentChallenges.map(c => c.id === graveyardBuryTarget.id ? { ...c, deadState: 'buried' as DeadState, buriedAt: Date.now() } : c), true);
    const buriedCount = currentChallenges.filter(c => c.deadState === 'buried').length + 1;
    const currentAchs = useAppStore.getState().achievements as Achievement[];
    const ids: AchievementId[] = [];
    if (buriedCount === 1 && !isAchUnlocked('initiation', currentAchs)) ids.push('initiation');
    if (buriedCount >= 3 && !isAchUnlocked('graveyard_grows', currentAchs)) ids.push('graveyard_grows');
    if (buriedCount >= 5 && !isAchUnlocked('ghost', currentAchs)) ids.push('ghost');
    if (ids.length > 0) handleAchievementQueue(ids);
    setGraveyardBuryTarget(null);
  }, [graveyardBuryTarget, isAchUnlocked, handleAchievementQueue]);

  const handleResurrect = useCallback((id: string, ts: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    saveChallenges((useAppStore.getState().challenges as Challenge[]).map(c => c.id === id ? { ...c, deadState: 'active' as DeadState, deadlineTs: ts, reviewedAt: Date.now(), wasResurrected: true, resurrectedBefore: true } : c), true);
    handleAchievementQueue(['second_chance', 'narrator_noticed']);
  }, [handleAchievementQueue]);

  const saveHabitLinks = useCallback((challengeId: string, links: ChallengeLink[]) => {
    // The modal already owns the full per-link config (which habits, whether
    // each auto-advances, and by how much), so we write it straight through.
    const updated = (useAppStore.getState().challenges as Challenge[]).map(c =>
      c.id === challengeId ? { ...c, links } : c
    );
    saveChallenges(updated);
  }, []);
  const handleMarkIncomplete = useCallback((c: Challenge) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    saveChallenges((useAppStore.getState().challenges as Challenge[]).map(x => x.id === c.id ? { ...x, deadState: 'active' as DeadState, achievedAt: undefined, current: Math.max(0, c.current - 1) } : x), true);
  }, []);

  // ─── DATA PREP ───
  const activeChallenges = useMemo(() => {
    return challenges.filter(c => c.deadState !== 'buried' && c.deadState !== 'achieved' && c.deadState !== 'trash');
  }, [challenges]);

  // Roster split + ordering, memoized so it recomputes only when the active set
  // changes — not on every unrelated re-render (progress taps, modal toggles,
  // theme flips). It was previously recomputed inline on every render.
  const { rosterSorted, rosterReviewable } = useMemo(() => {
    const alive = activeChallenges.filter(c => c.deadState !== 'dead' && c.deadState !== 'resurrected');
    const reviewable = activeChallenges.filter(c => c.deadState === 'dead' || c.deadState === 'resurrected');
    const edgeScore = (c: Challenge) =>
      c.current >= c.target ? Number.POSITIVE_INFINITY
        : (c.deadlineTs ? (c.deadlineTs - Date.now()) / 86400000 : Number.POSITIVE_INFINITY);
    const sorted = [...alive].sort((a, b) => {
      const ea = edgeScore(a), eb = edgeScore(b);
      if (ea !== eb) return ea - eb;
      return (a.current / a.target) - (b.current / b.target);
    });
    return { rosterSorted: sorted, rosterReviewable: reviewable };
  }, [activeChallenges]);

  const buriedChallenges = useMemo(() => challenges.filter(c => c.deadState === 'buried'), [challenges]);
  const trashChallenges = useMemo(() => challenges.filter(c => c.deadState === 'trash'), [challenges]);
  const achievedCount = useMemo(() => challenges.filter(c => c.deadState === 'achieved').length, [challenges]);
  // Preset IDs that the picker should HIDE — currently active states
  // (active / dead / resurrected) and 'achieved' (already won). We
  // intentionally do NOT include 'buried' or 'trash' here, so failed
  // or removed preset challenges return to the catalogue and can be
  // taken again.
  const takenPresetIds = useMemo(() => {
    const out = new Set<string>();
    for (const c of challenges) {
      if (!c.presetId) continue;
      if (c.deadState === 'active' || c.deadState === 'dead' || c.deadState === 'resurrected' || c.deadState === 'achieved') {
        out.add(c.presetId);
      }
    }
    return out;
  }, [challenges]);

  const todayLabel = useMemo(() => {
    // 3-letter month abbreviations to match Tasks/Notes/Habits/Timeline
    // headers. The full names live in SHAMSI_MONTHS / GREG_MONTHS for
    // calendar use and other surfaces; the tab header is the only
    // place we want them shortened.
    const d = new Date();
    if (calSystem === 'shamsi') { const s = getShamsiDateParts(d); return `${WDAYS_FA[(d.getDay() + 1) % 7]}, ${SHAMSI_MONTHS[s.month - 1].slice(0, 3)} ${s.day}`; }
    return `${WDAYS_EN[d.getDay()]}, ${GREG_MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  }, [calSystem]);

  // Stable detail-view callbacks. Reading the target id via the
  // detailChallengeId in deps lets each callback close over a constant
  // value while the detail view is open, so React.memo on the detail
  // view's static sub-components actually hits across taps.
  const detailOnProgress = useCallback((delta: number) => {
    if (!detailChallengeId) return;
    updateProgress(detailChallengeId, delta);
  }, [detailChallengeId, updateProgress]);
  const detailOnCustomLog = useCallback(() => {
    if (!detailChallengeId) return;
    const c = (useAppStore.getState().challenges as Challenge[]).find(x => x.id === detailChallengeId);
    if (!c) return;
    setCustomLogValue('');
    setCustomLogChallenge(c);
  }, [detailChallengeId]);
  const detailOnToggleMilestone = useCallback((mid: string) => {
    if (!detailChallengeId) return;
    const cur = useAppStore.getState().challenges as Challenge[];
    saveChallenges(cur.map(x => x.id === detailChallengeId
      ? { ...x, milestones: (x.milestones || []).map(m => m.id === mid ? { ...m, completed: !m.completed } : m) }
      : x));
  }, [detailChallengeId]);
  const detailOnAddNote = useCallback((text: string) => {
    if (!detailChallengeId) return;
    const cur = useAppStore.getState().challenges as Challenge[];
    const entry: NoteEntry = { id: `n_${Date.now().toString(36)}`, text, createdAt: Date.now() };
    saveChallenges(cur.map(x => x.id === detailChallengeId
      ? { ...x, noteEntries: [entry, ...(x.noteEntries || [])] }
      : x));
  }, [detailChallengeId]);
  const detailOnEditNote = useCallback((noteId: string, newText: string) => {
    if (!detailChallengeId) return;
    const cur = useAppStore.getState().challenges as Challenge[];
    saveChallenges(cur.map(x => x.id === detailChallengeId
      ? { ...x, noteEntries: (x.noteEntries || []).map(e => e.id === noteId ? { ...e, text: newText } : e) }
      : x));
  }, [detailChallengeId]);
  const detailOnRemoveNote = useCallback((noteId: string) => {
    if (!detailChallengeId) return;
    const cur = useAppStore.getState().challenges as Challenge[];
    saveChallenges(cur.map(x => x.id === detailChallengeId
      ? { ...x, noteEntries: (x.noteEntries || []).filter(e => e.id !== noteId) }
      : x));
  }, [detailChallengeId]);
  const detailOnClose = useCallback(() => setDetailChallengeId(null), []);
  const detailOnEdit = useCallback(() => {
    if (!detailChallengeId) return;
    const c = (useAppStore.getState().challenges as Challenge[]).find(x => x.id === detailChallengeId);
    if (c) openAddEditSheet(c);
  }, [detailChallengeId, openAddEditSheet]);

  // ── Unlock arc gate ──────────────────────────────────────────────────────
  // Hidden before day 2. On day 2 the tab appears as a teaser — a shimmer + a
  // literal 24h countdown stamped at first appearance (challengesTeaserSeenAt,
  // set in app/_layout). After that 24h the four conditions show — their data
  // has been accruing silently since install, so an active user can land here
  // already met. Meeting all four + tapping UNLOCK flips challengesUnlocked for
  // good. "Show me everything" users skip the whole arc via allFeaturesUnlocked.
  if (!allFeaturesUnlocked && !challengesUnlocked) {
    if (daysSinceInstall < 2) return <Redirect href={'/(tabs)' as any} />;
    if (!revealReached) {
      // onReveal fires the instant the countdown hits zero, so we flip to the
      // conditions live — never sitting at 00:00:00, never needing a tab reopen.
      return <ChallengeTeaser theme={theme} revealAt={revealAt} onReveal={() => setRevealReached(true)} />;
    }
    // Fade the gate in so the reveal animates instead of hard-cutting — the
    // LockScreen's own ring sweep + staggered rows then play as the reveal.
    // The redesigned LockScreen owns the final unlock moment (haptic + burst +
    // ring pulse), then calls onUnlock ~1s later — so that's just the gate flip.
    return (
      <Reanimated.View style={{ flex: 1 }} entering={FadeIn.duration(450)}>
        <LockGate onUnlock={() => setChallengesUnlocked(true)} theme={theme} />
      </Reanimated.View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>
        <View style={[styles.container, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
          <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

          {/* ── HEADER ── */}
          <View style={{ paddingHorizontal: 24, paddingTop: 30, paddingBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ fontSize: 36, fontWeight: '900', color: theme.textMain, letterSpacing: -1 }}>Challenges.</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 }}>
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>{todayLabel}</Text>
                <TouchableOpacity onPress={toggleCalendar} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                  <Text style={{ fontSize: 9, color: theme.textSub, opacity: 0.5, fontWeight: '900', letterSpacing: 0.5 }}>• {calSystem === 'shamsi' ? 'SHAMSI' : 'GREGORIAN'}</Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* Three icons, all destinations/creation peers. Graveyard
                (moon) sits next to Dossier (award) only when there's
                something buried — they're the two history surfaces.
                Plus-circle stays the create action; long-press opens
                the preset picker as a power-user shortcut. */}
            <View style={{ flexDirection: 'row', gap: 18, alignItems: 'center' }}>
              {buriedChallenges.length > 0 ? (
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setGraveyardOpen(true); }}
                  hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                >
                  <Feather name="moon" size={20} color={theme.textMain} />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAchievedVisible(true); if (achievedCount >= 5) handleAchievementQueue(['witness']); }}
                onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); setAchievementsVisible(true); }}
                delayLongPress={500}
                hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
              >
                <Feather name="award" size={20} color={theme.textMain} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleOpenAddSheet}
                onLongPress={handleOpenPresets}
                delayLongPress={350}
                hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
              >
                <Feather name="plus-circle" size={22} color={theme.textMain} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── ACTIVE LIST ── */}
          <View style={styles.experimentalWrapper}>
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              {(ledgerUnlocked || stakes.length > 0) ? (
                <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setLedgerOpen(true); }} activeOpacity={0.85}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 14 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: hexToRgba(theme.textMain, isDarkMode ? 0.08 : 0.06), alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="book" size={17} color={theme.textMain} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: theme.textMain, letterSpacing: -0.2 }}>The Ledger</Text>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: theme.textSub, marginTop: 1 }}>{stakes.length === 0 ? 'Tap to set a stake' : ledgerUnsettled > 0 ? `${ledgerUnsettled} to settle` : 'All settled'}</Text>
                  </View>
                  <Feather name="chevron-right" size={20} color={theme.textSub} />
                </TouchableOpacity>
              ) : null}
              {activeChallenges.length === 0 ? (
                // Empty state — leads the user toward action without
                // cheerleading. Replaces "Empty Sector." which read as
                // a sci-fi placeholder. The CTA opens the same form
                // the + button does, so it's the same path with a
                // friendlier entry point on a fresh tab.
                <View style={{ alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 }}>
                  <Feather name="target" size={36} color={theme.textSub} style={{ opacity: 0.18, marginBottom: 20 }} />
                  <Text style={{ color: theme.textMain, fontSize: 17, fontWeight: '900', textAlign: 'center', letterSpacing: -0.3, marginBottom: 8 }}>No lines drawn.</Text>
                  <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 19, marginBottom: 28, opacity: 0.85 }}>A line has a target, a deadline, and a record. You hold it, or you don’t.</Text>
                  {/* Two CTAs — preset is primary because most first-time
                      users don't know what to commit to yet. The blank-form
                      path stays a click away as the secondary action. */}
                  <TouchableOpacity
                    onPress={handleOpenPresets}
                    style={{ paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.textMain, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}
                  >
                    <Feather name="grid" size={14} color={theme.bg} />
                    <Text style={{ color: theme.bg, fontSize: 13, fontWeight: '900', letterSpacing: 1 }}>BROWSE PRESETS</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleOpenAddSheet}
                    hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}
                  >
                    <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>or draw your own →</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {/* Single-column Line cards for living challenges — the
                      Roster reads as a short stack of commitments you're
                      holding, not a dense tile grid. Dead/resurrected ones
                      (need-review) keep their full-width overlay and sit
                      below until the death surfaces are reskinned. */}
                  {(() => {
                    // Split + ordering computed in the rosterSorted / rosterReviewable
                    // memo above (soonest deadline first; first is the hero, the rest
                    // hold) — read here so it doesn't recompute on every render.
                    const sorted = rosterSorted;
                    const reviewable = rosterReviewable;
                    const openCb = (c: Challenge) => () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDetailChallengeId(c.id); };
                    const editCb = (c: Challenge) => () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); openAddEditSheet(c); };
                    return (
                      <>
                        {sorted.map((c, i) => (
                          <RosterCard key={`${c.id}-${rosterAnimKey}`} challenge={c} theme={theme} calSystem={calSystem} index={i} hero={i === 0} onBump={() => updateProgress(c.id, 1)} onOpen={openCb(c)} />
                        ))}
                        {reviewable.length > 0 ? (
                          <View style={{ marginTop: sorted.length > 0 ? 24 : 0 }}>
                            {reviewable.map(c => (
                              <ActivityRingCard key={c.id} challenge={c} theme={theme} calSystem={calSystem} onPress={openCb(c)} onLongPress={editCb(c)} onReview={() => setReviewChallenge(c)} />
                            ))}
                          </View>
                        ) : null}
                      </>
                    );
                  })()}

                  {/* Trash is recoverable — kept accessible but quiet.
                      A monospace text link sits below the last card,
                      intentionally low-contrast so it never competes
                      with active challenges. Graveyard moved to a
                      header icon since it's a peer destination to the
                      Dossier (won) — both are history surfaces. */}
                  {trashChallenges.length > 0 ? (
                    <TouchableOpacity
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); storageSheetRef.current?.present(); }}
                      style={{ alignSelf: 'center', marginTop: 24, paddingVertical: 8, paddingHorizontal: 16 }}
                      hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}
                    >
                      <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', opacity: 0.5, letterSpacing: 1 }}>
                        Trash · {trashChallenges.length}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              )}
            </ScrollView>
          </View>

          {/* ── ADD/EDIT MODAL ── full-screen, matches the editor
              pattern in Notes/Tasks. Stacks correctly above the
              ChallengeDetailView modal because both are RN Modals at
              the same native window level — the previous gorhom
              BottomSheetModal rendered in a portal that ended up
              behind the detail view. */}
          <Modal visible={addEditOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setAddEditOpen(false)}>
            <View style={{ flex: 1, backgroundColor: theme.bg }}>
              <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
                {/* Header — chevron-back on left, Save pill on right.
                    Same shape as the Notes editor header so the user
                    encounters one consistent gesture across tabs. */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                  <TouchableOpacity onPress={() => setAddEditOpen(false)} hitSlop={15} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Feather name="chevron-left" size={22} color={theme.textMain} />
                    <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: '700' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSaveChallenge}
                    disabled={!(title.trim() && targetV.trim())}
                    style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100, backgroundColor: title.trim() && targetV.trim() ? theme.textMain : theme.border }}
                  >
                    <Text style={{ color: title.trim() && targetV.trim() ? theme.bg : theme.textSub, fontWeight: '800', fontSize: 13 }}>
                      {editingChallenge ? 'Save' : 'Create'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 80 }}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                  >
              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 12 }}>WHAT IS IT</Text>
              <TextInput
                style={[
                  styles.inputTitle,
                  {
                    color: theme.textMain,
                    textAlign: isRtl(title) ? 'right' : 'left',
                    writingDirection: isRtl(title) ? 'rtl' : 'ltr',
                  },
                ]}
                placeholder="Name your challenge"
                placeholderTextColor={theme.border}
                value={title}
                onChangeText={setTitle}
              />

              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
                <TextInput style={[styles.inputSub, { color: theme.textMain, flex: 1 }]} placeholder="Target (e.g. 100)" placeholderTextColor={theme.border} value={targetV} onChangeText={setTargetV} keyboardType="numeric" />
                <TextInput
                  style={[styles.inputSub, { color: theme.textMain, flex: 1, textAlign: isRtl(unit) ? 'right' : 'left', writingDirection: isRtl(unit) ? 'rtl' : 'ltr' }]}
                  placeholder="Unit (e.g. Hours)"
                  placeholderTextColor={theme.border}
                  value={unit}
                  onChangeText={setUnit}
                />
              </View>

              {/* Description — static "what is this challenge about"
                  copy. Notes (the dated journal entries) are intentionally
                  NOT in this sheet anymore — they live in the detail view
                  where the user does the actual writing/reading. */}
              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }}>DESCRIPTION</Text>
              <TextInput
                style={{
                  color: theme.textMain,
                  fontSize: 15,
                  fontWeight: '500',
                  lineHeight: 22,
                  paddingVertical: 12,
                  paddingHorizontal: 0,
                  minHeight: 60,
                  textAlignVertical: 'top',
                  marginBottom: 24,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                  textAlign: isRtl(description) ? 'right' : 'left',
                  writingDirection: isRtl(description) ? 'rtl' : 'ltr',
                }}
                placeholder="What is this challenge about?"
                placeholderTextColor={theme.border}
                value={description}
                onChangeText={setDescription}
                multiline
              />

              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 12 }}>SCHEDULE</Text>

              {/* Selected deadline — prominent header. The previous
                  toggle ("Set Deadline & Reminders") gated all this
                  behind one click; making the picker live by default
                  removes that step and lets the user see the answer
                  to "when is this due?" the moment the sheet opens. */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
                <View>
                  <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '700', letterSpacing: -0.5 }}>
                    {deadlineTs ? formatDeadlineFull(deadlineTs, calSystem) : 'No deadline'}
                  </Text>
                  {deadlineTs ? (
                    <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginTop: 2 }}>
                      {(() => {
                        const days = Math.ceil((deadlineTs - Date.now()) / 86400000);
                        if (days < 0) return `${Math.abs(days)} days overdue`;
                        if (days === 0) return 'Today';
                        if (days === 1) return 'Tomorrow';
                        return `In ${days} days`;
                      })()}
                    </Text>
                  ) : null}
                </View>
                {deadlineTs ? (
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setDeadlineTs(undefined);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={{ color: theme.danger, fontSize: 12, fontWeight: '700' }}>Clear</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Quick-pick chips — the common case for a 30/60/90-day
                  challenge. Tapping a chip stamps the deadline at end-
                  of-day so the calendar/time inputs are optional unless
                  the user wants to fine-tune. Horizontal scroll uses the
                  gesture-handler ScrollView so the bottom sheet's
                  vertical pan handler doesn't intercept side swipes. */}
              <GHScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingVertical: 2, marginBottom: 16 }}
              >
                {DEADLINE_QUICK_PICKS.map(({ label, days }) => {
                  // Compare the chip's implied date with the current deadline (within
                  // the same day) so a quick-pick stays visually selected even after
                  // the user tweaks the time on top of it.
                  const chipTs = (() => { const d = new Date(); d.setHours(23, 59, 0, 0); d.setDate(d.getDate() + days); return d.getTime(); })();
                  const isActive = !!deadlineTs && Math.abs(deadlineTs - chipTs) < 86400000 / 2;
                  return (
                    <TouchableOpacity
                      key={label}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        const d = new Date();
                        d.setHours(23, 59, 0, 0);
                        d.setDate(d.getDate() + days);
                        setDeadlineTs(d.getTime());
                      }}
                      style={{
                        paddingHorizontal: 14, paddingVertical: 9,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: isActive ? theme.textMain : theme.border,
                        backgroundColor: isActive ? theme.textMain : 'transparent',
                      }}
                    >
                      <Text style={{ color: isActive ? theme.bg : theme.textMain, fontSize: 12, fontWeight: '700' }}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </GHScrollView>

              {/* Calendar — collapsed by default. Tapping "Pick exact
                  date" reveals the month grid for fine-grained control. */}
              <TouchableOpacity
                onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setCalOpen(!calOpen); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: calOpen ? 12 : 20 }}
              >
                <Feather name={calOpen ? 'chevron-down' : 'chevron-right'} size={14} color={theme.textSub} />
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>
                  {calOpen ? 'Hide calendar' : 'Pick exact date'}
                </Text>
              </TouchableOpacity>

              {calOpen ? (
                <View style={{ backgroundColor: theme.bg, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: theme.border, marginBottom: 20 }}>
                  <CalendarPicker value={deadlineTs} onChange={setDeadlineTs} theme={theme} calSystem={calSystem} />
                </View>
              ) : null}

              {/* No time-of-day input — challenges are date-bound. The
                  deadline is "by the end of this day" implicitly. If
                  reminders need to fire at a specific moment later,
                  that's a separate notification setting, not part of
                  the deadline definition itself. */}
              <View style={{ marginBottom: 4 }} />

              {/* Urgency style is always 'auto' — calculated from the
                  deadline distance. The manual picker was removed; the
                  data field on Challenge stays so getUrgencyLevel can
                  still consult it if a future surface needs to override. */}

              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10, marginTop: 20 }}>STAKES</Text>
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
                <TextInput
                  style={[styles.inputSub, { color: theme.textMain, flex: 1, textAlign: isRtl(reward) ? 'right' : 'left', writingDirection: isRtl(reward) ? 'rtl' : 'ltr' }]}
                  placeholder="Reward" placeholderTextColor={theme.border} value={reward} onChangeText={setReward}
                />
                <TextInput
                  style={[styles.inputSub, { color: theme.textMain, flex: 1, textAlign: isRtl(punishment) ? 'right' : 'left', writingDirection: isRtl(punishment) ? 'rtl' : 'ltr' }]}
                  placeholder="Consequence" placeholderTextColor={theme.border} value={punishment} onChangeText={setPunishment}
                />
              </View>

              {/* MILESTONES — gated on the first-challenge unlock. Absent when
                  locked (i.e. while creating the very first challenge); appears
                  for every challenge created after one exists. */}
              {milestonesUnlocked ? (
              <Reanimated.View entering={FadeIn.duration(300)}>
              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 12 }}>MILESTONES</Text>
              {milestones.map((m, i) => {
                const mRtl = isRtl(m.text);
                return (
                <View key={m.id} style={{ flexDirection: mRtl ? 'row-reverse' : 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                  {/* Tap the row body to toggle completion. The X
                      stays as a separate hit target for removal so a
                      user can't accidentally trash a milestone while
                      ticking it. */}
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setMilestones(p => p.map((x, j) => j === i ? { ...x, completed: !x.completed } : x));
                    }}
                    style={{ flexDirection: mRtl ? 'row-reverse' : 'row', alignItems: 'center', flex: 1, paddingVertical: 4 }}
                  >
                    <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 2, justifyContent: 'center', alignItems: 'center', borderColor: m.completed ? color : theme.border, backgroundColor: m.completed ? color : 'transparent', marginRight: mRtl ? 0 : 12, marginLeft: mRtl ? 12 : 0 }}>
                      {m.completed && <Feather name="check" size={10} color="#FFF" />}
                    </View>
                    <Text
                      style={{
                        color: m.completed ? theme.textSub : theme.textMain,
                        fontWeight: '700', flex: 1, fontSize: 13,
                        textDecorationLine: m.completed ? 'line-through' : 'none',
                        textAlign: mRtl ? 'right' : 'left',
                        writingDirection: mRtl ? 'rtl' : 'ltr',
                      }}
                    >
                      {m.text}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setMilestones(p => p.filter((_, j) => j !== i))} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Feather name="x" size={13} color={theme.textSub} />
                  </TouchableOpacity>
                </View>
                );
              })}
              {milestones.length > 0 && <View style={{ height: 14 }} />}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
                <TextInput
                  style={[styles.inputSub, { color: theme.textMain, flex: 1, textAlign: isRtl(newMs) ? 'right' : 'left', writingDirection: isRtl(newMs) ? 'rtl' : 'ltr' }]}
                  placeholder="Add milestone..." placeholderTextColor={theme.border}
                  value={newMs} onChangeText={setNewMs} onSubmitEditing={addMs} returnKeyType="done"
                />
                <TouchableOpacity onPress={addMs} style={{ backgroundColor: theme.textMain, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' }}><Feather name="plus" size={16} color={theme.bg} /></TouchableOpacity>
              </View>
              </Reanimated.View>
              ) : null}

              {/* ── CAPSULE-LOCKED FINISH ──
                  Seal a message for the moment this challenge is achieved. The note
                  lives in Notes (capsules group) and unlocks automatically on completion.
                  Once a capsule HAS been sealed, the entire section is hidden — the
                  user shouldn't be reminded that a future-self message is waiting,
                  which is part of the surprise. They can't edit or remove it from
                  here either; the seal is set-once. */}
              {/* Capsule-locked finish — gated on CAPSULE_LOCK, which only
                  unlocks for users who discovered Sealing in Notes first
                  (day 10+). Absent otherwise. Also hidden once a capsule is
                  already sealed on this challenge (preserve the surprise). */}
              {(editingChallenge?.linkedCapsuleNoteId || !capsuleLockUnlocked) ? null : (
                <Reanimated.View entering={FadeIn.duration(300)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }}>SEAL A MESSAGE FOR THE FINISH LINE</Text>
                    </View>
                    <Switch value={capsuleEnabled} onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCapsuleEnabled(v); }} trackColor={{ true: theme.textMain }} thumbColor="#FFF" />
                  </View>
                  {capsuleEnabled && (
                    <View style={{ marginBottom: 24 }}>
                      <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600', lineHeight: 16, marginBottom: 10, fontStyle: 'italic' }}>From past you to future you. Opens the moment you cross the line.</Text>
                      <TextInput
                        style={[styles.inputSub, { color: theme.textMain, minHeight: 96, textAlignVertical: 'top', fontStyle: 'normal' }]}
                        placeholder="What do you want to read at the finish?"
                        placeholderTextColor={theme.border}
                        value={capsuleMessage}
                        onChangeText={setCapsuleMessage}
                        multiline
                      />
                    </View>
                  )}
                </Reanimated.View>
              )}

              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 12, marginTop: 8 }}>AESTHETICS</Text>
              {/* Color picker — wrap grid at 34px to match the swatch
                  size used in Habits and Tasks. Wraps naturally based
                  on container width so the row count adapts to the
                  device, and the dots stay small enough to feel like
                  picker chrome rather than buttons. */}
              {/* 22px circles in two explicit rows of 9, using
                  justify-content: space-between so the swatches column-
                  align between rows regardless of device width. The
                  wrap-with-gap pattern was overflowing on narrower
                  devices and pushing into a third row. */}
              {[COLORS.slice(0, 9), COLORS.slice(9, 18)].map((row, ri) => (
                <View
                  key={ri}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    marginBottom: ri === 0 ? 10 : 16,
                  }}
                >
                  {row.map(c => (
                    <TouchableOpacity
                      key={c}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setColor(c); }}
                      style={{
                        width: 22, height: 22, borderRadius: 11,
                        backgroundColor: c,
                        borderWidth: color === c ? 2 : 0,
                        borderColor: theme.textMain,
                        transform: [{ scale: color === c ? 1.15 : 1 }],
                      }}
                    />
                  ))}
                </View>
              ))}
              {/* Icon picker — horizontal scroll. Uses the gesture-handler-
                  aware ScrollView so the inner horizontal pan doesn't
                  fight the bottom sheet's vertical pan handler. */}
              <GHScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10, paddingVertical: 2, marginBottom: 32 }}
              >
                {ICONS.map(ic => (
                  <TouchableOpacity
                    key={ic}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIcon(ic); }}
                    style={{
                      width: 44, height: 44,
                      justifyContent: 'center', alignItems: 'center',
                      backgroundColor: icon === ic ? theme.textMain : theme.bg,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: icon === ic ? theme.textMain : theme.border,
                    }}
                  >
                    <Feather name={ic as any} size={18} color={icon === ic ? theme.bg : theme.textSub} />
                  </TouchableOpacity>
                ))}
              </GHScrollView>

              {/* Manage row — only for existing challenges. Link Habits
                  and Move to Trash were previously their own surfaces;
                  they live here now that the inline-expand pattern
                  replaced the full-screen detail modal. */}
              {editingChallenge ? (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, marginBottom: 4 }}>
                  {/* Link Habits gated on LINKED_HABITS (2+ active challenges).
                      Absent before unlock; the dot sits on it until tapped.
                      Move to Trash stays regardless and takes the row when
                      Link Habits is hidden. */}
                  {linkedHabitsUnlocked ? (
                  <Reanimated.View entering={FadeIn.duration(300)} style={{ flex: 1 }}>
                  <TouchableOpacity
                    onPress={() => {
                      // Open habit-link modal ON TOP of the edit sheet
                      // — don't dismiss the sheet first. RN Modal stacks
                      // above the gorhom bottom sheet, so the user can
                      // close the link modal and land back in the same
                      // edit context with their form state intact.
                      markDotSeen(FEATURE_IDS.LINKED_HABITS);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setHabitLinkChallenge(editingChallenge);
                    }}
                    style={{ paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: linkedHabitsIsNew ? '#3B82F6' : theme.border, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}
                  >
                    <Feather name="link-2" size={14} color={theme.textSub} />
                    <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>Link Habits</Text>
                    {linkedHabitsIsNew ? (
                      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#3B82F6' }} />
                    ) : null}
                  </TouchableOpacity>
                  </Reanimated.View>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                      setAddEditOpen(false);
                      requestTrash(editingChallenge);
                    }}
                    style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(244,63,94,0.3)', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}
                  >
                    <Feather name="trash-2" size={14} color={L1_COLOR} />
                    <Text style={{ color: L1_COLOR, fontSize: 12, fontWeight: '700' }}>Move to Trash</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
                  </ScrollView>
                </KeyboardAvoidingView>
              </SafeAreaView>
            </View>
          </Modal>

          {/* ── PRESET PICKER ── opens via long-press on + or via the
              empty-state CTA. Single-pick by design: tap a preset card,
              the sheet dismisses and the editor opens with the preset's
              values pre-filled. */}
          <PresetPickerSheet ref={presetsSheetRef} theme={theme} takenPresetIds={takenPresetIds} onPick={openWithPreset} />

          {/* ── TRASH SHEET — was the Storage, now scoped to trash only.
              The graveyard tab was promoted to its own full-screen
              surface (GraveyardScreen) because it's a place you visit,
              not a transient drawer. Trash stays here because its
              actions (restore / delete forever) are transactional. */}
          <BottomSheetModal ref={storageSheetRef} snapPoints={['85%']} backdropComponent={renderBackdrop} backgroundStyle={{ backgroundColor: theme.bg, borderRadius: 32 }} handleIndicatorStyle={{ backgroundColor: theme.border, width: 40, height: 5 }}>
            <View style={{ paddingHorizontal: 24, paddingTop: 10, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ fontSize: 28, fontWeight: '900', color: theme.textMain, letterSpacing: -1 }}>Trash.</Text>
                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 4, opacity: 0.8 }}>
                  AUTO-PURGE AFTER 30 DAYS
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
                {trashChallenges.length > 0 && (
                  <TouchableOpacity onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); setPurgeAllVisible(true); }} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Text style={{ color: L1_COLOR, fontWeight: '800', fontSize: 14 }}>Purge all</Text></TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => storageSheetRef.current?.dismiss()} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="x" size={24} color={theme.textMain} /></TouchableOpacity>
              </View>
            </View>
            <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
              {trashChallenges.length === 0 ? (
                <View style={{ alignItems: 'center', paddingTop: 60 }}>
                  <Feather name="trash-2" size={32} color={theme.textSub} style={{ opacity: 0.18, marginBottom: 14 }} />
                  <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '700' }}>Empty.</Text>
                </View>
              ) : trashChallenges.map(c => {
                const dl = c.deletedAt ? Math.max(0, 30 - Math.floor((Date.now() - c.deletedAt) / 86400000)) : 30;
                return (
                  <View key={c.id} style={{ padding: 16, borderRadius: 14, borderWidth: 1, borderColor: hexToRgba('#F59E0B', 0.15), backgroundColor: theme.surface, marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.color }} />
                      <Text
                        style={{
                          color: theme.textSub, fontSize: 13, fontWeight: '800', flex: 1,
                          textAlign: isRtl(c.title) ? 'right' : 'left',
                          writingDirection: isRtl(c.title) ? 'rtl' : 'ltr',
                        }}
                        numberOfLines={1}
                      >
                        {c.title}
                      </Text>
                      <Text style={{ color: '#F59E0B', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{dl + 'D'}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity onPress={() => restoreFromTrash(c.id)} style={{ flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: theme.border, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 }}><Feather name="corner-up-left" size={12} color={theme.textSub} /><Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '800' }}>Restore</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => requestDeleteForever(c)} style={{ flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(244,63,94,0.25)', backgroundColor: 'rgba(244,63,94,0.05)', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 }}><Feather name="x" size={12} color={L1_COLOR} /><Text style={{ color: L1_COLOR, fontSize: 11, fontWeight: '800' }}>Delete Forever</Text></TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </BottomSheetScrollView>
          </BottomSheetModal>

          {/* Full-screen Graveyard surface — case-file portrait cards
              with ambient scan-line. Tap a card → opens the existing
              ReviewModal so the user can resurrect (one final chance,
              new deadline) without rebuilding the resurrection flow. */}
          <GraveyardScreen
            visible={graveyardOpen}
            challenges={buriedChallenges}
            theme={theme}
            onClose={() => setGraveyardOpen(false)}
            onTap={(c) => { setGraveyardOpen(false); setReviewChallenge(c); }}
            onDelete={(c) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); saveChallenges((useAppStore.getState().challenges as Challenge[]).filter(x => x.id !== c.id), true); }}
          />

          {/* Detail view — read from current store state via id, not a
              cached snapshot, so progress and notes update live as the
              user logs / edits inside the view itself. */}
          {detailChallengeId ? (() => {
            const dc = challenges.find(c => c.id === detailChallengeId) || null;
            if (!dc) return null;
            return (
              <ChallengeDetailView
                key={dc.id}
                challenge={dc}
                theme={theme}
                calSystem={calSystem}
                insets={insets}
                onClose={detailOnClose}
                onEdit={detailOnEdit}
                onProgress={detailOnProgress}
                onCustomLog={detailOnCustomLog}
                onToggleMilestone={detailOnToggleMilestone}
                onAddNote={detailOnAddNote}
                onEditNote={detailOnEditNote}
                onRemoveNote={detailOnRemoveNote}
              />
            );
          })() : null}

          <HabitLinkModal visible={!!habitLinkChallenge} challenge={habitLinkChallenge} habits={allHabits} theme={theme} insets={insets} onSave={saveHabitLinks} onClose={() => setHabitLinkChallenge(null)} />
          <ReviewModal visible={!!reviewChallenge} challenge={reviewChallenge} theme={theme} insets={insets} calSystem={calSystem} onResurrect={handleResurrect} onBury={(id) => requestBury(id)} onClose={() => setReviewChallenge(null)} />
          <LedgerModal visible={ledgerOpen} theme={theme} insets={insets} onClose={() => setLedgerOpen(false)} />
          <AchievedModal visible={achievedVisible} challenges={challenges} theme={theme} insets={insets} onClose={() => setAchievedVisible(false)} onMarkIncomplete={(c) => { handleMarkIncomplete(c); setAchievedVisible(false); }} onMoveToTrash={(c) => { requestTrash(c); setAchievedVisible(false); }} />
          <AchievementsScreen visible={achievementsVisible} achievements={achievements} theme={theme} onClose={() => setAchievementsVisible(false)} onTrigger={(id, ft) => { const narr = ACHIEVEMENT_NARRATION[id]; setCurrentNarrator({ lines: narr.lines, dismissLabel: narr.dismiss, achievementId: id, tone: narr.tone, firstTime: ft }); }} />

          {completionCeremony && <CompletionCeremony visible challenge={completionCeremony.challenge} isFirst={completionCeremony.isFirst} wasResurrected={completionCeremony.wasResurrected} theme={theme} onDone={() => setCompletionCeremony(null)} onAchievementQueue={handleAchievementQueue} />}
          {currentNarrator && <Modal visible animationType="fade" transparent={false}><NarratorCeremony moment={currentNarrator} theme={theme} onDone={() => setCurrentNarrator(null)} /></Modal>}
          <SoftDeleteOverlay visible={softDeleteMode === 'trash'} title={softDeleteTarget?.title || ''} subtitle="You're sure?" confirmLabel="GONE." cancelLabel="Not yet." onConfirm={confirmTrash} onCancel={() => { setSoftDeleteTarget(null); setSoftDeleteMode(null); }} theme={theme} />
          <SoftDeleteOverlay visible={softDeleteMode === 'forever'} title={softDeleteTarget?.title || ''} subtitle={"This cannot be undone.\nThis challenge will not be remembered."} confirmLabel="ERASE IT." cancelLabel="KEEP IT." onConfirm={confirmDeleteForever} onCancel={() => { setSoftDeleteTarget(null); setSoftDeleteMode(null); }} theme={theme} />
          <SoftDeleteOverlay visible={purgeAllVisible} title="Purge all trash" subtitle={"Every challenge in the trash will be erased.\nThis cannot be undone."} confirmLabel="PURGE ALL." cancelLabel="KEEP THEM." onConfirm={confirmPurgeAll} onCancel={() => setPurgeAllVisible(false)} theme={theme} />

          {/* The "preset slot occupied" status now lives passively in
              the active list (top dashed row), so this overlay was
              removed — no modal interrupt needed. */}
          <GraveyardBuryOverlay visible={!!graveyardBuryTarget} challenge={graveyardBuryTarget} onConfirm={confirmBury} onCancel={() => setGraveyardBuryTarget(null)} theme={theme} />

          {/* Custom-amount log modal — opened by long-pressing the +1
              LOG button inside an expanded card. Tap outside or the X
              to dismiss. */}
          {customLogChallenge ? (
            <Modal visible transparent animationType="fade" onRequestClose={() => setCustomLogChallenge(null)}>
              <View style={{ flex: 1, backgroundColor: theme.isDark ? 'rgba(0,0,0,0.93)' : 'rgba(255,255,255,0.93)', justifyContent: 'center', alignItems: 'center', padding: 36 }}>
                <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={() => setCustomLogChallenge(null)} />
                <View style={{ width: '100%', alignItems: 'center' }}>
                  <Text style={{ fontSize: 10, color: theme.textSub, letterSpacing: 2, marginBottom: 18 }}>LOG CUSTOM AMOUNT</Text>
                  <Text
                    style={{
                      fontSize: 20, fontWeight: '900', color: theme.textMain,
                      letterSpacing: -0.4, marginBottom: 6, textAlign: 'center',
                      writingDirection: isRtl(customLogChallenge.title) ? 'rtl' : 'ltr',
                    }}
                  >
                    {customLogChallenge.title}
                  </Text>
                  <Text style={{ fontSize: 11, color: theme.textSub, marginBottom: 28, textAlign: 'center' }}>
                    {customLogChallenge.current} / {customLogChallenge.target} {customLogChallenge.unit}
                  </Text>
                  <TextInput
                    autoFocus
                    style={{ width: '100%', maxWidth: 280, height: 56, borderRadius: 10, borderWidth: 1, textAlign: 'center', fontSize: 22, fontWeight: '900', backgroundColor: theme.bg, color: theme.textMain, borderColor: theme.border, marginBottom: 18 }}
                    value={customLogValue}
                    onChangeText={v => setCustomLogValue(v.replace(/[^0-9]/g, ''))}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={theme.border}
                  />
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                    <TouchableOpacity
                      onPress={() => {
                        const n = parseInt(customLogValue);
                        if (!n) return;
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        updateProgress(customLogChallenge.id, -n, 'bulk');
                        setCustomLogChallenge(null);
                        setCustomLogValue('');
                      }}
                      disabled={!parseInt(customLogValue)}
                      style={{ paddingHorizontal: 24, paddingVertical: 14, borderWidth: 1, borderColor: theme.border, borderRadius: 4, opacity: parseInt(customLogValue) ? 1 : 0.4 }}
                    >
                      <Text style={{ color: theme.textMain, fontSize: 12, fontWeight: '900', letterSpacing: 2 }}>SUBTRACT</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        const n = parseInt(customLogValue);
                        if (!n) return;
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        updateProgress(customLogChallenge.id, n, 'bulk');
                        setCustomLogChallenge(null);
                        setCustomLogValue('');
                      }}
                      disabled={!parseInt(customLogValue)}
                      style={{ paddingHorizontal: 24, paddingVertical: 14, borderWidth: 1, borderColor: customLogChallenge.color, borderRadius: 4, backgroundColor: parseInt(customLogValue) ? hexToRgba(customLogChallenge.color, 0.12) : 'transparent', opacity: parseInt(customLogValue) ? 1 : 0.4 }}
                    >
                      <Text style={{ color: customLogChallenge.color, fontSize: 12, fontWeight: '900', letterSpacing: 2 }}>ADD</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={() => { setCustomLogChallenge(null); setCustomLogValue(''); }}
                    hitSlop={{ top: 15, bottom: 15, left: 30, right: 30 }}
                  >
                    <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>CANCEL</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          ) : null}

          {/* The full-screen detail modal and quick-action middle modal
              were both removed in the activity-ring redesign. Tap on a
              card now expands inline (pace + −1 / +1 LOG); long-press
              opens the add/edit sheet directly, where habit links,
              trash, milestone toggling, and all other editing live. */}
        </View>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  experimentalWrapper: { flex: 1 },
  overlayBottom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  bottomSheet: { borderTopLeftRadius: 32, borderTopRightRadius: 32, borderWidth: 1, borderBottomWidth: 0, paddingHorizontal: 24, paddingTop: 20, width: '100%' },
  modalDragHandle: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 20 },
  modalSectionTitle: { fontSize: 22, fontWeight: '900', marginBottom: 8 },
  inputLabel: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  inputTitle: { fontSize: 24, fontWeight: '900', marginBottom: 15 },
  inputSub: { fontSize: 15, fontWeight: '700', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: 'rgba(150,150,150,0.1)' },
  colorRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  colorDot: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  colorDotInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFF' },
  saveBtn: { paddingHorizontal: 28, paddingVertical: 13, borderRadius: 100 },
  saveBtnText: { fontWeight: '900', fontSize: 15 },
  habitLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  linkCheckbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  list: { paddingHorizontal: 20, paddingBottom: 110, paddingTop: 8 },
  clearDeadlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
});