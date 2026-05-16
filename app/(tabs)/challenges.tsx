import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, Pressable, Dimensions,
  Platform, Modal, TextInput, KeyboardAvoidingView, Animated, Easing,
  StatusBar, TouchableWithoutFeedback, LayoutAnimation, UIManager, BackHandler, Switch
} from 'react-native';
import { GestureHandlerRootView, ScrollView as GHScrollView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  BottomSheetModal, BottomSheetModalProvider, BottomSheetBackdrop,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import Svg, { Circle } from 'react-native-svg';
import Reanimated, { useSharedValue, useAnimatedProps, runOnJS } from 'react-native-reanimated';

import { useAppStore, Task, Habit, CalendarSystem, Challenge, Achievement, AchievementId, Milestone, NoteEntry, DeadState, ChallengeUrgency, UrgencyStyle, NarratorTone, Note } from '../../store/useAppStore';
import { calculateGlobalStrength } from '../../lib/habitScore';
import { isRtl } from '../../lib/rtl';
import { PresetPickerSheet } from '../../components/challenges/PresetPickerSheet';
import { ChallengePreset, CHALLENGE_PRESETS } from '../../lib/challengePresets';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try { UIManager.setLayoutAnimationEnabledExperimental(true); } catch (e) {}
}

const { width, height } = Dimensions.get('window');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const L1_COLOR = '#F43F5E';
const L2_COLOR = '#F59E0B';
const L3_COLOR = '#8B5CF6';
const DEV_MODE = false; // ← set to false before shipping

type NarratorMoment = { lines: string[]; dismissLabel: string; achievementId?: AchievementId; tone: NarratorTone; firstTime?: boolean; };

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
function getUrgencyLevel(ts?: number, override?: UrgencyStyle): ChallengeUrgency { if (!ts) return 'none'; const d = daysUntil(ts)!; if (d > 14) return 'none'; if (override && override !== 'auto') return override as ChallengeUrgency; if (d <= 3) return 'haemorrhage'; if (d <= 7) return 'static'; return 'none'; }
function urgencyColor(level: ChallengeUrgency) { if (level === 'static') return L2_COLOR; if (level === 'haemorrhage') return L1_COLOR; return 'transparent'; }
function shouldBeDead(c: Challenge) { if (c.deadState !== 'active' && c.deadState !== 'resurrected') return false; if (!c.deadlineTs || c.current >= c.target) return false; return Date.now() > c.deadlineTs; }

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function countConsecutiveLogDays(logDates: string[]): number {
  if (!logDates.length) return 0;
  const unique = Array.from(new Set(logDates)).sort().reverse();
  let streak = 0;
  const check = new Date(); check.setHours(0, 0, 0, 0);
  for (const str of unique) {
    const d = `${check.getFullYear()}-${String(check.getMonth() + 1).padStart(2, '0')}-${String(check.getDate()).padStart(2, '0')}`;
    if (str === d) { streak++; check.setDate(check.getDate() - 1); } else break;
  }
  return streak;
}

const DEAD_MESSAGES: { label: string; text: string; cause: string }[] = [
  { label: 'OBJECTIVE ABANDONED', text: 'This directive was issued. It was not executed.\nThe operator made a choice. This is the record of that choice.', cause: 'OPERATOR INACTION' },
  { label: 'PROTOCOL BREACH', text: 'The system set a deadline.\nThe system was ignored.\nThe system remembers everything.', cause: 'DEADLINE BREACH' },
  { label: 'MISSION FAILURE', text: 'Target acquisition was initiated.\nTarget was not secured.\nAll resources allocated to this objective have been logged.', cause: 'MISSION ABORT' },
];
function getDeadMessage(c: Challenge) {
  if (c.current === 0) return { label: 'UNTOUCHED', text: "You created this.\nYou never touched it.\nNot once.", cause: 'ZERO ENGAGEMENT' };
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
const FloatingParticle = ({ color, delay }: { color: string; delay: number }) => {
  const anim = useRef(new Animated.Value(0)).current;
  const startX = useMemo(() => 20 + Math.random() * (width - 40), []);
  const size = useMemo(() => 2 + Math.random() * 3, []);
  useEffect(() => { const loop = Animated.loop(Animated.sequence([Animated.delay(delay), Animated.timing(anim, { toValue: 1, duration: 4000 + Math.random() * 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }), Animated.timing(anim, { toValue: 0, duration: 4000 + Math.random() * 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: true })])); loop.start(); return () => loop.stop(); }, []);
  return <Animated.View style={{ position: 'absolute', left: startX, bottom: height * 0.35, width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: 0.4, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -40] }) }] }} />;
};

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
  const progress = Math.min(1, challenge.current / challenge.target);
  const scanAnim = useRef(new Animated.Value(0)).current;
  // Slow scan-line — kept for the surveillance vibe, but with a stop()
  // on unmount and a stopped() ref so the loop doesn't keep walking
  // when the user navigates away from the tab. Previously it ran
  // forever per dead card, in parallel, even off-screen.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(scanAnim, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: false })
    );
    loop.start();
    return () => { loop.stop(); scanAnim.stopAnimation(); };
  }, []);
  const caseId = challenge.id.slice(-6).toUpperCase();
  return (
    <View style={[StyleSheet.absoluteFill, { borderRadius: 18, backgroundColor: '#0A0A0A', zIndex: 20, overflow: 'hidden' }]}>
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: isPermanent ? 'rgba(244,63,94,0.12)' : 'rgba(255,255,255,0.04)', top: scanAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} pointerEvents="none" />
      {/* Voice: clinical observation. Single register, no sci-fi
          ("TIMELINE SEVERED") or detective metaphors ("CASE FILE") —
          just a quiet record that the deadline came and went. */}
      <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <Text style={{ color: isPermanent ? L1_COLOR : '#555', fontSize: 9, fontWeight: '900', letterSpacing: 2.5, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' }}>{isPermanent ? 'CLOSED' : 'EXPIRED'}</Text>
          <Text style={{ color: '#333', fontSize: 9, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' }}>{'#' + caseId}</Text>
        </View>
        <Text
          style={{
            color: '#FFF', fontSize: 13, fontWeight: '900', letterSpacing: 0.4,
            textAlign: isRtl(challenge.title) ? 'right' : 'left',
            writingDirection: isRtl(challenge.title) ? 'rtl' : 'ltr',
          }}
          numberOfLines={1}
        >
          {challenge.title}
        </Text>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 14 }}>
        <Text style={{ color: isPermanent ? L1_COLOR : '#888', fontSize: 9, fontWeight: '900', letterSpacing: 2, marginBottom: 6 }}>DEADLINE PASSED</Text>
        <Text style={{ color: isPermanent ? '#FFAAAA' : '#CCC', fontSize: 11, lineHeight: 16, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' }}>{`${Math.round(progress * 100)}% reached. Target was ${challenge.target} ${challenge.unit}.`}</Text>
      </View>
      <View style={{ marginHorizontal: 14, marginBottom: 10, height: 2, backgroundColor: '#1A1A1A', borderRadius: 1, overflow: 'hidden' }}><View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: isPermanent ? 'rgba(244,63,94,0.38)' : '#333', borderRadius: 1 }} /></View>
      {!isPermanent ? (
        <TouchableOpacity onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); onReview(); }} style={{ margin: 10, marginTop: 0, backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#2A2A2A', paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}><Text style={{ color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 }}>REVIEW</Text><Text style={{ color: '#555', fontSize: 10, fontWeight: '600', marginTop: 2 }}>One decision left: resurrect or bury</Text></View>
          <Feather name="arrow-right" size={14} color="#666" />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); onReview(); }} style={{ margin: 10, marginTop: 0, backgroundColor: 'rgba(244,63,94,0.08)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(244,63,94,0.2)', paddingVertical: 12 }}>
          <Text style={{ color: L1_COLOR, fontSize: 11, fontWeight: '900', letterSpacing: 0.5, textAlign: 'center' }}>BURY</Text>
        </TouchableOpacity>
      )}
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
// Pace projection — extracted so both the card's deadline subtitle
// and the full-screen detail view can share the same formatting.
function computePace(challenge: Challenge, theme: any) {
  const isDone = challenge.current >= challenge.target;
  if (isDone) return { text: 'Target reached.', color: theme.success };
  if (challenge.current === 0) return { text: 'Awaiting first log.', color: theme.textSub };
  const elapsedDays = Math.max(1, (Date.now() - challenge.createdAt) / 86400000);
  const ratePerDay = challenge.current / elapsedDays;
  const remaining = challenge.target - challenge.current;
  const projectedDays = Math.ceil(remaining / ratePerDay);
  if (!challenge.deadlineTs) return { text: `~${projectedDays}d remaining at current rate.`, color: theme.textSub };
  const actualDaysLeft = Math.max(0, Math.ceil((challenge.deadlineTs - Date.now()) / 86400000));
  const buffer = actualDaysLeft - projectedDays;
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

const CompletionBurst = ({ color, visible }: { color: string; visible: boolean }) => {
  const anims = useRef(Array.from({ length: 12 }, () => new Animated.Value(0))).current;
  useEffect(() => { if (!visible) return; Animated.parallel(anims.map((a, i) => Animated.sequence([Animated.delay(i * 25), Animated.spring(a, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true })]))).start(); const t = setTimeout(() => Animated.parallel(anims.map(a => Animated.timing(a, { toValue: 0, duration: 400, useNativeDriver: true }))).start(), 1400); return () => clearTimeout(t); }, [visible]);
  if (!visible) return null;
  return (<View style={StyleSheet.absoluteFill} pointerEvents="none">{anims.map((anim, i) => { const angle = (i / 12) * Math.PI * 2; return <Animated.View key={i} style={{ position: 'absolute', top: '45%', left: '45%', width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity: anim, transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * 90] }) }, { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * 90] }) }, { scale: anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1.6, 0.5] }) }] }} />; })}</View>);
};

const NarratorCeremony = ({ moment, theme, onDone }: { moment: NarratorMoment; theme: any; onDone: () => void }) => {
  const [displayedLines, setDisplayedLines] = useState<string[]>([]);
  const [currentLineText, setCurrentLineText] = useState('');
  const [typingDone, setTypingDone] = useState(false);
  const symAnim = useRef(new Animated.Value(0)).current;
  const textAnim = useRef(new Animated.Value(0)).current;
  const btnAnim = useRef(new Animated.Value(0)).current;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alive = useRef(true);
  const ach = moment.achievementId ? ACHIEVEMENT_DEFS.find(a => a.id === moment.achievementId) : null;
  const effectiveTone = (moment.achievementId && EXISTENTIAL_OVERRIDES.has(moment.achievementId)) ? 'existential' as NarratorTone : moment.tone;
  const charMs = NARRATOR_CHAR_SPEED[effectiveTone];
  const pauseMs = NARRATOR_LINE_PAUSE[effectiveTone];
  const addTimer = (fn: () => void, ms: number) => { const t = setTimeout(() => { if (alive.current) fn(); }, ms); timers.current.push(t); };
  const typeLines = useCallback((lineIdx: number, lines: string[]) => {
    if (lineIdx >= lines.length) { setTypingDone(true); addTimer(() => Animated.timing(btnAnim, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(), 400); return; }
    const line = lines[lineIdx]; let ci = 0;
    const tick = () => { if (!alive.current) return; if (ci < line.length) { ci++; setCurrentLineText(line.slice(0, ci)); const ch = line[ci - 1]; const ms = ch === '.' || ch === '…' ? charMs * 5 : ch === ',' ? charMs * 3 : ch === '!' || ch === '?' ? charMs * 4 : ch === ' ' ? charMs * 1.3 : charMs; addTimer(tick, ms); } else { setDisplayedLines(prev => [...prev, line]); setCurrentLineText(''); addTimer(() => typeLines(lineIdx + 1, lines), pauseMs); } };
    tick();
  }, [charMs, pauseMs]);
  useEffect(() => {
    // Entry choreography pushed as fast as possible. Text starts
    // already visible (textAnim init = 1) and typing begins on the
    // same tick the modal becomes interactive — no setTimeout
    // padding. The symbol still fades in for the stamp-press feel
    // but doesn't block anything else.
    alive.current = true; setDisplayedLines([]); setCurrentLineText(''); setTypingDone(false);
    symAnim.setValue(0); textAnim.setValue(1); btnAnim.setValue(0);
    timers.current.forEach(clearTimeout); timers.current = [];
    Animated.timing(symAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    typeLines(0, moment.lines);
    return () => { alive.current = false; timers.current.forEach(clearTimeout); };
  }, [moment.achievementId, moment.lines.join('|')]);
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center', padding: 44 }}>
      <StatusBar barStyle={theme.bg === '#000000' ? 'light-content' : 'dark-content'} />
      {ach && (<Animated.View style={{ marginBottom: 36, opacity: symAnim, transform: [{ scale: symAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }], alignItems: 'center' }}><Text style={{ fontSize: 52, color: theme.textMain, fontWeight: '900', textAlign: 'center' }}>{ach.sym}</Text>{!moment.firstTime && (<Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 3, color: theme.textSub, textAlign: 'center', marginTop: 10, opacity: 0.7 }}>{ach.name}</Text>)}</Animated.View>)}
      <Animated.View style={{ opacity: textAnim, width: '100%' }}>{displayedLines.map((line, i) => (<Text key={i} style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: theme.textSub, fontSize: 13, lineHeight: 22, marginBottom: 2 }}>{line}</Text>))}{!typingDone && (<Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: theme.textMain, fontSize: 13, lineHeight: 22, opacity: 0.85 }}>{currentLineText}<Text style={{ color: theme.textSub, opacity: 0.5 }}>▌</Text></Text>)}</Animated.View>
      <Animated.View style={{ position: 'absolute', bottom: 60, opacity: btnAnim, transform: [{ translateY: btnAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}><TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onDone(); }} hitSlop={{ top: 20, bottom: 20, left: 40, right: 40 }}><Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '900', letterSpacing: 2.5 }}>{moment.dismissLabel}</Text></TouchableOpacity></Animated.View>
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
        <StatusBar barStyle={theme.bg === '#000000' ? 'light-content' : 'dark-content'} />
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
  const isDark = theme.bg === '#000000';
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
              <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 18, opacity: 0.85 }}>Achievements appear here as you earn them. Their names won't be shown until you do.</Text>
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
                        <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: theme.textSub, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginTop: 6, opacity: 0.6 }}>
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
const LOCK_FOCUS_HOURS = 10;
const LOCK_TASKS = 10;
const LOCK_HABIT_SCORE = 30;
const LOCK_PROMISES_KEPT = 1;

const LockScreen = ({ focusHrs, tasksDone, habitScore, promisesKept, onUnlock, theme }: {
  focusHrs: number;
  tasksDone: number;
  habitScore: number;
  promisesKept: number;
  onUnlock: () => void;
  theme: any;
}) => {
  const focusPct = Math.min(1, focusHrs / LOCK_FOCUS_HOURS);
  const tasksPct = Math.min(1, tasksDone / LOCK_TASKS);
  const habitPct = Math.min(1, habitScore / LOCK_HABIT_SCORE);
  const promisePct = Math.min(1, promisesKept / LOCK_PROMISES_KEPT);
  const allMet = focusPct >= 1 && tasksPct >= 1 && habitPct >= 1 && promisePct >= 1;
  const focusAnim = useRef(new Animated.Value(0)).current;
  const tasksAnim = useRef(new Animated.Value(0)).current;
  const habitAnim = useRef(new Animated.Value(0)).current;
  const promiseAnim = useRef(new Animated.Value(0)).current;
  const unlockAnim = useRef(new Animated.Value(0)).current;
  const [metLines, setMetLines] = useState<string[]>([]);
  useEffect(() => {
    Animated.sequence([
      Animated.timing(focusAnim, { toValue: focusPct, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.delay(120),
      Animated.timing(tasksAnim, { toValue: tasksPct, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.delay(120),
      Animated.timing(habitAnim, { toValue: habitPct, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.delay(120),
      Animated.timing(promiseAnim, { toValue: promisePct, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start(() => {
      const lines: string[] = [];
      if (focusPct >= 1) lines.push('> Focus threshold met.');
      if (tasksPct >= 1) lines.push('> Task count verified.');
      if (habitPct >= 1) lines.push('> Habit strength confirmed.');
      if (promisePct >= 1) lines.push('> Promise kept.');
      if (lines.length) setMetLines(lines);
      if (allMet) setTimeout(() => Animated.timing(unlockAnim, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(), 400);
    });
  }, [focusPct, tasksPct, habitPct, promisePct, allMet]);
  const Bar = ({ label, value, anim, met }: { label: string; value: string; anim: Animated.Value; met: boolean }) => (
    <View style={{ marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{met && <Text style={{ color: '#10B981', fontSize: 11 }}>✓</Text>}<Text style={{ color: met ? '#10B981' : theme.textMain, fontSize: 13, fontWeight: '900', letterSpacing: 0.3 }}>{label}</Text></View>
        <Text style={{ color: met ? '#10B981' : theme.textSub, fontSize: 11, fontWeight: '700' }}>{value}</Text>
      </View>
      <View style={{ height: 2, backgroundColor: theme.surface, borderRadius: 1, overflow: 'hidden' }}><Animated.View style={{ height: '100%', borderRadius: 1, backgroundColor: met ? '#10B981' : theme.textMain, width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} /></View>
    </View>
  );
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: theme.bg }]}>
      <StatusBar barStyle={theme.bg === '#000000' ? 'light-content' : 'dark-content'} />
      {Array.from({ length: 5 }).map((_, i) => <FloatingParticle key={i} color={COLORS[i % COLORS.length]} delay={i * 700} />)}
      <ScrollView contentContainerStyle={{ padding: 36, paddingTop: 60, flexGrow: 1, justifyContent: 'center' }} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 3, color: theme.textSub, marginBottom: 8 }}>SECTOR LOCKED</Text>
        <Text style={{ fontSize: 32, fontWeight: '900', color: theme.textMain, letterSpacing: -1, marginBottom: 8 }}>Earn access.</Text>
        <Text style={{ fontSize: 13, color: theme.textSub, lineHeight: 20, marginBottom: 36 }}>Four conditions. All at once.</Text>
        <Bar label="Deep work" value={`${Math.round(focusHrs * 10) / 10} / ${LOCK_FOCUS_HOURS} hrs`} anim={focusAnim} met={focusPct >= 1} />
        <Bar label="Tasks done" value={`${Math.min(tasksDone, LOCK_TASKS)} / ${LOCK_TASKS}`} anim={tasksAnim} met={tasksPct >= 1} />
        <Bar label="Habit strength" value={`${Math.min(habitScore, LOCK_HABIT_SCORE)} / ${LOCK_HABIT_SCORE}`} anim={habitAnim} met={habitPct >= 1} />
        <Bar label="Promises kept" value={`${Math.min(promisesKept, LOCK_PROMISES_KEPT)} / ${LOCK_PROMISES_KEPT}`} anim={promiseAnim} met={promisePct >= 1} />
        {metLines.length > 0 && <View style={{ marginTop: 4, marginBottom: 20 }}>{metLines.map((l, i) => <Text key={i} style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: '#10B981', fontSize: 11, lineHeight: 18 }}>{l}</Text>)}</View>}
        {allMet && <Animated.View style={{ opacity: unlockAnim, transform: [{ translateY: unlockAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}><TouchableOpacity onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onUnlock(); }} style={{ paddingVertical: 18, borderRadius: 4, borderWidth: 1, borderColor: theme.textMain, alignItems: 'center', marginTop: 8 }}><Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '900', letterSpacing: 3 }}>UNLOCK</Text></TouchableOpacity></Animated.View>}
        {DEV_MODE && <TouchableOpacity style={{ marginTop: 40, padding: 10, alignSelf: 'center' }} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onUnlock(); }}><Text style={{ color: theme.textSub, fontSize: 9, letterSpacing: 3 }}>DEV OVERRIDE</Text></TouchableOpacity>}
      </ScrollView>
    </SafeAreaView>
  );
};

// Wrapper that owns the metric computation. Mounted only when the tab
// is locked — once unlocked, this component (and all its expensive
// reductions over tasks/habits/sessions) never instantiates. Cuts the
// "challenges tab takes a while to open" cost for unlocked users.
const LockGate = ({ onUnlock, theme }: { onUnlock: () => void; theme: any }) => {
  const tasks = useAppStore(s => s.tasks);
  const deepWorkSessions = useAppStore(s => s.deepWorkSessions);
  const promiseStats = useAppStore(s => s.promiseStats);
  const allHabits = useAppStore(s => s.habits);

  const focusHrs = useMemo(
    () => deepWorkSessions.reduce((acc, s) => acc + (s.durationMs || 0), 0) / 3_600_000,
    [deepWorkSessions]
  );
  const tasksDone = useMemo(
    () => tasks.filter(t => t.completed && t.status !== 'trash').length,
    [tasks]
  );
  const habitScore = useMemo(() => {
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return calculateGlobalStrength(allHabits, todayStr);
  }, [allHabits]);
  const promisesKept = promiseStats.keptTotal;

  return (
    <LockScreen
      focusHrs={focusHrs}
      tasksDone={tasksDone}
      habitScore={habitScore}
      promisesKept={promisesKept}
      onUnlock={onUnlock}
      theme={theme}
    />
  );
};

// ── GRAVEYARD SCREEN ────────────────────────────────────────────────
// Promoted from a tab inside the Vault sheet to its own full-screen
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
const GraveyardScreen = ({ visible, challenges, theme, onClose, onTap }: { visible: boolean; challenges: Challenge[]; theme: any; onClose: () => void; onTap: (c: Challenge) => void; }) => {
  const scanAnim = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (!visible) { loopRef.current?.stop(); loopRef.current = null; scanAnim.setValue(0); return; }
    loopRef.current = Animated.loop(
      Animated.timing(scanAnim, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: false })
    );
    loopRef.current.start();
    return () => { loopRef.current?.stop(); loopRef.current = null; };
  }, [visible]);

  const dateRange = useMemo(() => {
    if (challenges.length === 0) return '';
    const stamps = challenges.map(c => c.buriedAt || c.createdAt).sort((a, b) => a - b);
    const fmt = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    if (stamps[0] === stamps[stamps.length - 1]) return fmt(stamps[0]);
    return `${fmt(stamps[0])} – ${fmt(stamps[stamps.length - 1])}`;
  }, [challenges]);
  const isDark = theme.bg === '#000000';

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        {/* Ambient scan-line — 1px tall, full width, drifting top-to-
            bottom on an 8s loop. Pure decoration, pointer-events off. */}
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(244,63,94,0.06)', top: scanAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />

        <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 28, fontWeight: '900', color: theme.textMain, letterSpacing: -1 }}>Graveyard.</Text>
            <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: theme.textSub, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 6 }}>
              {challenges.length} BURIED{dateRange ? ` · ${dateRange}` : ''}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
            <Feather name="x" size={22} color={theme.textSub} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {challenges.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 }}>
              <Feather name="moon" size={36} color={theme.textSub} style={{ opacity: 0.18, marginBottom: 18 }} />
              <Text style={{ color: theme.textMain, fontSize: 16, fontWeight: '900', textAlign: 'center', marginBottom: 6 }}>The graveyard is empty.</Text>
              <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 18, opacity: 0.85 }}>Buried challenges live here. They are not deleted; they are remembered.</Text>
            </View>
          ) : (
            challenges.map(c => {
              const caseId = c.id.slice(-6).toUpperCase();
              const buriedDate = c.buriedAt ? new Date(c.buriedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase() : '';
              const msg = getDeadMessage(c);
              const pct = Math.round(Math.min(1, c.current / c.target) * 100);
              return (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onTap(c); }}
                  activeOpacity={0.85}
                  style={{ marginBottom: 12, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(244,63,94,0.15)', borderLeftWidth: 3, borderLeftColor: 'rgba(244,63,94,0.4)', overflow: 'hidden' }}
                >
                  {/* Header strip — case ID + buried date in monospace */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 }}>
                    <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: theme.textSub, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }}>#{caseId}</Text>
                    <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: '#F43F5E', fontSize: 9, fontWeight: '900', letterSpacing: 1.2, opacity: 0.8 }}>BURIED · {buriedDate}</Text>
                  </View>
                  <View style={{ height: 1, backgroundColor: theme.border, marginHorizontal: 14 }} />

                  {/* Title */}
                  <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
                    <Text
                      style={{
                        color: theme.textMain, fontSize: 16, fontWeight: '900', letterSpacing: -0.2,
                        textAlign: isRtl(c.title) ? 'right' : 'left',
                        writingDirection: isRtl(c.title) ? 'rtl' : 'ltr',
                      }}
                      numberOfLines={2}
                    >
                      {c.title}
                    </Text>
                  </View>

                  {/* Data row — progress + cause */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 10 }}>
                    <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: theme.textSub, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 }}>
                      PROGRESS {pct}%
                    </Text>
                    <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.border }} />
                    <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: theme.textSub, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 }}>
                      {c.current}/{c.target} {c.unit?.toUpperCase()}
                    </Text>
                    <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.border }} />
                    <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: theme.textSub, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 }}>
                      CAUSE {msg.cause.toUpperCase()}
                    </Text>
                  </View>

                  {/* Progress bar — muted red, 2px */}
                  <View style={{ marginHorizontal: 14, marginTop: 10, height: 2, backgroundColor: theme.border, borderRadius: 1, overflow: 'hidden' }}>
                    <View style={{ height: '100%', width: `${pct}%`, backgroundColor: 'rgba(244,63,94,0.4)' }} />
                  </View>

                  {/* Clinical dead-message in italic monospace */}
                  <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: theme.textSub, fontSize: 11, fontStyle: 'italic', lineHeight: 17, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, opacity: 0.85 }}>
                    {msg.text}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const HabitLinkModal = ({ visible, challenge, habits, theme, insets, onSave, onClose }: { visible: boolean; challenge: Challenge | null; habits: Habit[]; theme: any; insets: { bottom: number }; onSave: (id: string, ids: string[]) => void; onClose: () => void; }) => {
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { if (challenge) setSelected(challenge.linkedHabitIds || []); }, [challenge?.id]);
  const active = habits.filter(h => h.status === 'active');
  const toggle = (id: string) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]); };
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlayBottom}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.bottomSheet, { backgroundColor: theme.surface, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, 20) + 16 }]}>
          <View style={[styles.modalDragHandle, { backgroundColor: theme.border }]} />
          <Text style={[styles.modalSectionTitle, { color: theme.textMain }]}>Link Habits</Text>
          <Text style={{ color: theme.textSub, fontSize: 13, marginBottom: 20, lineHeight: 19 }}>Each day you fully complete a linked habit, this challenge advances by 1.</Text>
          <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
            {active.length === 0 ? (<View style={{ alignItems: 'center', paddingVertical: 30 }}><Feather name="activity" size={32} color={theme.textSub} style={{ opacity: 0.3, marginBottom: 12 }} /><Text style={{ color: theme.textSub, fontSize: 14, textAlign: 'center' }}>No active habits yet.</Text></View>) : active.map(h => { const isLinked = selected.includes(h.id); return (<TouchableOpacity key={h.id} onPress={() => toggle(h.id)} style={[styles.habitLinkRow, { backgroundColor: isLinked ? h.color + '18' : theme.bg, borderColor: isLinked ? h.color : theme.border }]}><View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: h.color + '25', justifyContent: 'center', alignItems: 'center' }}><Feather name={h.icon as any} size={15} color={h.color} /></View><Text style={{ color: isLinked ? theme.textMain : theme.textSub, fontWeight: '700', flex: 1, fontSize: 14 }}>{h.title}</Text><View style={[styles.linkCheckbox, { borderColor: isLinked ? h.color : theme.border, backgroundColor: isLinked ? h.color : 'transparent' }]}>{isLinked && <Feather name="check" size={10} color="#FFF" />}</View></TouchableOpacity>); })}
            <View style={{ height: 20 }} />
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10 }}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Text style={{ color: theme.textSub, fontWeight: '800' }}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { if (challenge) { onSave(challenge.id, selected); onClose(); } }} style={[styles.saveBtn, { backgroundColor: theme.textMain }]}><Text style={[styles.saveBtnText, { color: theme.bg }]}>Save Links</Text></TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const ReviewModal = ({ visible, challenge, theme, insets, calSystem, onResurrect, onBury, onClose }: { visible: boolean; challenge: Challenge | null; theme: any; insets: { bottom: number }; calSystem: CalendarSystem; onResurrect: (id: string, ts: number) => void; onBury: (id: string) => void; onClose: () => void; }) => {
  const [newTs, setNewTs] = useState<number | undefined>();
  const isPermanent = challenge?.deadState === 'resurrected';
  useEffect(() => { if (visible) setNewTs(undefined); }, [visible]);
  if (!challenge) return null;
  const progress = Math.min(1, challenge.current / challenge.target), msg = getDeadMessage(challenge);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlayBottom}>
        <TouchableWithoutFeedback onPress={onClose}><View style={StyleSheet.absoluteFill} /></TouchableWithoutFeedback>
        <View style={[styles.bottomSheet, { backgroundColor: theme.surface, borderColor: theme.border, maxHeight: '92%', paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={[styles.modalDragHandle, { backgroundColor: theme.border }]} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(244,63,94,0.1)', justifyContent: 'center', alignItems: 'center' }}><Feather name={isPermanent ? 'x-circle' : 'alert-circle'} size={18} color="#F43F5E" /></View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: theme.textMain, fontSize: 17, fontWeight: '900',
                  textAlign: isRtl(challenge.title) ? 'right' : 'left',
                  writingDirection: isRtl(challenge.title) ? 'rtl' : 'ltr',
                }}
              >
                {challenge.title}
              </Text>
              <Text style={{ color: '#F43F5E', fontSize: 9, fontWeight: '900', letterSpacing: 1.5, marginTop: 2 }}>
                {isPermanent ? 'CLOSED — NO MORE ATTEMPTS' : 'DEADLINE PASSED — REVIEW REQUIRED'}
              </Text>
            </View>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
            <View style={{ backgroundColor: theme.bg, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 16, marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', gap: 20, marginBottom: 14 }}><View><Text style={{ color: theme.textSub, fontSize: 8, fontWeight: '900', letterSpacing: 1.5 }}>CAUSE</Text><Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '700', marginTop: 3 }}>{msg.cause}</Text></View><View><Text style={{ color: theme.textSub, fontSize: 8, fontWeight: '900', letterSpacing: 1.5 }}>PROGRESS</Text><Text style={{ color: '#F43F5E', fontSize: 11, fontWeight: '700', marginTop: 3 }}>{Math.round(progress * 100)}%</Text></View></View>
              <View style={{ height: 4, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden', marginBottom: 12 }}><View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: '#F43F5E', borderRadius: 2 }} /></View>
              <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: theme.textMain, fontSize: 11, lineHeight: 17 }}>{msg.text}</Text>
            </View>
            {!isPermanent && (<><Text style={[styles.inputLabel, { color: theme.textSub, marginBottom: 12 }]}>RESURRECT — Set a new deadline</Text><CalendarPicker value={newTs} onChange={setNewTs} theme={theme} calSystem={calSystem} /><TouchableOpacity disabled={!newTs} onPress={() => { if (newTs) { onResurrect(challenge.id, newTs); onClose(); } }} style={[styles.saveBtn, { backgroundColor: newTs ? L3_COLOR : theme.border, alignItems: 'center', marginBottom: 12, paddingVertical: 16 }]}><Text style={{ color: newTs ? '#FFF' : theme.textSub, fontWeight: '900', fontSize: 15, letterSpacing: 0.5 }}>RESURRECT</Text><Text style={{ color: newTs ? 'rgba(255,255,255,0.6)' : theme.textSub, fontSize: 10, fontWeight: '600', marginTop: 2 }}>One final attempt.</Text></TouchableOpacity></>)}
            <TouchableOpacity onPress={() => { onBury(challenge.id); onClose(); }} style={[styles.saveBtn, { backgroundColor: 'rgba(244,63,94,0.08)', borderWidth: 1, borderColor: 'rgba(244,63,94,0.25)', alignItems: 'center', paddingVertical: 16, marginBottom: 20 }]}><Text style={{ color: '#F43F5E', fontWeight: '900', fontSize: 15, letterSpacing: 0.5 }}>BURY</Text><Text style={{ color: 'rgba(244,63,94,0.45)', fontSize: 10, fontWeight: '600', marginTop: 2 }}>Move to the graveyard. Permanent.</Text></TouchableOpacity>
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
  return (
    <Animated.View style={{ position: 'absolute', inset: 0, backgroundColor: theme.bg === '#000000' ? 'rgba(0,0,0,0.93)' : 'rgba(255,255,255,0.93)', zIndex: 300, justifyContent: 'center', alignItems: 'center', padding: 44, opacity: fadeAnim }}>
      <StatusBar barStyle={theme.bg === '#000000' ? 'light-content' : 'dark-content'} />
      <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontSize: 10, color: theme.textSub, letterSpacing: 2, marginBottom: 24 }}>CONFIRMATION REQUIRED</Text>
      <Text
        style={{
          fontSize: 18, fontWeight: '900', color: theme.textMain,
          textAlign: 'center', letterSpacing: 0.3,
          marginBottom: subtitle ? 8 : 36,
          writingDirection: isRtl(title) ? 'rtl' : 'ltr',
        }}
      >
        {title}
      </Text>
      {subtitle && <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontSize: 12, color: theme.textSub, textAlign: 'center', lineHeight: 19, marginBottom: 36 }}>{subtitle}</Text>}
      <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); onConfirm(); }} style={{ marginBottom: 20, paddingHorizontal: 32, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(244,63,94,0.4)', borderRadius: 4 }}><Text style={{ color: L1_COLOR, fontSize: 13, fontWeight: '900', letterSpacing: 2 }}>{confirmLabel}</Text></TouchableOpacity>
      <TouchableOpacity onPress={onCancel} hitSlop={{ top: 15, bottom: 15, left: 30, right: 30 }}><Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>{cancelLabel}</Text></TouchableOpacity>
    </Animated.View>
  );
};

const GraveyardBuryOverlay = ({ visible, challenge, onConfirm, onCancel, theme }: { visible: boolean; challenge: Challenge | null; onConfirm: () => void; onCancel: () => void; theme: any; }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scanAnim = useRef(new Animated.Value(0)).current;
  // Capture the loop in a ref so we can stop() it both when `visible`
  // flips to false AND on unmount. Previously only the visible→hidden
  // path stopped it; an unmount while visible would leak the loop.
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      loopRef.current = Animated.loop(
        Animated.timing(scanAnim, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: false })
      );
      loopRef.current.start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      loopRef.current?.stop();
      loopRef.current = null;
      scanAnim.setValue(0);
    }
    return () => { loopRef.current?.stop(); loopRef.current = null; };
  }, [visible]);
  if (!visible || !challenge) return null;
  const msg = getDeadMessage(challenge); const progress = Math.min(1, challenge.current / challenge.target); const caseId = challenge.id.slice(-6).toUpperCase();
  return (
    <Animated.View style={{ position: 'absolute', inset: 0, backgroundColor: theme.bg, zIndex: 300, opacity: fadeAnim }}>
      <StatusBar barStyle={theme.bg === '#000000' ? 'light-content' : 'dark-content'} />
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(244,63,94,0.12)', top: scanAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} pointerEvents="none" />
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: 36 }}>
        {/* Voice — clinical observational, matches DeadCardOverlay's
            register. Dropped the "∎ CASE FILE" detective framing. */}
        <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: '#F43F5E', fontSize: 8, letterSpacing: 3, marginBottom: 24 }}>PERMANENT CLOSURE</Text>
        <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 6, opacity: 0.7 }}>{'#' + caseId}</Text>
        <Text
          style={{
            color: theme.textMain, fontSize: 20, fontWeight: '900', marginBottom: 4,
            textAlign: isRtl(challenge.title) ? 'right' : 'left',
            writingDirection: isRtl(challenge.title) ? 'rtl' : 'ltr',
          }}
          numberOfLines={2}
        >
          {challenge.title}
        </Text>
        <Text style={{ color: '#F43F5E', fontSize: 9, fontWeight: '900', letterSpacing: 2, marginBottom: 24 }}>{msg.label}</Text>
        <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: theme.textSub, fontSize: 11, lineHeight: 18, marginBottom: 24 }}>{msg.text}</Text>
        <View style={{ height: 1, backgroundColor: theme.border, marginBottom: 16 }} />
        <View style={{ flexDirection: 'row', gap: 20, marginBottom: 16 }}><View><Text style={{ color: theme.textSub, fontSize: 8, letterSpacing: 1.5, opacity: 0.7 }}>PROGRESS AT BURIAL</Text><Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '700', marginTop: 2 }}>{Math.round(progress * 100)}%</Text></View><View><Text style={{ color: theme.textSub, fontSize: 8, letterSpacing: 1.5, opacity: 0.7 }}>CAUSE</Text><Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '700', marginTop: 2 }}>{msg.cause}</Text></View></View>
        <View style={{ height: 2, backgroundColor: theme.border, borderRadius: 1, overflow: 'hidden', marginBottom: 40 }}><View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: 'rgba(244,63,94,0.3)', borderRadius: 1 }} /></View>
        <TouchableOpacity onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 200); onConfirm(); }} style={{ paddingVertical: 16, borderWidth: 1, borderColor: 'rgba(244,63,94,0.3)', borderRadius: 4, alignItems: 'center', marginBottom: 16 }}><Text style={{ color: '#F43F5E', fontSize: 13, fontWeight: '900', letterSpacing: 2 }}>BURY</Text></TouchableOpacity>
        <TouchableOpacity onPress={onCancel} style={{ paddingVertical: 12, alignItems: 'center' }}><Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>LEAVE IT</Text></TouchableOpacity>
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
  const isDark = theme.bg === '#000000';
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

  if (!challenge) return null;

  const isDark = theme.bg === '#000000';
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

  // 30-day log strip — one cell per day, oldest to newest, today on
  // the right edge. Memoized on logDates so rapid +1 taps don't
  // rebuild the 30-element array every render (Date math + map were
  // showing up as a hot path during spam-tap testing).
  const logDates = challenge.logDates || [];
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

  // Notes — newest first. Editable for 3 days after creation; older
  // entries become read-only so the journal log feels like a record
  // rather than a scratchpad.
  const NOTE_EDIT_WINDOW_MS = 3 * 86400000;
  const notes = useMemo(
    () => (challenge.noteEntries || []).slice().sort((a, b) => b.createdAt - a.createdAt),
    [challenge.noteEntries]
  );

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

// ─── MAIN SCREEN ───
export default function ChallengesScreen() {
  const insets = useSafeAreaInsets();

  // Clean store selectors — no more (s as any) casts
  const isDarkMode = useAppStore(s => s.isDarkMode);
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

  // ── Lock-screen gating ────────────────────────────────────────────────
  // Just the bool here. The actual metric computation lives inside
  // <LockGate/> (rendered only when !challengesUnlocked) so unlocked
  // users don't pay the cost of summing deep-work hours, filtering
  // tasks, and walking every habit's history on every mount.
  const challengesUnlocked = useAppStore(s => s.challengesUnlocked);
  const setChallengesUnlocked = useAppStore(s => s.setChallengesUnlocked);

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
  const vaultSheetRef = useRef<BottomSheetModal>(null);
  // Graveyard is now its own full-screen surface, not a tab in the
  // vault sheet. Vault becomes trash-only — kept as a sheet because
  // trash actions (restore / delete forever) are transactional.
  const [graveyardOpen, setGraveyardOpen] = useState(false);

  const [completionCeremony, setCompletionCeremony] = useState<{ challenge: Challenge; isFirst: boolean; wasResurrected: boolean } | null>(null);
  const [currentNarrator, setCurrentNarrator] = useState<NarratorMoment | null>(null);

  const [softDeleteTarget, setSoftDeleteTarget] = useState<Challenge | null>(null);
  const [softDeleteMode, setSoftDeleteMode] = useState<'trash' | 'forever' | null>(null);
  const [graveyardBuryTarget, setGraveyardBuryTarget] = useState<Challenge | null>(null);

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

  const theme = useMemo(() => ({ bg: isDarkMode ? '#000000' : '#F8F9FA', surface: isDarkMode ? '#0A0A0A' : '#FFFFFF', border: isDarkMode ? '#1A1A1A' : '#E5E5EA', textMain: isDarkMode ? '#FFFFFF' : '#111111', textSub: isDarkMode ? '#666666' : '#888888', danger: '#F43F5E', success: '#10B981' }), [isDarkMode]);
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
      if (c.deadState === 'resurrected' && c.wasResurrected) setTimeout(() => handleAchievementQueue(['recidivist']), 100);
      return { ...c, deadState: c.deadState === 'resurrected' ? 'resurrected' : 'dead' };
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
      linkedHabitIds: [],
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
      const newC: Challenge = { id: challengeId, current: 0, createdAt: Date.now(), linkedHabitIds: [], deadState: 'active', logDates: [], ...enrichedData } as any;
      saveChallenges([...currentChallenges, newC], true);
      if (currentChallenges.length + 1 >= 5) handleAchievementQueue(['architect']);
    }
    setEditingChallenge(null);
    setAddEditOpen(false);
  }, [title, description, targetV, unit, noteEntries, deadlineTs, urgencyStyle, reward, punishment, milestones, color, icon, editingChallenge, handleAchievementQueue, capsuleEnabled, capsuleMessage]);

  const updateProgress = useCallback((challengeId: string, amount: number) => {
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

    if (!was && next >= challenge.target) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const currentAchs = useAppStore.getState().achievements as Achievement[];
      const isFirst = !currentAchs.some(a => a.id === 'first_blood' && a.unlockedAt);
      const wasRes = !!(challenge.wasResurrected || challenge.deadState === 'resurrected');
      const updated = checkDeadTransition({ ...challenge, current: next, lastLoggedAt: now, wasResurrected: wasRes || undefined, logDates: newLogDates } as any);
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
      const updated = checkDeadTransition({ ...challenge, current: next, lastLoggedAt: now, logDates: newLogDates } as any);
      saveChallenges(currentChallenges.map(c => c.id === (updated as any).id ? updated : c));

      const hr = new Date().getHours();
      const achievementIds: AchievementId[] = [];
      if (hr >= 0 && hr < 4) achievementIds.push('insomniac');
      const consecutiveDays = countConsecutiveLogDays(newLogDates);
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
    saveChallenges((useAppStore.getState().challenges as Challenge[]).map(c => c.id === id ? { ...c, deadState: 'resurrected' as DeadState, deadlineTs: ts, reviewedAt: Date.now(), wasResurrected: true } : c), true);
    handleAchievementQueue(['second_chance', 'narrator_noticed']);
  }, [handleAchievementQueue]);

  const saveHabitLinks = useCallback((challengeId: string, ids: string[]) => {
    const updated = (useAppStore.getState().challenges as Challenge[]).map(c => c.id === challengeId ? { ...c, linkedHabitIds: ids } : c);
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

  if (!challengesUnlocked) {
    return (
      <LockGate
        onUnlock={() => { setChallengesUnlocked(true); handleAchievementQueue(['cleared']); }}
        theme={theme}
      />
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
              {activeChallenges.length === 0 ? (
                // Empty state — leads the user toward action without
                // cheerleading. Replaces "Empty Sector." which read as
                // a sci-fi placeholder. The CTA opens the same form
                // the + button does, so it's the same path with a
                // friendlier entry point on a fresh tab.
                <View style={{ alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 }}>
                  <Feather name="target" size={36} color={theme.textSub} style={{ opacity: 0.18, marginBottom: 20 }} />
                  <Text style={{ color: theme.textMain, fontSize: 17, fontWeight: '900', textAlign: 'center', letterSpacing: -0.3, marginBottom: 8 }}>Nothing yet.</Text>
                  <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 19, marginBottom: 28, opacity: 0.85 }}>A challenge has a target, a deadline, and a record. Kept or buried — you'll see it here.</Text>
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
                    <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>or build your own →</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {/* Two-column grid for live challenges; dead/resurrected
                      cards (need-review state) keep their full-width
                      DeadCardOverlay treatment and sit below the grid so
                      they don't break the tile rhythm. Pair chunking
                      done inline — the list is small enough that the
                      cost of the loop per render is negligible. */}
                  {(() => {
                    const alive = activeChallenges.filter(c => c.deadState !== 'dead' && c.deadState !== 'resurrected');
                    const reviewable = activeChallenges.filter(c => c.deadState === 'dead' || c.deadState === 'resurrected');
                    const pairs: Challenge[][] = [];
                    for (let i = 0; i < alive.length; i += 2) pairs.push(alive.slice(i, i + 2));
                    return (
                      <>
                        {pairs.map((pair, i) => (
                          <View key={`pair-${i}`} style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                            {pair.map(c => (
                              <View key={c.id} style={{ flex: 1 }}>
                                <ActivityRingCard
                                  challenge={c}
                                  theme={theme}
                                  calSystem={calSystem}
                                  onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    setDetailChallengeId(c.id);
                                  }}
                                  onLongPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                                    openAddEditSheet(c);
                                  }}
                                  onReview={() => setReviewChallenge(c)}
                                />
                              </View>
                            ))}
                            {pair.length === 1 ? <View style={{ flex: 1 }} /> : null}
                          </View>
                        ))}
                        {reviewable.map(c => (
                          <ActivityRingCard
                            key={c.id}
                            challenge={c}
                            theme={theme}
                            calSystem={calSystem}
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              setDetailChallengeId(c.id);
                            }}
                            onLongPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                              openAddEditSheet(c);
                            }}
                            onReview={() => setReviewChallenge(c)}
                          />
                        ))}
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
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); vaultSheetRef.current?.present(); }}
                      style={{ alignSelf: 'center', marginTop: 24, paddingVertical: 8, paddingHorizontal: 16 }}
                      hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}
                    >
                      <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: theme.textSub, fontSize: 10, fontWeight: '700', opacity: 0.45, letterSpacing: 1.5 }}>
                        TRASH · {trashChallenges.length}
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

              {/* ── CAPSULE-LOCKED FINISH ──
                  Seal a message for the moment this challenge is achieved. The note
                  lives in Notes (capsules group) and unlocks automatically on completion.
                  Once a capsule HAS been sealed, the entire section is hidden — the
                  user shouldn't be reminded that a future-self message is waiting,
                  which is part of the surprise. They can't edit or remove it from
                  here either; the seal is set-once. */}
              {editingChallenge?.linkedCapsuleNoteId ? null : (
                <>
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
                </>
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
                  <TouchableOpacity
                    onPress={() => {
                      // Open habit-link modal ON TOP of the edit sheet
                      // — don't dismiss the sheet first. RN Modal stacks
                      // above the gorhom bottom sheet, so the user can
                      // close the link modal and land back in the same
                      // edit context with their form state intact.
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setHabitLinkChallenge(editingChallenge);
                    }}
                    style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}
                  >
                    <Feather name="link-2" size={14} color={theme.textSub} />
                    <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>Link Habits</Text>
                  </TouchableOpacity>
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

          {/* ── TRASH SHEET — was the Vault, now scoped to trash only.
              The graveyard tab was promoted to its own full-screen
              surface (GraveyardScreen) because it's a place you visit,
              not a transient drawer. Trash stays here because its
              actions (restore / delete forever) are transactional. */}
          <BottomSheetModal ref={vaultSheetRef} snapPoints={['85%']} backdropComponent={renderBackdrop} backgroundStyle={{ backgroundColor: theme.bg, borderRadius: 32 }} handleIndicatorStyle={{ backgroundColor: theme.border, width: 40, height: 5 }}>
            <View style={{ paddingHorizontal: 24, paddingTop: 10, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ fontSize: 28, fontWeight: '900', color: theme.textMain, letterSpacing: -1 }}>Trash.</Text>
                <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: theme.textSub, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 4, opacity: 0.8 }}>
                  AUTO-PURGE AFTER 30 DAYS
                </Text>
              </View>
              <TouchableOpacity onPress={() => vaultSheetRef.current?.dismiss()} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="x" size={24} color={theme.textMain} /></TouchableOpacity>
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
          <AchievedModal visible={achievedVisible} challenges={challenges} theme={theme} insets={insets} onClose={() => setAchievedVisible(false)} onMarkIncomplete={(c) => { handleMarkIncomplete(c); setAchievedVisible(false); }} onMoveToTrash={(c) => { requestTrash(c); setAchievedVisible(false); }} />
          <AchievementsScreen visible={achievementsVisible} achievements={achievements} theme={theme} onClose={() => setAchievementsVisible(false)} onTrigger={(id, ft) => { const narr = ACHIEVEMENT_NARRATION[id]; setCurrentNarrator({ lines: narr.lines, dismissLabel: narr.dismiss, achievementId: id, tone: narr.tone, firstTime: ft }); }} />

          {completionCeremony && <CompletionCeremony visible challenge={completionCeremony.challenge} isFirst={completionCeremony.isFirst} wasResurrected={completionCeremony.wasResurrected} theme={theme} onDone={() => setCompletionCeremony(null)} onAchievementQueue={handleAchievementQueue} />}
          {currentNarrator && <Modal visible animationType="fade" transparent={false}><NarratorCeremony moment={currentNarrator} theme={theme} onDone={() => setCurrentNarrator(null)} /></Modal>}
          <SoftDeleteOverlay visible={softDeleteMode === 'trash'} title={softDeleteTarget?.title || ''} subtitle="You're sure?" confirmLabel="GONE." cancelLabel="Not yet." onConfirm={confirmTrash} onCancel={() => { setSoftDeleteTarget(null); setSoftDeleteMode(null); }} theme={theme} />
          <SoftDeleteOverlay visible={softDeleteMode === 'forever'} title={softDeleteTarget?.title || ''} subtitle={"This cannot be undone.\nThis challenge will not be remembered."} confirmLabel="ERASE IT." cancelLabel="KEEP IT." onConfirm={confirmDeleteForever} onCancel={() => { setSoftDeleteTarget(null); setSoftDeleteMode(null); }} theme={theme} />

          {/* The "preset slot occupied" status now lives passively in
              the active list (top dashed row), so this overlay was
              removed — no modal interrupt needed. */}
          <GraveyardBuryOverlay visible={!!graveyardBuryTarget} challenge={graveyardBuryTarget} onConfirm={confirmBury} onCancel={() => setGraveyardBuryTarget(null)} theme={theme} />

          {/* Custom-amount log modal — opened by long-pressing the +1
              LOG button inside an expanded card. Tap outside or the X
              to dismiss. */}
          {customLogChallenge ? (
            <Modal visible transparent animationType="fade" onRequestClose={() => setCustomLogChallenge(null)}>
              <View style={{ flex: 1, backgroundColor: theme.bg === '#000000' ? 'rgba(0,0,0,0.93)' : 'rgba(255,255,255,0.93)', justifyContent: 'center', alignItems: 'center', padding: 36 }}>
                <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={() => setCustomLogChallenge(null)} />
                <View style={{ width: '100%', alignItems: 'center' }}>
                  <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontSize: 10, color: theme.textSub, letterSpacing: 2, marginBottom: 18 }}>LOG CUSTOM AMOUNT</Text>
                  <Text
                    style={{
                      fontSize: 20, fontWeight: '900', color: theme.textMain,
                      letterSpacing: -0.4, marginBottom: 6, textAlign: 'center',
                      writingDirection: isRtl(customLogChallenge.title) ? 'rtl' : 'ltr',
                    }}
                  >
                    {customLogChallenge.title}
                  </Text>
                  <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontSize: 11, color: theme.textSub, marginBottom: 28, textAlign: 'center' }}>
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
                        updateProgress(customLogChallenge.id, -n);
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
                        updateProgress(customLogChallenge.id, n);
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