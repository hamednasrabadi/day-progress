/**
 * Timeline — Command Center
 * Renamed from index.tsx → timeline.tsx for clarity.
 *
 * Migration note (v20 → v21):
 *   Activities, dayLog, and notification prefs were previously stored in
 *   AsyncStorage. On first focus after the update, this screen reads the old
 *   keys one time, writes them into the Zustand store, then deletes the old
 *   keys so the migration never runs again.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, Modal, TextInput,
  Platform, Switch, LayoutAnimation, UIManager, LogBox,
  Dimensions, Alert,
} from 'react-native';
// Use react-native-keyboard-controller's KeyboardAvoidingView (handles iOS + Android
// consistently — the RN built-in is iOS-padding-only) and useReanimatedKeyboardAnimation
// to drive an animated bottom-padding on sheets so the home-indicator clearance collapses
// as the keyboard rises. We deliberately do NOT use KeyboardAwareScrollView from the same
// library — it adds its own keyboard-height contentInset on top of what KeyboardAvoidingView
// already does, producing a double-lift that lets users scroll into empty white space below
// the actual content. KAV alone lifts the sheet by exactly keyboard height; that's enough.
// The library is already in deps (1.18.5) and used elsewhere (Tasks tab quick-add bar).
import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, useAnimatedScrollHandler, withTiming, runOnJS,
} from 'react-native-reanimated';
import {
  useAppStore,
  Activity, DayRating,
  Task, Habit, CalendarSystem,
  Intent, IntentSourceType, Challenge,
  DayNote, Reminder,
} from '../../store/useAppStore';
import {
  exportBackup, pickAndReadBackup, applyBackup,
  ALL_KEYS, KEY_LABELS, describeCount, TAB_GROUPS,
  type BackupKey, type BackupPayload, type BackupTab,
} from '../../lib/backup';
import { isRtl, rtlTextStyle, rtlInputStyle, persianSafeInputStyle } from '../../lib/rtl';
import { Theme, getTheme, hexToRgba, darken } from '../../lib/timelineTheme';
import { DaySpine } from '../../components/timeline/DaySpine';
import { BackupSlicePicker } from '../../components/timeline/BackupSlicePicker';
import { IntentAddModal } from '../../components/timeline/IntentAddModal';
import { SettingsModal } from '../../components/timeline/SettingsModal';
import { ReminderModal } from '../../components/timeline/ReminderModal';
import { CalendarPicker } from '../../components/CalendarPicker';
import {
  syncTimelineNotifications,
  refreshNowPlaying,
  requestTimelinePermissions,
} from '../../lib/timelineNotifications';
import { scheduleReminder, cancelReminder } from '../../lib/reminderNotifications';

LogBox.ignoreLogs(['new NativeEventEmitter', 'setLayoutAnimationEnabledExperimental']);

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try { UIManager.setLayoutAnimationEnabledExperimental(true); } catch (e) {}
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const { width: SW } = Dimensions.get('window');
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// AsyncStorage keys used before v21 — read once during migration then deleted.
const LEGACY_ACTIVITIES_KEY = '@timeline_activities_v6';
const LEGACY_NOTIFS_KEY     = '@timeline_global_notifs';
const LEGACY_OFFSET_KEY     = '@timeline_notif_offset';
const LEGACY_DAY_LOG_KEY    = '@command_day_log_v1';
const LEGACY_SEEDED_KEY     = '@timeline_seeded_v1';
const MIGRATION_DONE_KEY    = '@titan_v21_migration_done';

// RTL helpers + theme moved to lib/rtl.ts and lib/timelineTheme.ts (imported
// above). Both are shared with Habits and the extracted Timeline components.

const DAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const JS_DAY_MAP: Record<number, string> = {
  6: 'Saturday', 0: 'Sunday', 1: 'Monday',
  2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday',
};
const COLORS = [
  // row 1 — originals
  '#3B82F6', '#10B981', '#F59E0B', '#F43F5E', '#8B5CF6', '#2DD4BF', '#EC4899', '#64748B',
  // row 2 — expansion (matches Tasks palette)
  '#EF4444', '#F97316', '#EAB308', '#84CC16', '#06B6D4', '#6366F1', '#A855F7', '#92400E',
];

const SHAMSI_MONTHS = ['Farvardin','Ordibehesht','Khordad','Tir','Mordad','Shahrivar','Mehr','Aban','Azar','Dey','Bahman','Esfand'];
const GREG_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WDAYS_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Theme + Theme type now imported from lib/timelineTheme.ts.

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const parseTime = (t: string): number => {
  if (!t) return NaN;
  if (t.includes(':')) { const [h, m] = t.split(':'); return parseInt(h) + (parseInt(m || '0') / 60); }
  return parseFloat(t);
};
// Constrains input to a valid HH:MM shape as the user types. Strips non-digits, auto-inserts `:`
// after the hour digits, caps HH at 23 and MM at 59. Returns whatever partial (e.g. "0", "09", "09:",
// "09:3", "09:30") is legal at the current keystroke. Empty string allowed.
//
// UX choice: colon appears immediately when the second digit is typed — users see "12:" the instant
// they finish the hour, which feels more locked-in than waiting for the third keystroke. Backspacing
// from "12:" drops the colon so users can edit the hour without fighting auto-insertion.
const sanitizeTimeInput = (raw: string, prev: string): string => {
  const digits = raw.replace(/[^0-9]/g, '').slice(0, 4);
  if (digits.length === 0) return '';
  if (digits.length === 1) {
    // Single digit → could be start of a two-digit hour or a one-digit hour.
    return digits;
  }
  let hh = digits.slice(0, 2);
  if (parseInt(hh, 10) > 23) hh = '23';
  if (digits.length === 2) {
    // Backspace path — user just deleted from "12:" or "12:3" back to "12". Don't re-add the colon
    // they're trying to remove; let them edit hours freely.
    if (raw.length < prev.length && !raw.includes(':')) return hh;
    // Forward-typing path — show the colon immediately so the user can continue with minutes.
    return `${hh}:`;
  }
  let mm = digits.slice(2, 4);
  if (parseInt(mm, 10) > 59) mm = '59';
  return `${hh}:${mm}`;
};
const formatTime = (dec: number): string => {
  if (isNaN(dec)) return '';
  const h = Math.floor(dec), m = Math.round((dec - h) * 60);
  return `${h < 10 ? '0' + h : h}:${m < 10 ? '0' + m : m}`;
};
const formatDuration = (hours: number): string => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};
// Gap-indicator threshold — below this use quiet connector, at/above use compact schedulable card.
const GAP_HYBRID_THRESHOLD_HOURS = 1;

// Smart-suggestion prefill: pick a clean 1h window inside a larger free gap so tapping the
// suggestion produces a sensible block without the user having to think about times.
//   Large gap (≥3h): round up to the next :30 mark one hour after gap start — "breathe for an
//     hour, then do this." Example: gap 05:00–12:00 → 06:00–07:00.
//   Small gap (2h–3h): center a 1h window, rounded to nearest :30. Example: gap 05:00–07:00
//     → 05:30–06:30.
// Duration is fixed at 1h. The modal is editable, so the user can bump the end time in one tap
// if they want 2h. Short gaps (<2h) never trigger a suggestion (see SMART_SUGGESTION_MIN_HOURS).
const roundHalfHour = (h: number) => Math.round(h * 2) / 2;
function suggestionWindow(gapStart: number, gapEnd: number): { start: number; end: number } {
  const gap = gapEnd - gapStart;
  const DURATION = 1;
  if (gap >= 3) {
    const start = Math.max(gapStart, Math.min(gapEnd - DURATION, roundHalfHour(gapStart + 1)));
    return { start, end: start + DURATION };
  }
  // 2h–3h gap — center a 1h window
  const midpoint = (gapStart + gapEnd) / 2;
  const start = roundHalfHour(midpoint - DURATION / 2);
  return { start, end: start + DURATION };
}
const todayGreg = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dateStrOffset = (n: number): string => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// hexToRgba moved to lib/timelineTheme.ts (imported above).

// ─── CONFIRM MODAL ──────────────────────────────────────────────────────────
// Same shape as the modal used throughout Notes — keeps the in-app confirmation
// language consistent across tabs instead of falling back to native Alert.alert.
const CustomConfirmModal = ({
  visible, title, message, destructiveLabel = 'Delete',
  onCancel, onConfirm, theme, isSuccess = false,
}: {
  visible: boolean; title: string; message: string; destructiveLabel?: string;
  onCancel: () => void; onConfirm: () => void; theme: any; isSuccess?: boolean;
}) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <View style={{ backgroundColor: theme.surface, width: '100%', maxWidth: 340, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.border }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: hexToRgba(isSuccess ? '#8B5CF6' : (theme.danger || '#F43F5E'), 0.15), justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
          <Feather name={isSuccess ? 'check-circle' : 'alert-triangle'} size={24} color={isSuccess ? '#8B5CF6' : (theme.danger || '#F43F5E')} />
        </View>
        <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: '900', marginBottom: 8 }}>{title}</Text>
        <Text style={{ color: theme.textSub, fontSize: 14, lineHeight: 22, marginBottom: 24 }}>{message}</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity onPress={onCancel} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}>
            <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 14 }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onConfirm} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: isSuccess ? '#8B5CF6' : (theme.danger || '#F43F5E') }}>
            <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 14 }}>{destructiveLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);
// darken moved to lib/timelineTheme.ts (imported above).

function getShamsiDateParts(date: Date) {
  const jdm = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
  let gy = date.getFullYear() - 1600, gm = date.getMonth(), gd = date.getDate() - 1;
  let g_day_no = 365 * gy + Math.floor((gy + 3) / 4) - Math.floor((gy + 99) / 100) + Math.floor((gy + 399) / 400);
  for (let i = 0; i < gm; ++i) g_day_no += [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i];
  if (gm > 1 && ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0))) g_day_no++;
  g_day_no += gd;
  let j_day_no = g_day_no - 79;
  let j_np = Math.floor(j_day_no / 12053); j_day_no %= 12053;
  let jy = 979 + 33 * j_np + 4 * Math.floor(j_day_no / 1461); j_day_no %= 1461;
  if (j_day_no >= 366) { jy += Math.floor((j_day_no - 1) / 365); j_day_no = (j_day_no - 1) % 365; }
  let i = 0;
  for (i; i < 11 && j_day_no >= jdm[i]; ++i) j_day_no -= jdm[i];
  return { year: jy, month: i + 1, day: j_day_no + 1 };
}

function getDateLabel(calSystem: CalendarSystem): string {
  const d = new Date();
  if (calSystem === 'shamsi') {
    const s = getShamsiDateParts(d);
    return `${WDAYS_EN[d.getDay()]}, ${SHAMSI_MONTHS[s.month - 1].slice(0, 3)} ${s.day}`;
  }
  return `${WDAYS_EN[d.getDay()]}, ${GREG_MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

// ─── PROGRESS ────────────────────────────────────────────────────────────────

// Shamsi month lengths (last month is 29 in common years, 30 in leap). Leap cycle on years where (year * 8 + 29) % 33 < 8.
const SHAMSI_MONTH_LENGTHS_COMMON = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
const isShamsiLeap = (jy: number): boolean => {
  // Matches the algorithm used in `getShamsiDateParts` — 33-year cycle approximation.
  return ((jy * 8 + 29) % 33) < 8;
};

function calcProgress(calSystem: CalendarSystem = 'gregorian') {
  const now = new Date();
  const ds = new Date(now); ds.setHours(0, 0, 0, 0);
  const de = new Date(now); de.setHours(23, 59, 59, 999);
  const day = (now.getTime() - ds.getTime()) / (de.getTime() - ds.getTime());
  // Week starts Saturday, ends Friday — matches the DAYS array and the slider order.
  // JS getDay(): Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6.
  // Days since most-recent Saturday = (getDay() + 1) % 7.
  const dow = now.getDay();
  const sat = new Date(now); sat.setDate(now.getDate() - ((dow + 1) % 7)); sat.setHours(0, 0, 0, 0);
  const fri = new Date(sat); fri.setDate(sat.getDate() + 6); fri.setHours(23, 59, 59, 999);
  const week = (now.getTime() - sat.getTime()) / (fri.getTime() - sat.getTime());

  let month: number, year: number;
  if (calSystem === 'shamsi') {
    const s = getShamsiDateParts(now);
    const monthLengths = [...SHAMSI_MONTH_LENGTHS_COMMON];
    if (isShamsiLeap(s.year)) monthLengths[11] = 30;
    // Month progress: (currentDay - 1 + fractionOfToday) / totalDaysInMonth
    month = ((s.day - 1) + day) / monthLengths[s.month - 1];
    // Year progress: days elapsed in Shamsi year / total days in Shamsi year
    const daysBeforeCurrentMonth = monthLengths.slice(0, s.month - 1).reduce((a, b) => a + b, 0);
    const daysInYear = monthLengths.reduce((a, b) => a + b, 0);
    year = (daysBeforeCurrentMonth + (s.day - 1) + day) / daysInYear;
  } else {
    const ms = new Date(now.getFullYear(), now.getMonth(), 1);
    const me = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    month = (now.getTime() - ms.getTime()) / (me.getTime() - ms.getTime());
    const ys = new Date(now.getFullYear(), 0, 1);
    const ye = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    year = (now.getTime() - ys.getTime()) / (ye.getTime() - ys.getTime());
  }
  return { day, week, month, year };
}

// ─── HABIT SCHEDULING ────────────────────────────────────────────────────────

function isHabitToday(h: Habit, todayStr: string): boolean {
  if (h.status !== 'active') return false;
  if (h.scheduleType === 'days') {
    if (!h.frequency?.length) return true;
    const abbrs: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
    return h.frequency.includes(abbrs[new Date().getDay()]);
  }
  if (h.scheduleType === 'interval' && h.startDate && h.intervalDays) {
    const [sy, sm, sd] = h.startDate.split('-').map(Number);
    const [ty, tm, td] = todayStr.split('-').map(Number);
    const diff = Math.floor((Date.UTC(ty, tm - 1, td) - Date.UTC(sy, sm - 1, sd)) / 86400000);
    return diff >= 0 && diff % h.intervalDays === 0;
  }
  return false;
}

// ─── URGENCY ─────────────────────────────────────────────────────────────────

type UrgencyInfo = { label: string; color: string; level: number };
function getUrgency(task: Task): UrgencyInfo | null {
  if (!task.deadlineDate || task.completed) return null;
  try {
    const [y, m, d] = task.deadlineDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (task.deadlineTime) { const [h, mn] = task.deadlineTime.split(':').map(Number); dt.setHours(h, mn, 0, 0); }
    else dt.setHours(23, 59, 59, 999);
    const ms = dt.getTime() - Date.now();
    if (ms < 0) return { label: 'OVERDUE', color: '#F43F5E', level: 4 };
    const h = ms / 3600000;
    if (h <= 3) return { label: 'CRITICAL', color: '#8B5CF6', level: 3 };
    if (h <= 24) return { label: `${Math.ceil(h)}H LEFT`, color: '#F43F5E', level: 2 };
    if (h <= 72) return { label: `${Math.ceil(h / 24)}D LEFT`, color: '#F59E0B', level: 1 };
  } catch {}
  return null;
}

// DaySpine moved to components/timeline/DaySpine.tsx

const SectionLabel = ({ label, right, theme }: { label: string; right?: string; theme: Theme }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, marginTop: 4 }}>
    <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' }}>{label}</Text>
    {right && <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700' }}>{right}</Text>}
  </View>
);

// BackupSlicePicker moved to components/timeline/BackupSlicePicker.tsx

// IntentAddModal moved to components/timeline/IntentAddModal.tsx

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function TimelineScreen() {
  const insets = useSafeAreaInsets();
  const [currentTime, setCurrentTime] = useState(new Date());
  // `todayDayName` — what day of week TODAY is. Rolls over automatically at midnight via the currentTime ticker.
  const todayDayName = useMemo(() => JS_DAY_MAP[currentTime.getDay()], [currentTime]);
  // `selectedSlot` — which of the 7 slider slots (0..6) is selected. Slot 3 is the center, always today when weekOffset === 0.
  // `weekOffset` — whole-week shift: 0 = this week (centered on today), -1 = prev, +1 = next, etc.
  // Together they resolve to a concrete calendar date (selectedDateStr, computed below).
  const SLIDER_CENTER = 3;
  const [selectedSlot, setSelectedSlot] = useState(SLIDER_CENTER);
  const [weekOffset, setWeekOffset] = useState(0);
  // How far back the user is allowed to look. Future is unlimited.
  const PAST_LIMIT_DAYS = 30;
  // Intent label cap — short and directive. Roughly 3 sentences worth of text;
  // anything longer drifts into note/journal territory and stops being a "next
  // action." Enforced on add + edit, surfaced as a small char counter under the
  // input. Hard limit (input maxLength); not a soft warning.
  const INTENT_LABEL_MAX = 200;
  // Day-note cap — high enough that a normal user never hits it (~6-8 sentences),
  // low enough that the field doesn't drift into journal territory. The counter
  // is hidden by default and only surfaces when the user is within NOTE_COUNTER_VISIBLE
  // chars of the cap (Telegram-style). Heavy long-form goes in the Notes tab.
  const NOTE_TEXT_MAX = 1000;
  const NOTE_COUNTER_VISIBLE = 100;

  // `selectedOffset` — days from today to the selected date. Single source of truth; everything
  // downstream (selectedDay, selectedDateStr, view mode) derives from it.
  // Hoisted above callbacks so closures can reference the derived values without hoisting errors.
  const selectedOffset = weekOffset * 7 + (selectedSlot - SLIDER_CENTER);
  const isTodaySelected = selectedOffset === 0;
  const selectedDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + selectedOffset);
    return d;
  }, [selectedOffset]);
  const selectedDay = JS_DAY_MAP[selectedDate.getDay()];
  const selectedDateStr = useMemo(() =>
    `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`,
  [selectedDate]);

  // ── Typed store selectors — no (s as any) casts ──
  const tasks              = useAppStore(s => s.tasks) as Task[];
  const habits             = useAppStore(s => s.habits) as Habit[];
  const challenges         = useAppStore(s => s.challenges) as Challenge[];
  const isDarkMode         = useAppStore(s => s.isDarkMode);
  const calSystem          = useAppStore(s => s.calendarType) as CalendarSystem;
  const toggleThemeGlobal  = useAppStore(s => s.toggleTheme);
  const toggleCalendar     = useAppStore(s => s.toggleCalendar);

  // Timeline state — all from the store now
  const activities             = useAppStore(s => s.activities);
  const setActivities          = useAppStore(s => s.setActivities);
  const addOrUpdateActivity    = useAppStore(s => s.addOrUpdateActivity);
  const deleteActivityStore    = useAppStore(s => s.deleteActivity);
  const deleteActivityGroup    = useAppStore(s => s.deleteActivityGroup);
  const dayLog                 = useAppStore(s => s.dayLog);
  const logDayRating           = useAppStore(s => s.logDayRating);
  const setDayLog              = useAppStore(s => s.setDayLog);
  // diary store hooks retired from Timeline; will be re-imported in Notes tab.
  // Intent + weekly reflection store hooks — both live on Timeline.
  const intents                = useAppStore(s => s.intents);
  const addIntent              = useAppStore(s => s.addIntent);
  const toggleIntent           = useAppStore(s => s.toggleIntent);
  const updateIntentLabel      = useAppStore(s => s.updateIntentLabel);
  const deleteIntentFromStore  = useAppStore(s => s.deleteIntent);
  const pushIntentToTomorrow   = useAppStore(s => s.pushIntentToTomorrow);
  const shipIntentBackToToday  = useAppStore(s => s.shipIntentBackToToday);
  const resetIntentPushCount   = useAppStore(s => s.resetIntentPushCount);
  const weeklyReflections      = useAppStore(s => s.weeklyReflections);
  const addWeeklyReflection    = useAppStore(s => s.addWeeklyReflection);
  const endOfWeekDay           = useAppStore(s => s.endOfWeekDay);
  const reminders              = useAppStore(s => s.reminders);
  const addReminderToStore     = useAppStore(s => s.addReminder);
  const removeReminderFromStore = useAppStore(s => s.removeReminder);
  const pruneFiredReminders    = useAppStore(s => s.pruneFiredReminders);
  // Day notes — date-bound free-text markers shown when the user navigates to
  // any day other than today/tomorrow (those days use Intent instead).
  const dayNotes               = useAppStore(s => s.dayNotes);
  const addDayNote             = useAppStore(s => s.addDayNote);
  const updateDayNote          = useAppStore(s => s.updateDayNote);
  const deleteDayNoteFromStore = useAppStore(s => s.deleteDayNote);
  // Reflection acknowledgement — set of `${date}_${activityId}` keys for
  // committed blocks the user has acted on (reflected or dismissed). Drives
  // which committed blocks need the persistent reflection banner.
  const reflectedKeys          = useAppStore(s => s.reflectedKeys);
  const markReflected          = useAppStore(s => s.markReflected);
  const globalNotifsEnabled    = useAppStore(s => s.globalNotifsEnabled);
  const setGlobalNotifsEnabled = useAppStore(s => s.setGlobalNotifsEnabled);
  const preNotifOffset         = useAppStore(s => s.preNotifOffset);
  const setPreNotifOffset      = useAppStore(s => s.setPreNotifOffset);
  const ongoingBlockEnabled    = useAppStore(s => s.ongoingBlockEnabled) ?? true;
  const setOngoingBlockEnabled = useAppStore(s => s.setOngoingBlockEnabled);
  const navRevealCount         = useAppStore(s => s.navRevealCount) ?? 0;
  const incrementNavRevealCount = useAppStore(s => s.incrementNavRevealCount);
  // After 3 reveals the user clearly knows the gesture — stop rendering the hint handle so it
  // doesn't permanently occupy vertical space above the slider.
  const HINT_MAX_REVEALS = 3;
  const hintVisible = navRevealCount < HINT_MAX_REVEALS;
  const setTasksStore          = useAppStore(s => s.setTasks);

  // UI state
  const [settingsVisible, setSettingsVisible]   = useState(false);
  const [reminderModalVisible, setReminderModalVisible] = useState(false);
  const [addBlockVisible, setAddBlockVisible]   = useState(false);
  // Copy-day modal: duplicate the currently-viewed day's recurring blocks to other weekdays.
  const [copyModalVisible, setCopyModalVisible] = useState(false);
  const [copyTargetDays, setCopyTargetDays]     = useState<string[]>([]);
  // Pulse detail sheet — opens when the compact strip is tapped.
  const [pulseSheetVisible, setPulseSheetVisible] = useState(false);
  // (Diary input + dailyClose modal retired — moving to Notes tab later.)

  // ── Intent state ──
  // The add-intent modal; `intentTargetDate` is the YYYY-MM-DD the new intent
  // attaches to. Defaults to today; the close-of-day flow will open it with
  // tomorrow's date pre-filled. `intentRethink` holds the id whose 3rd-push
  // rethink prompt is currently being shown (null = no prompt visible).
  // `intentDetailId` holds the id whose detail sheet is open (cancel/edit/delete);
  // long-press on a row opens it. `intentEditId` + `intentEditDraft` drive the
  // small edit-label modal launched from the detail sheet's Edit button.
  const [intentModalVisible, setIntentModalVisible] = useState(false);
  const [intentTargetDate, setIntentTargetDate] = useState<string>('');
  const [intentRethink, setIntentRethink] = useState<string | null>(null);
  const [intentDetailId, setIntentDetailId] = useState<string | null>(null);
  const [intentEditId, setIntentEditId] = useState<string | null>(null);
  const [intentEditDraft, setIntentEditDraft] = useState<string>('');
  // Weekly reflection sheet — opens from the end-of-week card on Timeline.
  const [weeklyReflectionVisible, setWeeklyReflectionVisible] = useState(false);
  const [weeklyReflectionDraft, setWeeklyReflectionDraft] = useState('');

  // ── DayNote state ──
  // The note add/edit modal handles input for both new notes and edits. Edit
  // path reuses the same modal: when noteEditingId is set, save updates instead
  // of creating a new entry; when null, save creates new.
  // noteDetailId drives the read-only preview modal (tap-a-row entry point);
  // long notes shouldn't force the user into edit mode just to read.
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDetailId, setNoteDetailId] = useState<string | null>(null);

  // ── Backup / restore ──
  // Two flows.
  //   Export: either fire-and-forget (whole state) OR opens a checklist sheet
  //   (selective). exportPickerVisible drives the selective sheet; the same
  //   importSelected-style Set holds the user's choice.
  //   Import: 2-step — pick file → preview its contents in a sheet with
  //   checkboxes → user selects which slices to overwrite → confirm to apply.
  // We share a single `selectedKeys` set between the two flows since they
  // never overlap in time (export sheet hides import sheet and vice versa).
  const [importPayload, setImportPayload] = useState<BackupPayload | null>(null);
  const [importSelected, setImportSelected] = useState<Set<BackupKey>>(new Set());
  const [importBusy, setImportBusy] = useState(false);
  const [exportPickerVisible, setExportPickerVisible] = useState(false);
  const [exportSelected, setExportSelected] = useState<Set<BackupKey>>(new Set());

  // ── Commit reflection modal state ──
  // The post-block reflection flow is a small state machine: 'focus' → either
  // 'why' (if not Fully focused) or 'done-fully' → 'suggestion'. The user's
  // answers drive the suggestion text but are NOT persisted — only the act
  // of acknowledging the prompt is recorded (in reflectedKeys).
  type ReflectStep = 'focus' | 'why' | 'suggestion' | null;
  type ReflectFocus = 'fully' | 'partially' | 'drifted';
  type ReflectWhy = 'time' | 'distractions' | 'duration' | 'other';
  const [reflectKey, setReflectKey] = useState<string | null>(null);
  const [reflectStep, setReflectStep] = useState<ReflectStep>(null);
  const [reflectFocus, setReflectFocus] = useState<ReflectFocus | null>(null);
  const [reflectWhy, setReflectWhy] = useState<ReflectWhy | null>(null);


  // ── In-app confirm modal (replaces native Alert.alert) ──
  // Single state slot — only one confirm at a time. Shape mirrors the Notes pattern so the
  // call sites read the same: setConfirmModal({ title, message, label, onConfirm }).
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; label: string; isSuccess?: boolean; onConfirm: () => void } | null>(null);

  // ── Keyboard-driven sheet bottom padding ──
  // When a sheet's TextInput is focused the keyboard rises and KeyboardAvoidingView lifts
  // the sheet above it. The sheet's static `paddingBottom` (which exists to clear the home
  // indicator when the keyboard is down) then becomes dead white space between the last
  // element and the keyboard top. We animate that padding to 0 as the keyboard rises and
  // restore it on close. progress is a Reanimated SharedValue (0 → keyboard hidden,
  // 1 → fully shown), so the transition rides the same curve as the keyboard animation
  // itself — no jank.
  const kbAnim = useReanimatedKeyboardAnimation();
  const sheetBottomPadStyle = useAnimatedStyle(() => ({
    paddingBottom: (Math.max(insets.bottom, 16) + 16) * (1 - kbAnim.progress.value),
  }));
  // Nav chrome reveal — Telegram-archive pattern. Hidden at current week; pull-down at the top of the
  // scroll progressively reveals the bar in real time (no spinner, no flash). Always visible when on
  // a non-current week so the user has a clear return path.
  //
  // Architecture:
  //   - `pullY` — live pull distance (0 when not pulling, grows with finger as user drags down)
  //   - `navOpenV` — committed open state (0 = hidden, 1 = fully shown). Animates on reveal/collapse.
  //   - The nav bar's height is driven directly by pullY + navOpenV * HEIGHT; user sees it emerge smoothly.
  //   - The hint above the slider fades as pullY grows, disappearing by the time the bar is revealed.
  const [navRevealed, setNavRevealed] = useState(false);
  const navRevealedRef = useRef(false);
  useEffect(() => { navRevealedRef.current = navRevealed; }, [navRevealed]);

  const NAV_HEIGHT = 40;
  const REVEAL_THRESHOLD = 50;
  const pullY = useSharedValue(0);
  const navOpenV = useSharedValue(0);
  const scrollYV = useSharedValue(0);

  // Sync JS state → shared value. Bar stays open while viewing another week (navigation context).
  useEffect(() => {
    const shouldOpen = navRevealed || weekOffset !== 0;
    navOpenV.value = withTiming(shouldOpen ? 1 : 0, { duration: 220 });
  }, [navRevealed, weekOffset, navOpenV]);

  // JS helpers invoked from worklets via runOnJS
  const lastRevealAtRef = useRef(0); // cooldown to avoid momentum-scroll re-hiding right after reveal
  const revealViaPan = useCallback(() => {
    lastRevealAtRef.current = Date.now();
    navRevealedRef.current = true;
    setNavRevealed(true);
    incrementNavRevealCount();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [incrementNavRevealCount]);
  const autoHideNav = useCallback(() => {
    // Don't auto-hide in the 1s window after reveal — ScrollView's momentum/bounce settling
    // can briefly push contentOffset past the auto-hide threshold, causing an open-close-open flicker.
    if (Date.now() - lastRevealAtRef.current < 1000) return;
    if (navRevealedRef.current && weekOffset === 0) {
      navRevealedRef.current = false;
      setNavRevealed(false);
    }
  }, [weekOffset]);

  // Week navigation helpers, also used by the slider's horizontal-swipe gesture.
  // Setting navRevealed=true here means: once the user swipes through any week, the nav bar
  // stays open even after they swipe back to the current week. Only a scroll-down or a tab-blur
  // collapses it (see auto-hide cooldown + useFocusEffect cleanup below).
  const goPrevWeek = useCallback(() => {
    const prevWeekLatestOffset = (weekOffset - 1) * 7 + (6 - DAYS.indexOf(todayDayName));
    if (prevWeekLatestOffset < -PAST_LIMIT_DAYS) return;
    setWeekOffset(w => w - 1);
    setExpandedBlockId(null);
    lastRevealAtRef.current = Date.now();
    navRevealedRef.current = true;
    setNavRevealed(true);
    incrementNavRevealCount();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [weekOffset, todayDayName, incrementNavRevealCount]);
  const goNextWeek = useCallback(() => {
    setWeekOffset(w => w + 1);
    setExpandedBlockId(null);
    lastRevealAtRef.current = Date.now();
    navRevealedRef.current = true;
    setNavRevealed(true);
    incrementNavRevealCount();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [incrementNavRevealCount]);

  // Pull-down Pan on the ScrollView. Uses manualActivation so we can gate activation dynamically on
  // scrollY — the previous version used static activeOffsetY(12), which woke up on any downward drag
  // even while the user was mid-scroll, eating scroll-ups. With manual activation we explicitly fail
  // the gesture the moment it's clear the user wants to scroll (not pull).
  const touchStartYShared = useSharedValue(0);
  const pullGesture = useMemo(() =>
    Gesture.Pan()
      .manualActivation(true)
      .onTouchesDown((e) => {
        'worklet';
        touchStartYShared.value = e.allTouches[0].absoluteY;
      })
      .onTouchesMove((e, stateManager) => {
        'worklet';
        // If the user isn't at scroll top, or the bar is already open, never pull. Fail → ScrollView wins.
        if (scrollYV.value > 0 || navOpenV.value === 1) {
          stateManager.fail();
          return;
        }
        const dy = e.allTouches[0].absoluteY - touchStartYShared.value;
        // Any meaningful upward movement → this is a scroll-up attempt, not a pull. Fail immediately.
        if (dy < -6) {
          stateManager.fail();
          return;
        }
        // Enough downward travel → claim the gesture as a pull.
        if (dy > 12) {
          stateManager.activate();
        }
      })
      .onUpdate((e) => {
        'worklet';
        if (scrollYV.value > 0 || navOpenV.value === 1) return;
        if (e.translationY > 0) {
          pullY.value = Math.min(120, e.translationY * 0.7);
        }
      })
      .onEnd((e) => {
        'worklet';
        if (scrollYV.value > 0 || navOpenV.value === 1) { pullY.value = withTiming(0); return; }
        if (e.translationY > REVEAL_THRESHOLD) {
          // ── ANTI-FLICKER COMMIT ────────────────────────────────────────────
          // Seed navOpenV *synchronously* on the UI thread before any JS round-trip, and seed it to
          // match the current pull ratio so committed height === progressive height at t=0. Both
          // shared values then animate in lockstep on the UI thread — the bar's `max(progressive,
          // committed)` height stays monotonic. Without this seed, `navOpenV` was being driven by
          // `setNavRevealed(true)` → React re-render → useEffect → withTiming, which adds 16-50ms of
          // JS latency during which `pullY` had already started shrinking and `navOpenV` was still 0.
          // That gap was the "close" flicker; the "reopen" was navOpenV finally catching up.
          const startRatio = Math.min(1, pullY.value / NAV_HEIGHT);
          navOpenV.value = startRatio;
          navOpenV.value = withTiming(1, { duration: 160 });
          pullY.value = withTiming(0, { duration: 160 });
          runOnJS(revealViaPan)();
        } else {
          pullY.value = withTiming(0, { duration: 180 });
        }
      }),
  [revealViaPan, pullY, navOpenV, scrollYV, touchStartYShared]);

  // Horizontal swipe on the day slider — alternative trigger.
  //   - Swipe LEFT (translationX < -40) → next week
  //   - Swipe RIGHT (translationX > 40) → prev week (respecting past-30-day limit via goPrevWeek)
  //   - failOffsetY prevents vertical scrolls from activating this gesture
  // Reveal of the nav bar is implicit: changing weekOffset forces navOpenV to 1 via the sync effect.
  const sliderSwipeGesture = useMemo(() =>
    Gesture.Pan()
      .activeOffsetX([-15, 15])
      .failOffsetY([-10, 10])
      .onEnd((e) => {
        'worklet';
        const dx = e.translationX;
        if (Math.abs(dx) < 40) return;
        if (dx < 0) runOnJS(goNextWeek)();
        else runOnJS(goPrevWeek)();
      }),
  [goNextWeek, goPrevWeek]);

  // Animated scroll handler drives scrollYV on UI thread; triggers JS auto-hide when user scrolls past 20px.
  const animatedScrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollYV.value = e.contentOffset.y;
      if (e.contentOffset.y > 20) runOnJS(autoHideNav)();
    },
  });

  // Nav bar height: during pull, bar grows with pullY (damped). When committed, height is fixed at NAV_HEIGHT.
  const navAnimatedStyle = useAnimatedStyle(() => {
    const progressiveHeight = Math.min(NAV_HEIGHT, pullY.value);
    const committedHeight = navOpenV.value * NAV_HEIGHT;
    const h = Math.max(progressiveHeight, committedHeight);
    return {
      height: h,
      opacity: Math.min(1, h / (NAV_HEIGHT * 0.6)),
    };
  });

  // Hint handle above slider — short pill indicator. Fades out as the bar emerges.
  const hintAnimatedStyle = useAnimatedStyle(() => {
    const reveal = Math.max(Math.min(NAV_HEIGHT, pullY.value), navOpenV.value * NAV_HEIGHT);
    const fade = 1 - Math.min(1, reveal / (NAV_HEIGHT * 0.4));
    return { opacity: fade };
  });

  // Form state for add/edit block modal
  const [editingId, setEditingId]               = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId]     = useState<string | undefined>();
  const [newName, setNewName]                   = useState('');
  const [newStart, setNewStart]                 = useState('');
  const [newEnd, setNewEnd]                     = useState('');
  const [selectedColor, setSelectedColor]       = useState(COLORS[0]);
  // Block mode: 'recurring' = happens on every selected weekday (min 1, max 7).
  //             'oneTime'   = happens once on scheduledDate, then auto-purges after it passes.
  const [blockMode, setBlockMode]               = useState<'recurring' | 'oneTime'>('recurring');
  const [selectedWeekdays, setSelectedWeekdays] = useState<string[]>([]); // ['Monday', 'Wednesday', ...]
  const [scheduledDate, setScheduledDate]       = useState<string>(''); // YYYY-MM-DD when blockMode === 'oneTime'
  const [hasReminder, setHasReminder]           = useState(false);
  const [isHype, setIsHype]                     = useState(false);
  // Anchor mechanic was retired with drag-drop — without an auto-shift consumer
  // to skip past, "anchored" was a visual label with no behavior. Field stays
  // on the Activity type for back-compat with old data; UI is gone. We still
  // hydrate from any stored isLocked value so saves don't drop it on the floor.
  const [isLocked, setIsLocked]                 = useState(false);
  const [conflictError, setConflictError]       = useState(''); // banner-style validation (e.g. addTime "enter start first")
  // Per-field form errors — each input renders its own inline helper text. Cleared as soon as the
  // user edits the corresponding field so the message disappears the moment they correct course.
  type FormErrors = { name?: string; start?: string; end?: string; date?: string; days?: string };
  const [formErrors, setFormErrors]             = useState<FormErrors>({});
  // Rich conflict state — list of conflicting activities per day + a nearest-free-slot suggestion.
  // When non-null the add/edit modal renders the conflict panel and blocks the primary Save action.
  type ConflictInfo = {
    days: { day: string; conflicts: Activity[] }[];
    suggestion: { start: number; end: number; day: string } | null;
  };
  const [conflictData, setConflictData]         = useState<ConflictInfo | null>(null);
  const [expandedBlockId, setExpandedBlockId]   = useState<string | null>(null);

  const theme = useMemo(() => getTheme(isDarkMode), [isDarkMode]);

  // ── ONE-TIME MIGRATION: AsyncStorage → Zustand store ─────────────────────
  // Runs on first focus after app update. Reads old keys, writes into store,
  // then deletes the old keys. Sets a migration flag so it never runs again.
  useFocusEffect(useCallback(() => {
    const runMigration = async () => {
      const migrated = await AsyncStorage.getItem(MIGRATION_DONE_KEY);
      if (migrated) return;

      const [savedActs, savedNotifs, savedOffset, savedDayLog] = await Promise.all([
        AsyncStorage.getItem(LEGACY_ACTIVITIES_KEY),
        AsyncStorage.getItem(LEGACY_NOTIFS_KEY),
        AsyncStorage.getItem(LEGACY_OFFSET_KEY),
        AsyncStorage.getItem(LEGACY_DAY_LOG_KEY),
      ]);

      // Only migrate activities if the user had customised them.
      // If empty or absent, the DEFAULT_ACTIVITIES from the store are correct.
      if (savedActs) {
        try {
          const parsed = JSON.parse(savedActs);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setActivities(parsed);
          }
        } catch {}
      }

      if (savedNotifs) setGlobalNotifsEnabled(savedNotifs === 'true');
      if (savedOffset) setPreNotifOffset(parseInt(savedOffset));
      if (savedDayLog) {
        try {
          const parsed = JSON.parse(savedDayLog);
          if (parsed && typeof parsed === 'object') {
            // Merge into existing store dayLog (should be empty on first run)
            useAppStore.getState().setDayLog(parsed);
          }
        } catch {}
      }

      // Clean up old keys
      await Promise.all([
        AsyncStorage.removeItem(LEGACY_ACTIVITIES_KEY),
        AsyncStorage.removeItem(LEGACY_NOTIFS_KEY),
        AsyncStorage.removeItem(LEGACY_OFFSET_KEY),
        AsyncStorage.removeItem(LEGACY_DAY_LOG_KEY),
        AsyncStorage.removeItem(LEGACY_SEEDED_KEY),
      ]);

      await AsyncStorage.setItem(MIGRATION_DONE_KEY, 'true');
    };

    runMigration();

    // Past-immutability: we previously auto-purged past one-time blocks. That's gone now —
    // past dates need to show what was actually scheduled, not a wiped slate. One-time blocks
    // accumulate as historical records; they're cheap (no render cost on other dates).

    // Sync the 3-day alert window on every focus. The activities-dep useEffect
    // below only fires when blocks/prefs change — without this, a user who
    // opens the app days later (with no edits) would never re-build the schedule
    // past the originally-queued window. Also covers the case where the user
    // grants notification permission outside the app and re-enters the tab.
    {
      const s = useAppStore.getState();
      syncTimelineNotifications(s.activities, {
        globalNotifsEnabled: s.globalNotifsEnabled,
        preNotifOffset: s.preNotifOffset,
        ongoingBlockEnabled: s.ongoingBlockEnabled ?? true,
        endOfWeekDay: s.endOfWeekDay,
        weeklyReflections: s.weeklyReflections,
      });
    }
    // Sweep reminders whose fire moment has passed. The notification has
    // already been delivered by the OS — keeping the entry around just clutters
    // the modal's pending list. The store action is idempotent, so it's safe
    // to call on every focus.
    pruneFiredReminders();

    const tick = setInterval(() => {
      setCurrentTime(new Date());
      // Tick-driven refresh of the pinned "Now Playing" notification. Reads the freshest
      // activities + pref from the store so we don't need to re-subscribe.
      const s = useAppStore.getState();
      refreshNowPlaying(s.activities, s.ongoingBlockEnabled ?? true);
    }, 30000);
    return () => {
      clearInterval(tick);
      // Tab blur — reset to a clean command-center state so the user always returns to today.
      // Bar collapses, week offset resets, selected day returns to center (today).
      setNavRevealed(false);
      navRevealedRef.current = false;
      setWeekOffset(0);
      setSelectedSlot(SLIDER_CENTER);
    };
  }, []));

  // ── NOTIFICATIONS ─────────────────────────────────────────────────────────
  // One-time permission request, then keep-in-sync on every change to activities or prefs.
  // The helper is idempotent (wipes + rebuilds the 3-day window each call), so we don't need
  // a diff — just debounce to coalesce rapid-fire state changes (e.g. save → re-render → save).
  const notifPermRequestedRef = useRef(false);
  useEffect(() => {
    if (notifPermRequestedRef.current) return;
    notifPermRequestedRef.current = true;
    // Await the system permission dialog, then run a one-shot sync. Without this,
    // the activities-dep sync below races with the permission prompt: it fires
    // 300ms after mount, sees authorizationStatus=0 (user still looking at the
    // dialog), and bails — leaving commit/start/now-playing alerts un-scheduled
    // until the user next edits a block. By the time `requestTimelinePermissions`
    // resolves, the user has tapped Allow/Deny, so we can sync correctly.
    (async () => {
      const granted = await requestTimelinePermissions();
      if (!granted) return;
      const s = useAppStore.getState();
      syncTimelineNotifications(s.activities, {
        globalNotifsEnabled: s.globalNotifsEnabled,
        preNotifOffset: s.preNotifOffset,
        ongoingBlockEnabled: s.ongoingBlockEnabled ?? true,
        endOfWeekDay: s.endOfWeekDay,
        weeklyReflections: s.weeklyReflections,
      });
    })();
  }, []);

  const notifSyncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (notifSyncDebounceRef.current) clearTimeout(notifSyncDebounceRef.current);
    notifSyncDebounceRef.current = setTimeout(() => {
      syncTimelineNotifications(activities, {
        globalNotifsEnabled,
        preNotifOffset,
        ongoingBlockEnabled,
        endOfWeekDay,
        weeklyReflections,
      });
    }, 300);
    return () => {
      if (notifSyncDebounceRef.current) clearTimeout(notifSyncDebounceRef.current);
    };
  }, [activities, globalNotifsEnabled, preNotifOffset, ongoingBlockEnabled, endOfWeekDay, weeklyReflections]);

  // ── CONFLICT DETECTION ─────────────────────────────────────────────────────
  // Returns the full list of existing activities that overlap the proposed window on a given
  // calendar day. Unlike the old checkConflict boolean, callers need the offending blocks to
  // render a rich conflict panel with named blocks + a mini-spine.
  //
  // targetDate: `null` for recurring mode (weekday match); 'YYYY-MM-DD' for one-time mode
  // (exact-date match, but also catches recurring blocks that run on that weekday).
  const findConflictsOnDay = useCallback((
    day: string,
    targetDate: string | null,
    s: number, e: number,
    ignId: string | null, ignGid?: string,
  ): Activity[] => {
    // Cross-midnight proposal → split into two chunks, each tested independently.
    const iv = (a: number, b: number) => a > b ? [{ s: a, e: 24 }, { s: 0, e: b }] : [{ s: a, e: b }];
    const nI = iv(s, e);
    const current = useAppStore.getState().activities;
    const today = todayGreg();
    const hits: Activity[] = [];

    for (const a of current) {
      if (a.id === ignId) continue;
      if (ignGid && a.groupId === ignGid) continue;
      if (a.effectiveUntil && a.effectiveUntil <= today) continue;
      if (a.effectiveFrom && a.effectiveFrom > today) continue;

      // Decide if proposed and `a` are on the same concrete calendar day.
      let sameDate = false;
      if (targetDate) {
        // Proposed is one-time on targetDate.
        if (a.scheduledDate) sameDate = a.scheduledDate === targetDate;
        else sameDate = a.day === day; // recurring existing block on the same weekday
      } else {
        // Proposed is recurring on weekday `day`.
        if (a.scheduledDate) {
          const [yy, mm, dd] = a.scheduledDate.split('-').map(Number);
          const wd = JS_DAY_MAP[new Date(yy, mm - 1, dd).getDay()];
          sameDate = wd === day;
        } else {
          sameDate = a.day === day;
        }
      }
      if (!sameDate) continue;

      let collides = false;
      for (const ni of nI) {
        for (const ai of iv(a.startHour, a.endHour)) {
          if (ni.s < ai.e && ni.e > ai.s) { collides = true; break; }
        }
        if (collides) break;
      }
      if (collides) hits.push(a);
    }
    return hits;
  }, []);

  // Walk forward and backward from the proposed start in 15-min increments, looking for the
  // smallest shift that clears all conflicts on the given day. Duration is preserved. Returns
  // null if no window exists within a 12-hour search radius on either side.
  const findNearestFreeSlot = useCallback((
    s: number, e: number, day: string, targetDate: string | null,
    ignId: string | null, ignGid?: string,
  ): { start: number; end: number } | null => {
    const duration = e > s ? e - s : (24 - s) + e; // handle cross-midnight
    if (duration <= 0 || duration >= 24) return null;
    for (let shift = 15; shift <= 12 * 60; shift += 15) {
      const dh = shift / 60;
      // Forward — must fit in-day (start + duration ≤ 24).
      const fwdS = s + dh;
      if (fwdS + duration <= 24) {
        if (findConflictsOnDay(day, targetDate, fwdS, fwdS + duration, ignId, ignGid).length === 0) {
          return { start: fwdS, end: fwdS + duration };
        }
      }
      // Backward — same in-day guard. Without this, late-start + long-duration combos
      // produce nonsense like 21:00 → 35:45. We refuse to suggest cross-midnight slots;
      // user can keep their original block via "Schedule anyway" if that was the intent.
      const bwdS = s - dh;
      if (bwdS >= 0 && bwdS + duration <= 24) {
        if (findConflictsOnDay(day, targetDate, bwdS, bwdS + duration, ignId, ignGid).length === 0) {
          return { start: bwdS, end: bwdS + duration };
        }
      }
    }
    return null;
  }, [findConflictsOnDay]);

  const openNew = useCallback((prefillStart?: number, opts?: {
    prefillEnd?: number;
    prefillName?: string;
    prefillColor?: string;
    prefillMode?: 'recurring' | 'oneTime';
    prefillDate?: string;
  }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setEditingId(null); setEditingGroupId(undefined);
    setNewName(opts?.prefillName ?? '');
    setNewStart(prefillStart !== undefined ? formatTime(prefillStart) : '');
    setNewEnd(opts?.prefillEnd !== undefined ? formatTime(opts.prefillEnd) : '');
    setSelectedColor(opts?.prefillColor ?? COLORS[0]);
    setConflictError(''); setConflictData(null); setFormErrors({});
    setHasReminder(false); setIsHype(false); setIsLocked(false);
    setBlockMode(opts?.prefillMode ?? 'recurring');
    setScheduledDate(opts?.prefillDate ?? '');
    // Default the weekday selection to the day you're currently viewing — most common case.
    setSelectedWeekdays([selectedDay]);
    setAddBlockVisible(true);
  }, [selectedDay]);

  const openEdit = useCallback((actId: string) => {
    const allActs = useAppStore.getState().activities;
    const act = allActs.find(a => a.id === actId);
    if (!act) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setEditingId(act.id); setEditingGroupId(act.groupId);
    setNewName(act.label); setNewStart(formatTime(act.startHour)); setNewEnd(formatTime(act.endHour));
    setSelectedColor(act.color); setConflictError(''); setConflictData(null); setFormErrors({});
    setHasReminder(act.hasReminder !== false); setIsHype(act.isHype || false); setIsLocked(!!act.isLocked);
    setBlockMode(act.scheduledDate ? 'oneTime' : 'recurring'); setScheduledDate(act.scheduledDate || '');
    // For recurring blocks in a group (multi-day), gather every day the group spans.
    // For a single-day recurring block (no group), just its own day.
    if (act.groupId) {
      const groupDays = allActs.filter(a => a.groupId === act.groupId).map(a => a.day);
      setSelectedWeekdays(Array.from(new Set(groupDays)));
    } else {
      setSelectedWeekdays([act.day]);
    }
    setAddBlockVisible(true);
  }, []);

  const saveBlock = useCallback((opts?: { force?: boolean }) => {
    const s = parseTime(newStart), e = parseTime(newEnd);
    // ── Per-field validation ──
    // Each error is keyed by its field so the inline helper renders right under that input.
    // We collect everything first instead of bailing on the first failure — users see ALL the
    // problems at once instead of fixing one then discovering the next.
    const errs: FormErrors = {};
    if (!newName.trim()) errs.name = 'Give this block a name.';
    if (!newStart.trim()) errs.start = 'Start time is required.';
    else if (isNaN(s) || s < 0 || s >= 24) errs.start = 'Use HH:MM (00–23).';
    if (!newEnd.trim()) errs.end = 'End time is required.';
    else if (isNaN(e) || e < 0 || e >= 24) errs.end = 'Use HH:MM (00–23).';
    if (!errs.start && !errs.end && !isNaN(s) && !isNaN(e) && s === e) errs.end = 'End must differ from start.';
    if (blockMode === 'oneTime' && !scheduledDate) errs.date = 'Pick a date for the one-time block.';
    if (blockMode === 'recurring' && selectedWeekdays.length === 0) errs.days = 'Pick at least one day.';
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      setConflictError(''); setConflictData(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    setFormErrors({});
    setConflictError('');

    const today = todayGreg();
    const current = useAppStore.getState().activities;

    // ── Effective-date cutoff ──
    // For most edits, cutoff = today: old record gets effectiveUntil=today, new
    // record gets effectiveFrom=today. This preserves immutable past while
    // applying the change today onward.
    //
    // SPECIAL CASE — bled-into-today edits. If the block being edited (a) is
    // currently bleeding from yesterday into today (its source day-of-week is
    // yesterday's, AND it crosses midnight: endHour < startHour) AND we're
    // viewing today, then today's display reads YESTERDAY's effective records
    // (via the bleed resolver). With cutoff=today, the new record kicks in
    // tomorrow but yesterday's bleed still uses the old record — so the user's
    // edit looks like a no-op until next week. Setting cutoff=yesterday's date
    // makes yesterday's source instance reflect the new record, which means
    // today's bleed view immediately shows the change. Past dates strictly
    // before yesterday still hold the old record (effectiveUntil=yesterday
    // means "not effective from yesterday onward"; dates older than yesterday
    // are still less than that, so they keep showing the old version).
    const editingOriginal = editingId ? current.find(a => a.id === editingId) : null;
    const isBledIntoTodayEdit = isTodaySelected
      && !!editingOriginal
      && editingOriginal.endHour < editingOriginal.startHour
      && editingOriginal.day === yesterdayStr;
    const effectiveCutoff = isBledIntoTodayEdit ? yesterdayDateStr : today;

    // ── Conflict pre-check ── Collect per-day conflicts + nearest-free-slot suggestion.
    //   One-time: check the scheduled date's weekday against everything that occurs on that date.
    //   Recurring: check each selected weekday.
    //   Skipped when (a) the user explicitly chose Schedule Anyway (force=true), or
    //   (b) we're editing an existing block AND the start/end times haven't changed
    //   from the original. The user already accepted whatever conflict existed at
    //   creation time; non-time edits (label, color, reminder, etc.) shouldn't
    //   re-prompt for force-schedule. Touching either time flips this back on.
    const force = opts?.force === true;
    const timesUnchangedFromOriginal = !!editingOriginal
      && editingOriginal.startHour === s
      && editingOriginal.endHour === e;
    // schedulingUnchanged covers day/date/mode parity with the original record(s).
    // Used alongside timesUnchangedFromOriginal so that a day-only change (times same,
    // day different) still triggers a conflict check on the new day AND falls through
    // to the version-split path — the in-place fast-path doesn't write `day`/`scheduledDate`,
    // so taking it on a day change would silently drop the edit.
    const originalMode: 'recurring' | 'oneTime' = editingOriginal?.scheduledDate ? 'oneTime' : 'recurring';
    let schedulingUnchanged = !!editingOriginal && originalMode === blockMode;
    if (schedulingUnchanged && editingOriginal) {
      if (blockMode === 'oneTime') {
        schedulingUnchanged = editingOriginal.scheduledDate === scheduledDate;
      } else if (editingGroupId) {
        const groupDays = new Set(current.filter(a => a.groupId === editingGroupId).map(a => a.day));
        const newDays = new Set(selectedWeekdays);
        schedulingUnchanged = groupDays.size === newDays.size && [...groupDays].every(d => newDays.has(d));
      } else {
        schedulingUnchanged = selectedWeekdays.length === 1 && selectedWeekdays[0] === editingOriginal.day;
      }
    }
    const skipConflictCheck = force || (editingId != null && timesUnchangedFromOriginal && schedulingUnchanged);
    if (!skipConflictCheck) {
      const perDay: { day: string; conflicts: Activity[] }[] = [];
      if (blockMode === 'oneTime') {
        const [yy, mm, dd] = scheduledDate.split('-').map(Number);
        const wd = JS_DAY_MAP[new Date(yy, mm - 1, dd).getDay()];
        const hits = findConflictsOnDay(wd, scheduledDate, s, e, editingId ?? null, editingGroupId);
        if (hits.length > 0) perDay.push({ day: wd, conflicts: hits });
      } else {
        for (const d of selectedWeekdays) {
          const hits = findConflictsOnDay(d, null, s, e, editingId ?? null, editingGroupId);
          if (hits.length > 0) perDay.push({ day: d, conflicts: hits });
        }
      }
      if (perDay.length > 0) {
        // Suggest the nearest free slot on the first conflicting day. Same shift works for multi-day
        // since weekly patterns are symmetric — if 10:30–12:00 clears Monday, it likely clears
        // Wednesday too (user can still hit "Schedule anyway" if they want an override).
        const firstDay = perDay[0].day;
        const targetDateForSlot = blockMode === 'oneTime' ? scheduledDate : null;
        const slot = findNearestFreeSlot(s, e, firstDay, targetDateForSlot, editingId ?? null, editingGroupId);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setConflictData({
          days: perDay,
          suggestion: slot ? { ...slot, day: firstDay } : null,
        });
        return;
      }
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setConflictData(null);

    // ── In-place edit fast-path ──
    // We mutate the existing record(s) in place rather than splitting versions
    // when EITHER:
    //   (a) the times are unchanged (cosmetic edit — label, color, reminder,
    //       commit, isLocked) — there's no past-immutability contract to violate;
    //   (b) the edit originates from a bled-into-today view, regardless of what
    //       changed. The user asked for bled edits to reflect on today, and the
    //       version-split flow produced visible duplicates / consistency issues
    //       on the bled case. Past Tuesdays before today will show the new times,
    //       which matches the user's intent that the bled block's CURRENT
    //       INSTANCE is one live thing rather than a recurring history to
    //       preserve.
    // Otherwise we fall through to the version-split flow, which keeps past
    // immutability for normal time changes (the cutoff is today, so dates
    // strictly before today still hold the old version).
    const useInPlaceMutation = editingId && schedulingUnchanged && (timesUnchangedFromOriginal || isBledIntoTodayEdit);
    if (useInPlaceMutation) {
      const updated = current.map(a => {
        const isTarget = editingGroupId ? a.groupId === editingGroupId : a.id === editingId;
        if (!isTarget) return a;
        return {
          ...a,
          startHour: s,
          endHour: e,
          label: newName,
          color: selectedColor,
          hasReminder,
          isHype,
          isLocked,
        };
      });
      try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch {}
      setActivities(updated);
      setAddBlockVisible(false);
      setExpandedBlockId(null);
      return;
    }

    // Mark any existing records being edited as "ended at the cutoff date" — past
    // renders before the cutoff keep them via the effective-date filter; the
    // cutoff onward sees the new version pushed below. Cutoff is normally today
    // but can be yesterday's date for bled-into-today edits (see comment above).
    const withEnded = (arr: Activity[]) => arr.map(a => {
      const isTarget = editingGroupId ? a.groupId === editingGroupId : (editingId ? a.id === editingId : false);
      if (isTarget && !a.effectiveUntil) return { ...a, effectiveUntil: effectiveCutoff };
      return a;
    });

    if (blockMode === 'oneTime') {
      const [yy, mm, dd] = scheduledDate.split('-').map(Number);
      const targetDate = new Date(yy, mm - 1, dd);
      const targetDayName = JS_DAY_MAP[targetDate.getDay()];
      const updated = withEnded(current);
      updated.push({
        id: `${Date.now()}-one`,
        day: targetDayName, startHour: s, endHour: e,
        color: selectedColor, label: newName, hasReminder, isHype, isLocked,
        scheduledDate,
        effectiveFrom: effectiveCutoff,
      });
      try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch {}
      setActivities(updated);
      setAddBlockVisible(false); setExpandedBlockId(null);
      return;
    }

    // Recurring path.
    const targetDays = selectedWeekdays;
    const isMulti = targetDays.length > 1;
    const newGroupId = isMulti ? `g-${Date.now()}` : undefined;
    const updated = withEnded(current);
    targetDays.forEach((d, i) => updated.push({
      id: isMulti ? `${newGroupId}-${i}` : `one-${Date.now()}-${i}`,
      groupId: newGroupId, day: d, startHour: s, endHour: e,
      color: selectedColor, label: newName, hasReminder, isHype, isLocked,
      effectiveFrom: effectiveCutoff,
    }));

    try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch {}
    setActivities(updated);
    setAddBlockVisible(false); setExpandedBlockId(null);
  }, [newName, newStart, newEnd, selectedWeekdays, editingId, editingGroupId, blockMode, scheduledDate,
      selectedColor, hasReminder, isHype, findConflictsOnDay, findNearestFreeSlot, setActivities]);

  // ── COPY DAY ───────────────────────────────────────────────────────────
  // Duplicates the currently-selected day's recurring blocks (scheduledDate absent) onto
  // each chosen target weekday. Copies are independent (new ids, no shared groupId).
  // One-time blocks are intentionally skipped — they're date-specific, not pattern-copyable.
  const openCopyModal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopyTargetDays([]);
    setCopyModalVisible(true);
  }, []);
  const executeCopy = useCallback(() => {
    if (copyTargetDays.length === 0) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const today = todayGreg();
    const all = useAppStore.getState().activities;
    // Copy from the source day's currently-effective recurring blocks. Skip one-time blocks and
    // skip ended/historical versions so copies are always "what the day is now."
    const source = all.filter(a =>
      a.day === selectedDay &&
      !a.scheduledDate &&
      (!a.effectiveFrom || a.effectiveFrom <= today) &&
      (!a.effectiveUntil || a.effectiveUntil > today)
    );
    if (source.length === 0) { setCopyModalVisible(false); return; }
    const additions: Activity[] = [];
    copyTargetDays.forEach(targetDay => {
      source.forEach((a, i) => {
        additions.push({
          ...a,
          id: `copy-${Date.now()}-${targetDay}-${i}`,
          groupId: undefined, // copies are standalone, not tied to source's group
          day: targetDay,
          effectiveFrom: today,
          effectiveUntil: undefined,
        });
      });
    });
    try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch {}
    setActivities([...all, ...additions]);
    setCopyModalVisible(false);
  }, [copyTargetDays, selectedDay, setActivities]);

  const deleteBlock = useCallback(() => {
    // Confirm with the in-app modal so the language matches Notes/Habits/Challenges. Past dates
    // are preserved via effectiveUntil — the message tells the user that explicitly.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setConfirmModal({
      title: 'Remove this block?',
      message: 'It will disappear from today onward. Past days keep their record — you can still see it on dates before today.',
      label: 'Remove',
      onConfirm: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        const today = todayGreg();
        const current = useAppStore.getState().activities;
        const updated = current.map(a => {
          const match = editingGroupId ? a.groupId === editingGroupId : (editingId ? a.id === editingId : false);
          if (match && !a.effectiveUntil) return { ...a, effectiveUntil: today };
          return a;
        });
        setActivities(updated);
        setAddBlockVisible(false); setExpandedBlockId(null);
        setConfirmModal(null);
      },
    });
  }, [editingId, editingGroupId, setActivities]);

  const addTime = useCallback((h: number) => {
    const s = parseTime(newStart);
    if (isNaN(s)) { setConflictError('Enter a start time first.'); return; }
    const base = isNaN(parseTime(newEnd)) ? s : parseTime(newEnd);
    let e = base + h; if (e >= 24) e -= 24;
    setNewEnd(formatTime(e)); setConflictError(''); setConflictData(null);
  }, [newStart, newEnd]);

  const handleLogDayRating = useCallback((rating: DayRating) => {
    logDayRating(todayGreg(), rating);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [logDayRating]);

  // ── INTENT HANDLERS ───────────────────────────────────────────────────────
  // Open the add-intent modal pinned to a specific date. The close-of-day flow
  // calls this with tomorrow's date; the in-day "+ Add" button calls with today.
  const openIntentModal = useCallback((date: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIntentTargetDate(date);
    setIntentModalVisible(true);
  }, []);

  // Push wraps the store action with the rethink-prompt check. After incrementing
  // pushCount in the store, we read it back and surface the prompt at >= 3.
  const handlePushIntent = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pushIntentToTomorrow(id);
    // Read back the freshest state — set() inside Zustand is synchronous so this
    // is the just-pushed value, not a stale snapshot.
    const updated = useAppStore.getState().intents.find(i => i.id === id);
    if (updated && updated.pushCount >= 3) setIntentRethink(id);
  }, [pushIntentToTomorrow]);

  const deleteIntentWithConfirm = useCallback((id: string) => {
    const item = intents.find(i => i.id === id);
    if (!item) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setConfirmModal({
      title: 'Drop this intent?',
      message: item.label.length > 60 ? item.label.slice(0, 60) + '…' : item.label,
      label: 'Drop',
      onConfirm: () => {
        deleteIntentFromStore(id);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setConfirmModal(null);
      },
    });
  }, [intents, deleteIntentFromStore]);

  // ── DEEP WORK HANDLERS ────────────────────────────────────────────────────

  // (Diary handlers retired — diary entries live in the store and will be wired
  // up in the Notes tab when that tab is reworked.)

  // ── DERIVED ───────────────────────────────────────────────────────────────

  const currentHour = currentTime.getHours() + currentTime.getMinutes() / 60;

  // todayStr keyed on the date portion only — recomputes at midnight, not every 30s tick
  const todayDateKey = `${currentTime.getFullYear()}-${currentTime.getMonth()}-${currentTime.getDate()}`;
  const todayStr = useMemo(() => todayGreg(), [todayDateKey]);
  const prog = useMemo(() => calcProgress(calSystem), [currentTime, calSystem]);

  // yesterdayStr — day-of-week name of the day before `selectedDay`. Used for the bleed resolver.
  const yesterdayStr = DAYS[(DAYS.indexOf(selectedDay) + 6) % 7];
  const yesterdayDateStr = dateStrOffset(selectedOffset - 1);
  const isFutureSelected = selectedOffset > 0;
  const isPastSelected = selectedOffset < 0;

  // Effective-date filter: "is this activity's version visible on this date?"
  // An activity renders on renderDate iff its effective window contains that date.
  // Legacy activities (no effectiveFrom) are treated as always-effective for backwards compatibility.
  const isEffectiveOn = (a: Activity, renderDate: string): boolean => {
    if (a.effectiveFrom && a.effectiveFrom > renderDate) return false;
    if (a.effectiveUntil && a.effectiveUntil <= renderDate) return false;
    return true;
  };

  // Bled-from-yesterday blocks: include (a) recurring blocks on that day-of-week whose hours wrap past midnight,
  // and (b) one-time blocks scheduled for yesterday's date whose hours also wrap past midnight.
  const bledActs = useMemo(() => activities.filter(a => {
    if (a.startHour <= a.endHour) return false;
    if (!isEffectiveOn(a, yesterdayDateStr)) return false;
    if (a.scheduledDate) return a.scheduledDate === yesterdayDateStr;
    return a.day === yesterdayStr;
  }), [activities, yesterdayStr, yesterdayDateStr]);

  // The selected day's own blocks: (a) one-time blocks dated to this day, (b) recurring blocks for this day-of-week.
  const dayActs = useMemo(() => activities.filter(a => {
    if (!isEffectiveOn(a, selectedDateStr)) return false;
    if (a.scheduledDate) return a.scheduledDate === selectedDateStr;
    return a.day === selectedDay;
  }), [activities, selectedDay, selectedDateStr]);

  // Show every block scheduled for the selected day — past-ended blocks on today still matter
  // for context ("what happened so far"). The render pass dims past blocks via `isPast` opacity,
  // so they're visually distinct from active/upcoming without being hidden.
  const displayActs = useMemo(() => {
    const all = [
      ...bledActs.map(a => ({ ...a, renderStart: 0, renderEnd: a.endHour, isBled: true })),
      ...dayActs.map(a => ({ ...a, renderStart: a.startHour, renderEnd: a.startHour > a.endHour ? 24 : a.endHour, isBled: false })),
    ].sort((a, b) => a.renderStart - b.renderStart);
    return all;
  }, [bledActs, dayActs]);

  const activeNow  = useMemo(() => isTodaySelected ? displayActs.filter(a => currentHour >= a.renderStart && currentHour < a.renderEnd) : [], [displayActs, currentHour, isTodaySelected]);
  const upNext     = useMemo(() => isTodaySelected ? displayActs.find(a => a.renderStart > currentHour) ?? null : null, [displayActs, currentHour, isTodaySelected]);
  // Pact deadline — used to render a small hairline under the matching day on the week strip.
  // Surfaces the existing Pact mechanic into the home tab without adding any new data or logic;
  // the Pact still lives in Habits, this is just an awareness mark on the navigator.
  const pact = useAppStore(s => s.pact);
  const pactDeadlineStr = pact?.deadline ?? null;

  // ── CAPSULE UNLOCKS TODAY ──
  // Sealed Notes whose unlockDate falls within today's calendar bounds. Surfaces the time-capsule
  // mechanic into the awareness layer at zero cost — Notes still owns the data and the unlock UI.
  // Tappable: routes to the Notes tab so the user can read the capsule. Drops to null when none.
  const router = useRouter();
  const allNotes = useAppStore(s => s.notes);
  const capsulesUnlockingToday = useMemo(() => {
    if (!isTodaySelected) return [];
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const t1 = new Date(t0); t1.setDate(t1.getDate() + 1);
    const tStart = t0.getTime(), tEnd = t1.getTime();
    return allNotes.filter(n =>
      n.isSealed && n.status === 'active' &&
      typeof n.unlockDate === 'number' &&
      n.unlockDate >= tStart && n.unlockDate < tEnd
    );
  }, [allNotes, isTodaySelected, todayDateKey]);

  // ── BLOCK TRANSITION ──
  // The N-minute window after a block ends. While inside it, THE MOMENT/FREE TIME card is
  // replaced with a "just did X · next: Y" card so the user gets a moment of context-switch
  // closure instead of the schedule snapping to the next thing without acknowledgment.
  // Pure time-based detection (no manual "end block" needed) — the block's scheduled endHour
  // is the trigger, the window is fixed at 10 min wall-clock.
  const TRANSITION_WINDOW_HRS = 10 / 60;
  const justEnded = useMemo(() => {
    if (!isTodaySelected) return null;
    // Most-recent block whose end is within the window. Reverse-iterate so back-to-back blocks
    // surface the latest one (the one the user just left), not the one before it.
    for (let i = displayActs.length - 1; i >= 0; i--) {
      const a = displayActs[i];
      if (currentHour >= a.renderEnd && currentHour < a.renderEnd + TRANSITION_WINDOW_HRS) {
        return a;
      }
    }
    return null;
  }, [displayActs, currentHour, isTodaySelected]);
  const totalHrs   = useMemo(() => displayActs.reduce((s, a) => s + (a.renderEnd - a.renderStart), 0), [displayActs]);

  // ── Pending Commit reflections ──
  // A committed block needs reflection if (a) it's a Commit block, (b) it
  // ended at any point in the last PENDING_REFLECT_WINDOW_HOURS, and (c) the
  // user hasn't yet reflected/dismissed (its key isn't in reflectedKeys).
  // We surface the OLDEST pending one in the banner so older slips don't get
  // hidden behind newer ones; once acted on, the next oldest takes its slot.
  // Window is intentionally generous (4h) — the JUST DID card was 10 min,
  // which is way too short to catch a back-to-back block flow. The user opens
  // the app, sees what they need to reflect on, acts on it.
  const PENDING_REFLECT_WINDOW_HOURS = 4;
  const pendingReflections = useMemo(() => {
    if (!isTodaySelected) return [];
    const today = todayGreg();
    const reflectedSet = new Set(reflectedKeys);
    return displayActs
      .filter(a => {
        if (!a.isHype) return false;
        // Block has ended (currentHour past renderEnd) within the window.
        const endedAgoH = currentHour - (a.renderEnd ?? a.endHour ?? 0);
        if (endedAgoH < 0 || endedAgoH > PENDING_REFLECT_WINDOW_HOURS) return false;
        // Not yet acted on.
        const key = `${today}_${a.id}`;
        return !reflectedSet.has(key);
      })
      // Oldest first — so the banner pops the most-overdue reflection.
      .sort((a, b) => (a.renderEnd ?? a.endHour) - (b.renderEnd ?? b.endHour));
  }, [displayActs, currentHour, reflectedKeys, isTodaySelected]);
  const pendingReflection = pendingReflections[0] ?? null;

  // Overdue tasks are intentionally excluded — Timeline is today-facing. The Tasks tab
  // surfaces overdue with its "lifeless" treatment; Timeline doesn't re-echo past-deadline items.
  const activeTasks  = useMemo(() => tasks.filter(t => {
    if (t.completed || t.status === 'archived' || t.status === 'trash') return false;
    if (t.deadlineDate && t.deadlineDate < todayStr) return false; // drop overdue
    return true;
  }), [tasks, todayStr]);

  // LANDING — tasks whose DEADLINE or START DATE is the selected day. Fires on today
  // and any future day; past days have their own past-report surface. "Landing" as a
  // concept: things landing on that day. Each task is tagged later in render with a
  // small "DUE" / "STARTS" chip so the user knows why it's surfacing.
  const landingTasks = useMemo(() => {
    if (isPastSelected) return [];
    return tasks.filter(t => {
      if (t.completed || t.status === 'archived' || t.status === 'trash') return false;
      return t.deadlineDate === selectedDateStr || t.startDate === selectedDateStr;
    });
  }, [tasks, isPastSelected, selectedDateStr]);

  // PAST REPORT — what got done on the selected past date.
  // Completed tasks: by completedAt timestamp's date string.
  // Habits: those scheduled for that day-of-week, with done-count derived from history dates.
  const pastCompletedTasks = useMemo(() => {
    if (!isPastSelected) return [];
    return tasks.filter(t => {
      if (!t.completed || !t.completedAt) return false;
      const d = new Date(t.completedAt);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return ds === selectedDateStr;
    });
  }, [tasks, isPastSelected, selectedDateStr]);
  const pastHabits = useMemo(() => {
    if (!isPastSelected) return [];
    return habits.filter(h => isHabitToday(h, selectedDateStr));
  }, [habits, isPastSelected, selectedDateStr]);
  const pastHabitsDone = useMemo(() =>
    pastHabits.filter(h => h.history.filter(d => d === selectedDateStr).length >= h.targetCount),
  [pastHabits, selectedDateStr]);
  // (sortedTasks + pinnedTasks were retired with the Most-Urgent section. Intent
  // will replace that surface — see incoming Intent feature.)

  // ── Weekly reflection trigger ──
  // Surface the weekly-reflection card when (a) today's day-of-week matches the
  // user's chosen end-of-week and (b) we haven't yet logged a reflection for this
  // week. We key the reflection by the end-of-week date itself (todayStr when
  // it fires) — that's stable, locale-independent, and matches the user's mental
  // model of "the day I closed the week."
  const isEndOfWeekToday = useMemo(() => {
    const dayName = JS_DAY_MAP[currentTime.getDay()].toLowerCase();
    return dayName === endOfWeekDay;
  }, [currentTime, endOfWeekDay]);
  const weeklyReflectionLogged = !!weeklyReflections[todayStr];
  const weeklyReflectionDue = isTodaySelected && isEndOfWeekToday && !weeklyReflectionLogged;
  // Compute the rating breakdown for the trailing 7 days (including today).
  const weeklyRatingBreakdown = useMemo(() => {
    const counts = { strong: 0, ok: 0, rough: 0, missing: 0 };
    for (let i = 0; i < 7; i++) {
      const d = new Date(currentTime);
      d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const r = dayLog[ds];
      if (r === 'strong') counts.strong += 1;
      else if (r === 'ok') counts.ok += 1;
      else if (r === 'rough') counts.rough += 1;
      else counts.missing += 1;
    }
    return counts;
  }, [currentTime, dayLog]);

  // ── End-of-day pending-intents trigger ──
  // We surface a "roll undone intents to tomorrow" prompt once today's last
  // block has ended. Picking the cutoff from the actual schedule keeps us safe
  // against bedtime-style late-night blocks (sleep at 23:00 → cutoff is 23:00,
  // not earlier in the evening). Users with no blocks today get a 23:00 fallback.
  // Cross-midnight blocks (renderEnd > 24) just push the cutoff past 24, in
  // which case the prompt never fires today — that's correct: if you have a
  // sleep block running through tonight, end-of-day hasn't happened yet.
  const endOfDayCutoffHour = useMemo(() => {
    if (!isTodaySelected || displayActs.length === 0) return 23;
    return Math.max(...displayActs.map(a => a.renderEnd ?? a.endHour ?? 23));
  }, [displayActs, isTodaySelected]);
  const undoneTodayIntents = useMemo(
    () => intents.filter(i => i.date === todayStr && !i.completed),
    [intents, todayStr]
  );
  const showEndOfDayPrompt = isTodaySelected && currentHour >= endOfDayCutoffHour && undoneTodayIntents.length > 0;
  const handleRollAllToTomorrow = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Bulk-push each undone today-intent. Each call increments its own pushCount
    // by 1 — same semantic as the user pushing one-by-one, just batched.
    for (const it of undoneTodayIntents) {
      pushIntentToTomorrow(it.id);
    }
  }, [undoneTodayIntents, pushIntentToTomorrow]);

  // ── Selected-day derived values for the morphing top section ──
  // Intent mode fires on today + tomorrow; note mode on every other day.
  // Tomorrow's date string is computed from current time so it's stable across
  // selection changes (intent-mode is keyed by *real* tomorrow, not "yesterday's
  // tomorrow" if the app is open across midnight).
  const tomorrowDateStr = useMemo(() => {
    const d = new Date(currentTime);
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [todayDateKey]);
  const isTomorrowSelected = selectedDateStr === tomorrowDateStr;
  const showIntentSection = isTodaySelected || isTomorrowSelected;
  // Intent items pinned to the SELECTED day (today or tomorrow). Sorted with
  // incomplete first, then completed; within each group, oldest-first.
  const selectedDayIntents = useMemo(() => {
    if (!showIntentSection) return [];
    const mine = intents.filter(i => i.date === selectedDateStr);
    return [...mine].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return a.createdAt - b.createdAt;
    });
  }, [intents, selectedDateStr, showIntentSection]);
  const selectedDayIntentsDoneCount = useMemo(() => selectedDayIntents.filter(i => i.completed).length, [selectedDayIntents]);
  // Notes for the selected day, sorted by creation order. Computed for ALL
  // days now — today/tomorrow render notes as a secondary section below the
  // primary intent surface, since "John's birthday is today" is just as valid
  // a note as "John's birthday is in 5 days."
  const selectedDayNotes = useMemo(() => {
    return dayNotes
      .filter(n => n.date === selectedDateStr)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [dayNotes, selectedDateStr]);
  // Set of YYYY-MM-DD strings that have at least one DayNote. Used by the week
  // strip to render a small marker on each chip with notes — a quick at-a-glance
  // way to spot which days carry markers without scrolling through them.
  const datesWithNotes = useMemo(() => {
    const s = new Set<string>();
    for (const n of dayNotes) s.add(n.date);
    return s;
  }, [dayNotes]);
  // Past-day intents — visible read-only mirror of what the user intended that
  // day. Editing/pushing/deleting are NOT allowed; the past is a record. The
  // only way past intents update is via auto-tick when their linked source
  // (habit/task/challenge) is completed retroactively from its own surface.
  const pastDayIntents = useMemo(() => {
    if (!isPastSelected) return [];
    const mine = intents.filter(i => i.date === selectedDateStr);
    return [...mine].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return a.createdAt - b.createdAt;
    });
  }, [intents, selectedDateStr, isPastSelected]);

  const todayHabits     = useMemo(() => habits.filter(h => isHabitToday(h, todayStr)), [habits, todayStr]);
  const completedHabits = useMemo(() => todayHabits.filter(h =>
    h.history.filter(d => d === todayStr).length >= h.targetCount
  ), [todayHabits, todayStr]);
  const habitPct = useMemo(() => todayHabits.length > 0
    ? Math.round((completedHabits.length / todayHabits.length) * 100) : 100,
  [todayHabits, completedHabits]);

  const showClosePrompt = currentTime.getHours() >= 20 && !dayLog[todayStr];

  // Smart-suggestion threshold — anything shorter and "go do a task" doesn't make sense. You can't
  // meaningfully slot a haircut into a 1-hour open gap, so we only surface a suggestion when there's
  // a real 2h+ window. Below the threshold, we fall back to the plain gap indicator.
  const SMART_SUGGESTION_MIN_HOURS = 2;
  const energySuggestion = useMemo(() => {
    // Only surface suggestions for TODAY's free time. Past is written, future is planning —
    // neither should get a live "fill this gap now" prompt.
    if (!isTodaySelected || activeTasks.length === 0) return null;
    const sorted = [...displayActs].sort((a, b) => a.renderStart - b.renderStart);
    // Collect every gap from "now" through end-of-day, remembering which block each gap follows
    // (or `null` if it's before the first block). We'll pick the largest and render the suggestion
    // inline at that position — replacing the regular gap indicator between those two blocks.
    const gaps: { start: number; end: number; afterId: string | null }[] = [];
    let cursor = currentHour;
    let prevId: string | null = null;
    for (const act of sorted) {
      if (act.renderStart > cursor + 0.25) {
        gaps.push({ start: cursor, end: act.renderStart, afterId: prevId });
      }
      cursor = Math.max(cursor, act.renderEnd);
      prevId = act.id;
    }
    if (cursor < 22) {
      gaps.push({ start: cursor, end: 22, afterId: prevId });
    }
    // Largest gap wins — ties break on earlier start time.
    let best: typeof gaps[number] | null = null;
    for (const g of gaps) {
      const dur = g.end - g.start;
      if (dur < SMART_SUGGESTION_MIN_HOURS) continue;
      if (!best || dur > best.end - best.start) best = g;
    }
    if (!best) return null;
    const durationH = best.end - best.start;
    const energyForHour = best.start < 12 ? 'High' : best.start < 17 ? 'Medium' : 'Low';
    const match = activeTasks.find(t => t.energy === energyForHour) ?? activeTasks[0];
    if (!match) return null;
    return { start: best.start, end: best.end, durationH, task: match, afterId: best.afterId };
  }, [displayActs, activeTasks, currentHour, isTodaySelected]);

  const historyDots = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const ds = dateStrOffset(i - 6);
    const d = new Date(); d.setDate(d.getDate() + (i - 6));
    return { ds, isToday: i === 6, label: d.toLocaleDateString('en-US', { weekday: 'narrow' }), rating: dayLog[ds] };
  }), [dayLog]);

  const ratingColor = (r?: DayRating) =>
    r === 'strong' ? '#10B981' : r === 'ok' ? '#F59E0B' : r === 'rough' ? '#F43F5E' : (isDarkMode ? '#1A1A1A' : '#E5E5EA');

  const todayLabel = useMemo(() => getDateLabel(calSystem), [calSystem, currentTime]);

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>

        {/* ── HEADER ── */}
        <View style={{ paddingHorizontal: 24, paddingTop: 30, paddingBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ fontSize: 36, fontWeight: '900', color: theme.textMain, letterSpacing: -1 }}>Timeline.</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>{todayLabel}</Text>
              <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleCalendar(); }} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                <Text style={{ fontSize: 9, color: theme.textSub, opacity: 0.5, fontWeight: '900', letterSpacing: 0.5 }}>
                  • {calSystem === 'shamsi' ? 'SHAMSI' : 'GREGORIAN'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 18, alignItems: 'center' }}>
            {/* Pulse moved out of the main scroll (per Just-Now design). Still reachable here
                for users who want the day/week/month/year breakdown — small chart icon. */}
            <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPulseSheetVisible(true); }} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
              <Feather name="bar-chart-2" size={19} color={theme.textSub} />
            </TouchableOpacity>
            {/* Quick "remind me" capture — fire-and-forget reminder with no project / urgency / recurrence. */}
            <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setReminderModalVisible(true); }} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
              <Feather name="bell" size={19} color={theme.textMain} />
            </TouchableOpacity>
            {/* Dark mode moved into Settings (once-configured preference, not a daily action). */}
            <TouchableOpacity onPress={() => setSettingsVisible(true)} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
              <Feather name="settings" size={20} color={theme.textMain} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => openNew()} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
              <Feather name="plus-circle" size={22} color={theme.textMain} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── WEEK NAVIGATION ── Progressive pull-to-reveal via shared value.
             Height animates from 0 → NAV_HEIGHT as the user pulls. When viewing another week,
             the bar stays open until the user taps the "This week" label to return. */}
        <Animated.View style={[{ overflow: 'hidden' }, navAnimatedStyle]}>
        {(() => {
          const weekStart = new Date();
          weekStart.setDate(weekStart.getDate() + (weekOffset * 7) - DAYS.indexOf(todayDayName));
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          const fmt = (d: Date) => {
            if (calSystem === 'shamsi') {
              const s = getShamsiDateParts(d);
              return `${SHAMSI_MONTHS[s.month - 1].slice(0, 3)} ${s.day}`;
            }
            return `${GREG_MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
          };
          const prevWeekLatestOffset = (weekOffset - 1) * 7 + (6 - DAYS.indexOf(todayDayName));
          const canGoBack = prevWeekLatestOffset >= -PAST_LIMIT_DAYS;
          const atCurrentWeek = weekOffset === 0;
          const labelText = atCurrentWeek ? 'This week' : `${fmt(weekStart)} – ${fmt(weekEnd)}`;
          return (
            <View style={{ paddingHorizontal: 20, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <TouchableOpacity
                disabled={!canGoBack}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWeekOffset(w => w - 1); setExpandedBlockId(null); }}
                hitSlop={{ top: 12, bottom: 12, left: 20, right: 20 }}
              >
                <Feather name="chevron-left" size={18} color={canGoBack ? theme.textMain : theme.border} />
              </TouchableOpacity>
              <TouchableOpacity
                disabled={atCurrentWeek}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWeekOffset(0); setSelectedSlot(SLIDER_CENTER); setExpandedBlockId(null); setNavRevealed(false); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>{labelText}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWeekOffset(w => w + 1); setExpandedBlockId(null); }}
                hitSlop={{ top: 12, bottom: 12, left: 20, right: 20 }}
              >
                <Feather name="chevron-right" size={18} color={theme.textMain} />
              </TouchableOpacity>
            </View>
          );
        })()}
        </Animated.View>

        {/* ── HINT ── subtle handle above the slider; fades as the bar emerges.
             Hides permanently once the user has revealed the nav 3 times — they know the gesture. */}
        {hintVisible && (
          <Animated.View style={[{ alignItems: 'center', paddingVertical: 5 }, hintAnimatedStyle]}>
            <View style={{ width: 28, height: 3, borderRadius: 2, backgroundColor: theme.border }} />
          </Animated.View>
        )}

        {/* ── DAY SELECTOR ── 7-day slider. Each slot shows its date (translated to Shamsi when toggled).
             Cells older than PAST_LIMIT_DAYS are disabled and greyed out.
             Horizontal swipe (left = next week, right = prev week) acts as an alternative nav trigger. */}
        <GestureDetector gesture={sliderSwipeGesture}>
        <View style={{ paddingHorizontal: 20, marginBottom: 15, flexDirection: 'row', justifyContent: 'space-between' }}>
          {Array.from({ length: 7 }).map((_, i) => {
            // Rolling window centered on today: slot 3 is today when weekOffset === 0.
            const cellOffset = weekOffset * 7 + (i - SLIDER_CENTER);
            const cellDate = new Date(); cellDate.setDate(cellDate.getDate() + cellOffset);
            const isSel = selectedSlot === i;
            const isToday = cellOffset === 0;
            const disabled = cellOffset < -PAST_LIMIT_DAYS;
            const cellDayName = JS_DAY_MAP[cellDate.getDay()];
            const dayNum = calSystem === 'shamsi' ? getShamsiDateParts(cellDate).day : cellDate.getDate();
            // Pact deadline hairline — short colored bar under the day number on the matching cell.
            // Always rose (#F43F5E) — the urgency color across the app. Subtle, glanceable, no
            // tap target of its own (the cell handles selection).
            const cellDateStr = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
            const isPactDeadline = !!pactDeadlineStr && cellDateStr === pactDeadlineStr;
            const hasNote = datesWithNotes.has(cellDateStr);
            return (
              <TouchableOpacity
                key={i}
                disabled={disabled}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedSlot(i); setExpandedBlockId(null); }}
                // Compact Tinted (chosen from art-tab variants).
                // No borders anywhere. Distinction is purely from background:
                //   - selected → full inverted fill (textMain)
                //   - today    → faint textMain tint (8% in light, 14% in dark)
                //   - others   → transparent
                // The row reads as gentle elevation differences instead of stamped
                // outlines — calmer, less "every chip is a card."
                style={{
                  alignItems: 'center', paddingVertical: 7, borderRadius: 12, width: '13%',
                  backgroundColor: isSel
                    ? theme.textMain
                    : isToday
                      ? hexToRgba(theme.textMain, isDarkMode ? 0.14 : 0.08)
                      : 'transparent',
                  opacity: disabled ? 0.25 : 1,
                }}
              >
                <Text style={{ color: isSel ? theme.bg : theme.textSub, fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 }}>{cellDayName.slice(0, 3)}</Text>
                <Text style={{ color: isSel ? theme.bg : isToday ? theme.textMain : theme.textSub, fontSize: 14, fontWeight: '900', marginTop: 2 }}>
                  {dayNum}
                </Text>
                {/* Fixed-height indicator slot — every chip reserves the same
                    bottom space so chip heights stay uniform whether or not the
                    date carries a marker. Indicator priority (strongest first):
                      - pact deadline: rose hairline, wider — strongest signal.
                      - note exists: textSub hairline, narrower + dimmer.
                      - nothing: empty space. */}
                <View style={{ height: 5, marginTop: 3, alignItems: 'center', justifyContent: 'center' }}>
                  {isPactDeadline ? (
                    <View style={{ width: 12, height: 2, borderRadius: 1, backgroundColor: '#F43F5E' }} />
                  ) : hasNote ? (
                    <View style={{ width: 8, height: 1.5, borderRadius: 1, backgroundColor: isSel ? theme.bg : theme.textSub, opacity: 0.5 }} />
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
        </GestureDetector>

        <GestureDetector gesture={pullGesture}>
        <Animated.ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={animatedScrollHandler}
          scrollEventThrottle={16}
        >

          {/* ── WEEKLY REFLECTION CARD ── only on the user's chosen end-of-week day,
               and only when this week's reflection hasn't been logged yet. Shows the
               trailing-7-days rating count as a teaser and opens the reflection sheet
               on tap. Sits above Intent because it's the higher-emotion beat for that
               specific day — close the week before opening tomorrow. */}
          {weeklyReflectionDue && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setWeeklyReflectionDraft(''); setWeeklyReflectionVisible(true); }}
              style={{
                marginBottom: 16, paddingHorizontal: 16, paddingVertical: 14,
                borderRadius: 14, backgroundColor: hexToRgba('#8B5CF6', isDarkMode ? 0.18 : 0.1),
                borderWidth: 1, borderColor: hexToRgba('#8B5CF6', 0.3),
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <Feather name="archive" size={14} color="#8B5CF6" />
                <Text style={{ color: '#8B5CF6', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }}>END OF WEEK</Text>
              </View>
              <Text style={{ color: theme.textMain, fontSize: 16, fontWeight: '900', letterSpacing: -0.3, marginBottom: 4 }}>
                Close the week.
              </Text>
              <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600' }}>
                {weeklyRatingBreakdown.strong} Strong · {weeklyRatingBreakdown.ok} Steady · {weeklyRatingBreakdown.rough} Off
                {weeklyRatingBreakdown.missing > 0 ? ` · ${weeklyRatingBreakdown.missing} unrated` : ''}
              </Text>
            </TouchableOpacity>
          )}

          {/* ── COMMIT REFLECTION BANNER ── persistent surface for any committed
               block ended in the last 4 hours and not yet acted on. Survives
               back-to-back block transitions (the JUST DID card couldn't —
               it disappeared the moment a new block started). Tap to open
               the small reflection flow. Multiple pending reflections show
               oldest first; once acted on, the next one (if any) appears. */}
          {pendingReflection && (() => {
            const endedAgoMin = Math.round((currentHour - (pendingReflection.renderEnd ?? pendingReflection.endHour)) * 60);
            const ago = endedAgoMin < 1 ? 'just now' : endedAgoMin < 60 ? `${endedAgoMin}m ago` : `${Math.round(endedAgoMin / 60)}h ago`;
            const more = pendingReflections.length - 1;
            return (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setReflectKey(`${todayGreg()}_${pendingReflection.id}`);
                  setReflectStep('focus');
                  setReflectFocus(null);
                  setReflectWhy(null);
                }}
                style={{
                  marginBottom: 12, paddingHorizontal: 14, paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: hexToRgba(pendingReflection.color, isDarkMode ? 0.16 : 0.1),
                  borderWidth: 1, borderColor: hexToRgba(pendingReflection.color, 0.35),
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                }}
              >
                <Feather name="flag" size={14} color={pendingReflection.color} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: pendingReflection.color, fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginBottom: 2 }}>
                    REFLECT ON COMMIT{more > 0 ? ` · +${more} more` : ''}
                  </Text>
                  <Text style={[{ color: theme.textMain, fontSize: 13, fontWeight: '800' }, rtlTextStyle(pendingReflection.label)]} numberOfLines={1}>
                    {pendingReflection.label}
                  </Text>
                  <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600', marginTop: 1 }}>
                    Ended {ago}. Tap to log how it went.
                  </Text>
                </View>
                <Feather name="arrow-right" size={14} color={pendingReflection.color} />
              </TouchableOpacity>
            );
          })()}

          {/* ── END-OF-DAY PROMPT ── once today's last block has ended (or 23:00 if
               no blocks), if there are undone intents, surface a single-line strip
               with a Roll-all action. No silent auto-push at midnight — the user
               keeps explicit control, but the prompt makes silent dropping impossible.
               Tapping anywhere on the strip rolls every undone today-intent forward. */}
          {showEndOfDayPrompt && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleRollAllToTomorrow}
              style={{
                marginBottom: 12, paddingHorizontal: 14, paddingVertical: 12,
                borderRadius: 12, backgroundColor: hexToRgba('#F59E0B', isDarkMode ? 0.16 : 0.1),
                borderWidth: 1, borderColor: hexToRgba('#F59E0B', 0.35),
                flexDirection: 'row', alignItems: 'center', gap: 10,
              }}
            >
              <Feather name="moon" size={14} color="#F59E0B" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '800', letterSpacing: -0.1 }}>
                  {undoneTodayIntents.length} {undoneTodayIntents.length === 1 ? 'intent' : 'intents'} still pending
                </Text>
                <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600', marginTop: 2 }}>
                  Tap to roll {undoneTodayIntents.length === 1 ? 'it' : 'them all'} to tomorrow
                </Text>
              </View>
              <Feather name="arrow-right" size={14} color="#F59E0B" />
            </TouchableOpacity>
          )}

          {/* ── INTENT (today + tomorrow) ── top-of-Timeline plan. Up here on purpose:
               it's the first thing the user should see when opening the app. Each row is
               a checkbox + label + (optional) source-type icon. Long-press → drop. Push
               button moves un-checked items to tomorrow; 3rd push fires the rethink prompt.
               Only fires for today and tomorrow — other days surface a Note section below. */}
          {showIntentSection && (
            <View style={{
              marginBottom: 18, paddingHorizontal: 14, paddingVertical: 12,
              borderRadius: 14, borderWidth: 1, borderColor: theme.border,
              borderStyle: isTomorrowSelected ? 'dashed' : 'solid',
              backgroundColor: theme.surface,
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: selectedDayIntents.length > 0 ? 10 : 0 }}>
                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.8 }}>
                  {isTodaySelected ? 'TODAY' : 'TOMORROW'}{selectedDayIntents.length > 0 ? `  ·  ${selectedDayIntentsDoneCount}/${selectedDayIntents.length}` : ''}
                </Text>
                <TouchableOpacity onPress={() => openIntentModal(selectedDateStr)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Feather name="plus" size={12} color={theme.textMain} />
                  <Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '800' }}>Add</Text>
                </TouchableOpacity>
              </View>
              {selectedDayIntents.length === 0 ? (
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '500', fontStyle: 'italic', opacity: 0.7, marginTop: 4 }}>
                  {isTodaySelected ? 'Nothing set for today. Drop one in.' : 'Set up tomorrow.'}
                </Text>
              ) : (
                selectedDayIntents.map((it, idx) => {
                  const sourceIcon: keyof typeof Feather.glyphMap | null =
                    it.sourceType === 'task' ? 'check-square'
                    : it.sourceType === 'habit' ? 'target'
                    : it.sourceType === 'challenge' ? 'flag'
                    : null;
                  const isLast = idx === selectedDayIntents.length - 1;
                  return (
                    <TouchableOpacity
                      key={it.id}
                      activeOpacity={0.7}
                      onLongPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        setIntentDetailId(it.id);
                      }}
                      delayLongPress={400}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleIntent(it.id); }}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        paddingVertical: 9,
                        borderBottomWidth: isLast ? 0 : 1,
                        borderBottomColor: theme.border,
                      }}
                    >
                      {/* Checkbox — square so it visually contrasts the round dots used elsewhere */}
                      <View style={{
                        width: 18, height: 18, borderRadius: 5,
                        borderWidth: 1.5, borderColor: it.completed ? theme.textMain : theme.border,
                        backgroundColor: it.completed ? theme.textMain : 'transparent',
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        {it.completed && <Feather name="check" size={11} color={theme.bg} />}
                      </View>
                      {/* Label — strikethrough + dimmed once done. */}
                      <Text
                        numberOfLines={2}
                        style={[{
                          flex: 1, color: it.completed ? theme.textSub : theme.textMain,
                          fontSize: 13.5, fontWeight: '600', lineHeight: 18,
                          textDecorationLine: it.completed ? 'line-through' : 'none',
                          opacity: it.completed ? 0.55 : 1,
                        }, rtlTextStyle(it.label)]}
                      >
                        {it.label}
                      </Text>
                      {/* Carried-over chip — small, only when this item has been pushed at least once. */}
                      {it.pushCount > 0 && !it.completed && (
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: hexToRgba('#F59E0B', 0.12) }}>
                          <Text style={{ color: '#F59E0B', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>
                            ↑{it.pushCount}
                          </Text>
                        </View>
                      )}
                      {/* Source-type icon — quiet textSub, only when linked. */}
                      {sourceIcon && (
                        <Feather name={sourceIcon} size={11} color={theme.textSub} style={{ opacity: 0.65 }} />
                      )}
                      {/* Push / pull buttons — icon-only because the "today vs tomorrow"
                          context is now visible from the surrounding section header. On
                          today's un-done items: arrow-right pushes to tomorrow. On
                          tomorrow's un-done items: arrow-left pulls back to today (no
                          counter increment — pulling forward is a correction, not
                          deferral). Hit-slop generous enough to be tappable at this size. */}
                      {!it.completed && it.date === todayStr && (
                        <TouchableOpacity
                          onPress={(e) => { e.stopPropagation?.(); handlePushIntent(it.id); }}
                          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                          style={{ paddingHorizontal: 4, paddingVertical: 2 }}
                        >
                          <Feather name="arrow-right" size={15} color={theme.textSub} style={{ opacity: 0.75 }} />
                        </TouchableOpacity>
                      )}
                      {!it.completed && it.date === tomorrowDateStr && (
                        <TouchableOpacity
                          onPress={(e) => { e.stopPropagation?.(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); shipIntentBackToToday(it.id); }}
                          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                          style={{ paddingHorizontal: 4, paddingVertical: 2 }}
                        >
                          <Feather name="arrow-left" size={15} color={theme.textSub} style={{ opacity: 0.75 }} />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}

          {/* ── PAST INTENTS (read-only) ── on past-day views, mirror what the user
               intended that day. Visible only — no toggle, no push, no edit, no delete.
               The past is a record. Linked intents can still be retroactively ticked,
               but only by completing the underlying source from its own tab (e.g.
               marking yesterday's habit done in Habits → that day's linked intent
               auto-ticks). Hidden when there are no past intents to show. */}
          {isPastSelected && pastDayIntents.length > 0 && (
            <View style={{
              marginBottom: 18, paddingHorizontal: 14, paddingVertical: 12,
              borderRadius: 14, borderWidth: 1, borderColor: theme.border,
              borderStyle: 'dashed', backgroundColor: theme.surface,
              opacity: 0.85,
            }}>
              <View style={{ marginBottom: 10 }}>
                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.8 }}>
                  WAS INTENDED  ·  {pastDayIntents.filter(i => i.completed).length}/{pastDayIntents.length}
                </Text>
              </View>
              {pastDayIntents.map((it, idx) => {
                const sourceIcon: keyof typeof Feather.glyphMap | null =
                  it.sourceType === 'task' ? 'check-square'
                  : it.sourceType === 'habit' ? 'target'
                  : it.sourceType === 'challenge' ? 'flag'
                  : null;
                const isLast = idx === pastDayIntents.length - 1;
                return (
                  <View
                    key={it.id}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 10,
                      paddingVertical: 9,
                      borderBottomWidth: isLast ? 0 : 1,
                      borderBottomColor: theme.border,
                    }}
                  >
                    {/* Static checkbox visual — same shape as today's, no tap target. */}
                    <View style={{
                      width: 18, height: 18, borderRadius: 5,
                      borderWidth: 1.5, borderColor: it.completed ? theme.textMain : theme.border,
                      backgroundColor: it.completed ? theme.textMain : 'transparent',
                      alignItems: 'center', justifyContent: 'center',
                      opacity: 0.85,
                    }}>
                      {it.completed && <Feather name="check" size={11} color={theme.bg} />}
                    </View>
                    <Text
                      numberOfLines={2}
                      style={[{
                        flex: 1, color: it.completed ? theme.textSub : theme.textMain,
                        fontSize: 13.5, fontWeight: '600', lineHeight: 18,
                        textDecorationLine: it.completed ? 'line-through' : 'none',
                        opacity: it.completed ? 0.55 : 0.85,
                      }, rtlTextStyle(it.label)]}
                    >
                      {it.label}
                    </Text>
                    {sourceIcon && (
                      <Feather name={sourceIcon} size={11} color={theme.textSub} style={{ opacity: 0.5 }} />
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* ── DAY NOTE ── lightweight free-text markers attached to a date —
               birthdays, anniversaries, "concert tickets go on sale," etc. Different
               shape from Intent (no checkbox, no source link, no push). Multiple
               notes per day allowed. Tap a row to edit, long-press to delete.
               Renders on EVERY day:
                 - today/tomorrow: secondary surface below the intent section.
                   Compact when empty (header + Add button only), to keep the
                   primary intent surface from getting visually drowned.
                 - past/future-beyond-tomorrow: primary surface (no intent here).
                   Full empty-state copy + dashed border on future. */}
          {(() => {
            const isCompactWhenEmpty = showIntentSection;
            const showEmptyStateCopy = !isCompactWhenEmpty && selectedDayNotes.length === 0;
            return (
            <View style={{
              marginBottom: 18, paddingHorizontal: 14, paddingVertical: 12,
              borderRadius: 14, borderWidth: 1,
              borderStyle: (isFutureSelected && !showIntentSection) ? 'dashed' : 'solid',
              borderColor: theme.border, backgroundColor: theme.surface,
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: selectedDayNotes.length > 0 ? 10 : 0 }}>
                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.8 }}>
                  {selectedDayNotes.length > 1 ? `NOTES  ·  ${selectedDayNotes.length}` : 'NOTE'}
                </Text>
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNoteEditingId(null); setNoteDraft(''); setNoteModalVisible(true); }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                >
                  <Feather name="plus" size={12} color={theme.textMain} />
                  <Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '800' }}>Add</Text>
                </TouchableOpacity>
              </View>
              {showEmptyStateCopy ? (
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '500', fontStyle: 'italic', opacity: 0.7, marginTop: 4 }}>
                  {isPastSelected ? 'No notes for this day.' : 'Mark something on this day.'}
                </Text>
              ) : selectedDayNotes.length === 0 ? null : (
                selectedDayNotes.map((note, idx) => {
                  const isLast = idx === selectedDayNotes.length - 1;
                  return (
                    <TouchableOpacity
                      key={note.id}
                      activeOpacity={0.7}
                      onPress={() => {
                        // Tap → preview (read-only). Edit and Delete live inside
                        // the preview's button row. Forcing every read through
                        // edit mode dropped a cursor on the user when all they
                        // wanted was to look at the note.
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setNoteDetailId(note.id);
                      }}
                      onLongPress={() => {
                        // Long-press is still quick-delete for power users —
                        // skip the preview, go straight to confirm.
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        setConfirmModal({
                          title: 'Drop this note?',
                          message: note.text.length > 60 ? note.text.slice(0, 60) + '…' : note.text,
                          label: 'Drop',
                          onConfirm: () => {
                            deleteDayNoteFromStore(note.id);
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setConfirmModal(null);
                          },
                        });
                      }}
                      delayLongPress={500}
                      style={{
                        flexDirection: 'row', alignItems: 'flex-start', gap: 10,
                        paddingVertical: 9,
                        borderBottomWidth: isLast ? 0 : 1,
                        borderBottomColor: theme.border,
                      }}
                    >
                      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: theme.textSub, marginTop: 7, opacity: 0.6 }} />
                      {/* Cap row at 3 lines; full content reveals via tap → preview. */}
                      <Text numberOfLines={3} style={[{ flex: 1, color: theme.textMain, fontSize: 13.5, fontWeight: '500', lineHeight: 19 }, rtlTextStyle(note.text)]}>
                        {note.text}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
            );
          })()}

          {/* ── CAPSULE UNLOCKS TODAY ── high-emotion banner; sealed Note(s) crossing into "ready"
               on this calendar day. Tap routes to Notes so the user can extract them. Hidden on
               past/future days. Subtitle uses the first capsule's title; if multiple, count is
               appended ("+ 2 more"). */}
          {isTodaySelected && capsulesUnlockingToday.length > 0 && (() => {
            const first = capsulesUnlockingToday[0];
            const more = capsulesUnlockingToday.length - 1;
            return (
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/notes'); }}
                activeOpacity={0.85}
                style={{
                  marginBottom: 16, paddingHorizontal: 16, paddingVertical: 14,
                  borderRadius: 14, backgroundColor: hexToRgba('#8B5CF6', isDarkMode ? 0.18 : 0.1),
                  borderWidth: 1, borderColor: hexToRgba('#8B5CF6', 0.3),
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                }}
              >
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: hexToRgba('#8B5CF6', 0.2), alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="zap" size={14} color="#8B5CF6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#8B5CF6', fontSize: 11, fontWeight: '900', letterSpacing: 1.5 }}>
                    {capsulesUnlockingToday.length === 1 ? 'A CAPSULE UNLOCKS TODAY' : `${capsulesUnlockingToday.length} CAPSULES UNLOCK TODAY`}
                  </Text>
                  <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>
                    {first.title || 'Sealed object'}{more > 0 ? ` · +${more} more` : ''}
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color="#8B5CF6" style={{ opacity: 0.5 }} />
              </TouchableOpacity>
            );
          })()}

          {/* ── SECTION 1a: TRANSITION ── replaces THE MOMENT/FREE TIME for ~10 min after a
               block ends. Owns the market gap nobody nailed: notifications announce what's next
               but never close out what just happened. This card holds the previous block's name
               + duration, plus a one-line forward look (next block or "free time"). Calm,
               no narrator voice, no action — just acknowledgment. */}
          {isTodaySelected && justEnded && (() => {
            const dur = justEnded.renderEnd - justEnded.renderStart;
            // Look forward: is there an active block right now (back-to-back), or an upcoming one,
            // or nothing left? Each phrasing is slightly different.
            const nowActive = activeNow[0] ?? null;
            const nextLine = nowActive
              ? { label: 'NOW', text: nowActive.label, color: nowActive.color, time: '' }
              : upNext
                ? { label: 'NEXT', text: upNext.label, color: upNext.color, time: ` · ${formatTime(upNext.renderStart)}` }
                : { label: 'AFTER', text: displayActs.length === 0 ? 'Nothing scheduled' : 'Done for today', color: theme.textSub, time: '' };
            return (
              <View style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 18, marginBottom: 32, borderWidth: 1, borderColor: theme.border, borderLeftWidth: 4, borderLeftColor: justEnded.color }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: justEnded.color }} />
                  <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 2 }}>JUST DID</Text>
                  {/* Committed-block badge — signals "this block asked for a
                      reflection; the input box below is why it's here." */}
                  {justEnded.isHype && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: hexToRgba(justEnded.color, 0.15) }}>
                      <Feather name="flag" size={8} color={justEnded.color} />
                      <Text style={{ color: justEnded.color, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 }}>COMMIT</Text>
                    </View>
                  )}
                </View>
                <Text style={[{ color: theme.textMain, fontSize: 19, fontWeight: '900', letterSpacing: -0.4, marginBottom: 4 }, rtlTextStyle(justEnded.label)]} numberOfLines={1}>{justEnded.label}</Text>
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginBottom: 14 }}>
                  {formatDuration(dur)} · ended at {formatTime(justEnded.renderEnd)}
                </Text>

                {/* Commit reflection input — only on committed blocks. The
                    user logs how the block went; saves into commitReflections
                    keyed by date+activity. Capped at 280 chars (a tweet's
                    worth — short enough that "what mattered?" stays the
                    question, not "fill out a form"). */}
                <View style={{ height: 1, backgroundColor: theme.border, marginBottom: 12 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: nextLine.color, fontSize: 9, fontWeight: '900', letterSpacing: 2 }}>{nextLine.label}</Text>
                  <Text style={[{ color: theme.textMain, fontSize: 13, fontWeight: '700', flex: 1 }, rtlTextStyle(nextLine.text)]} numberOfLines={1}>
                    {nextLine.text}{nextLine.time}
                  </Text>
                </View>
              </View>
            );
          })()}

          {/* ── SECTION 1: THE MOMENT ── only when viewing today AND not in transition window */}
          {isTodaySelected && !justEnded && activeNow.length > 0 && activeNow.slice(0, 1).map(active => {
            const dur = active.renderEnd - active.renderStart;
            const pct = Math.min(100, Math.max(0, (currentHour - active.renderStart) / dur * 100));
            const minsLeft = Math.round((active.renderEnd - currentHour) * 60);
            return (
              <TouchableOpacity key={`moment-${active.id}`} activeOpacity={0.88} onPress={() => openEdit(active.id)}
                style={{ backgroundColor: active.color, borderRadius: 16, padding: 22, marginBottom: 32, overflow: 'hidden' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.8)' }} />
                    {/* Committed-block badge — leads the in-session label so the
                        user reads "this is a block I committed to" first, then
                        "in session." Mid-block check-in + end-of-block reflection
                        notifications fire for these. */}
                    {active.isHype && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.18)' }}>
                        <Feather name="flag" size={9} color="#FFF" />
                        <Text style={{ color: '#FFF', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>COMMIT</Text>
                      </View>
                    )}
                    <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 9, fontWeight: '900', letterSpacing: 2 }}>IN SESSION</Text>
                  </View>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '700' }}>
                    {minsLeft > 0 ? `${minsLeft}m left` : 'Wrapping up'}
                  </Text>
                </View>
                <Text style={{ color: '#FFF', fontSize: 24, fontWeight: '900', letterSpacing: -0.5, marginBottom: 20, lineHeight: 29 }} numberOfLines={2}>{active.label}</Text>
                <View style={{ height: 3, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                  <View style={{ height: '100%', width: `${pct}%`, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 2 }} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '700' }}>{formatTime(active.startHour)}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10, fontWeight: '900' }}>{Math.round(pct)}%</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '700' }}>{formatTime(active.endHour)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {isTodaySelected && !justEnded && activeNow.length === 0 && (
            <View style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 22, marginBottom: 32, borderWidth: 1, borderColor: theme.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.border }} />
                <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 2 }}>FREE TIME</Text>
              </View>
              {upNext ? (
                <>
                  <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: '900', letterSpacing: -0.4, marginBottom: 4 }} numberOfLines={1}>{upNext.label}</Text>
                  <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600' }}>
                    Starts at {formatTime(upNext.renderStart)} · {Math.round((upNext.renderStart - currentHour) * 60)}m from now
                  </Text>
                </>
              ) : (
                <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: '900', letterSpacing: -0.4 }}>
                  {displayActs.length === 0 ? 'Nothing scheduled.' : 'Done for today.'}
                </Text>
              )}
            </View>
          )}

          {/* Non-today hero — big date number anchors the view. Past = "recap", Future = "ahead". */}
          {!isTodaySelected && (() => {
            const sd = new Date(); sd.setDate(sd.getDate() + selectedOffset);
            const dateNum = calSystem === 'shamsi' ? getShamsiDateParts(sd).day : sd.getDate();
            const monthLabel = calSystem === 'shamsi'
              ? SHAMSI_MONTHS[getShamsiDateParts(sd).month - 1].slice(0, 3)
              : GREG_MONTHS[sd.getMonth()].slice(0, 3);
            const stateLabel = isPastSelected ? 'RECAP' : 'AHEAD';
            const stateColor = isPastSelected ? theme.textSub : '#3B82F6';
            return (
              <View style={{ marginBottom: 28, flexDirection: 'row', alignItems: 'flex-end', gap: 16 }}>
                <Text style={{ color: theme.textMain, fontSize: 64, fontWeight: '900', letterSpacing: -3, lineHeight: 64 }}>{dateNum}</Text>
                <View style={{ flex: 1, paddingBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Text style={{ color: theme.textMain, fontSize: 18, fontWeight: '900', letterSpacing: -0.3 }}>{selectedDay}</Text>
                    <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, backgroundColor: hexToRgba(stateColor, 0.15) }}>
                      <Text style={{ color: stateColor, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 }}>{stateLabel}</Text>
                    </View>
                  </View>
                  <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600' }}>
                    {monthLabel} · {isPastSelected
                      ? `${pastCompletedTasks.length} done · ${pastHabitsDone.length}/${pastHabits.length} habits`
                      : totalHrs > 0 ? `${totalHrs.toFixed(1)}h scheduled` : 'nothing blocked yet'}
                  </Text>
                </View>
              </View>
            );
          })()}


          {/* ── SECTION 2: BLOCKS ──
              Today = current + upcoming.
              Future = the selected day's full schedule, cards get dashed borders ("planned").
              Past   = the selected day's full schedule at 0.72 opacity ("history, done with"). */}
          <View style={{ marginBottom: 32, opacity: isPastSelected ? 0.72 : 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, marginTop: 4 }}>
              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' }}>
                {isTodaySelected ? "Today's blocks" : `${selectedDay}'s blocks`}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                {totalHrs > 0 && <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700' }}>{totalHrs.toFixed(1)}h</Text>}
                {/* Copy-day action: only surfaced when the selected day has at least one recurring block.
                    Past/future both allowed — you can duplicate any day's pattern onto other weekdays. */}
                {dayActs.some(a => !a.scheduledDate) && (
                  <TouchableOpacity onPress={openCopyModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Feather name="copy" size={14} color={theme.textSub} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {displayActs.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <DaySpine acts={displayActs} currentHour={currentHour} isTodaySelected={isTodaySelected} theme={theme} onPress={isPastSelected ? (() => {}) : openEdit} />
              </View>
            )}

            {/* Smart suggestion is now rendered INLINE at the biggest-gap position between blocks
                (see the displayActs map below). No standalone render here. */}

            {displayActs.length === 0 ? (
              isPastSelected ? (() => {
                // Past-day empty state — no blocks were scheduled, but the day might still hold
                // signal: tasks completed on that date, habit ratio, day rating. Surface what
                // DID happen so the day doesn't read as a void. Falls back to a minimal "no
                // record" line when truly nothing exists.
                const tasksDone = pastCompletedTasks.length;
                const habitsTotal = pastHabits.length;
                const habitsCompleted = pastHabitsDone.length;
                const rating = dayLog[selectedDateStr];
                const ratingMeta = rating === 'strong' ? { label: 'Strong', color: '#10B981' }
                  : rating === 'ok' ? { label: 'Steady', color: '#F59E0B' }
                  : rating === 'rough' ? { label: 'Off', color: '#F43F5E' }
                  : null;
                const hasAnySignal = tasksDone > 0 || habitsTotal > 0 || !!rating;
                if (!hasAnySignal) {
                  return (
                    <View style={{ paddingVertical: 28, alignItems: 'center' }}>
                      <Feather name="circle" size={20} color={theme.border} style={{ marginBottom: 10, opacity: 0.6 }} />
                      <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600' }}>No record of this day.</Text>
                    </View>
                  );
                }
                return (
                  <View style={{ padding: 18, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
                    <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '800', letterSpacing: -0.2, marginBottom: 4 }}>No blocks scheduled</Text>
                    <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginBottom: 14 }}>But here's what the day held.</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {tasksDone > 0 && (
                        <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Feather name="check" size={11} color={theme.textSub} />
                          <Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '800' }}>{tasksDone} task{tasksDone === 1 ? '' : 's'}</Text>
                        </View>
                      )}
                      {habitsTotal > 0 && (
                        <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Feather name="target" size={11} color={theme.textSub} />
                          <Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '800' }}>{habitsCompleted}/{habitsTotal} habit{habitsTotal === 1 ? '' : 's'}</Text>
                        </View>
                      )}
                      {ratingMeta && (
                        <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: hexToRgba(ratingMeta.color, 0.1), borderWidth: 1, borderColor: hexToRgba(ratingMeta.color, 0.3), flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ratingMeta.color }} />
                          <Text style={{ color: ratingMeta.color, fontSize: 11, fontWeight: '900' }}>{ratingMeta.label}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })() : (
                <TouchableOpacity onPress={() => openNew()} style={{ borderWidth: 1, borderColor: theme.border, borderStyle: 'dashed', borderRadius: 16, paddingVertical: 28, alignItems: 'center' }}>
                  <Feather name="calendar" size={20} color={theme.border} style={{ marginBottom: 8 }} />
                  <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600' }}>Add a block to {isTodaySelected ? 'today' : selectedDay.toLowerCase()}</Text>
                </TouchableOpacity>
              )
            ) : (
              displayActs.map((item, idx) => {
                const isActive = isTodaySelected && currentHour >= item.renderStart && currentHour < item.renderEnd;
                const isPast = isTodaySelected && currentHour >= item.renderEnd;
                const isExp = expandedBlockId === item.id + idx;
                const dur = item.renderEnd - item.renderStart;
                const pct = isActive ? Math.min(100, Math.max(0, (currentHour - item.renderStart) / dur * 100)) : 0;
                // Gap math — if there's a next block, the empty time between them is item.renderEnd → next.renderStart
                const next = displayActs[idx + 1];
                const gap = next ? next.renderStart - item.renderEnd : 0;
                // ── BLOCK CARD (D · left-slab) ──
                //   72px colored slab on the left holds the time range in white.
                //   Surface body on the right holds label + meta. Visually distinct from Tasks'
                //   "white card with colored stripe" language — this is a file-tab shape.
                //   Active blocks get a thin progress bar across the top + a soft border glow.
                //   Tap → toggle expand. Long-press → open edit modal (reschedule etc.).
                return (
                  <React.Fragment key={`b-${item.id}-${idx}`}>
                  <TouchableOpacity activeOpacity={isPastSelected ? 1 : 0.85}
                    onPress={() => { if (isPastSelected) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setExpandedBlockId(isExp ? null : item.id + idx); }}
                    onLongPress={() => !isPastSelected && openEdit(item.id)} delayLongPress={300}
                    style={{
                      marginBottom: 12, borderRadius: 16, overflow: 'hidden',
                      backgroundColor: theme.surface,
                      borderWidth: 1, borderStyle: isFutureSelected ? 'dashed' : 'solid',
                      borderColor: isActive ? hexToRgba(item.color, 0.5) : theme.border,
                      opacity: isPast && !isActive ? 0.35 : 1,
                      shadowColor: item.color, shadowOpacity: isActive ? 0.25 : 0, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: isActive ? 3 : 0,
                    }}>
                    {isActive && (
                      <View style={{ height: 2, backgroundColor: hexToRgba(item.color, 0.25) }}>
                        {/* Progress fill is a darker shade of the block color — same family, stronger weight.
                            Without this it reads as "same color as the slab," blending in. */}
                        <View style={{ height: '100%', width: `${pct}%`, backgroundColor: darken(item.color, 0.25) }} />
                      </View>
                    )}
                    <View style={{ flexDirection: 'row' }}>
                      {/* Left slab — time range in white over block color. 60px feels sized to the content. */}
                      <View style={{ width: 60, backgroundColor: item.color, paddingVertical: 14, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center', gap: 2 }}>
                        <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '900', letterSpacing: -0.3 }}>{formatTime(item.startHour)}</Text>
                        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700' }}>{formatTime(item.endHour)}</Text>
                      </View>
                      {/* Body — label + meta, expand affordance on the right */}
                      <View style={{ flex: 1, padding: 14, justifyContent: 'center' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                              <Text style={[{ color: theme.textMain, fontSize: 16, fontWeight: '800', flex: 1, letterSpacing: -0.2 }, rtlTextStyle(item.label)]} numberOfLines={1}>{item.label}</Text>
                              {/* Anchor icon retired alongside the anchor mechanic. */}
                              {item.isHype && <Feather name="flag" size={11} color={theme.textSub} style={{ opacity: 0.85 }} />}
                              {item.isBled && <Text style={{ color: theme.textSub, fontSize: 8, fontWeight: '900', letterSpacing: 1 }}>CONT.</Text>}
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600' }}>{formatDuration(dur)}</Text>
                              {item.hasReminder && !isPastSelected && <Feather name="bell" size={9} color={theme.textSub} style={{ opacity: 0.7 }} />}
                            </View>
                          </View>
                          {isActive ? (
                            <View style={{ backgroundColor: hexToRgba(item.color, 0.2), paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                              <Text style={{ color: item.color, fontSize: 9, fontWeight: '900' }}>NOW</Text>
                            </View>
                          ) : !isPastSelected ? (
                            <Feather name={isExp ? 'chevron-up' : 'chevron-down'} size={14} color={theme.border} />
                          ) : null}
                        </View>
                      </View>
                    </View>
                    {isExp && (
                      <View style={{ paddingHorizontal: 14, paddingTop: 0, paddingBottom: 14, flexDirection: 'row', gap: 10, borderTopWidth: 1, borderTopColor: theme.border }}>
                        <TouchableOpacity onPress={() => openEdit(item.id)} style={{ flex: 1, marginTop: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: item.color, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
                          <Feather name="edit-2" size={12} color={item.color} />
                          <Text style={{ color: item.color, fontSize: 12, fontWeight: '800' }}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => {
                            const { groupId, id, isBled } = item;
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setConfirmModal({
                              title: 'Remove this block?',
                              // Copy adapts: bled blocks are treated as live single
                              // instances (consistent with in-place mutation on
                              // edit), so removal is a true delete — past records
                              // for that pattern are gone too. Non-bled blocks
                              // preserve past via effectiveUntil.
                              message: isBled
                                ? 'This block stretches across midnight. Removing it deletes the record entirely; past instances of the same pattern will also be gone.'
                                : 'It will disappear from today onward. Past days keep their record — you can still see it on dates before today.',
                              label: 'Remove',
                              onConfirm: () => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                                const current = useAppStore.getState().activities;
                                let updated: Activity[];
                                if (isBled) {
                                  // True delete for bled blocks. effectiveUntil=yesterday
                                  // didn't reliably hide the record across all surfaces,
                                  // and conceptually these blocks are live single things,
                                  // not history records to preserve.
                                  updated = current.filter(a =>
                                    groupId ? a.groupId !== groupId : a.id !== id
                                  );
                                } else {
                                  // Standard: mark effectiveUntil=today; past renders keep
                                  // the record, today and forward stop showing it.
                                  const cutoff = todayGreg();
                                  updated = current.map(a => {
                                    const match = groupId ? a.groupId === groupId : a.id === id;
                                    if (match && !a.effectiveUntil) return { ...a, effectiveUntil: cutoff };
                                    return a;
                                  });
                                }
                                setActivities(updated);
                                setExpandedBlockId(null);
                                setConfirmModal(null);
                              },
                            });
                          }}
                          style={{ flex: 1, marginTop: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: hexToRgba('#F43F5E', 0.3), alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
                          <Feather name="trash-2" size={12} color="#F43F5E" />
                          <Text style={{ color: '#F43F5E', fontSize: 12, fontWeight: '800' }}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </TouchableOpacity>
                  {/* ── GAP / SMART SUGGESTION ── rendered after every block that has space after it.
                      The smart suggestion can land on an end-of-day gap too (no `next`), so we check it
                      independently of the regular-gap math. Past / <1h gaps stay quiet connectors. */}
                  {(() => {
                    const isSmartGap = !!energySuggestion && energySuggestion.afterId === item.id;
                    if (isSmartGap && energySuggestion) {
                      const sug = energySuggestion;
                      const win = suggestionWindow(sug.start, sug.end);
                      return (
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => openNew(win.start, {
                            prefillEnd: win.end,
                            prefillName: sug.task.text,
                            prefillColor: sug.task.color,
                            prefillMode: 'oneTime',
                            prefillDate: todayStr,
                          })}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: hexToRgba(sug.task.color, 0.4), backgroundColor: hexToRgba(sug.task.color, isDarkMode ? 0.08 : 0.05) }}
                        >
                          <View style={{ width: 3, height: 32, borderRadius: 2, backgroundColor: sug.task.color }} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 1.5, marginBottom: 2 }}>
                              {formatDuration(sug.durationH).toUpperCase()} FREE · {formatTime(sug.start)}–{formatTime(sug.end)}
                            </Text>
                            <Text style={[{ color: theme.textMain, fontSize: 13, fontWeight: '800' }, rtlTextStyle(sug.task.text)]} numberOfLines={1}>{sug.task.text}</Text>
                          </View>
                          <Feather name="plus" size={14} color={sug.task.color} />
                        </TouchableOpacity>
                      );
                    }
                    if (gap <= 0.01) return null;
                    const useConnector = isPastSelected || gap < GAP_HYBRID_THRESHOLD_HOURS;
                    if (useConnector) {
                      const barHeight = Math.min(48, 14 + gap * 6);
                      return (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 22, marginBottom: 12, marginTop: -2 }}>
                          <View style={{ width: 2, height: barHeight, backgroundColor: theme.border, borderRadius: 1 }} />
                          <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700' }}>{formatDuration(gap)} free</Text>
                        </View>
                      );
                    }
                    return (
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => openNew(item.renderEnd)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: theme.border, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 12 }}
                      >
                        <Feather name="plus" size={12} color={theme.textSub} />
                        <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>{formatDuration(gap)} free</Text>
                        <Text style={{ color: theme.border, fontSize: 10, fontWeight: '600', marginLeft: 'auto' }}>{formatTime(item.renderEnd)} – {formatTime(next!.renderStart)}</Text>
                      </TouchableOpacity>
                    );
                  })()}
                  </React.Fragment>
                );
              })
            )}
          </View>

          {/* ── LANDING ── tasks whose deadline OR start date is this day. Renders for
               today and future. Each row carries a DUE / STARTS chip so the user knows
               why it's surfacing (avoids the ambiguity of "is this task due today, or did
               I just start it today"). No cap — every landing matters equally. */}
          {!isPastSelected && landingTasks.length > 0 && (
            <View style={{ marginBottom: 32 }}>
              <SectionLabel label={isTodaySelected ? 'Landing today' : 'Landing'} right={`${landingTasks.length}`} theme={theme} />
              {landingTasks.map(task => {
                const isDue = task.deadlineDate === selectedDateStr;
                const isStart = task.startDate === selectedDateStr;
                return (
                  <View key={`land-${task.id}`} style={{ backgroundColor: theme.surface, borderRadius: 16, marginBottom: 10, borderWidth: 1, borderLeftWidth: 4, borderStyle: isFutureSelected ? 'dashed' : 'solid', borderColor: theme.border, borderLeftColor: task.color, padding: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: task.color, overflow: 'hidden', justifyContent: 'flex-end' }}>
                        {task.progress > 0 && <View style={{ height: `${task.progress}%`, backgroundColor: task.color, width: '100%' }} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[{ color: theme.textMain, fontSize: 15, fontWeight: '800', marginBottom: 5, letterSpacing: -0.2 }, rtlTextStyle(task.text)]} numberOfLines={1}>{task.text}</Text>
                        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          {/* Why-it's-here chip — DUE wins over STARTS when both are this day */}
                          {isDue ? (
                            <View style={{ backgroundColor: hexToRgba('#F43F5E', 0.12), paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}>
                              <Text style={{ color: '#F43F5E', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>DUE</Text>
                            </View>
                          ) : isStart ? (
                            <View style={{ backgroundColor: hexToRgba(task.color, 0.15), paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}>
                              <Text style={{ color: task.color, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>STARTS</Text>
                            </View>
                          ) : null}
                          {task.priority === 'High' && <View style={{ backgroundColor: hexToRgba('#F43F5E', 0.1), paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}><Text style={{ color: '#F43F5E', fontSize: 9, fontWeight: '900' }}>HIGH</Text></View>}
                          {task.deadlineTime && <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600' }}>by {task.deadlineTime}</Text>}
                          {(task.subTasks?.length || 0) > 0 && <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600' }}>{task.subTasks!.filter(s => s.completed).length}/{task.subTasks!.length} steps</Text>}
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* ── PAST REPORT ── past-day only: completed tasks + habit status for that day */}
          {isPastSelected && (
            <>
              {pastCompletedTasks.length > 0 && (
                <View style={{ marginBottom: 28 }}>
                  <SectionLabel label="Done" right={`${pastCompletedTasks.length}`} theme={theme} />
                  {pastCompletedTasks.map(task => (
                    <View key={`done-${task.id}`} style={{ backgroundColor: theme.surface, borderRadius: 16, marginBottom: 10, borderWidth: 1, borderLeftWidth: 4, borderColor: theme.border, borderLeftColor: task.color, padding: 16, opacity: 0.75 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: task.color, alignItems: 'center', justifyContent: 'center' }}>
                          <Feather name="check" size={14} color="#FFF" />
                        </View>
                        <Text style={[{ flex: 1, color: theme.textMain, fontSize: 15, fontWeight: '700', textDecorationLine: 'line-through' }, rtlTextStyle(task.text)]} numberOfLines={1}>{task.text}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {pastHabits.length > 0 && (
                <View style={{ marginBottom: 32 }}>
                  <SectionLabel label="Habits" right={`${pastHabitsDone.length}/${pastHabits.length}`} theme={theme} />
                  <View style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: theme.border }}>
                    {pastHabits.map((h, i) => {
                      const done = h.history.filter(d => d === selectedDateStr).length >= h.targetCount;
                      return (
                        <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: i < pastHabits.length - 1 ? 1 : 0, borderBottomColor: theme.border }}>
                          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: done ? h.color : 'transparent', borderWidth: done ? 0 : 1.5, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}>
                            {done && <Feather name="check" size={11} color="#FFF" />}
                          </View>
                          <Text style={{ flex: 1, color: done ? theme.textMain : theme.textSub, fontSize: 14, fontWeight: done ? '800' : '600' }} numberOfLines={1}>{h.title}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              {pastCompletedTasks.length === 0 && pastHabits.length === 0 && (
                <View style={{ paddingVertical: 28, alignItems: 'center', marginBottom: 32 }}>
                  <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600' }}>No record for this day.</Text>
                </View>
              )}
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              JUST-NOW LAYOUT (the below-blocks zone)
              Order is reversed and made conditional per the Just-Now architecture:
                1. Habits left today      (only when incomplete habits exist)
                2. Most urgent task       (only when there's at least one pinned task)
                3. Day rating             (big buttons when unset, small pill when set)
                4. "You're clear." beat   (when all three above are empty)
                5. Diary                  (always — the memory layer is invariant)
              The Pulse strip is gone from this scroll; it lives behind the chart
              icon in the header now. The Active Tasks 3-card list collapsed into a
              single "most urgent" card per Just-Now's spirit.
              ══════════════════════════════════════════════════════════════════ */}

          {/* ── HABITS LEFT TODAY ── only renders when at least one habit is unfinished. */}
          {isTodaySelected && (() => {
            const habitsLeft = todayHabits.filter(h => h.history.filter(d => d === todayStr).length < h.targetCount);
            if (habitsLeft.length === 0) return null;
            return (
              <View style={{ marginBottom: 24 }}>
                <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '700', marginBottom: 10 }}>
                  {habitsLeft.length === 1 ? 'One habit left today' : `${habitsLeft.length} habits left today`}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {habitsLeft.map(h => (
                    <View
                      key={h.id}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 7,
                        paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                        backgroundColor: hexToRgba(h.color, 0.1),
                        borderWidth: 1, borderColor: hexToRgba(h.color, 0.3),
                      }}
                    >
                      <View style={{ width: 7, height: 7, borderRadius: 3.5, borderWidth: 1.5, borderColor: h.color }} />
                      <Text style={{ color: h.color, fontSize: 12, fontWeight: '800' }} numberOfLines={1}>{h.title}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })()}

          {/* ── DAY RATING ── big buttons when unset, small pill when set. The
               late-evening "Reflect deeper" link was retired with the diary input
               — reflection input belongs in Notes, not Timeline. */}
          {isTodaySelected && (() => {
            const currentRating = dayLog[todayStr];
            // Word-label vocabulary mapped onto the existing 3-state DayRating schema. Keeps
            // historical data forward-compatible (no migration needed) while losing the emoji
            // language that read juvenile in a focus tool. Each label gets a single colored
            // dot for quick scan, but the word does the actual work.
            const RATINGS: { r: DayRating; label: string; color: string }[] = [
              { r: 'rough',  label: 'Off',    color: '#F43F5E' },
              { r: 'ok',     label: 'Steady', color: '#F59E0B' },
              { r: 'strong', label: 'Strong', color: '#10B981' },
            ];

            // Compact pill — once today's been rated, the section collapses to a single
            // self-explanatory line with a tap-to-change affordance. Keeps the screen quiet
            // without burying the ability to amend the rating.
            if (currentRating) {
              const meta = RATINGS.find(r => r.r === currentRating);
              if (!meta) return null;
              return (
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    const next = { ...dayLog }; delete next[todayStr]; setDayLog(next);
                  }}
                  activeOpacity={0.7}
                  style={{
                    marginBottom: 24, paddingHorizontal: 14, paddingVertical: 12,
                    borderRadius: 12, backgroundColor: hexToRgba(meta.color, 0.1),
                    borderWidth: 1, borderColor: hexToRgba(meta.color, 0.3),
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                  }}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: meta.color }} />
                  <Text style={{ color: meta.color, fontSize: 13, fontWeight: '900' }}>Today · {meta.label}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700' }}>Change</Text>
                </TouchableOpacity>
              );
            }

            // Unset — full button row.
            return (
              <View style={{ marginBottom: 24 }}>
                <View style={{ marginBottom: 10 }}>
                  <Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>HOW DID TODAY GO?</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {RATINGS.map(({ r, label, color }) => (
                    <TouchableOpacity
                      key={r}
                      onPress={() => handleLogDayRating(r)}
                      activeOpacity={0.75}
                      style={{
                        flex: 1, paddingVertical: 14, borderRadius: 12,
                        backgroundColor: isDarkMode ? '#111' : theme.surface,
                        borderWidth: 1, borderColor: theme.border,
                        alignItems: 'center', gap: 8,
                      }}
                    >
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                      <Text style={{ color: theme.textMain, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 }}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            );
          })()}

          {/* ── "YOU'RE CLEAR." BEAT ── shown when all three Just-Now sections above were
               hidden because nothing needs you (no habits left, no urgent tasks, rating set).
               Skipped when any of those is rendering. Diary still renders below regardless. */}
          {isTodaySelected && (() => {
            const habitsLeftCount = todayHabits.filter(h => h.history.filter(d => d === todayStr).length < h.targetCount).length;
            // No more "noUrgent" check via pinnedTasks — that surface was retired. The
            // "you're clear" beat now keys on habits done + rating set.
            const ratingSet = !!dayLog[todayStr];
            const allClear = habitsLeftCount === 0 && ratingSet;
            if (!allClear) return null;
            return (
              <View style={{ marginBottom: 24, paddingVertical: 8 }}>
                <Text style={{ color: theme.textMain, fontSize: 16, fontWeight: '900', letterSpacing: -0.3 }}>You're clear.</Text>
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginTop: 4 }}>Nothing pressing for the rest of today.</Text>
              </View>
            );
          })()}

          {/* Diary section retired from Timeline. Entries still live in the store
              (diaryEntries) and will be surfaced from a new Notes-tab sub-section
              when that tab is reworked. Timeline is now reflection-input-free. */}
        </Animated.ScrollView>
        </GestureDetector>

        {/* ── ADD/EDIT BLOCK MODAL ── */}
        <Modal visible={addBlockVisible} animationType="slide" transparent onRequestClose={() => setAddBlockVisible(false)}>
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setAddBlockVisible(false)} />
            <Animated.View style={[{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, maxHeight: '88%' }, sheetBottomPadStyle]}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginTop: 16, marginBottom: 12 }} />
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets={false}>
                <TextInput style={[{ fontSize: 28, fontWeight: '900', color: theme.textMain, marginBottom: formErrors.name ? 6 : 20 }, persianSafeInputStyle, rtlInputStyle(newName)]} placeholder="Block name..." placeholderTextColor={formErrors.name ? hexToRgba('#F43F5E', 0.45) : theme.border} value={newName} onChangeText={t => { setNewName(t); setFormErrors(e => ({ ...e, name: undefined })); setConflictError(''); }} autoFocus={!editingId} />
                {formErrors.name ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 16 }}>
                    <Feather name="alert-circle" size={11} color="#F43F5E" />
                    <Text style={{ color: '#F43F5E', fontSize: 11, fontWeight: '700' }}>{formErrors.name}</Text>
                  </View>
                ) : null}
                {conflictError ? <Text style={{ color: '#F59E0B', fontSize: 12, fontWeight: '800', marginBottom: 12, backgroundColor: hexToRgba('#F59E0B', 0.1), padding: 10, borderRadius: 10 }}>{conflictError}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: formErrors.start || formErrors.end ? 6 : 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: formErrors.start ? '#F43F5E' : theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 7 }}>START</Text>
                    <TextInput style={{ backgroundColor: isDarkMode ? '#111' : theme.bg, color: theme.textMain, padding: 14, borderRadius: 12, textAlign: 'center', fontWeight: '700', fontSize: 16, borderWidth: 1, borderColor: formErrors.start ? hexToRgba('#F43F5E', 0.5) : 'transparent' }} placeholder="08:00" placeholderTextColor={theme.border} value={newStart} onChangeText={v => { setNewStart(sanitizeTimeInput(v, newStart)); setFormErrors(e => ({ ...e, start: undefined })); setConflictError(''); setConflictData(null); }} onBlur={() => { const d = parseTime(newStart); if (!isNaN(d) && d >= 0 && d < 24) setNewStart(formatTime(d)); else setNewStart(''); }} keyboardType="number-pad" maxLength={5} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: formErrors.end ? '#F43F5E' : theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 7 }}>END</Text>
                    <TextInput style={{ backgroundColor: isDarkMode ? '#111' : theme.bg, color: theme.textMain, padding: 14, borderRadius: 12, textAlign: 'center', fontWeight: '700', fontSize: 16, borderWidth: 1, borderColor: formErrors.end ? hexToRgba('#F43F5E', 0.5) : 'transparent' }} placeholder="10:00" placeholderTextColor={theme.border} value={newEnd} onChangeText={v => { setNewEnd(sanitizeTimeInput(v, newEnd)); setFormErrors(e => ({ ...e, end: undefined })); setConflictError(''); setConflictData(null); }} onBlur={() => { const d = parseTime(newEnd); if (!isNaN(d) && d >= 0 && d < 24) setNewEnd(formatTime(d)); else setNewEnd(''); }} keyboardType="number-pad" maxLength={5} />
                  </View>
                </View>
                {(formErrors.start || formErrors.end) ? (
                  <View style={{ flexDirection: 'row', gap: 12, marginBottom: 10 }}>
                    <View style={{ flex: 1 }}>
                      {formErrors.start ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <Feather name="alert-circle" size={11} color="#F43F5E" />
                          <Text style={{ color: '#F43F5E', fontSize: 11, fontWeight: '700', flex: 1 }}>{formErrors.start}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      {formErrors.end ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <Feather name="alert-circle" size={11} color="#F43F5E" />
                          <Text style={{ color: '#F43F5E', fontSize: 11, fontWeight: '700', flex: 1 }}>{formErrors.end}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 20 }}>
                  {[{ l: '15m', v: 0.25 }, { l: '30m', v: 0.5 }, { l: '1h', v: 1 }, { l: '1.5h', v: 1.5 }, { l: '2h', v: 2 }].map(({ l, v }) => (
                    <TouchableOpacity key={l} onPress={() => addTime(v)} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: isDarkMode ? '#111' : theme.bg, alignItems: 'center', borderWidth: 1, borderColor: theme.border }}>
                      <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '800' }}>{l}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* ── MODE TOGGLE — weekly recurring vs. one-time dated ── */}
                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }}>WHEN</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14, backgroundColor: isDarkMode ? '#111' : theme.bg, borderRadius: 12, padding: 4 }}>
                  {([
                    { key: 'recurring' as const, label: 'Weekly' },
                    { key: 'oneTime'   as const, label: 'One-time' },
                  ]).map(opt => {
                    const active = blockMode === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setBlockMode(opt.key); setConflictError(''); setConflictData(null); if (opt.key === 'recurring') setScheduledDate(''); }}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: active ? theme.textMain : 'transparent', alignItems: 'center' }}
                      >
                        <Text style={{ color: active ? theme.bg : theme.textSub, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 }}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {blockMode === 'oneTime' ? (
                  <View style={{ marginBottom: formErrors.date ? 8 : 24 }}>
                    <CalendarPicker value={scheduledDate} onChange={(v) => { setScheduledDate(v); setFormErrors(e => ({ ...e, date: undefined })); setConflictData(null); setConflictError(''); }} theme={theme} calSystem={calSystem} />
                    {formErrors.date ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 }}>
                        <Feather name="alert-circle" size={11} color="#F43F5E" />
                        <Text style={{ color: '#F43F5E', fontSize: 11, fontWeight: '700' }}>{formErrors.date}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View style={{ marginBottom: formErrors.days ? 8 : 22 }}>
                    <Text style={{ color: formErrors.days ? '#F43F5E' : theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }}>DAYS</Text>
                    <View style={{ flexDirection: 'row', gap: 5 }}>
                      {DAYS.map(d => {
                        const isSel = selectedWeekdays.includes(d);
                        return (
                          <TouchableOpacity
                            key={d}
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              setSelectedWeekdays(prev => {
                                const next = prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d];
                                // Enforce minimum 1 selected day.
                                return next.length === 0 ? prev : next;
                              });
                              setFormErrors(e => ({ ...e, days: undefined }));
                              setConflictError(''); setConflictData(null);
                            }}
                            style={{ flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: isSel ? theme.textMain : (isDarkMode ? '#111' : theme.bg), borderWidth: 1, borderColor: isSel ? theme.textMain : (formErrors.days ? hexToRgba('#F43F5E', 0.4) : theme.border), alignItems: 'center' }}
                          >
                            <Text style={{ color: isSel ? theme.bg : theme.textSub, fontSize: 10, fontWeight: '900' }}>{d.slice(0, 3).toUpperCase()}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {formErrors.days ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 }}>
                        <Feather name="alert-circle" size={11} color="#F43F5E" />
                        <Text style={{ color: '#F43F5E', fontSize: 11, fontWeight: '700' }}>{formErrors.days}</Text>
                      </View>
                    ) : null}
                  </View>
                )}

                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }}>COLOR</Text>
                <View style={{ marginBottom: 24 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                    {COLORS.slice(0, 8).map(c => (
                      <TouchableOpacity key={c} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedColor(c); }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, alignItems: 'center', justifyContent: 'center' }}>
                        {selectedColor === c ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFF' }} /> : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    {COLORS.slice(8, 16).map(c => (
                      <TouchableOpacity key={c} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedColor(c); }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, alignItems: 'center', justifyContent: 'center' }}>
                        {selectedColor === c ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFF' }} /> : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <View style={{ backgroundColor: isDarkMode ? '#111' : theme.bg, borderRadius: 14, marginBottom: 20 }}>
                  {([
                    // Recurring days are now picked directly via the DAYS chip row above — no "Apply to Whole Week" switch.
                    // Each toggle carries a one-line helper so first-time users understand what
                    // they're enabling — no mystery checkboxes. Helpers are quiet textSub gray
                    // so they read as caption, not as primary content.
                    // (Anchor row was retired alongside drag-drop; without an auto-shift
                    // consumer it had no behavior, just visual noise.)
                    { icon: 'bell' as const, label: 'Pre-Start Reminder', helper: 'Notify a few minutes before this block starts.', value: hasReminder, set: setHasReminder },
                    { icon: 'flag' as const, label: 'Commit', helper: 'Adds a mid-block check-in and an end-of-block reflection prompt.', value: isHype, set: setIsHype },
                  ]).map(({ icon, label, helper, value, set }, i, arr) => (
                    <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: theme.border }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, paddingRight: 12 }}>
                        <Feather name={icon} size={16} color={theme.textMain} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '700' }}>{label}</Text>
                          <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '500', marginTop: 2, lineHeight: 14 }}>{helper}</Text>
                        </View>
                      </View>
                      <Switch value={value} onValueChange={v => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); set(v); }} trackColor={{ true: theme.textMain }} thumbColor="#FFF" />
                    </View>
                  ))}
                </View>
                {/* ── CONFLICT PANEL ── Shown when saveBlock detects overlaps.
                    Layout: warning chip → one compact strip per conflicting day (each strip
                    shows existing taken blocks in their colors on top, proposed block in
                    the user's selected color on bottom — no text in the bars, just a tight
                    visual) → primary "Try free slot" CTA (if one exists) → secondary
                    "Schedule anyway" escape. */}
                {conflictData && (() => {
                  const s = parseTime(newStart), e = parseTime(newEnd);
                  const propEndAbs = e > s ? e : e + 24;

                  return (
                    <View style={{
                      marginBottom: 16,
                      backgroundColor: hexToRgba('#F59E0B', isDarkMode ? 0.08 : 0.06),
                      borderWidth: 1, borderColor: hexToRgba('#F59E0B', 0.3),
                      borderRadius: 14, padding: 14, gap: 14,
                    }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Feather name="alert-triangle" size={12} color="#F59E0B" />
                        <Text style={{ color: '#F59E0B', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }}>CONFLICT</Text>
                      </View>

                      {conflictData.days.map((dayEntry) => {
                        // Per-day window: hug the collision zone tightly — 30 min padding each side.
                        const cEndsAbs = dayEntry.conflicts.map(c => c.endHour > c.startHour ? c.endHour : c.endHour + 24);
                        const winStart = Math.max(0, Math.floor(Math.min(s, ...dayEntry.conflicts.map(c => c.startHour)) - 0.5));
                        const winEnd = Math.min(48, Math.ceil(Math.max(propEndAbs, ...cEndsAbs) + 0.5));
                        const winW = Math.max(1, winEnd - winStart);
                        const leftPct = (x: number): `${number}%` => `${Math.max(0, Math.min(100, ((x - winStart) / winW) * 100))}%`;
                        const widthPct = (dur: number): `${number}%` => `${Math.max(0, Math.min(100, (dur / winW) * 100))}%`;

                        return (
                          <View key={`cday-${dayEntry.day}`} style={{ gap: 6 }}>
                            {/* Day header */}
                            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                              <Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 }}>
                                {dayEntry.day.toUpperCase()}
                              </Text>
                              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '700' }}>
                                {formatTime(winStart % 24)}–{formatTime(winEnd % 24)}
                              </Text>
                            </View>

                            {/* Two-row overlap strip: top = taken (existing), bottom = yours (proposed). */}
                            <View style={{ gap: 3 }}>
                              {/* Taken */}
                              <View style={{ height: 12, borderRadius: 3, backgroundColor: isDarkMode ? '#000' : theme.bg, overflow: 'hidden', position: 'relative' }}>
                                {dayEntry.conflicts.map((c, i) => {
                                  const ce = c.endHour > c.startHour ? c.endHour : c.endHour + 24;
                                  return (
                                    <View key={`cex-${dayEntry.day}-${i}`} style={{
                                      position: 'absolute',
                                      left: leftPct(c.startHour), width: widthPct(ce - c.startHour),
                                      top: 0, bottom: 0,
                                      backgroundColor: c.color,
                                    }} />
                                  );
                                })}
                              </View>
                              {/* Yours */}
                              <View style={{ height: 12, borderRadius: 3, backgroundColor: isDarkMode ? '#000' : theme.bg, overflow: 'hidden', position: 'relative' }}>
                                {!isNaN(s) && !isNaN(e) && (
                                  <View style={{
                                    position: 'absolute',
                                    left: leftPct(s), width: widthPct(propEndAbs - s),
                                    top: 0, bottom: 0,
                                    backgroundColor: selectedColor,
                                  }} />
                                )}
                              </View>
                            </View>

                            {/* Compact named list for this day */}
                            <View style={{ gap: 3, paddingTop: 2 }}>
                              {dayEntry.conflicts.map((c) => (
                                <View key={`cn-${dayEntry.day}-${c.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.color }} />
                                  <Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '700', flex: 1 }} numberOfLines={1}>{c.label}</Text>
                                  <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '600' }}>
                                    {formatTime(c.startHour)}–{formatTime(c.endHour)}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        );
                      })}

                      {/* Actions — primary suggestion + secondary force. */}
                      {conflictData.suggestion && (
                        <TouchableOpacity
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            setNewStart(formatTime(conflictData.suggestion!.start));
                            setNewEnd(formatTime(conflictData.suggestion!.end));
                            setConflictData(null);
                          }}
                          style={{
                            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                            paddingVertical: 12, borderRadius: 10, backgroundColor: theme.success,
                          }}
                        >
                          <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '900' }}>
                            Try {formatTime(conflictData.suggestion.start)}–{formatTime(conflictData.suggestion.end)}
                          </Text>
                          <Feather name="arrow-right" size={14} color="#FFF" />
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); saveBlock({ force: true }); }}
                        style={{
                          paddingVertical: 11, borderRadius: 10,
                          borderWidth: 1, borderColor: hexToRgba('#F59E0B', 0.5),
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: '#F59E0B', fontSize: 12, fontWeight: '900', letterSpacing: 0.3 }}>Schedule anyway</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })()}
                <TouchableOpacity onPress={() => saveBlock()} style={{ backgroundColor: theme.textMain, borderRadius: 14, padding: 17, alignItems: 'center', marginBottom: editingId ? 10 : 0 }}>
                  <Text style={{ color: theme.bg, fontWeight: '900', fontSize: 15 }}>Save Block</Text>
                </TouchableOpacity>
                {editingId && (
                  <TouchableOpacity onPress={deleteBlock} style={{ borderRadius: 14, borderWidth: 1, borderColor: hexToRgba('#F43F5E', 0.3), padding: 14, alignItems: 'center' }}>
                    <Text style={{ color: '#F43F5E', fontWeight: '900', fontSize: 14 }}>Delete Block</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            </Animated.View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ── PULSE DETAIL SHEET ── full detail for the compact strip: progress bars + 7-day dots + habits */}
        <Modal visible={pulseSheetVisible} animationType="slide" transparent onRequestClose={() => setPulseSheetVisible(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPulseSheetVisible(false)} />
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: Math.max(insets.bottom, 16) + 16 }}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 20 }} />
              <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, marginBottom: 18 }}>Pulse</Text>

              <View style={{ gap: 14, marginBottom: 22 }}>
                {[
                  { label: 'Day',   pct: prog.day,   color: '#3B82F6' },
                  { label: 'Week',  pct: prog.week,  color: '#10B981' },
                  { label: 'Month', pct: prog.month, color: '#F59E0B' },
                  { label: 'Year',  pct: prog.year,  color: '#F43F5E' },
                ].map(b => (
                  <View key={b.label}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                      <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700' }}>{b.label}</Text>
                      <Text style={{ color: b.color, fontSize: 11, fontWeight: '900' }}>{(b.pct * 100).toFixed(0)}%</Text>
                    </View>
                    <View style={{ height: 3, backgroundColor: theme.isDark ? '#111' : theme.border, borderRadius: 2, overflow: 'hidden' }}>
                      <View style={{ height: '100%', width: `${Math.min(100, b.pct * 100)}%`, backgroundColor: b.color, borderRadius: 2 }} />
                    </View>
                  </View>
                ))}
              </View>

              {/* Habits moved to its own main-scroll section. Pulse sheet keeps bars + 7-day dots only. */}
              <View style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 18 }}>
                <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 2, marginBottom: 12 }}>7 DAYS</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  {historyDots.map((d, i) => (
                    <View key={i} style={{ alignItems: 'center', gap: 6 }}>
                      <View style={{ width: d.isToday ? 10 : 8, height: d.isToday ? 10 : 8, borderRadius: 5, backgroundColor: ratingColor(d.rating), borderWidth: d.isToday ? 1.5 : 0, borderColor: theme.textMain }} />
                      <Text style={{ color: d.isToday ? theme.textMain : theme.border, fontSize: 9, fontWeight: d.isToday ? '900' : '700' }}>{d.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── COPY DAY MODAL ── pick target weekdays; recurring blocks from selectedDay get duplicated */}
        <Modal visible={copyModalVisible} animationType="slide" transparent onRequestClose={() => setCopyModalVisible(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setCopyModalVisible(false)} />
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: Math.max(insets.bottom, 16) + 16 }}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 20 }} />
              <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 }}>Copy {selectedDay}</Text>
              <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginBottom: 20 }}>
                Duplicate every recurring block onto the days you pick.
              </Text>
              <View style={{ flexDirection: 'row', gap: 5, marginBottom: 22 }}>
                {DAYS.filter(d => d !== selectedDay).map(d => {
                  const isSel = copyTargetDays.includes(d);
                  return (
                    <TouchableOpacity
                      key={d}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setCopyTargetDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
                      }}
                      style={{ flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: isSel ? theme.textMain : (isDarkMode ? '#111' : theme.bg), borderWidth: 1, borderColor: isSel ? theme.textMain : theme.border, alignItems: 'center' }}
                    >
                      <Text style={{ color: isSel ? theme.bg : theme.textSub, fontSize: 10, fontWeight: '900' }}>{d.slice(0, 3).toUpperCase()}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity onPress={() => setCopyModalVisible(false)} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ color: theme.textSub, fontWeight: '800', fontSize: 13 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={executeCopy}
                  disabled={copyTargetDays.length === 0}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.textMain, alignItems: 'center', opacity: copyTargetDays.length === 0 ? 0.4 : 1 }}
                >
                  <Text style={{ color: theme.bg, fontWeight: '900', fontSize: 13 }}>
                    Copy to {copyTargetDays.length || 'none'}{copyTargetDays.length === 1 ? ' day' : ' days'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* DailyClose modal + Diary modal retired — reflection input belongs in
            Notes, not Timeline. Diary entries data still lives in the store and
            will be surfaced in Notes when that tab is reworked. */}

        {/* ── INTENT ADD MODAL ──
            Four tabs: Custom (label-only freeform) / From Tasks / From Habits /
            From Challenges. Tapping a row in a From-X tab creates the intent
            linked to that source AND closes the modal — one tap to commit, no
            confirm step. Custom requires typing + Add. Items already linked as
            intents for this date are filtered out so we don't duplicate. */}
        <IntentAddModal
          visible={intentModalVisible}
          theme={theme}
          isDarkMode={isDarkMode}
          targetDate={intentTargetDate}
          todayStr={todayStr}
          tasks={tasks}
          habits={habits}
          challenges={challenges}
          existingIntents={intents}
          maxLabelLen={INTENT_LABEL_MAX}
          onClose={() => setIntentModalVisible(false)}
          onAdd={(payload) => {
            const now = Date.now();
            addIntent({
              id: `int_${now}_${Math.random().toString(36).slice(2, 6)}`,
              date: intentTargetDate,
              label: payload.label,
              completed: false,
              sourceType: payload.sourceType,
              sourceId: payload.sourceId,
              pushCount: 0,
              createdAt: now,
            });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setIntentModalVisible(false);
          }}
          insetsBottom={insets.bottom}
          sheetBottomPadStyle={sheetBottomPadStyle}
        />

        {/* ── WEEKLY REFLECTION SHEET ──
            Shows the rating breakdown the user already authored across the
            week, plus a single free-text input. On submit, saves to the store
            keyed by today's date (the end-of-week day). If 3+ Off days landed,
            an after-submit warm-words note appears once — gentle, not clinical.
            The phrasing ("If it helps to talk to someone, talk to someone") is
            permissive, not prescriptive. */}
        <Modal visible={weeklyReflectionVisible} transparent animationType="slide" onRequestClose={() => setWeeklyReflectionVisible(false)}>
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setWeeklyReflectionVisible(false)} />
            <Animated.View style={[{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 12) + 16, paddingHorizontal: 24 }, sheetBottomPadStyle]}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 18 }} />
              <Text style={{ color: theme.textMain, fontSize: 24, fontWeight: '900', letterSpacing: -0.6, marginBottom: 6 }}>Close the week.</Text>
              <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', marginBottom: 18 }}>
                {weeklyRatingBreakdown.strong} Strong, {weeklyRatingBreakdown.ok} Steady, {weeklyRatingBreakdown.rough} Off. How do you think the week was?
              </Text>
              <TextInput
                value={weeklyReflectionDraft}
                onChangeText={setWeeklyReflectionDraft}
                placeholder="A few sentences. What landed, what didn't."
                placeholderTextColor={theme.border}
                multiline
                autoFocus
                style={[{
                  backgroundColor: isDarkMode ? '#111' : theme.bg,
                  color: theme.textMain, padding: 14, borderRadius: 12,
                  minHeight: 120, fontSize: 15, fontWeight: '500', lineHeight: 21,
                  textAlignVertical: 'top', marginBottom: 12, borderWidth: 1, borderColor: theme.border,
                }, persianSafeInputStyle, rtlInputStyle(weeklyReflectionDraft)]}
              />
              {/* Warm-words note — appears as part of the sheet when 3+ Off days
                  landed, BEFORE the user submits. Comes after the input field so
                  it reads as context for the reflection, not as something blocking
                  the submit. Quiet color, no medical language. */}
              {weeklyRatingBreakdown.rough >= 3 && (
                <View style={{ marginBottom: 12, padding: 12, borderRadius: 10, backgroundColor: hexToRgba('#F59E0B', isDarkMode ? 0.12 : 0.08), borderLeftWidth: 3, borderLeftColor: '#F59E0B' }}>
                  <Text style={{ color: theme.textMain, fontSize: 12, fontWeight: '600', lineHeight: 18 }}>
                    Three off days is a lot of weight to carry. That's allowed to be true. If it helps to talk to someone, talk to someone.
                  </Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setWeeklyReflectionVisible(false)}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                >
                  <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '800' }}>Later</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    const text = weeklyReflectionDraft.trim();
                    // Allow empty submits — closing the week is the ritual; the
                    // text is optional. Saving an empty entry still records that
                    // the week was acknowledged.
                    addWeeklyReflection({
                      id: todayStr,
                      weekKey: todayStr,
                      endedOn: todayStr,
                      text,
                      createdAt: Date.now(),
                    });
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    setWeeklyReflectionDraft('');
                    setWeeklyReflectionVisible(false);
                  }}
                  style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.textMain, alignItems: 'center' }}
                >
                  <Text style={{ color: theme.bg, fontSize: 13, fontWeight: '900', letterSpacing: 0.3 }}>Save</Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ── DAY NOTE PREVIEW ──
            Read-only full-content view. Opened by tapping a note row. From
            here the user can dismiss, jump into Edit (which opens the edit
            modal with the text loaded), or Delete (which routes through the
            existing confirm flow). Reading a long note no longer forces
            cursor-and-edit-mode. */}
        {noteDetailId && (() => {
          const note = dayNotes.find(n => n.id === noteDetailId);
          if (!note) return null;
          return (
            <Modal visible transparent animationType="fade" onRequestClose={() => setNoteDetailId(null)}>
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
                <View style={{ backgroundColor: theme.surface, borderRadius: 18, padding: 22, borderWidth: 1, borderColor: theme.border, maxHeight: '70%' }}>
                  {/* No date header — the user got here from this day's note row,
                      so they already know which day this belongs to. */}
                  <ScrollView style={{ marginBottom: 18 }} showsVerticalScrollIndicator={false}>
                    <Text style={[{ color: theme.textMain, fontSize: 15, fontWeight: '500', lineHeight: 22 }, rtlTextStyle(note.text)]}>
                      {note.text}
                    </Text>
                  </ScrollView>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => setNoteDetailId(null)}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                    >
                      <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '900' }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setNoteEditingId(note.id);
                        setNoteDraft(note.text);
                        setNoteDetailId(null);
                        setNoteModalVisible(true);
                      }}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                    >
                      <Text style={{ color: theme.textMain, fontSize: 12, fontWeight: '900' }}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        const id = note.id;
                        const txt = note.text;
                        setNoteDetailId(null);
                        // Tiny defer so the preview's dismiss animation doesn't
                        // race the new confirm modal mount.
                        setTimeout(() => {
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                          setConfirmModal({
                            title: 'Drop this note?',
                            message: txt.length > 60 ? txt.slice(0, 60) + '…' : txt,
                            label: 'Drop',
                            onConfirm: () => {
                              deleteDayNoteFromStore(id);
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              setConfirmModal(null);
                            },
                          });
                        }, 50);
                      }}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: hexToRgba('#F43F5E', 0.4), alignItems: 'center' }}
                    >
                      <Text style={{ color: '#F43F5E', fontSize: 12, fontWeight: '900' }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          );
        })()}

        {/* ── DAY NOTE MODAL ──
            Single text input pinned to a calendar date. Used on any day that
            isn't today/tomorrow. Reused for both add and edit (noteEditingId
            non-null = edit mode, preserving original createdAt). */}
        <Modal visible={noteModalVisible} transparent animationType="slide" onRequestClose={() => setNoteModalVisible(false)}>
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setNoteModalVisible(false)} />
            <Animated.View style={[{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 12) + 16, paddingHorizontal: 24 }, sheetBottomPadStyle]}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 18 }} />
              <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 }}>
                {noteEditingId ? 'Edit note.' : `Note for ${selectedDay}.`}
              </Text>
              <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginBottom: 18 }}>
                Birthdays, anniversaries, anything you want anchored to this date.
              </Text>
              {/* Input + overlay counter. The counter is positioned ABSOLUTELY
                  inside the input wrapper so it floats over the bottom-right of
                  the field — this keeps it visible above the keyboard, where a
                  below-the-input position would slide off-screen. Only renders
                  when the user is within NOTE_COUNTER_VISIBLE chars of the cap.
                  Sits on a small surface chip so it stays legible against the
                  input's background.
                  maxHeight caps growth so a long note becomes internally
                  scrollable instead of expanding the modal and shoving the
                  buttons below the keyboard. */}
              <View style={{ position: 'relative', marginBottom: 16 }}>
                <TextInput
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  placeholder="What's on this day?"
                  placeholderTextColor={theme.border}
                  multiline
                  autoFocus
                  maxLength={NOTE_TEXT_MAX}
                  style={[{
                    backgroundColor: isDarkMode ? '#111' : theme.bg,
                    color: theme.textMain, padding: 14, paddingRight: 50, borderRadius: 12,
                    minHeight: 92, maxHeight: 200, fontSize: 15, fontWeight: '500', lineHeight: 21,
                    textAlignVertical: 'top', borderWidth: 1, borderColor: theme.border,
                  }, persianSafeInputStyle, rtlInputStyle(noteDraft)]}
                />
                {NOTE_TEXT_MAX - noteDraft.length <= NOTE_COUNTER_VISIBLE && (
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute', bottom: 6, right: 6,
                      paddingHorizontal: 6, paddingVertical: 2,
                      borderRadius: 6,
                      backgroundColor: hexToRgba(theme.surface, 0.92),
                    }}
                  >
                    <Text style={{
                      color: NOTE_TEXT_MAX - noteDraft.length <= 20 ? '#F43F5E' : theme.textSub,
                      fontSize: 10, fontWeight: '800',
                    }}>
                      {NOTE_TEXT_MAX - noteDraft.length}
                    </Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => { setNoteModalVisible(false); setNoteEditingId(null); setNoteDraft(''); }}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                >
                  <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '800' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={!noteDraft.trim()}
                  onPress={() => {
                    const text = noteDraft.trim();
                    if (!text) return;
                    if (noteEditingId) {
                      updateDayNote(noteEditingId, text);
                    } else {
                      const now = Date.now();
                      addDayNote({
                        id: `dn_${now}_${Math.random().toString(36).slice(2, 6)}`,
                        date: selectedDateStr,
                        text,
                        createdAt: now,
                      });
                    }
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    setNoteDraft('');
                    setNoteEditingId(null);
                    setNoteModalVisible(false);
                  }}
                  style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.textMain, alignItems: 'center', opacity: noteDraft.trim() ? 1 : 0.4 }}
                >
                  <Text style={{ color: theme.bg, fontSize: 13, fontWeight: '900', letterSpacing: 0.3 }}>
                    {noteEditingId ? 'Save changes' : 'Save'}
                  </Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ── INTENT DETAIL SHEET ──
            Opened by long-press on any intent row. Shows the FULL label
            (no truncation — the row itself caps at ~2 lines so users with
            longer items can read them in their entirety here) and three
            actions: Cancel (dismiss), Edit (opens edit modal), Delete
            (with confirm via the existing CustomConfirmModal). */}
        {intentDetailId && (() => {
          const item = intents.find(i => i.id === intentDetailId);
          if (!item) return null;
          const sourceLabel =
            item.sourceType === 'task' ? 'TASK'
            : item.sourceType === 'habit' ? 'HABIT'
            : item.sourceType === 'challenge' ? 'GOAL'
            : 'CUSTOM';
          return (
            <Modal visible transparent animationType="fade" onRequestClose={() => setIntentDetailId(null)}>
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
                <View style={{ backgroundColor: theme.surface, borderRadius: 18, padding: 22, borderWidth: 1, borderColor: theme.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 }}>{sourceLabel}</Text>
                    {item.completed && (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: hexToRgba(theme.textMain, 0.1) }}>
                        <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>DONE</Text>
                      </View>
                    )}
                    {item.pushCount > 0 && !item.completed && (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: hexToRgba('#F59E0B', 0.12) }}>
                        <Text style={{ color: '#F59E0B', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>↑{item.pushCount}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[{ color: theme.textMain, fontSize: 16, fontWeight: '700', lineHeight: 22, marginBottom: 18 }, rtlTextStyle(item.label)]}>
                    {item.label}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => setIntentDetailId(null)}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                    >
                      <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '900' }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setIntentEditId(item.id);
                        setIntentEditDraft(item.label);
                        setIntentDetailId(null);
                      }}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                    >
                      <Text style={{ color: theme.textMain, fontSize: 12, fontWeight: '900' }}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        const id = item.id;
                        setIntentDetailId(null);
                        // Defer the confirm-modal trigger so the detail sheet's
                        // dismiss animation doesn't race with the new modal.
                        setTimeout(() => deleteIntentWithConfirm(id), 50);
                      }}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: hexToRgba('#F43F5E', 0.4), alignItems: 'center' }}
                    >
                      <Text style={{ color: '#F43F5E', fontSize: 12, fontWeight: '900' }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          );
        })()}

        {/* ── INTENT EDIT MODAL ──
            Small label-only edit sheet launched from the detail sheet. Same
            char cap as the add flow. Source link is preserved (we only edit
            the label here — the auto-check linkage stays intact). */}
        {intentEditId && (
          <Modal visible transparent animationType="slide" onRequestClose={() => setIntentEditId(null)}>
            <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setIntentEditId(null)} />
              <Animated.View style={[{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 12) + 16, paddingHorizontal: 24 }, sheetBottomPadStyle]}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 18 }} />
                <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 }}>Edit intent.</Text>
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginBottom: 18 }}>
                  Keep it short and directive.
                </Text>
                {/* Input + overlay counter — same pattern as the note modal.
                    Counter floats over the input's bottom-right so the keyboard
                    can't hide it. Always shown for intent (the cap is tight).
                    maxHeight caps growth so the input becomes internally
                    scrollable instead of pushing buttons under the keyboard. */}
                <View style={{ position: 'relative', marginBottom: 14 }}>
                  <TextInput
                    value={intentEditDraft}
                    onChangeText={setIntentEditDraft}
                    placeholder="What's the intent?"
                    placeholderTextColor={theme.border}
                    multiline
                    autoFocus
                    maxLength={INTENT_LABEL_MAX}
                    style={[{
                      backgroundColor: isDarkMode ? '#111' : theme.bg,
                      color: theme.textMain, padding: 14, paddingRight: 50, borderRadius: 12,
                      minHeight: 92, maxHeight: 160, fontSize: 15, fontWeight: '500', lineHeight: 21,
                      textAlignVertical: 'top', borderWidth: 1, borderColor: theme.border,
                    }, persianSafeInputStyle, rtlInputStyle(intentEditDraft)]}
                  />
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute', bottom: 6, right: 6,
                      paddingHorizontal: 6, paddingVertical: 2,
                      borderRadius: 6,
                      backgroundColor: hexToRgba(theme.surface, 0.92),
                    }}
                  >
                    <Text style={{
                      color: INTENT_LABEL_MAX - intentEditDraft.length <= 20 ? '#F43F5E' : theme.textSub,
                      fontSize: 10, fontWeight: '800',
                    }}>
                      {INTENT_LABEL_MAX - intentEditDraft.length}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => { setIntentEditId(null); setIntentEditDraft(''); }}
                    style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                  >
                    <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '800' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={!intentEditDraft.trim()}
                    onPress={() => {
                      const text = intentEditDraft.trim();
                      if (!text || !intentEditId) return;
                      updateIntentLabel(intentEditId, text);
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      setIntentEditId(null);
                      setIntentEditDraft('');
                    }}
                    style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.textMain, alignItems: 'center', opacity: intentEditDraft.trim() ? 1 : 0.4 }}
                  >
                    <Text style={{ color: theme.bg, fontSize: 13, fontWeight: '900', letterSpacing: 0.3 }}>Save</Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            </KeyboardAvoidingView>
          </Modal>
        )}

        {/* ── INTENT RETHINK PROMPT ──
            Fires after the third consecutive push of an intent item. The user
            chose three days in a row to defer this; that's the moment to stop
            and ask whether the answer is still "tomorrow." */}
        {intentRethink && (() => {
          const item = intents.find(i => i.id === intentRethink);
          if (!item) return null;
          return (
            <Modal visible transparent animationType="fade" onRequestClose={() => setIntentRethink(null)}>
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
                <View style={{ backgroundColor: theme.surface, borderRadius: 18, padding: 22, borderWidth: 1, borderColor: theme.border }}>
                  <Text style={{ color: theme.textMain, fontSize: 18, fontWeight: '900', letterSpacing: -0.4, marginBottom: 10 }}>
                    Three days running.
                  </Text>
                  <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', lineHeight: 19, marginBottom: 18 }}>
                    "{item.label}" keeps slipping. Sometimes the answer isn't tomorrow — drop it, change it, or do it now.
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => {
                        deleteIntentFromStore(item.id);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setIntentRethink(null);
                      }}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: hexToRgba('#F43F5E', 0.4), alignItems: 'center' }}
                    >
                      <Text style={{ color: '#F43F5E', fontSize: 12, fontWeight: '900' }}>Drop</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        // Acknowledged the slip — reset the chronic-deferral
                        // counter so the prompt has a clean slate. The user
                        // chose to keep going; they don't need a re-prompt on
                        // every subsequent push, only when the chain hits 3 again.
                        if (item) resetIntentPushCount(item.id);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setIntentRethink(null);
                      }}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                    >
                      <Text style={{ color: theme.textMain, fontSize: 12, fontWeight: '900' }}>Keep</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          );
        })()}

        {/* ReminderModal — quick "remind me" capture sheet. Fires a one-shot
            notification at the chosen offset; pending list lives inside the
            modal so users can cancel before fire. */}
        <ReminderModal
          visible={reminderModalVisible}
          onClose={() => setReminderModalVisible(false)}
          theme={theme}
          isDarkMode={isDarkMode}
          insetsBottom={insets.bottom}
          sheetBottomPadStyle={sheetBottomPadStyle}
          reminders={reminders}
          onAdd={(text, minutes) => {
            const id = `${Date.now()}-rem`;
            const r: Reminder = {
              id,
              text,
              fireAt: Date.now() + minutes * 60_000,
              createdAt: Date.now(),
            };
            addReminderToStore(r);
            // Fire-and-forget — the schedule call returns a Promise but the UI
            // doesn't need to wait for the OS confirmation; if scheduling fails
            // the user will simply not get a notification at fireAt, and the
            // entry sweeps from the list afterward like any expired reminder.
            scheduleReminder(r).catch(e => console.warn('[reminder] schedule failed', e));
          }}
          onRemove={(id) => {
            removeReminderFromStore(id);
            cancelReminder(id).catch(() => {});
          }}
        />

        {/* SettingsModal — extracted to components/timeline/SettingsModal.tsx.
            Settings flags are read directly from the store inside the modal;
            backup actions are delegated up because they coordinate with picker
            modals that live here. */}
        <SettingsModal
          visible={settingsVisible}
          onClose={() => setSettingsVisible(false)}
          theme={theme}
          isDarkMode={isDarkMode}
          insetsBottom={insets.bottom}
          onExportEverything={async () => {
            const res = await exportBackup();
            if (!res.ok) {
              setConfirmModal({
                title: 'Export failed',
                message: res.reason,
                label: 'OK',
                onConfirm: () => setConfirmModal(null),
              });
            }
          }}
          onSelectiveExport={() => {
            setExportSelected(new Set(ALL_KEYS as readonly BackupKey[]));
            setExportPickerVisible(true);
          }}
          onImport={async () => {
            setImportBusy(true);
            const res = await pickAndReadBackup();
            setImportBusy(false);
            if (!res.ok) {
              if (!res.cancelled) {
                setConfirmModal({
                  title: 'Import failed',
                  message: res.reason,
                  label: 'OK',
                  onConfirm: () => setConfirmModal(null),
                });
              }
              return;
            }
            const present = ALL_KEYS.filter(k => (res.payload as any)[k] !== undefined);
            setImportSelected(new Set(present));
            setImportPayload(res.payload);
          }}
        />


        {/* ── EXPORT BACKUP PICKER ──
            For selective exports. Same UI shape as the import picker (checklist
            with Select all / Clear) but the action is "Export selected" — runs
            exportBackup with the chosen keys. Counts come straight from the
            current store state, so the user knows exactly what's about to land
            in the file. */}
        {exportPickerVisible && (
          <Modal visible transparent animationType="slide" onRequestClose={() => setExportPickerVisible(false)}>
            <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setExportPickerVisible(false)} />
              <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 12) + 12, maxHeight: '88%' }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 18 }} />
                <View style={{ paddingHorizontal: 24, marginBottom: 14 }}>
                  <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 }}>Selective export.</Text>
                  <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', lineHeight: 17 }}>
                    Pick what to include in the backup file. Counts reflect what's
                    in your data right now.
                  </Text>
                </View>
                <BackupSlicePicker
                  theme={theme}
                  isDarkMode={isDarkMode}
                  selected={exportSelected}
                  onToggle={(key) => {
                    setExportSelected(prev => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key); else next.add(key);
                      return next;
                    });
                  }}
                  onTabSetAll={(keys, turnOn) => {
                    setExportSelected(prev => {
                      const next = new Set(prev);
                      for (const k of keys) {
                        if (turnOn) next.add(k); else next.delete(k);
                      }
                      return next;
                    });
                  }}
                  // For export: pull live values from the store so counts reflect current data.
                  getValue={(key) => (useAppStore.getState() as any)[key]}
                  // Every key is exportable; the picker shows them all and the
                  // user trims down. (No "absent" filter for export.)
                  isAvailable={() => true}
                />
                <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 24, marginTop: 14 }}>
                  <TouchableOpacity
                    onPress={() => setExportPickerVisible(false)}
                    style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                  >
                    <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '800' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={exportSelected.size === 0}
                    onPress={async () => {
                      const keys = Array.from(exportSelected) as BackupKey[];
                      setExportPickerVisible(false);
                      const res = await exportBackup({ keys });
                      if (!res.ok) {
                        setConfirmModal({
                          title: 'Export failed',
                          message: res.reason,
                          label: 'OK',
                          onConfirm: () => setConfirmModal(null),
                        });
                      }
                    }}
                    style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.textMain, alignItems: 'center', opacity: exportSelected.size === 0 ? 0.4 : 1 }}
                  >
                    <Text style={{ color: theme.bg, fontSize: 13, fontWeight: '900', letterSpacing: 0.3 }}>
                      Export {exportSelected.size} section{exportSelected.size === 1 ? '' : 's'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        )}

        {/* ── IMPORT BACKUP MODAL ──
            Surfaces after the user picks a valid backup file. Lists every slice
            present in the file with a count + checkbox; the user toggles which
            ones to overwrite, then confirms. Defaults to all-selected.
            Restore is destructive on the selected slices — copy reflects this. */}
        {importPayload && (
          <Modal visible transparent animationType="slide" onRequestClose={() => setImportPayload(null)}>
            <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setImportPayload(null)} />
              <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 12) + 12, maxHeight: '88%' }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 18 }} />
                <View style={{ paddingHorizontal: 24, marginBottom: 14 }}>
                  <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 }}>Restore from backup.</Text>
                  <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', lineHeight: 17 }}>
                    Pick what to overwrite. Anything you uncheck stays as it is now.
                    Restoring is destructive — selected sections will be replaced.
                  </Text>
                </View>
                <BackupSlicePicker
                  theme={theme}
                  isDarkMode={isDarkMode}
                  selected={importSelected}
                  onToggle={(key) => {
                    setImportSelected(prev => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key); else next.add(key);
                      return next;
                    });
                  }}
                  onTabSetAll={(keys, turnOn) => {
                    setImportSelected(prev => {
                      const next = new Set(prev);
                      for (const k of keys) {
                        if (turnOn) next.add(k); else next.delete(k);
                      }
                      return next;
                    });
                  }}
                  // For import: read counts from the file payload, not the store.
                  getValue={(key) => (importPayload as any)[key]}
                  // Only keys actually present in the file are interactive.
                  // Tabs whose keys are entirely absent from the file dim out
                  // (the picker handles that via tabCounts).
                  isAvailable={(key) => (importPayload as any)[key] !== undefined}
                />
                <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 24, marginTop: 14 }}>
                  <TouchableOpacity
                    onPress={() => setImportPayload(null)}
                    style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                  >
                    <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '800' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={importSelected.size === 0}
                    onPress={() => {
                      const payload = importPayload;
                      const keys = Array.from(importSelected) as BackupKey[];
                      // Confirm step — restoring is destructive on the picked slices.
                      setConfirmModal({
                        title: `Restore ${keys.length} section${keys.length === 1 ? '' : 's'}?`,
                        message: `The selected data on your device will be replaced with the backup. Other sections stay untouched.`,
                        label: 'Restore',
                        onConfirm: () => {
                          if (payload) applyBackup(payload, keys);
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          setImportPayload(null);
                          setImportSelected(new Set());
                          setConfirmModal(null);
                        },
                      });
                    }}
                    style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.textMain, alignItems: 'center', opacity: importSelected.size === 0 ? 0.4 : 1 }}
                  >
                    <Text style={{ color: theme.bg, fontSize: 13, fontWeight: '900', letterSpacing: 0.3 }}>
                      Restore {importSelected.size} section{importSelected.size === 1 ? '' : 's'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        )}

        {/* ── COMMIT REFLECTION MODAL ──
            Three-step state machine driven by reflectStep. Step 1 always asks
            "How focused were you?"; if the answer is anything but "fully," we
            advance to "What got in the way?" and then to a tailored suggestion.
            "Fully focused" jumps straight to a brief acknowledgement.
            Acknowledgement (Done / Dismiss) marks the block via markReflected
            so the banner stops surfacing it. The user's answers are NOT saved
            anywhere — the prompt is in-the-moment guidance, nothing more. */}
        {reflectStep && reflectKey && (() => {
          // Look up the activity by parsing the key. Don't crash if it can't
          // be found (block was deleted mid-flow).
          const activityId = reflectKey.split('_').slice(1).join('_');
          const block = displayActs.find(a => a.id === activityId);
          const blockColor = block?.color ?? theme.textMain;
          const blockLabel = block?.label ?? 'Block';

          const acknowledge = () => {
            markReflected(reflectKey);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setReflectKey(null);
            setReflectStep(null);
            setReflectFocus(null);
            setReflectWhy(null);
          };

          // Suggestion text per "what got in the way?" choice.
          const SUGGESTIONS: Record<ReflectWhy, string> = {
            time:         'Consider moving this block to a time you usually have more energy. The block lives in Tasks → edit, or you can adjust the time directly here.',
            distractions: 'Try removing what pulled you away — phone in another room, do-not-disturb on, browser tabs you don\'t need closed. Small frictions add up.',
            duration:     'If it felt too long or too short, the block length might be wrong for the work. Adjust the duration to match what the work actually takes.',
            other:        'Sometimes the cause takes a few rounds to surface. Notice what\'s different next time — that\'s usually where the answer is.',
          };
          const FOCUS_OPTIONS: { key: ReflectFocus; label: string; subtitle: string }[] = [
            { key: 'fully',     label: 'Fully focused',     subtitle: 'Locked in start to finish.' },
            { key: 'partially', label: 'Partially focused', subtitle: 'Some drift, but mostly there.' },
            { key: 'drifted',   label: 'Drifted',           subtitle: 'Lost the thread early.' },
          ];
          const WHY_OPTIONS: { key: ReflectWhy; label: string }[] = [
            { key: 'time',         label: 'Wrong time of day' },
            { key: 'distractions', label: 'Too many distractions' },
            { key: 'duration',     label: 'Wrong duration' },
            { key: 'other',        label: 'Something else' },
          ];

          return (
            <Modal visible transparent animationType="fade" onRequestClose={acknowledge}>
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 24 }}>
                <View style={{ backgroundColor: theme.surface, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: theme.border }}>
                  {/* Header — block label as the subject of the reflection */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Feather name="flag" size={11} color={blockColor} />
                    <Text style={{ color: blockColor, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 }}>COMMIT</Text>
                  </View>
                  <Text style={[{ color: theme.textMain, fontSize: 17, fontWeight: '900', letterSpacing: -0.3, marginBottom: 18 }, rtlTextStyle(blockLabel)]} numberOfLines={2}>
                    {blockLabel}
                  </Text>

                  {/* Step 1: how focused */}
                  {reflectStep === 'focus' && (
                    <>
                      <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '700', marginBottom: 14 }}>
                        How focused were you?
                      </Text>
                      {FOCUS_OPTIONS.map((opt, idx) => (
                        <TouchableOpacity
                          key={opt.key}
                          activeOpacity={0.75}
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setReflectFocus(opt.key);
                            // Fully → straight to suggestion (acknowledgement). Otherwise → why.
                            if (opt.key === 'fully') setReflectStep('suggestion');
                            else setReflectStep('why');
                          }}
                          style={{
                            paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12,
                            borderWidth: 1, borderColor: theme.border,
                            backgroundColor: isDarkMode ? '#111' : theme.bg,
                            marginBottom: idx < FOCUS_OPTIONS.length - 1 ? 8 : 0,
                          }}
                        >
                          <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '900', letterSpacing: 0.2 }}>{opt.label}</Text>
                          <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '500', marginTop: 2 }}>{opt.subtitle}</Text>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity
                        onPress={acknowledge}
                        style={{ marginTop: 14, paddingVertical: 10, alignItems: 'center' }}
                      >
                        <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>Skip</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {/* Step 2: what got in the way (only when not Fully focused) */}
                  {reflectStep === 'why' && (
                    <>
                      <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '700', marginBottom: 14 }}>
                        What got in the way?
                      </Text>
                      {WHY_OPTIONS.map((opt, idx) => (
                        <TouchableOpacity
                          key={opt.key}
                          activeOpacity={0.75}
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setReflectWhy(opt.key);
                            setReflectStep('suggestion');
                          }}
                          style={{
                            paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10,
                            borderWidth: 1, borderColor: theme.border,
                            backgroundColor: isDarkMode ? '#111' : theme.bg,
                            marginBottom: idx < WHY_OPTIONS.length - 1 ? 6 : 0,
                          }}
                        >
                          <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '700' }}>{opt.label}</Text>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity
                        onPress={acknowledge}
                        style={{ marginTop: 14, paddingVertical: 10, alignItems: 'center' }}
                      >
                        <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>Skip</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {/* Step 3: suggestion + Done */}
                  {reflectStep === 'suggestion' && (
                    <>
                      {reflectFocus === 'fully' ? (
                        <View style={{ marginBottom: 18, padding: 14, borderRadius: 12, backgroundColor: hexToRgba('#10B981', isDarkMode ? 0.14 : 0.08), borderLeftWidth: 3, borderLeftColor: '#10B981' }}>
                          <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '700', lineHeight: 20 }}>
                            Good. Carry that into the next one.
                          </Text>
                        </View>
                      ) : (
                        <View style={{ marginBottom: 18, padding: 14, borderRadius: 12, backgroundColor: hexToRgba('#F59E0B', isDarkMode ? 0.14 : 0.08), borderLeftWidth: 3, borderLeftColor: '#F59E0B' }}>
                          <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '600', lineHeight: 19 }}>
                            {reflectWhy ? SUGGESTIONS[reflectWhy] : SUGGESTIONS.other}
                          </Text>
                        </View>
                      )}
                      <TouchableOpacity
                        onPress={acknowledge}
                        style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: theme.textMain, alignItems: 'center' }}
                      >
                        <Text style={{ color: theme.bg, fontSize: 13, fontWeight: '900', letterSpacing: 0.3 }}>Done</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            </Modal>
          );
        })()}

        {/* In-app confirm modal — single mount, all confirms route through this. Replaces native
            Alert.alert across the tab so the language matches Notes / Habits / Challenges. */}
        {confirmModal && (
          <CustomConfirmModal
            visible
            theme={theme}
            title={confirmModal.title}
            message={confirmModal.message}
            destructiveLabel={confirmModal.label}
            isSuccess={confirmModal.isSuccess}
            onCancel={() => setConfirmModal(null)}
            onConfirm={confirmModal.onConfirm}
          />
        )}

      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

// Timeline uses inline styles throughout — no `styles` object exported.