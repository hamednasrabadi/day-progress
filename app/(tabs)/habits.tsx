import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Platform, UIManager, Pressable, Keyboard, Dimensions, Modal, Animated as RNAnimated, BackHandler, TextInput, AppState } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { IntentPanel } from '../../components/IntentPanel';
import { DayRatingCheckIn } from '../../components/DayRatingCheckIn';
import { getTheme } from '../../lib/timelineTheme';
import { getWeeklyReviewWindow } from '../../lib/weeklyReview';
import { rtlInputStyle } from '../../lib/rtl';
import { SettingsSheet } from '../../components/SettingsSheet';
import notifee, { TriggerType, RepeatFrequency, AlarmType } from '@notifee/react-native';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { GestureHandlerRootView, Swipeable, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, { FadeInDown, FadeIn, FadeOut, Easing, useAnimatedStyle, withSpring, useSharedValue, withTiming, runOnJS, cancelAnimation, withSequence, withDelay, interpolate, Extrapolation } from 'react-native-reanimated';

import { useFocusEffect } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { BottomSheetModal, BottomSheetModalProvider, BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { PALETTE, DEFAULT_COLOR } from '../../lib/palette';
import { ColorPicker } from '../../components/ColorPicker';
import { useAppStore, Habit, HabitStatus, TimeBlock, Note } from '../../store/useAppStore';
import { calculateStrengthScore, isHabitScheduledOn } from '../../lib/habitScore';
import { FEATURE_IDS, useIsUnlocked, useIsNew } from '../../lib/unlocks';
import { Eclipse_Horizon } from '../../components/DayConqueredVariations';

const SCREEN_HEIGHT = Dimensions.get('window').height;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try { UIManager.setLayoutAnimationEnabledExperimental(true); } catch(e){}
}

// Color palettes now live in lib/palette.ts (single source of truth).
// Ordered by expected usage frequency — most-used habits first
const ICONS: (keyof typeof Feather.glyphMap)[] = [
  // tier 1 — the usual suspects (water, exercise, read, sleep, morning)
  'droplet',      // water
  'activity',     // exercise / run
  'book-open',    // read
  'sun',          // morning / wake
  'moon',         // sleep / night
  'heart',        // health
  'coffee',       // morning routine
  'zap',          // energy / workout

  // tier 2 — common but less universal
  'edit-3',       // journal / write
  'wind',         // meditate / breath
  'code',         // study / work
  'clock',        // timer / focus
  'target',       // goal / aim
  'check-circle', // generic "done"
  'star',         // priority
  'feather',      // gentle writing

  // tier 3 — specialized
  'music',        // practice instrument
  'headphones',   // listen / podcast
  'cpu',          // deep work / tech
  'terminal',     // code / build
  'briefcase',    // work
  'calendar',     // plan / schedule
  'eye',          // review / observe
  'camera',       // photo / art

  // tier 4 — thematic, rare
  'crosshair',    // focus / aim
  'anchor',       // grounding
  'sunrise',      // early
  'sunset',       // evening routine
  'compass',      // direction
  'map-pin',      // place-based
  'tool',         // maintenance
  'user',         // self-care
  'award',        // achievement
  'flag',         // milestone
  'shield',       // discipline
];

const TIME_BLOCKS = [
  { id: 'morning', label: 'Morning', icon: 'sunrise', time: 'Wake - 12 PM' },
  { id: 'afternoon', label: 'Afternoon', icon: 'sun', time: '12 PM - 5 PM' },
  { id: 'evening', label: 'Evening', icon: 'moon', time: '5 PM - Sleep' },
  { id: 'anytime', label: 'Anytime', icon: 'clock', time: 'Floating Habit' },
] as const;

const JS_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UI_DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const G_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const S_MONTHS = ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'];

// --- CALENDAR & MATH HELPERS ---
// Android-only: disable font padding so deep descenders (ر / ز / ژ) don't bump the TextInput's measured height.
// Ignored on iOS. Apply to every TextInput that can receive Persian/Arabic input.
const persianSafeInputStyle = { includeFontPadding: false as const };

// ── "Go for more" easter egg (EXPERIMENTAL) ──────────────────────────────────
// A secret early-finish moment. SHIPS OFF — flip GO_FOR_MORE_ENABLED to true
// only to test in dev; beta/production stay dark. Built to be HARD (conquer the
// whole day before 4pm) and MYSTERIOUS (low chance even then, once/day, and it
// retires forever after being ignored 3 times). Reward payload is a deferred
// placeholder (the diary tie-in comes later).
const GO_FOR_MORE_ENABLED = false;
const GO_FOR_MORE_CHANCE = 0.34;      // ~1 in 3, even once you qualify
const GO_FOR_MORE_BEFORE_HOUR = 16;   // must conquer the day before 4pm

const getFormatDateStr = (date: Date = new Date()) => {
  const d = new Date(date); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().split('T')[0];
};

const diffInDays = (startStr: string, endStr: string) => {
  const [sy, sm, sd] = startStr.split('-').map(Number); const [ey, em, ed] = endStr.split('-').map(Number);
  const d1 = Date.UTC(sy, sm - 1, sd); const d2 = Date.UTC(ey, em - 1, ed); return Math.floor((d2 - d1) / (86400000));
};

const getNextTriggerTimestamp = (h: number, m: number) => {
  const now = new Date(); const target = new Date(); target.setHours(h, m, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime();
};

function getShamsiDateParts(date: Date) {
  const j_days_in_month = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
  let gy = date.getFullYear() - 1600; let gm = date.getMonth(); let gd = date.getDate() - 1;
  let g_day_no = 365 * gy + Math.floor((gy + 3) / 4) - Math.floor((gy + 99) / 100) + Math.floor((gy + 399) / 400);
  for (let i = 0; i < gm; ++i) g_day_no += [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i];
  if (gm > 1 && ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0))) g_day_no++;
  g_day_no += gd; let j_day_no = g_day_no - 79; let j_np = Math.floor(j_day_no / 12053); j_day_no %= 12053;
  let jy = 979 + 33 * j_np + 4 * Math.floor(j_day_no / 1461); j_day_no %= 1461;
  if (j_day_no >= 366) { jy += Math.floor((j_day_no - 1) / 365); j_day_no = (j_day_no - 1) % 365; }
  let i = 0; for (i; i < 11 && j_day_no >= j_days_in_month[i]; ++i) j_day_no -= j_days_in_month[i];
  return { year: jy, month: i + 1, day: j_day_no + 1 };
}

const parseTimeString = (text: string) => {
  if (!text) return '';
  let cleaned = text.replace(/[^0-9:]/g, '');
  if (!cleaned.includes(':')) {
    if (cleaned.length <= 2) cleaned = `${cleaned.padStart(2, '0')}:00`;
    else if (cleaned.length === 3) cleaned = `0${cleaned.slice(0,1)}:${cleaned.slice(1)}`;
    else cleaned = `${cleaned.slice(0,2)}:${cleaned.slice(2,4)}`;
  } else {
    let parts = cleaned.split(':');
    cleaned = `${parts[0].padStart(2, '0')}:${(parts[1] || '00').padEnd(2, '0').slice(0, 2)}`;
  }
  let [hStr, mStr] = cleaned.split(':');
  let h = Math.min(23, parseInt(hStr, 10) || 0); let m = Math.min(59, parseInt(mStr, 10) || 0);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

// Current streak = consecutive SCHEDULED days the habit was satisfied, walking
// back from today. The key rule: days the habit isn't due on (e.g. a gym habit's
// off-days on a Mon/Wed/Fri schedule) are skipped — they neither extend nor
// break the streak. Only a scheduled day that was missed (not completed, rested,
// or skipped) ends it. Without the schedule check the streak broke on the first
// off-day, capping things like a 3×/week gym habit at ~1.
const calculateStreak = (habit: Habit) => {
  const history = habit.history;
  const restDays = habit.restDays || [];
  const skippedDays = habit.skippedDays || [];
  const targetCount = habit.targetCount;
  if (!history || history.length === 0) return 0;
  const dateCounts: Record<string, number> = {};
  history.forEach(d => { dateCounts[d] = (dateCounts[d] || 0) + 1; });
  const completedDates = Object.keys(dateCounts).filter(d => dateCounts[d] >= targetCount);

  // Floor the walk at the habit's creation date so interval habits (whose
  // pre-startDate days read as "not scheduled") can't loop backward forever.
  const created = new Date(habit.createdAt);
  const createdStr = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`;

  const today = getFormatDateStr(); let checkDate = new Date(); checkDate.setMinutes(checkDate.getMinutes() - checkDate.getTimezoneOffset());
  let streak = 0;
  if (!completedDates.includes(today) && !restDays.includes(today)) checkDate.setDate(checkDate.getDate() - 1);

  while (true) {
    const checkDateStr = checkDate.toISOString().split('T')[0];
    if (checkDateStr < createdStr) break;
    if (skippedDays.includes(checkDateStr)) break;
    if (completedDates.includes(checkDateStr)) { streak++; checkDate.setDate(checkDate.getDate() - 1); }
    else if (restDays.includes(checkDateStr)) { checkDate.setDate(checkDate.getDate() - 1); }
    else if (!isHabitScheduledOn(habit, checkDateStr)) { checkDate.setDate(checkDate.getDate() - 1); } // off-day: not due, so it can't break the streak
    else break; // a scheduled day with no completion/rest/skip → streak ends
  }
  return streak;
};

// Strength Score — implementation lives in `lib/habitScore.ts` so the
// Challenges-tab unlock can read it without dragging this whole file in.

function hexToRgba(hex: string, a: number) {
  const h = hex.replace('#',''); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

// --- UI COMPONENTS ---
const CustomConfirmModal = ({ visible, title, message, destructiveLabel = "Delete", onCancel, onConfirm, theme }: any) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <View style={{ backgroundColor: theme.surface, width: '100%', maxWidth: 340, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.border }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: hexToRgba(theme.danger, 0.15), justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
          <Feather name="alert-triangle" size={24} color={theme.danger} />
        </View>
        <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: '900', marginBottom: 8 }}>{title}</Text>
        <Text style={{ color: theme.textSub, fontSize: 14, lineHeight: 22, marginBottom: 24 }}>{message}</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity onPress={onCancel} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}>
            <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 14 }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onConfirm} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: theme.danger }}>
            <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 14 }}>{destructiveLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

// ─── SWIPE ACTION RENDERERS (stable — defined outside component, never recreated) ───
// These receive theme/color via closure-safe props through the Swipeable API.
// eslint-disable-next-line react/display-name -- Swipeable render callback, not a component
const makeLeftActions = (theme: any) => (p: any, d: RNAnimated.AnimatedInterpolation<any>) => {
  const s = d.interpolate({ inputRange: [0, 100], outputRange: [0.5, 1], extrapolate: 'clamp' });
  return (
    <View style={{ justifyContent: 'center', width: '100%', borderRadius: 16, backgroundColor: theme.textMain, paddingLeft: 24, alignItems: 'flex-start', marginBottom: 12 }}>
      <RNAnimated.View style={{ transform: [{ scale: s }] }}><Feather name="archive" size={20} color={theme.bg} /></RNAnimated.View>
    </View>
  );
};

// eslint-disable-next-line react/display-name -- Swipeable render callback, not a component
// Longest consecutive-day run in a habit's completion history — the "best streak"
// stat shown on storage trophy medallions.
function longestRun(dates: string[] = []): number {
  if (!dates.length) return 0;
  const set = [...new Set(dates)].sort();
  let best = 1, run = 1;
  for (let i = 1; i < set.length; i++) {
    const diff = Math.round((new Date(set[i]).getTime() - new Date(set[i - 1]).getTime()) / 86400000);
    run = diff === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

const makeRightActions = (theme: any, habitId: string, selectedDateStr: string, onAction: any, isFuture: boolean) => () => (
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 10, gap: 10, width: 140, marginBottom: 12, opacity: isFuture ? 0.3 : 1 }}>
    <Pressable onPress={() => { if (isFuture) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onAction(habitId, 'rest', selectedDateStr); }} style={{ backgroundColor: theme.freeze, padding: 12, borderRadius: 12 }}><Feather name="coffee" size={18} color="#FFF" /></Pressable>
    <Pressable onPress={() => { if (isFuture) return; Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); onAction(habitId, 'skipped', selectedDateStr); }} style={{ backgroundColor: theme.danger, padding: 12, borderRadius: 12 }}><Feather name="x" size={18} color="#FFF" /></Pressable>
  </View>
);

// ─── MEMOIZED HABIT CARD ───
const HabitCard = React.memo(function HabitCard({ habit, selectedDateStr, todayCount, currentStatus, currentStreak, strengthScore, theme, onToggle, onAction, onOpen, onArchive, onNotePress, notesUnlocked }: any) {
  const progress = useSharedValue(0);
  const scale = useSharedValue(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sweepTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSweeping = useRef(false);
  const hasJustSwept = useRef(false);

  // Stable refs so inner callbacks don't need these in deps
  const statusRef = useRef(currentStatus);
  const habitIdRef = useRef(habit.id);
  const selectedDateRef = useRef(selectedDateStr);
  useEffect(() => { statusRef.current = currentStatus; }, [currentStatus]);
  useEffect(() => { selectedDateRef.current = selectedDateStr; }, [selectedDateStr]);
  useEffect(() => { habitIdRef.current = habit.id; }, [habit.id]);

  const triggerComplete = useCallback(() => {
    hasJustSwept.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (intervalRef.current) clearInterval(intervalRef.current);
    scale.value = withSpring(1.03, {}, () => { scale.value = withSpring(1); });
    onAction(habitIdRef.current, 'done', selectedDateRef.current);
    progress.value = 0;
    // Flag stays true until next handlePressIn resets it — blocks tap-through
  }, [onAction, progress, scale]);

  const triggerUndo = useCallback(() => {
    hasJustSwept.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    scale.value = withSequence(withSpring(0.95), withSpring(1));
    onAction(habitIdRef.current, 'pending', selectedDateRef.current);
    // Flag stays true until next handlePressIn resets it
  }, [onAction, scale]);

  const handlePressIn = useCallback(() => {
    if (isFutureDateRef.current) return;
    // Reset the "held long enough to block tap" flag each press
    hasJustSwept.current = false;
    if (statusRef.current === 'pending') {
      sweepTimeout.current = setTimeout(() => {
        isSweeping.current = true;
        hasJustSwept.current = true; // Any sweep action blocks tap-through
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        scale.value = withSpring(0.98);
        progress.value = withTiming(1, { duration: 600, easing: Easing.linear }, (isFinished) => {
          if (isFinished) runOnJS(triggerComplete)();
        });
        let ticks = 0;
        intervalRef.current = setInterval(() => { ticks++; if (ticks < 3) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft); }, 200);
      }, 200);
    } else {
      sweepTimeout.current = setTimeout(() => {
        isSweeping.current = true;
        hasJustSwept.current = true;
        runOnJS(triggerUndo)();
      }, 500);
    }
  }, [progress, scale, triggerComplete, triggerUndo]);

  const handlePressOut = useCallback(() => {
    if (sweepTimeout.current) clearTimeout(sweepTimeout.current);
    scale.value = withSpring(1);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (progress.value < 1 && statusRef.current === 'pending') {
      cancelAnimation(progress);
      progress.value = withTiming(0, { duration: 200 });
    }
    // Always release the sweep lock shortly after a gesture ends, for ANY
    // status. Previously this only happened in the 'pending' branch, so a
    // hold-to-undo on a completed/rest/skipped card left isSweeping stuck true
    // and the NEXT tap couldn't open the detail view ("can't open a completed
    // habit by tap"). The 50ms delay lets onPress still see the lock for the
    // gesture that just ended (so an undo-hold doesn't also open the detail).
    setTimeout(() => { isSweeping.current = false; }, 50);
  }, [progress, scale]);

  const handlePress = useCallback(() => {
    if (hasJustSwept.current || isSweeping.current) return;
    onOpen(habit);
  }, [habit, onOpen]);

  const isFutureDateRef = useRef(false);
  useEffect(() => { isFutureDateRef.current = selectedDateStr > getFormatDateStr(); }, [selectedDateStr]);

  const handleToggle = useCallback(() => {
    if (isFutureDateRef.current) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    // Tap the checkbox to toggle done↔pending. This MUST go through the 3-arg
    // action handler: `onToggle` is wired to handleHabitAction(id, action, date),
    // so the old onToggle(id, date) put the DATE into `action` — the tap did
    // nothing AND linked challenges never advanced (the advance only fires on
    // action === 'done'). Routing through onAction with the real action makes a
    // checkbox completion advance its linked challenges, same as hold-to-sweep.
    onAction(habitIdRef.current, statusRef.current === 'done' ? 'pending' : 'done', selectedDateRef.current);
  }, [onAction]);

  const handleArchive = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onArchive(habit.id, 'archived');
  }, [habit.id, onArchive]);

  const sweepStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%`, backgroundColor: habit.color }));
  const cardStyle = useAnimatedStyle(() => ({ 
    transform: [{ scale: scale.value }], 
    borderColor: currentStatus === 'done' ? habit.color : currentStatus === 'skipped' ? theme.danger : currentStatus === 'rest' ? theme.freeze : theme.border 
  }));

  // Memoize the swipe renderers so Swipeable doesn't recreate them each render
  const renderLeft = useMemo(() => makeLeftActions(theme), [theme]);
  const isFuture = selectedDateStr > getFormatDateStr();
  const renderRight = useMemo(() => makeRightActions(theme, habit.id, selectedDateStr, onAction, isFuture), [theme, habit.id, selectedDateStr, onAction, isFuture]);

  return (
    // No layout-spring here: this is a recycled FlashList row, and Reanimated
    // layout animations re-fire on every recycle/reposition as you scroll —
    // that's the "rows springing up and down" jank. FlashList owns positioning.
    <Animated.View>
      <Swipeable
        renderLeftActions={renderLeft}
        renderRightActions={renderRight}
        onSwipeableOpen={(direction) => { if (direction === 'left') handleArchive(); }}
        containerStyle={{ overflow: 'visible' }} childrenContainerStyle={{ overflow: 'visible' }}
      >
        <Animated.View style={[{ backgroundColor: theme.surface, borderWidth: 1, borderRadius: 16, marginBottom: 12, padding: 0, overflow: 'hidden', borderLeftWidth: 4, borderLeftColor: currentStatus === 'rest' ? theme.freeze : currentStatus === 'skipped' ? theme.danger : habit.color }, cardStyle, currentStatus !== 'pending' && { opacity: 0.5 }]}>
          {currentStatus === 'pending' && <Animated.View style={[{ position: 'absolute', bottom: 0, left: 0, height: 4 }, sweepStyle]} />}
          
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, flex: 1 }}>
            <TouchableOpacity 
              hitSlop={15}
              onPress={handleToggle}
              style={{ marginRight: 16 }}
            >
              <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, justifyContent: 'center', alignItems: 'center', borderColor: currentStatus === 'done' ? habit.color : currentStatus === 'skipped' ? theme.danger : currentStatus === 'rest' ? theme.freeze : theme.border, backgroundColor: currentStatus === 'done' ? habit.color : 'transparent' }}>
                {currentStatus === 'rest' ? <Feather name="coffee" size={12} color={theme.freeze} /> :
                 currentStatus === 'skipped' ? <Feather name="x" size={12} color={theme.danger} /> :
                 <Feather name={currentStatus === 'done' ? "check" : habit.icon} size={12} color={currentStatus === 'done' ? theme.bg : theme.textSub} />}
              </View>
            </TouchableOpacity>

            <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={handlePress} style={{ flex: 1 }}>
              <Text style={[{ fontSize: 16, fontWeight: '800' }, currentStatus !== 'pending' ? { textDecorationLine: 'line-through', color: theme.textSub } : { color: theme.textMain }]}>{habit.title}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {currentStatus === 'rest' && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: theme.freeze + '20' }}><Text style={{ fontSize: 10, fontWeight: '800', color: theme.freeze }}>REST DAY</Text></View>}
                {currentStatus === 'pending' && habit.targetCount > 1 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#222' }}><Text style={{ fontSize: 10, fontWeight: '800', color: theme.textSub }}>{todayCount} / {habit.targetCount} {habit.unit}</Text></View>}
                {strengthScore > 0 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: hexToRgba(strengthScore >= 80 ? habit.color : strengthScore >= 50 ? theme.textSub : theme.danger, 0.15) }}><Text style={{ fontSize: 10, fontWeight: '900', color: strengthScore >= 80 ? habit.color : strengthScore >= 50 ? theme.textSub : theme.danger }}>{strengthScore}%</Text></View>}
                {habit.hasReminder && currentStatus === 'pending' && <Feather name="bell" size={10} color={theme.textSub} style={{ opacity: 0.4 }} />}
                {currentStatus === 'done' && notesUnlocked && onNotePress && (
                  <Pressable onPress={() => onNotePress(habit.id, selectedDateStr)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: habit.completionNotes?.[selectedDateStr] ? hexToRgba(habit.color, 0.15) : hexToRgba(theme.textSub, 0.15) }}>
                    <Feather name={habit.completionNotes?.[selectedDateStr] ? 'file-text' : 'plus'} size={10} color={habit.completionNotes?.[selectedDateStr] ? habit.color : theme.textMain} />
                    <Text style={{ fontSize: 10, fontWeight: '800', color: habit.completionNotes?.[selectedDateStr] ? habit.color : theme.textMain }}>Note</Text>
                  </Pressable>
                )}
              </View>
              {/* 30-day dot strip */}
              <View style={{ flexDirection: 'row', gap: 2, marginTop: 10, flexWrap: 'nowrap' }}>
                {Array.from({ length: 30 }).map((_, i) => {
                  const d = new Date(); d.setDate(d.getDate() - (29 - i));
                  const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                  const count = habit.history.filter((h: string) => h === dStr).length;
                  const isDone = count >= habit.targetCount;
                  const isRest = habit.restDays?.includes(dStr);
                  const isSkip = habit.skippedDays?.includes(dStr);
                  const isFut = dStr > getFormatDateStr();
                  const color = isFut ? theme.border + '30' : isDone ? habit.color : isRest ? theme.freeze + '60' : isSkip ? theme.danger + '60' : theme.border + '40';
                  return <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: color }} />;
                })}
              </View>
            </Pressable>
          </View>
        </Animated.View>
      </Swipeable>
    </Animated.View>
  );
}, (prev, next) => {
  // Precise equality check — only re-render when data actually changes
  return (
    prev.habit.id === next.habit.id &&
    prev.habit.color === next.habit.color &&
    prev.habit.icon === next.habit.icon &&
    prev.habit.title === next.habit.title &&
    prev.habit.targetCount === next.habit.targetCount &&
    prev.habit.unit === next.habit.unit &&
    prev.habit.hasReminder === next.habit.hasReminder &&
    prev.habit.reminderTime === next.habit.reminderTime &&
    prev.habit.completionNotes?.[prev.selectedDateStr] === next.habit.completionNotes?.[next.selectedDateStr] &&
    prev.currentStatus === next.currentStatus &&
    prev.todayCount === next.todayCount &&
    prev.currentStreak === next.currentStreak &&
    prev.strengthScore === next.strengthScore &&
    prev.selectedDateStr === next.selectedDateStr &&
    prev.notesUnlocked === next.notesUnlocked &&
    prev.theme === next.theme
  );
});

// ─── MAIN ENGINE ───
export default function HabitsScreen() {
  const insets = useSafeAreaInsets();
  
  const {
    habits, isDarkMode, themeMode, calendarType, toggleCalendar,
    addOrUpdateHabit, deleteHabit, retireHabit, unretireHabit, updateHabitStatus, toggleHabitAction,
    setHabitCompletionNote, markWhisperSeen,
    lastDayConqueredCelebrated, setLastDayConqueredCelebrated,
    goForMoreRetired, goForMoreLastShown, recordGoForMoreShown, recordGoForMoreIgnored,
    weeklyReflections, addWeeklyReflection, addOrUpdateNote, incrementTotalNotesCreated,
  } = useAppStore();

  // ── Progressive unlock gates ──
  // pact (3 habits) → entry point; completion notes (5 single-habit
  // completions) → per-completion note field; strength score (first day
  // conquered) → the % chips + summary display. The storage/archive is NOT
  // gated — it ships available from day one.
  const pactUnlocked = useIsUnlocked(FEATURE_IDS.PACT);
  const completionNotesUnlocked = useIsUnlocked(FEATURE_IDS.COMPLETION_NOTES);
  const strengthScoreUnlocked = useIsUnlocked(FEATURE_IDS.STRENGTH_SCORE);
  const weeklyReviewUnlocked = useIsUnlocked(FEATURE_IDS.WEEKLY_REVIEW);
  const markDotSeen = useAppStore(s => s.markDotSeen);
  // End-of-week anchor + per-day ratings feed the Weekly Review prompt (the
  // in-content "close the week" card, shown only during its 30h window).
  const dayLog = useAppStore(s => s.dayLog);
  const endOfWeekDay = useAppStore(s => s.endOfWeekDay);

  // Active Day Conquered variation — null when nothing is showing
  const [activeEclipse, setActiveEclipse] = useState(false);

  // Strength history modal
  const [showStrengthHistory, setShowStrengthHistory] = useState(false);
  // Sort order for the per-habit breakdown. Default ascending = weakest first,
  // so underperforming habits surface on their own (no nagging review needed).
  const [strengthSortAsc, setStrengthSortAsc] = useState(true);
  // "Go for more" easter egg surface (experimental, flagged off). engagedRef
  // tracks whether the user stepped toward it before it auto-faded, so a let-it-
  // pass correctly counts as an "ignore" toward the 3-strikes retirement.
  const [goForMoreActive, setGoForMoreActive] = useState(false);
  const goForMoreEngagedRef = useRef(false);

  // Pact history modal
  const [showPactHistory, setShowPactHistory] = useState(false);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  // Habit pending retirement — drives the Keep-or-Vanish prompt.
  const [retireTarget, setRetireTarget] = useState<Habit | null>(null);
  const [noteModal, setNoteModal] = useState<{ habitId: string; dateStr: string; text: string } | null>(null);
  const [noteDeleteTarget, setNoteDeleteTarget] = useState<{ habitId: string; dateStr: string } | null>(null);
  const { pact, setPact } = useAppStore();
  const [showPactSetup, setShowPactSetup] = useState(false);

  // Clean up old pact schema + self-heal orphaned habit refs. A habit deleted
  // before the deleteHabit-prune landed leaves a dead id in pact.habits that
  // renders as "???": drop any pact habit whose id no longer exists, level the
  // Pact down to the surviving count, and dissolve it if none survive.
  useEffect(() => {
    if (!pact) return;
    if (!pact.habits) { setPact(undefined); return; }
    const live = pact.habits.filter(ph => habits.some(h => h.id === ph.id));
    if (live.length !== pact.habits.length) {
      setPact(live.length === 0 ? undefined : { ...pact, habits: live, level: Math.max(1, live.length) });
    }
  }, []);
  const [showPactDecision, setShowPactDecision] = useState(false);
  const [pactOutcomeOverride, setPactOutcomeOverride] = useState<'won' | 'lost' | null>(null);
  const [detailHabit, setDetailHabit] = useState<Habit | null>(null);
  // Global settings sheet (rehomed from the Timeline — the surface that
  // survives the cut; holds end-of-week, weekly reflection, and backup).
  const [showSettings, setShowSettings] = useState(false);
  // Weekly Review prompt (in-content "close the week") + its writing sheet.
  const [weeklyReviewOpen, setWeeklyReviewOpen] = useState(false);
  const [weeklyReviewDraft, setWeeklyReviewDraft] = useState('');
  // Which retired card has revealed its hidden "bring back" button (via a long
  // ~2s hold — deliberately not discoverable by accident).
  const [bringBackId, setBringBackId] = useState<string | null>(null);
  const [returnToDetail, setReturnToDetail] = useState<string | null>(null);
  const [pactPickHabitId, setPactPickHabitId] = useState<string | null>(null);

  // ── Whisper system (must be declared early — used by effects below) ──
  const [whisperText, setWhisperText] = useState<string | null>(null);

  const lastWhisperRef = useRef(0);
  const showWhisper = useCallback((text: string) => {
    if (Date.now() - lastWhisperRef.current < 10000) return;
    lastWhisperRef.current = Date.now();
    setWhisperText(text);
    setTimeout(() => setWhisperText(null), 4000);
  }, []);
  const [storageTab, setStorageTab] = useState<'trophies' | 'active' | 'paused'>('trophies');

  const [habitModalVisible, setHabitModalVisible] = useState(false);
  const storageSheetRef = useRef<BottomSheetModal>(null);
  // Close the storage when leaving this tab — a sheet shouldn't linger open across
  // a tab switch. useFocusEffect's cleanup runs on blur.
  useFocusEffect(useCallback(() => () => storageSheetRef.current?.dismiss(), []));
  const snapPoints = useMemo(() => ['100%'], []);
  const [storageIndex, setStorageIndex] = useState(-1);

  // Safe Android Back Handler
  useEffect(() => {
    const backAction = () => {
      if (showSettings) { setShowSettings(false); return true; }
      if (habitModalVisible) { setHabitModalVisible(false); return true; }
      if (storageIndex >= 0) { storageSheetRef.current?.dismiss(); return true; }
      if (detailHabit) { setDetailHabit(null); return true; }
      return false;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [habitModalVisible, storageIndex, detailHabit, showSettings]);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.6} />,
    []
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newTargetCount, setNewTargetCount] = useState('1');
  const [newUnit, setNewUnit] = useState('');
  const [newTimeBlock, setNewTimeBlock] = useState<TimeBlock>('morning');
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [newIcon, setNewIcon] = useState<keyof typeof Feather.glyphMap>('activity');
  const [newScheduleType, setNewScheduleType] = useState<'days' | 'interval'>('days');
  const [newFrequency, setNewFrequency] = useState<string[]>(UI_DAYS);
  const [newIntervalDays, setNewIntervalDays] = useState('2');
  const [newStartDate, setNewStartDate] = useState(getFormatDateStr());
  const [newHasReminder, setNewHasReminder] = useState(false);
  const [newReminderTime, setNewReminderTime] = useState('');

  // Screen theme = the shared 3-mode palette (light / graphite dark / navy blue).
  const theme = useMemo(() => getTheme(themeMode), [themeMode]);

  // Same palette, passed to the rehomed-from-Timeline components (IntentPanel /
  // DayRatingCheckIn / SettingsSheet) — kept as its own name for clarity.
  const tlTheme = useMemo(() => getTheme(themeMode), [themeMode]);

  // ── Weekly Review window ──────────────────────────────────────────────────
  // The "close the week" prompt lives in the tab content (not Settings) and is
  // only due during its 30h window (6pm on the end-of-week day → end of the next
  // day). Recomputed each render so it flips as the window opens/closes; the
  // submitted review saves into the Notes tab. weeklyReflections[anchor] records
  // the close, so the prompt hides once done.
  const reviewWindow = getWeeklyReviewWindow(endOfWeekDay);
  // Locked by default — the end-of-week prompt only appears once WEEKLY_REVIEW
  // is unlocked (3 "how did it go?" day ratings logged in this tab).
  const weeklyReviewDue = weeklyReviewUnlocked && reviewWindow.open && !weeklyReflections[reviewWindow.anchor];
  const reviewBreakdown = useMemo(() => {
    let strong = 0, ok = 0, rough = 0;
    const [yy, mm, dd] = reviewWindow.anchor.split('-').map(Number);
    const end = new Date(yy, (mm || 1) - 1, dd || 1);
    for (let i = 0; i < 7; i++) {
      const day = new Date(end); day.setDate(end.getDate() - i);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      const r = dayLog[key];
      if (r === 'strong') strong++;
      else if (r === 'ok') ok++;
      else if (r === 'rough') rough++;
    }
    return { strong, ok, rough };
  }, [reviewWindow.anchor, dayLog]);

  // Debounce ref to avoid notification reschedule on every keystroke
  const notifDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleAllNotifications = useCallback(async (habitsToSchedule: Habit[], currentPact: typeof pact) => {
    try {
      const today = getFormatDateStr();
      const triggerIds = await notifee.getTriggerNotificationIds();
      // Cancels per-habit reminders, streak warnings, and pact deadline pings
      // — all use the `habit_` prefix so a single filter covers everything.
      const habitIds = triggerIds.filter(id => id.startsWith('habit_'));
      if (habitIds.length > 0) await notifee.cancelTriggerNotifications(habitIds);

      // Track which habits are still pending today — drives the streak warning below.
      const atRisk: { habit: Habit; streak: number }[] = [];

      for (const h of habitsToSchedule) {
        if (h.status !== 'active') continue;
        const isScheduledToday = h.scheduleType === 'interval'
          ? (diffInDays(h.startDate || today, today) >= 0 && diffInDays(h.startDate || today, today) % (h.intervalDays || 1) === 0)
          : (h.frequency.length === 0 || h.frequency.includes(JS_DAYS[new Date().getDay()]));
        if (!isScheduledToday) continue;
        if (h.restDays?.includes(today) || h.skippedDays?.includes(today)) continue;
        const todayCount = h.history.filter((d: string) => d === today).length;
        if (todayCount >= h.targetCount) continue;

        // Per-habit explicit reminder at user-chosen time.
        if (h.hasReminder && h.reminderTime) {
          const [hrs, mins] = h.reminderTime.split(':').map(Number);
          if (!isNaN(hrs) && !isNaN(mins)) {
            await notifee.createTriggerNotification({
              id: `habit_reminder_${h.id}`,
              title: `Reminder: ${h.title}`,
              body: `Time to get it done! (${todayCount}/${h.targetCount})`,
              android: { channelId: `notif_pop_v4` },
              ios: { sound: `pop.wav` }
            }, { type: TriggerType.TIMESTAMP, timestamp: getNextTriggerTimestamp(hrs, mins), alarmManager: { type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE } });
          }
        }

        // Streak-at-risk check: only nag on habits where there's actually momentum to lose.
        const streak = calculateStreak(h);
        if (streak >= 3) atRisk.push({ habit: h, streak });
      }

      // ── Streak-at-risk evening warning ───────────────────────────────────
      // One consolidated notification at 8 PM listing every habit with a 3+
      // day streak that's still incomplete. Single ping (not one per habit) so
      // it never devolves into a wall of notifications. Skipped if 8 PM has
      // already passed today — re-runs throughout the day catch the user as
      // they complete habits and prune the at-risk list.
      if (atRisk.length > 0 && useAppStore.getState().streakRemindersEnabled) {
        const target = new Date(); target.setHours(20, 0, 0, 0);
        if (target.getTime() > Date.now()) {
          const titles = atRisk.map(x => x.habit.title);
          const title = `Before the sun sets`;
          const body = atRisk.length === 1
            ? `${titles[0]} is still open — keep your ${atRisk[0].streak}-day run going, if you like.`
            : `Still open: ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? ` + ${titles.length - 3} more` : ''}.`;
          await notifee.createTriggerNotification({
            id: `habit_streak_warn_${today.replace(/-/g, '')}`,
            title, body,
            android: { channelId: `notif_pop_v4` },
            ios: { sound: `pop.wav` },
          }, { type: TriggerType.TIMESTAMP, timestamp: target.getTime(), alarmManager: { type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE } });
        }
      }

      // ── Pact deadline approaching ────────────────────────────────────────
      // Daily 8 AM ping during the final 3 days of an active Pact, including
      // deadline day itself. Pacts are explicit high-stakes commitments — silent
      // failure is the worst outcome, so we escalate with daily reminders rather
      // than a single one-shot heads-up.
      if (currentPact && currentPact.deadline) {
        const daysToDeadline = diffInDays(today, currentPact.deadline);
        if (daysToDeadline >= 0 && daysToDeadline <= 3) {
          for (let d = 0; d <= daysToDeadline; d++) {
            const target = new Date();
            target.setDate(target.getDate() + d);
            target.setHours(8, 0, 0, 0);
            if (target.getTime() <= Date.now()) continue;
            const remaining = daysToDeadline - d;
            const title = remaining === 0 ? 'Pact ends today'
              : remaining === 1 ? 'Pact ends tomorrow'
              : `Pact ends in ${remaining} days`;
            const body = `Your Level ${currentPact.level} Pact — show up or face the fall.`;
            const stamp = `${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, '0')}${String(target.getDate()).padStart(2, '0')}`;
            await notifee.createTriggerNotification({
              id: `habit_pact_deadline_${stamp}`,
              title, body,
              android: { channelId: `notif_pop_v4` },
              ios: { sound: `pop.wav` },
            }, { type: TriggerType.TIMESTAMP, timestamp: target.getTime(), alarmManager: { type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE } });
          }
        }
      }
    } catch(e) { console.warn(e); }
  }, []);

  // Debounced notification scheduling — don't fire on every tiny state change.
  // Re-syncs on habits OR pact changes so streak warnings and deadline pings
  // stay aligned with whatever the user just edited.
  useEffect(() => {
    if (notifDebounceRef.current) clearTimeout(notifDebounceRef.current);
    notifDebounceRef.current = setTimeout(() => {
      scheduleAllNotifications(habits, pact);
    }, 1500);
    return () => { if (notifDebounceRef.current) clearTimeout(notifDebounceRef.current); };
  }, [habits, pact, scheduleAllNotifications]);

  // Notification permission verification on tab focus
  const [notifCompromised, setNotifCompromised] = useState(false);

  // Focus-triggered whispers — each key fires exactly ONCE, ever. No per-session repetition.
  useFocusEffect(useCallback(() => {
    const todayStr = getFormatDateStr();
    const activeHabits = habits.filter(h => h.status === 'active');
    if (activeHabits.length === 0) return;
    const seen = useAppStore.getState().whispersSeen || {};

    const tryFire = (key: string, line: string, delay = 1500) => {
      if (seen[key]) return false;
      markWhisperSeen(key);
      setTimeout(() => showWhisper(line), delay);
      return true;
    };

    // Ghost Mode — returning after absence
    const allDates = activeHabits.flatMap(h => h.history);
    if (allDates.length > 0) {
      const lastDate = allDates.sort().pop()!;
      const gap = diffInDays(lastDate, todayStr);
      if (gap >= 5 && tryFire('ghost_long', "Absence logged. The system waited.", 1200)) return;
      if (gap >= 3 && tryFire('ghost_short', "You came back. That is being noted.", 1200)) return;
    }

    // Identity whispers — sustained habits at milestones
    for (const h of activeHabits) {
      const created = new Date(h.createdAt);
      const daysActive = diffInDays(getFormatDateStr(created), todayStr);
      const score = calculateStrengthScore(h, todayStr);

      if (daysActive >= 90 && score >= 80 && tryFire('identity_90', "Ninety days. This is not a habit. This is identity.")) return;
      if (daysActive >= 60 && score >= 85 && tryFire('identity_60', "Sixty days at eighty-five. The work is no longer effortful.")) return;
      if (daysActive >= 30 && score >= 80 && tryFire('identity_30', "Thirty days. The pattern is holding.")) return;
    }

    // Global strength 80%+ across 2+ habits
    const scores = activeHabits.map(h => calculateStrengthScore(h, todayStr));
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    if (avg >= 80 && activeHabits.length >= 2) {
      tryFire('strength_global_80', `${avg}% across the board. That is not chance.`);
    }
  }, [habits, showWhisper, markWhisperSeen]));

  useFocusEffect(useCallback(() => {
    const verify = async () => {
      try {
        const settings = await notifee.getNotificationSettings();
        const permOk = settings.authorizationStatus >= 1;
        const triggerIds = await notifee.getTriggerNotificationIds();
        const habitTriggers = triggerIds.filter(id => id.startsWith('habit_'));
        const habitsWithReminders = habits.filter(h => h.hasReminder && h.status === 'active');
        const triggersOk = habitsWithReminders.length === 0 || habitTriggers.length > 0;
        setNotifCompromised(!permOk || !triggersOk);
      } catch (e) { /* silent */ }
    };
    verify();
  }, [habits]));

  const repairNotifications = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await notifee.requestPermission();
      await scheduleAllNotifications(habits, pact);
      setNotifCompromised(false);
    } catch (e) { /* silent */ }
  }, [habits, pact, scheduleAllNotifications]);

  const handleReminderTimeChange = useCallback((text: string) => {
    let cleaned = text.replace(/[^0-9]/g, '').slice(0, 4);
    if (cleaned.length >= 3) { cleaned = cleaned.slice(0, 2) + ':' + cleaned.slice(2); }
    setNewReminderTime(cleaned);
  }, []);

  const openSheet = useCallback((habit?: Habit) => {
    Keyboard.dismiss();
    if (habit) {
      setEditingId(habit.id); setNewTitle(habit.title); setNewDescription(habit.description || ''); setNewColor(habit.color); setNewIcon(habit.icon);
      setNewTargetCount(habit.targetCount.toString()); setNewUnit(habit.unit || ''); setNewTimeBlock(habit.timeBlock);
      setNewScheduleType(habit.scheduleType || 'days'); setNewFrequency(habit.frequency || []);
      setNewIntervalDays(habit.intervalDays?.toString() || '2'); setNewStartDate(habit.startDate || getFormatDateStr());
      setNewHasReminder(habit.hasReminder || false); setNewReminderTime(habit.reminderTime || '');
    } else {
      setEditingId(null); setNewTitle(''); setNewDescription(''); setNewTargetCount('1'); setNewUnit(''); setNewTimeBlock('morning');
      setNewScheduleType('days'); setNewFrequency(UI_DAYS); setNewIntervalDays('2'); setNewStartDate(getFormatDateStr());
      setNewHasReminder(false); setNewReminderTime('');
    }
    setHabitModalVisible(true);
  }, []);

  const closeSheet = useCallback(() => {
    Keyboard.dismiss();
    setHabitModalVisible(false);
  }, []);

  const openStorage = useCallback(() => {
    Keyboard.dismiss();
    storageSheetRef.current?.present();
  }, []);

  const closeStorage = useCallback(() => {
    storageSheetRef.current?.dismiss();
  }, []);

  const saveHabit = useCallback(() => {
    if (!newTitle.trim()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Always read the current snapshot from the store — avoids stale closure bug
    const existing = editingId ? useAppStore.getState().habits.find((h: Habit) => h.id === editingId) : null;
    const newHabit: Habit = {
      id: editingId || Date.now().toString(),
      title: newTitle.trim(), color: newColor, icon: newIcon, timeBlock: newTimeBlock,
      description: newDescription.trim() || undefined,
      targetCount: Math.max(1, parseInt(newTargetCount) || 1),
      unit: newUnit.trim(),
      scheduleType: newScheduleType,
      frequency: newScheduleType === 'days' ? newFrequency : [],
      intervalDays: newScheduleType === 'interval' ? Math.max(1, parseInt(newIntervalDays) || 1) : undefined,
      startDate: newScheduleType === 'interval' ? newStartDate : undefined,
      hasReminder: newHasReminder,
      reminderTime: newHasReminder ? parseTimeString(newReminderTime) : '',
      history: existing?.history || [],
      restDays: existing?.restDays || [],
      skippedDays: existing?.skippedDays || [],
      createdAt: existing?.createdAt || Date.now(),
      // addOrUpdateHabit fully replaces the record, so carry forward fields the
      // editor doesn't manage — without this, editing a habit wiped its
      // per-completion notes.
      completionNotes: existing?.completionNotes,
      status: 'active',
    };
    addOrUpdateHabit(newHabit);
    // Monotonic unlock counter — only fresh habits tick it (PACT + STORAGE at >=3).
    if (!editingId) useAppStore.getState().incrementTotalHabitsCreated();
    closeSheet();
    // First-habit onboarding whisper — fires exactly once ever when user creates their first habit
    if (!editingId) {
      const allHabits = useAppStore.getState().habits;
      const seen = useAppStore.getState().whispersSeen || {};
      if (allHabits.length <= 1 && !seen['first_habit']) {
        markWhisperSeen('first_habit');
        setTimeout(() => showWhisper("One habit. That's how everything starts."), 800);
      }
    }
  }, [
    newTitle, newDescription, newColor, newIcon, newTimeBlock, newTargetCount, newUnit,
    newScheduleType, newFrequency, newIntervalDays, newStartDate,
    newHasReminder, newReminderTime, editingId, addOrUpdateHabit, closeSheet,
    markWhisperSeen, showWhisper,
  ]);

  // --- DATA PREP ---
  // Stable date string — only recomputes when selectedDate actually changes
  const selectedDateStr = useMemo(() => getFormatDateStr(selectedDate), [selectedDate]);
  const selectedJsDayName = useMemo(() => JS_DAYS[selectedDate.getDay()], [selectedDate]);

  // ── Day rollover ──────────────────────────────────────────────────────────
  // selectedDate is captured once at mount and only changes on a chip tap, so
  // it goes stale the moment the user's clock crosses local midnight while the
  // app sits open or backgrounded. A stale day makes isAllDone's TODAY-only
  // guard fail — so completing the last habit after midnight wouldn't fire the
  // day-conquered celebration. Re-sync to today on focus, on app foreground,
  // and at the next local midnight — but ONLY while the user is tracking
  // "today" (never yank them off a past/future day they deliberately selected).
  const viewingTodayRef = useRef(true);
  const rollToTodayIfTracking = useCallback(() => {
    if (!viewingTodayRef.current) return;
    if (getFormatDateStr(selectedDate) !== getFormatDateStr()) setSelectedDate(new Date());
  }, [selectedDate]);
  useFocusEffect(useCallback(() => {
    rollToTodayIfTracking();
    // Catch the rollover even if the tab stays open across midnight.
    const now = new Date();
    const nextMidnight = new Date(now); nextMidnight.setHours(24, 0, 5, 0); // ~5s past local midnight
    const t = setTimeout(rollToTodayIfTracking, Math.max(1000, nextMidnight.getTime() - now.getTime()));
    return () => clearTimeout(t);
  }, [rollToTodayIfTracking]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') rollToTodayIfTracking(); });
    return () => sub.remove();
  }, [rollToTodayIfTracking]);

  const weekWindow = useMemo(() => {
    const today = new Date();
    return Array.from({length: 7}).map((_, i) => { 
      const d = new Date(today); 
      d.setDate(today.getDate() - 3 + i); 
      return d; 
    });
  // Recompute once per day, not on every render — keyed off date string
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getFormatDateStr(new Date())]);

  const next14Days = useMemo(() => {
    const today = new Date();
    return Array.from({length: 14}).map((_, i) => { 
      const d = new Date(today); 
      d.setDate(today.getDate() + i); 
      return d; 
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getFormatDateStr(new Date())]);

  const scheduledHabits = useMemo(() => habits.filter((h: Habit) => {
    if (h.status !== 'active') return false;
    // A habit only exists from its creation day forward — a freshly-made habit
    // shouldn't appear on past dates in the window (mirrors the createdAt guard
    // in wasDayConquered). Future dates are fine.
    if (getFormatDateStr(new Date(h.createdAt)) > selectedDateStr) return false;
    if (h.scheduleType === 'interval') {
       if (!h.startDate) return false;
       const diff = diffInDays(h.startDate, selectedDateStr); return diff >= 0 && diff % (h.intervalDays || 1) === 0;
    }
    return h.frequency.length === 0 || h.frequency.includes(selectedJsDayName);
  }), [habits, selectedDateStr, selectedJsDayName]);

  // Compute streak + status once here so renderFlashListItem doesn't recompute per render
  const flashListData = useMemo(() => {
    const data: any[] = [];
    TIME_BLOCKS.forEach(block => {
      const blockHabits = scheduledHabits.filter((h: Habit) => h.timeBlock === block.id);
      if (blockHabits.length > 0) {
        const completed = blockHabits.filter((h: Habit) => {
          const todayCount = h.history.filter((d: string) => d === selectedDateStr).length;
          return h.skippedDays?.includes(selectedDateStr) || h.restDays?.includes(selectedDateStr) || todayCount >= h.targetCount;
        }).length;
        
        const blockScores = blockHabits.map((h: Habit) => calculateStrengthScore(h, selectedDateStr));
        const blockStrength = blockScores.length > 0 ? Math.round(blockScores.reduce((a: number, b: number) => a + b, 0) / blockScores.length) : 0;
        data.push({ type: 'header', id: `header-${block.id}`, block, total: blockHabits.length, completed, blockStrength });

        blockHabits.forEach((h: Habit) => {
          // Pre-compute all derived values here — renderFlashListItem just reads them
          const todayCount = h.history.filter((d: string) => d === selectedDateStr).length;
          let currentStatus = 'pending';
          if (h.skippedDays?.includes(selectedDateStr)) currentStatus = 'skipped';
          else if (h.restDays?.includes(selectedDateStr)) currentStatus = 'rest';
          else if (todayCount >= h.targetCount) currentStatus = 'done';
          const currentStreak = calculateStreak(h);
          const strengthScore = calculateStrengthScore(h, selectedDateStr);

          data.push({ type: 'habit', id: h.id, habit: h, todayCount, currentStatus, currentStreak, strengthScore });
        });
      }
    });

    if (data.length === 0) data.push({ type: 'empty', id: 'empty' });
    return data;
  }, [scheduledHabits, selectedDateStr]);

  // Memoized storage list
  const storageActive = useMemo(() => habits.filter((h: Habit) => h.status === 'active'), [habits]);
  const storageArchived = useMemo(() => habits.filter((h: Habit) => h.status === 'archived'), [habits]);

  // Retired habits kept as trophies (vanished ones are excluded — they still
  // count in the grade but the user chose not to memorialize them).
  const retiredHabits = useMemo(
    () => habits.filter((h: Habit) => h.status === 'retired' && !h.vanished),
    [habits]
  );

  // ─── THE ECLIPSE LOGIC ───
  const eclipseProgress = useSharedValue(0);
  const prevIsAllDone = useRef(false);
  const eclipseFiredForDate = useRef<string | null>(null);

  // isAllDone derived from already-memoized scheduledHabits
  const isAllDone = useMemo(() => {
    // Eclipse only fires for TODAY — not past, not future
    if (selectedDateStr !== getFormatDateStr()) return false;
    return scheduledHabits.length > 0 && scheduledHabits.every((h: Habit) => {
      const todayCount = h.history.filter((d: string) => d === selectedDateStr).length;
      return h.skippedDays?.includes(selectedDateStr) || h.restDays?.includes(selectedDateStr) || todayCount >= h.targetCount;
    });
  }, [scheduledHabits, selectedDateStr]);

  useEffect(() => {
    // Fire once per calendar day. The in-memory ref guards within a session;
    // lastDayConqueredCelebrated (persisted) guards across remounts/restarts so
    // reopening the tab on an already-conquered day doesn't replay the eclipse.
    if (isAllDone && eclipseFiredForDate.current !== selectedDateStr && lastDayConqueredCelebrated !== selectedDateStr) {
      eclipseFiredForDate.current = selectedDateStr;
      setLastDayConqueredCelebrated(selectedDateStr);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft), 1000);

      // Every scheduled habit is done — let the sun set on the day.
      setActiveEclipse(true);

      // ── "Go for more" easter egg (experimental, flagged off) ──
      // Only rolls when the day is conquered BEFORE 4pm (hard), then a low
      // chance (mysterious), at most once/day, and never if it's been retired
      // after 3 ignores. Surfaces after the eclipse settles so the two moments
      // don't collide.
      if (
        GO_FOR_MORE_ENABLED &&
        !goForMoreRetired &&
        goForMoreLastShown !== selectedDateStr &&
        new Date().getHours() < GO_FOR_MORE_BEFORE_HOUR &&
        Math.random() < GO_FOR_MORE_CHANCE
      ) {
        recordGoForMoreShown(selectedDateStr);
        goForMoreEngagedRef.current = false;
        setTimeout(() => setGoForMoreActive(true), 3200);
      }
    }
    prevIsAllDone.current = isAllDone;
  }, [isAllDone, habits, pact, selectedDateStr, lastDayConqueredCelebrated, setLastDayConqueredCelebrated, goForMoreRetired, goForMoreLastShown, recordGoForMoreShown]);

  // Auto-fade the "go for more" moment. If it's let to pass (not engaged), that
  // counts as an ignore toward the 3-strikes retirement. Engaging closes the
  // modal first, so this cleanup clears the timer and no ignore is recorded.
  useEffect(() => {
    if (!goForMoreActive) return;
    const t = setTimeout(() => {
      if (!goForMoreEngagedRef.current) recordGoForMoreIgnored();
      setGoForMoreActive(false);
    }, 5000);
    return () => clearTimeout(t);
  }, [goForMoreActive, recordGoForMoreIgnored]);

  const eclipseUiShift = useAnimatedStyle(() => ({
    opacity: interpolate(eclipseProgress.value, [0, 0.6], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(eclipseProgress.value, [0, 0.6], [1, 0.95], Extrapolation.CLAMP) }]
  }));

  const eclipseStamp = useAnimatedStyle(() => ({
    opacity: interpolate(eclipseProgress.value, [0.4, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(eclipseProgress.value, [0.4, 1], [0.95, 1], Extrapolation.CLAMP) },
      { translateY: interpolate(eclipseProgress.value, [0.4, 1], [10, 0], Extrapolation.CLAMP) }
    ]
  }));

  // Wrapper for habit action that checks for recovery whisper
  const handleHabitAction = useCallback((id: string, action: string, dateStr: string) => {
    if (action === 'done') {
      const todayStr = getFormatDateStr();
      const h = useAppStore.getState().habits.find(hb => hb.id === id);
      if (h) {
        // Recovery whisper — fires exactly once ever (first time user returns after 3+ day gap)
        const sorted = [...h.history].sort().reverse();
        const lastDone = sorted[0];
        if (lastDone && diffInDays(lastDone, dateStr) >= 3) {
          const seen = useAppStore.getState().whispersSeen || {};
          if (!seen['recovery']) {
            markWhisperSeen('recovery');
            setTimeout(() => showWhisper("You missed. You returned. The record continues."), 1000);
          }
        }
        // Past-completion whisper — fires exactly once ever
        const gap = diffInDays(dateStr, todayStr);
        if (gap >= 1 && gap <= 3) {
          const seen = useAppStore.getState().whispersSeen || {};
          if (!seen['past_completion']) {
            markWhisperSeen('past_completion');
            setTimeout(() => showWhisper("The past was rewritten. The system permits this."), 1000);
          }
        }
      }
    }
    toggleHabitAction(id, action as any, dateStr);
    // Auto-tick today's intent items linked to this habit. Only fires on the
    // 'done' action — skip/rest/clear shouldn't tick an intent. Same forward-
    // only semantics for the linked-challenges advancement: completing a
    // habit nudges every linked challenge forward, but un-completing the
    // habit does NOT roll the challenge back. Rollback is a separate
    // intentional action via the challenge's −1 button.
    if (action === 'done') {
      useAppStore.getState().autoCheckIntentsForHabit(id, dateStr);
      useAppStore.getState().advanceLinkedChallengesForHabit(id, dateStr);
    }
  }, [toggleHabitAction, showWhisper, markWhisperSeen]);

  const handleOpenDetail = useCallback((habit: Habit) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const fresh = useAppStore.getState().habits.find(h => h.id === habit.id);
    setDetailHabit(fresh || habit);
  }, []);

  const handleNotePress = useCallback((habitId: string, dateStr: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const habit = useAppStore.getState().habits.find(h => h.id === habitId);
    setNoteModal({ habitId, dateStr, text: habit?.completionNotes?.[dateStr] || '' });
  }, []);

  const saveCompletionNote = useCallback(() => {
    if (!noteModal) return;
    setHabitCompletionNote(noteModal.habitId, noteModal.dateStr, noteModal.text);
    const savedHabitId = noteModal.habitId;
    setNoteModal(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // If coming from detail view (returnToDetail set), reopen it with fresh data
    if (detailHabit?.id === savedHabitId) {
      setTimeout(() => {
        const fresh = useAppStore.getState().habits.find(h => h.id === savedHabitId);
        if (fresh) setDetailHabit({ ...fresh });
      }, 250);
    }
  }, [noteModal, setHabitCompletionNote, detailHabit]);

  const renderFlashListItem = useCallback(({ item }: any) => {
    if (item.type === 'empty') {
      const emptyLines = [
        "Nothing scheduled. The day is an open field.",
        "No habits today. Rest is part of the system.",
        "Blank slate. What you do next is up to you.",
        "The schedule is clear. Use it wisely.",
        "No demands today. That's rare.",
        "Empty day. Not every day needs a mission.",
        "Nothing here. Sometimes that's the point.",
      ];
      const msg = emptyLines[new Date().getDay() % emptyLines.length];
      return (
        <View style={{ alignItems: 'center', marginTop: 60, paddingHorizontal: 40 }}>
          <Feather name="wind" size={64} color={theme.textSub} style={{ opacity: 0.1, marginBottom: 20 }} />
          <Text style={{ color: theme.textSub, fontSize: 15, fontWeight: '600', fontStyle: 'italic', textAlign: 'center', lineHeight: 24 }}>{msg}</Text>
        </View>
      );
    }
    if (item.type === 'header') {
      const isBlockDone = item.completed === item.total;
      const accentColor = isBlockDone ? theme.success : theme.textSub;
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, marginTop: 20, paddingHorizontal: 4, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name={item.block.icon as any} size={13} color={accentColor} style={{ opacity: 0.7 }} />
            <Text style={{ color: accentColor, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.7 }}>{item.block.label}</Text>
          </View>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
          <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '800', opacity: 0.5 }}>{item.blockStrength}%</Text>
          <View style={{ width: 1, height: 10, backgroundColor: theme.border, marginHorizontal: 4 }} />
          <Text style={{ color: accentColor, fontSize: 11, fontWeight: '900', opacity: 0.6 }}>{item.completed}/{item.total}</Text>
        </View>
      );
    }

    // All values pre-computed in flashListData memo — zero work here
    return (
      <HabitCard
        habit={item.habit}
        selectedDateStr={selectedDateStr}
        todayCount={item.todayCount}
        currentStatus={item.currentStatus}
        currentStreak={item.currentStreak}
        // Strength % chip is gated by passing 0 when locked — the card
        // already hides the chip at 0, so no extra prop needed.
        strengthScore={strengthScoreUnlocked ? item.strengthScore : 0}
        theme={theme}
        onToggle={handleHabitAction}
        onAction={handleHabitAction}
        onOpen={handleOpenDetail}
        onArchive={updateHabitStatus}
        // Completion-note button is gated by passing undefined when locked;
        // the card only renders the Note pressable when onNotePress exists.
        onNotePress={completionNotesUnlocked ? handleNotePress : undefined}
        notesUnlocked={completionNotesUnlocked}
      />
    );
  }, [selectedDateStr, theme, handleHabitAction, handleOpenDetail, updateHabitStatus, handleNotePress, strengthScoreUnlocked, completionNotesUnlocked]);

  const getTodayLabel = useCallback(() => {
    const dayName = FULL_DAYS[selectedDate.getDay()];
    if (calendarType === 'shamsi') { const parts = getShamsiDateParts(selectedDate); return `${dayName}, ${S_MONTHS[parts.month - 1].slice(0, 3)} ${parts.day}`; }
    return `${dayName}, ${G_MONTHS[selectedDate.getMonth()]} ${selectedDate.getDate()}`;
  }, [selectedDate, calendarType]);

  const globalStrength = useMemo(() => {
    // The ONE grade number. Active (live) + kept retired (frozen) count — same
    // set the chart modal uses — so the header score and the chart score can
    // never disagree. Vanished retired habits are excluded ("delete from grade");
    // archived (long-paused) is excluded until it returns.
    const counted = habits.filter(h => h.status === 'active' || (h.status === 'retired' && !h.vanished));
    if (counted.length === 0) return null;
    const todayStr = getFormatDateStr();
    const scores = counted.map(h => calculateStrengthScore(h, todayStr));
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }, [habits]);

  // Track peak-ever strength for the Sovereign overreach easter egg (read in challenges.tsx).
  const notePeakStrength = useAppStore(s => s.notePeakStrength);
  useEffect(() => { if (globalStrength != null) notePeakStrength(globalStrength); }, [globalStrength, notePeakStrength]);


  // ── Pact logic ──
  // Tier system: 1=easy (~50% of weekly schedule), 2=medium (~75%), 3=hard (100%)
  const getHabitRequirement = useCallback((habitId: string, tier: number): number => {
    const h = habits.find(hb => hb.id === habitId);
    if (!h) return 3;
    let daysPerWeek = 7;
    if (h.scheduleType === 'days' && h.frequency.length > 0) daysPerWeek = h.frequency.length;
    else if (h.scheduleType === 'interval') daysPerWeek = Math.min(7, 7 / (h.intervalDays || 1));
    const multiplier = tier === 1 ? 0.5 : tier === 2 ? 0.75 : 1.0;
    return Math.max(2, Math.ceil(daysPerWeek * multiplier));
  }, [habits]);

  const calculatePactDeadline = useCallback((pactHabits: { id: string; tier: number }[]): string => {
    let maxCycleDays = 0;
    for (const ph of pactHabits) {
      const req = getHabitRequirement(ph.id, ph.tier);
      const h = habits.find(hb => hb.id === ph.id);
      if (!h) continue;
      let daysPerWeek = 7;
      if (h.scheduleType === 'days' && h.frequency.length > 0) daysPerWeek = h.frequency.length;
      else if (h.scheduleType === 'interval') daysPerWeek = Math.min(7, 7 / (h.intervalDays || 1));
      const cycleDays = Math.ceil(req / (daysPerWeek / 7));
      if (cycleDays > maxCycleDays) maxCycleDays = cycleDays;
    }
    // Buffer shrinks with tier: 40% for tier 1, 20% for tier 2, 10% for tier 3
    const maxTier = Math.max(...pactHabits.map(ph => ph.tier));
    const buffer = maxTier === 1 ? 1.4 : maxTier === 2 ? 1.2 : 1.1;
    const totalDays = Math.ceil(maxCycleDays * buffer);
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + Math.max(totalDays, 3));
    return getFormatDateStr(deadline);
  }, [habits, getHabitRequirement]);

  const pactStatus = useMemo(() => {
    if (!pact || !pact.habits) return null;
    const todayStr = getFormatDateStr();
    const daysLeft = diffInDays(todayStr, pact.deadline);
    const isExpired = daysLeft < 0;

    const habitProgress = pact.habits.map(ph => {
      const h = habits.find(hb => hb.id === ph.id);
      if (!h) return { id: ph.id, title: '?', tier: ph.tier, completed: 0, required: getHabitRequirement(ph.id, ph.tier), color: '#666', icon: 'circle' as any };
      const countPerDay: Record<string, number> = {};
      h.history.filter(d => d >= pact.startedAt && d <= todayStr).forEach(d => { countPerDay[d] = (countPerDay[d] || 0) + 1; });
      const daysCompleted = Object.values(countPerDay).filter(c => c >= h.targetCount).length;
      const required = getHabitRequirement(ph.id, ph.tier);
      return { id: ph.id, title: h.title, tier: ph.tier, completed: daysCompleted, required, color: h.color, icon: h.icon };
    });

    const allDone = habitProgress.every(hp => hp.completed >= hp.required);
    return { daysLeft, isExpired, habitProgress, allDone, level: pact.level };
  }, [pact, habits, getHabitRequirement]);

  // Check if pact just completed or expired
  const pactDecisionShown = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!pactStatus || pactDecisionShown.current) return;
    if (pactStatus.allDone) {
      pactDecisionShown.current = true;
      setPactOutcomeOverride('won');
      setTimeout(() => setShowPactDecision(true), 600);
    } else if (pactStatus.isExpired) {
      pactDecisionShown.current = true;
      setPactOutcomeOverride('lost');
      setTimeout(() => setShowPactDecision(true), 600);
    }
  }, [pactStatus]));

  const snapshotPact = useCallback((outcome: 'completed' | 'failed') => {
    if (!pact || !pact.habits) return;
    const todayStr = getFormatDateStr();
    const snap = {
      level: pact.level,
      habits: pact.habits.map(ph => {
        const h = habits.find(hb => hb.id === ph.id);
        const countPerDay: Record<string, number> = {};
        (h?.history || []).filter(d => d >= pact.startedAt && d <= todayStr).forEach(d => { countPerDay[d] = (countPerDay[d] || 0) + 1; });
        const completed = Object.values(countPerDay).filter(c => c >= (h?.targetCount || 1)).length;
        return { id: ph.id, title: h?.title || '?', tier: ph.tier, completed, required: getHabitRequirement(ph.id, ph.tier) };
      }),
      outcome,
      startedAt: pact.startedAt,
      endedAt: todayStr,
    };
    return [...(pact.history || []), snap];
  }, [pact, habits, getHabitRequirement]);

  const startPact = useCallback((habitId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const todayStr = getFormatDateStr();
    const pactHabits = [{ id: habitId, tier: 1 }];
    const deadline = calculatePactDeadline(pactHabits);
    setPact({ habits: pactHabits, level: 1, startedAt: todayStr, deadline, history: [] });
    setShowPactSetup(false);
    showWhisper("Pact initiated. The deadline is real.");
  }, [setPact, calculatePactDeadline, showWhisper]);

  const handlePactDecision = useCallback((choice: 'add' | 'deeper' | 'hold' | 'retry' | 'scale_back') => {
    if (!pact) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const todayStr = getFormatDateStr();
    const history = snapshotPact(pactStatus?.allDone ? 'completed' : 'failed') || pact.history || [];
    pactDecisionShown.current = false;

    if (choice === 'add') {
      setShowPactDecision(false);
      setShowPactSetup(true);
    } else if (choice === 'deeper') {
      // Increase tier of all habits (max 3), tighter deadline
      const newHabits = pact.habits.map(ph => ({ ...ph, tier: Math.min(3, ph.tier + 1) }));
      const deadline = calculatePactDeadline(newHabits);
      setPact({ ...pact, habits: newHabits, startedAt: todayStr, deadline, history });
      setShowPactDecision(false);
      showWhisper("Requirements escalated. Deadline tightened.");
    } else if (choice === 'hold') {
      const deadline = calculatePactDeadline(pact.habits);
      setPact({ ...pact, startedAt: todayStr, deadline, history });
      setShowPactDecision(false);
      showWhisper("Same directive. New window.");
    } else if (choice === 'retry') {
      // The failed-pact history entry (snapshotPact + pact.history above) is
      // the canonical record; we used to also auto-create a Notes entry here
      // but it muddied the line between "user's private workspace" and "system
      // event log." History stays in the Pact card.
      const deadline = calculatePactDeadline(pact.habits);
      setPact({ ...pact, startedAt: todayStr, deadline, history });
      setShowPactDecision(false);
      pactDecisionShown.current = false;
      showWhisper("Same target. Deadline reset.");
    } else if (choice === 'scale_back') {
      // Same as the retry branch above: the Pact history entry IS the record;
      // we no longer mirror it into Notes (Notes is for the user's words, not
      // the system's log of them).
      if (pact.habits.length <= 1) {
        // Check if we can just drop a tier
        if (pact.habits[0].tier > 1) {
          const newHabits = [{ ...pact.habits[0], tier: pact.habits[0].tier - 1 }];
          const deadline = calculatePactDeadline(newHabits);
          setPact({ ...pact, habits: newHabits, startedAt: todayStr, deadline, history });
          setShowPactDecision(false);
          showWhisper("Difficulty lowered. The system accepts this.");
        } else {
          setPact(undefined);
          setShowPactDecision(false);
          showWhisper("Pact dissolved. The record remains.");
        }
      } else {
        const newHabits = pact.habits.slice(0, -1);
        const deadline = calculatePactDeadline(newHabits);
        setPact({ ...pact, habits: newHabits, level: pact.level - 1, startedAt: todayStr, deadline, history });
        setShowPactDecision(false);
        showWhisper("Scope reduced. Focus narrowed.");
      }
    }
  }, [pact, pactStatus, setPact, calculatePactDeadline, snapshotPact, showWhisper]);

  // Compute buffer usage: 0 = finished with lots of time left, 1 = used all the buffer
  const computeBufferUsage = useCallback((): number => {
    if (!pact) return 1;
    const todayStr = getFormatDateStr();
    const totalWindow = diffInDays(pact.startedAt, pact.deadline);
    const daysUsed = diffInDays(pact.startedAt, todayStr);
    if (totalWindow <= 0) return 1;
    return Math.max(0, Math.min(1, daysUsed / totalWindow));
  }, [pact]);

  const addHabitToPact = useCallback((habitId: string) => {
    if (!pact) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const todayStr = getFormatDateStr();
    const history = snapshotPact('completed') || pact.history || [];
    // Buffer-aware: if finished with lots of time left, keep existing tiers. User proved they can handle it.
    const bufferUsage = computeBufferUsage();
    const strongCompletion = bufferUsage < 0.6;
    const adjustedHabits = strongCompletion
      ? pact.habits
      : pact.habits.map(ph => ({ ...ph, tier: ph.tier > 1 ? ph.tier - 1 : ph.tier }));
    const newHabits = [...adjustedHabits, { id: habitId, tier: 1 }];
    const deadline = calculatePactDeadline(newHabits);
    setPact({ habits: newHabits, level: pact.level + 1, startedAt: todayStr, deadline, history });
    setShowPactSetup(false);
    pactDecisionShown.current = false;
    if (strongCompletion) {
      showWhisper(`Level ${pact.level + 1}. Tiers held. You earned that.`);
    } else {
      showWhisper(`Level ${pact.level + 1}. New directive added.`);
    }
  }, [pact, setPact, calculatePactDeadline, snapshotPact, showWhisper, computeBufferUsage]);

  const adjustPactHabit = useCallback((habitId: string) => {
    if (!pact) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newHabits = pact.habits.map(ph =>
      ph.id === habitId && ph.tier > 1 ? { ...ph, tier: ph.tier - 1 } : ph
    );
    const deadline = calculatePactDeadline(newHabits);
    setPact({ ...pact, habits: newHabits, deadline });
    showWhisper("Recalibrated. No shame in knowing your limits.");
  }, [pact, setPact, calculatePactDeadline, showWhisper]);


  // Memoized date selection handler
  const handleDateSelect = useCallback((date: Date) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Track whether the user is sitting on "today" so the midnight rollover
    // only auto-advances when they haven't deliberately picked another day.
    viewingTodayRef.current = getFormatDateStr(date) === getFormatDateStr();
    setSelectedDate(date);
  }, []);

  // Memoized frequency toggle
  const handleFrequencyToggle = useCallback((day: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNewFrequency(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
      <BottomSheetModalProvider>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          
          {/* DAY CONQUERED — context-aware variation. Rendered in a Modal so it covers the tab bar too. */}
          <Modal visible={activeEclipse} transparent animationType="none" statusBarTranslucent onRequestClose={() => setActiveEclipse(false)}>
            <View style={{ flex: 1 }} pointerEvents="none">
              {activeEclipse && <Eclipse_Horizon theme={theme} onDone={() => setActiveEclipse(false)} />}
            </View>
          </Modal>

          {/* "GO FOR MORE" — secret early-finish moment (EXPERIMENTAL, ships off).
              A faint, wordless-feeling system line. Step toward it to engage
              (reward TBD — deferred placeholder); let it fade and it counts as an
              ignore (3 → gone forever). */}
          <Modal visible={goForMoreActive} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (!goForMoreEngagedRef.current) recordGoForMoreIgnored(); setGoForMoreActive(false); }}>
            <Pressable
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center' }}
              onPress={() => {
                goForMoreEngagedRef.current = true;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setGoForMoreActive(false);
                // TODO: reward payload (diary tie-in) — intentionally a no-op
                // placeholder for now; the whole feature ships off in beta.
              }}
            >
              <Animated.View entering={FadeIn.duration(1600)} exiting={FadeOut.duration(900)}>
                <Text style={{ color: theme.textMain, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontSize: 13, letterSpacing: 3, opacity: 0.5, textAlign: 'center' }}>the day bent early</Text>
              </Animated.View>
            </Pressable>
          </Modal>

          {/* MAIN UI (WRAPPED IN ECLIPSE SHIFT) */}
          <Animated.View style={[{ flex: 1 }, eclipseUiShift]}>
            <View style={{ paddingHorizontal: 24, paddingTop: 30, paddingBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ fontSize: 36, fontWeight: '900', color: theme.textMain, letterSpacing: -1 }}>Habits.</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 }}>
                  <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>{getTodayLabel()}</Text>
                  <TouchableOpacity onPress={toggleCalendar} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                    <Text style={{ fontSize: 9, color: theme.textSub, opacity: 0.5, fontWeight: '900', letterSpacing: 0.5 }}>• {calendarType.toUpperCase()}</Text>
                  </TouchableOpacity>
                  {globalStrength !== null && strengthScoreUnlocked && (
                    <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowStrengthHistory(true); }} hitSlop={10} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: hexToRgba(globalStrength >= 80 ? '#10B981' : globalStrength >= 50 ? theme.textSub : theme.danger, 0.15) }}>
                      <Text style={{ fontSize: 10, fontWeight: '900', color: globalStrength >= 80 ? '#10B981' : globalStrength >= 50 ? theme.textSub : theme.danger }}>{globalStrength}%</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
                {/* Settings — rehomed from the Timeline (now the app's only Settings entry). */}
                <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowSettings(true); }} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                  <Feather name="settings" size={20} color={theme.textMain} />
                </TouchableOpacity>
                {/* Storage/archive — always available (ungated). Count is an absolute
                    superscript so a changing archived total never reflows the row. */}
                <TouchableOpacity onPress={openStorage} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                  <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="archive" size={20} color={theme.textMain} />
                    {habits.filter(h => h.status === 'archived').length > 0 && (
                      <Text style={{ position: 'absolute', top: -7, right: -9, color: theme.textSub, fontSize: 10, fontWeight: '700', opacity: 0.5, fontVariant: ['tabular-nums'] }}>{habits.filter(h => h.status === 'archived').length}</Text>
                    )}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => openSheet()} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                  <Feather name="plus-circle" size={22} color={theme.textMain} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ flex: 1 }}>
              <FlashList
                data={flashListData}
                keyExtractor={(item) => item.id}
                renderItem={renderFlashListItem}
                // @ts-ignore
                estimatedItemSize={100}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
                ListHeaderComponent={
                  <>
                    {notifCompromised && (
                      <Pressable onPress={repairNotifications} style={{ marginBottom: 12, padding: 14, borderRadius: 14, backgroundColor: hexToRgba(theme.danger, 0.1), borderWidth: 1, borderColor: hexToRgba(theme.danger, 0.3), flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Feather name="alert-circle" size={18} color={theme.danger} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.danger, fontWeight: '800', fontSize: 13 }}>Notifications compromised</Text>
                          <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600', marginTop: 2 }}>Tap to repair permissions and reschedule alerts.</Text>
                        </View>
                      </Pressable>
                    )}

                    <View style={{ marginBottom: 15, flexDirection: 'row', justifyContent: 'space-between' }}>
                      {weekWindow.map(date => {
                        const dStr = getFormatDateStr(date);
                        const isSelected = dStr === selectedDateStr;
                        const isToday = dStr === getFormatDateStr();
                        return (
                          // Compact Tinted chip — matches the Timeline tab's strip
                          // visually. No borders. Selected = full inverted fill;
                          // today = faint textMain tint; others = transparent.
                          <TouchableOpacity
                            key={dStr}
                            onPress={() => handleDateSelect(date)}
                            style={{
                              alignItems: 'center', paddingVertical: 7, borderRadius: 12, width: '13%',
                              backgroundColor: isSelected
                                ? theme.textMain
                                : isToday
                                  ? hexToRgba(theme.textMain, isDarkMode ? 0.14 : 0.08)
                                  : 'transparent',
                            }}
                          >
                            <Text style={{ color: isSelected ? theme.bg : theme.textSub, fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 }}>{JS_DAYS[date.getDay()]}</Text>
                            <Text style={{ color: isSelected ? theme.bg : isToday ? theme.textMain : theme.textSub, fontSize: 14, fontWeight: '900', marginTop: 2 }}>{calendarType === 'shamsi' ? getShamsiDateParts(date).day : date.getDate()}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* WEEKLY REVIEW — "close the week", in-content during its 30h
                        window (6pm end-of-week day → end of next day). Tapping
                        opens the writing sheet; the saved review lands in Notes.
                        (Replaced the old "This Week" progress bar.) */}
                    {weeklyReviewDue && (
                      <TouchableOpacity
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWeeklyReviewDraft(weeklyReflections[reviewWindow.anchor]?.text ?? ''); setWeeklyReviewOpen(true); }}
                        activeOpacity={0.85}
                        style={{ marginBottom: 16, borderRadius: 16, padding: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.freeze + '55' }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '900', letterSpacing: -0.2 }}>Close the week</Text>
                          <Feather name="feather" size={16} color={theme.freeze} />
                        </View>
                        <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', lineHeight: 17 }}>
                          {reviewBreakdown.strong} Strong · {reviewBreakdown.ok} Steady · {reviewBreakdown.rough} Off. A few sentences — it saves to your Notes.
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* INTENT — "what is today for?", rehomed from the Timeline.
                        Sits right under the day strip so picking a day shows that
                        day's intent; today/tomorrow are editable, past is a mirror. */}
                    <IntentPanel
                      theme={tlTheme}
                      isDarkMode={isDarkMode}
                      selectedDateStr={selectedDateStr}
                      todayStr={getFormatDateStr()}
                      insetsBottom={insets.bottom}
                    />

                    {pactStatus ? (
                      <View style={{ marginBottom: 16, borderRadius: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: pactStatus.allDone ? theme.success + '40' : pactStatus.isExpired ? theme.danger + '40' : theme.border, overflow: 'hidden' }}>
                        <TouchableOpacity onPress={() => { pactDecisionShown.current = false; setPactOutcomeOverride(pactStatus.allDone ? 'won' : pactStatus.isExpired ? 'lost' : null); setShowPactDecision(true); }} activeOpacity={0.8} style={{ padding: 16 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <Text style={{ fontSize: 11, fontWeight: '900', color: theme.textSub, letterSpacing: 1.5, textTransform: 'uppercase' }}>The Pact</Text>
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: theme.border }}><Text style={{ fontSize: 10, fontWeight: '800', color: theme.textSub }}>Lv.{pactStatus.level}</Text></View>
                            </View>
                            <Text style={{ fontSize: 11, fontWeight: '800', color: pactStatus.isExpired ? theme.danger : pactStatus.daysLeft <= 1 ? theme.freeze : theme.textSub }}>
                              {pactStatus.allDone ? 'COMPLETE' : pactStatus.isExpired ? 'EXPIRED' : `${pactStatus.daysLeft}d left`}
                            </Text>
                          </View>
                          {pactStatus.habitProgress.map(hp => {
                            const tierLabel = hp.tier === 1 ? '' : hp.tier === 2 ? ' ••' : ' •••';
                            const done = hp.completed >= hp.required;
                            return (
                              <View key={hp.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                                <Feather name={hp.icon as any} size={14} color={hp.color} />
                                <Text style={{ flex: 1, color: done ? theme.textSub : theme.textMain, fontSize: 13, fontWeight: '700', textDecorationLine: done ? 'line-through' : 'none' }} numberOfLines={1}>{hp.title}<Text style={{ color: theme.textSub, fontSize: 10 }}>{tierLabel}</Text></Text>
                                {hp.tier > 1 && !pactStatus.allDone && !pactStatus.isExpired && (
                                  <TouchableOpacity onPress={() => adjustPactHabit(hp.id)} hitSlop={10} style={{ padding: 4 }}>
                                    <Feather name="minus-circle" size={14} color={theme.textSub} style={{ opacity: 0.4 }} />
                                  </TouchableOpacity>
                                )}
                                <Text style={{ fontSize: 12, fontWeight: '900', color: done ? theme.success : theme.textSub }}>{hp.completed}/{hp.required}</Text>
                              </View>
                            );
                          })}
                        </TouchableOpacity>
                      </View>
                    ) : (pactUnlocked && habits.some(h => h.status === 'active')) ? (
                      // Pact entry gated on PACT (3 habits). Absent until then.
                      <Animated.View entering={FadeIn.duration(300)}>
                        <TouchableOpacity onPress={() => setShowPactSetup(true)} style={{ marginBottom: 16, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.border, borderStyle: 'dashed', alignItems: 'center' }}>
                          <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>Start The Pact — build habits one at a time</Text>
                        </TouchableOpacity>
                      </Animated.View>
                    ) : null}
                  </>
                }
                ListFooterComponent={
                  // Day rating — the end-of-day check-in, rehomed from the
                  // Timeline. A footer so it reads as the day's closing bookend,
                  // after the habits. Today only (you rate the day you're in).
                  selectedDateStr === getFormatDateStr() ? (
                    <View style={{ marginTop: 28 }}>
                      <DayRatingCheckIn theme={tlTheme} isDarkMode={isDarkMode} todayStr={getFormatDateStr()} />
                    </View>
                  ) : null
                }
              />
            </View>
          </Animated.View>

          {/* GLOBAL SETTINGS — rehomed from the Timeline. */}
          <SettingsSheet
            visible={showSettings}
            onClose={() => setShowSettings(false)}
            theme={tlTheme}
            insetsBottom={insets.bottom}
          />

          {/* ── WEEKLY REVIEW SHEET ── the "close the week" writing surface,
              opened from the in-content prompt above. The breakdown is the
              ratings the user already gave; the text is optional. On save it's
              written into the Notes tab AND recorded so the prompt hides. */}
          <Modal visible={weeklyReviewOpen} transparent animationType="slide" onRequestClose={() => setWeeklyReviewOpen(false)}>
            <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
              <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={() => setWeeklyReviewOpen(false)} />
              <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 12) + 16, paddingHorizontal: 24 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 18 }} />
                <Text style={{ color: theme.textMain, fontSize: 24, fontWeight: '900', letterSpacing: -0.6, marginBottom: 6 }}>Close the week.</Text>
                <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', marginBottom: 18 }}>
                  {reviewBreakdown.strong} Strong, {reviewBreakdown.ok} Steady, {reviewBreakdown.rough} Off. How do you think the week was?
                </Text>
                <TextInput
                  value={weeklyReviewDraft}
                  onChangeText={setWeeklyReviewDraft}
                  placeholder="A few sentences. What landed, what didn't."
                  placeholderTextColor={theme.textSub}
                  multiline
                  autoFocus
                  style={[{
                    backgroundColor: theme.bg, color: theme.textMain, padding: 14, borderRadius: 12,
                    minHeight: 120, fontSize: 15, fontWeight: '500', lineHeight: 21,
                    textAlignVertical: 'top', marginBottom: 12, borderWidth: 1, borderColor: theme.border,
                  }, persianSafeInputStyle, rtlInputStyle(weeklyReviewDraft)]}
                />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => setWeeklyReviewOpen(false)} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                    <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '800' }}>Later</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      const text = weeklyReviewDraft.trim();
                      const anchor = reviewWindow.anchor;
                      // Save the review into the Notes tab as a regular note.
                      const note: Note = {
                        id: `wr_${anchor}`,
                        title: `Weekly review — week ending ${anchor}`,
                        // Tag every auto-saved review with a shared group so they
                        // surface a chip on the card and cluster under one filter
                        // ("Weekly Review") in the Notes tab.
                        group: 'weekly review',
                        content: `${reviewBreakdown.strong} Strong · ${reviewBreakdown.ok} Steady · ${reviewBreakdown.rough} Off\n\n${text}`,
                        color: '#82AAFF',
                        createdAt: Date.now(),
                        isPinned: false,
                        isLocked: false,
                        order: -Date.now(),
                        status: 'active',
                      };
                      addOrUpdateNote(note);
                      incrementTotalNotesCreated();
                      // Record the close so the prompt hides + survives reloads.
                      addWeeklyReflection({ id: anchor, weekKey: anchor, endedOn: anchor, text, createdAt: Date.now() });
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      setWeeklyReviewDraft('');
                      setWeeklyReviewOpen(false);
                    }}
                    style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.textMain, alignItems: 'center' }}
                  >
                    <Text style={{ color: theme.bg, fontSize: 13, fontWeight: '900', letterSpacing: 0.3 }}>Save to Notes</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>

          {/* DELETE MODAL */}
          {deleteConfirmId && (() => {
            const isDissolve = deleteConfirmId === '__PACT_DISSOLVE__';
            // Deleting a habit that's part of the active Pact: warn, and state the
            // consequence. deleteHabit (store) prunes the Pact down one level — or
            // dissolves it if this was the last habit — so no dead id is left.
            const inPact = !isDissolve && !!pact?.habits?.some(ph => ph.id === deleteConfirmId);
            const lastInPact = inPact && pact!.habits.length === 1;
            const title = isDissolve ? "Dissolve The Pact" : inPact ? "Delete a Pact habit?" : "Obliterate Habit";
            const message = isDissolve
              ? "This will end The Pact and erase all progress. Your habits stay, but the commitment is gone."
              : lastInPact
                ? `This is the only habit in your Level ${pact!.level} Pact — deleting it dissolves the Pact. The habit and its history are erased.`
                : inPact
                  ? `This habit is part of your Level ${pact!.level} Pact. Deleting it drops the Pact to Level ${pact!.level - 1} (the other habits carry on). The habit and its history are erased.`
                  : "Are you sure? This will permanently delete this habit and erase all its history.";
            return (
              <CustomConfirmModal
                visible={!!deleteConfirmId}
                title={title}
                message={message}
                destructiveLabel={isDissolve ? "Dissolve" : "Purge"} theme={theme}
                onCancel={() => setDeleteConfirmId(null)}
                onConfirm={() => {
                  if (isDissolve) {
                    setPact(undefined); pactDecisionShown.current = false;
                    showWhisper("Pact dissolved. The record remains.");
                  } else {
                    deleteHabit(deleteConfirmId); closeSheet();
                  }
                  setDeleteConfirmId(null);
                }}
              />
            );
          })()}

          {/* RETIRE MODAL — honor a finished habit. Both choices keep its frozen
              score in the grade; the choice is only whether to memorialize it on
              the Retired screen ("Keep") or quietly set it down ("Vanish"). */}
          {retireTarget && (
            <Modal visible transparent animationType="fade" onRequestClose={() => setRetireTarget(null)}>
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
                <View style={{ backgroundColor: theme.surface, width: '100%', maxWidth: 360, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.border }}>
                  <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: hexToRgba(retireTarget.color, 0.15), justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                    <Feather name="award" size={24} color={retireTarget.color} />
                  </View>
                  <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: '900', marginBottom: 8 }}>Retire this habit?</Text>
                  <Text style={{ color: theme.textSub, fontSize: 14, lineHeight: 22, marginBottom: 22 }}>It leaves your active list, but the strength it earned stays in your grade — that effort happened. Keep it as a trophy, or set it down quietly.</Text>
                  <TouchableOpacity
                    onPress={() => { const id = retireTarget.id; setRetireTarget(null); setDetailHabit(null); retireHabit(id, true, getFormatDateStr()); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
                    style={{ paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: retireTarget.color, marginBottom: 10 }}
                  >
                    <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 14 }}>Keep as a trophy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { const id = retireTarget.id; setRetireTarget(null); setDetailHabit(null); retireHabit(id, false, getFormatDateStr()); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
                    style={{ paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, marginBottom: 10 }}
                  >
                    <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 14 }}>Vanish it</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setRetireTarget(null)} style={{ paddingVertical: 10, alignItems: 'center' }}>
                    <Text style={{ color: theme.textSub, fontWeight: '700', fontSize: 13 }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          )}

          {/* ── STRENGTH HISTORY MODAL ── */}
          <Modal visible={showStrengthHistory} transparent animationType="fade" onRequestClose={() => setShowStrengthHistory(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
              {/* Backdrop is a sibling BEHIND the sheet: tapping outside closes, but
                  taps on the sheet don't reach it — so the sheet can be a plain View
                  instead of a Pressable, which was swallowing the list's scroll. */}
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowStrengthHistory(false)} />
              <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 28, paddingBottom: 48, paddingHorizontal: 28, minHeight: '62%', maxHeight: '88%' }}>
                {(() => {
                  // Mirror calculateGlobalStrength: active (live scores) + kept
                  // retired (frozen) count toward the grade; vanished retired and
                  // archived (long-paused) are excluded. Keeps the modal's number
                  // consistent with the header grade chip.
                  const active = habits.filter(h => h.status === 'active');
                  const retired = habits.filter(h => h.status === 'retired' && !h.vanished);
                  const counted = [...active, ...retired];
                  if (counted.length === 0) {
                    return (
                      <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                        <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: '600' }}>No habits yet.</Text>
                      </View>
                    );
                  }

                  // Compute 30-day history — global strength score as-of each day
                  const today = new Date();
                  const points: { day: number; score: number; dateStr: string }[] = [];
                  for (let i = 29; i >= 0; i--) {
                    const d = new Date(today);
                    d.setDate(today.getDate() - i);
                    const dStr = getFormatDateStr(d);
                    const scores = counted
                      .filter(h => new Date(h.createdAt) <= d)
                      .map(h => calculateStrengthScore(h, dStr));
                    const avg = scores.length === 0 ? 0 : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
                    points.push({ day: 29 - i, score: avg, dateStr: dStr });
                  }

                  const current = points[points.length - 1].score;
                  const past = points[0].score;
                  const diff = current - past;
                  const diffLabel = diff > 0 ? `+${diff}` : `${diff}`;
                  const diffColor = diff > 0 ? theme.success : diff < 0 ? theme.danger : theme.textSub;

                  const max = Math.max(100, ...points.map(p => p.score));

                  return (
                    <>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                        <View>
                          <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Strength</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
                            <Text style={{ color: current >= 80 ? theme.success : current >= 50 ? theme.textMain : theme.danger, fontSize: 56, fontWeight: '900', letterSpacing: -3 }}>{current}%</Text>
                            <Text style={{ color: diffColor, fontSize: 14, fontWeight: '800' }}>{diffLabel} <Text style={{ color: theme.textSub, fontWeight: '600' }}>in 30 days</Text></Text>
                          </View>
                        </View>
                        <TouchableOpacity onPress={() => setShowStrengthHistory(false)} hitSlop={15}>
                          <Feather name="x" size={22} color={theme.textSub} />
                        </TouchableOpacity>
                      </View>

                      {/* Sparkline — vertical bars */}
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 2, marginBottom: 10 }}>
                        {points.map(p => {
                          const color = p.score >= 80 ? theme.success : p.score >= 50 ? theme.textSub : theme.danger;
                          return <View key={p.day} style={{ flex: 1, height: `${Math.max(2, (p.score / max) * 100)}%`, backgroundColor: color, opacity: 0.75, borderRadius: 1 }} />;
                        })}
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
                        <Text style={{ fontSize: 10, color: theme.textSub, opacity: 0.5, fontWeight: '700' }}>30 days ago</Text>
                        <Text style={{ fontSize: 10, color: theme.textSub, opacity: 0.5, fontWeight: '700' }}>today</Text>
                      </View>

                      {/* Per-habit breakdown — sortable, so weak habits surface
                          on their own (this replaced the nagging weekly review). */}
                      {(() => {
                        const scoredHabits = active
                          .map(h => ({ h, s: calculateStrengthScore(h, getFormatDateStr()) }))
                          .sort((a, b) => strengthSortAsc ? a.s - b.s : b.s - a.s);
                        return (
                          <>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' }}>By habit</Text>
                              <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStrengthSortAsc(v => !v); }} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <Feather name={strengthSortAsc ? 'arrow-up' : 'arrow-down'} size={11} color={theme.textSub} />
                                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '800', letterSpacing: 0.3 }}>{strengthSortAsc ? 'Lowest first' : 'Highest first'}</Text>
                              </TouchableOpacity>
                            </View>
                            {/* Only the habit list scrolls — score + sparkline above stay
                                fixed. flexShrink lets it shrink to fit inside the sheet's
                                bounded (maxHeight) height, giving it a definite frame to
                                scroll within instead of overflowing off-screen. */}
                            <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator nestedScrollEnabled contentContainerStyle={{ gap: 10 }}>
                              {scoredHabits.map(({ h, s }) => {
                                const c = s >= 80 ? h.color : s >= 50 ? theme.textSub : theme.danger;
                                return (
                                  <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                    <Feather name={h.icon} size={14} color={h.color} />
                                    <Text style={{ flex: 1, color: theme.textMain, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{h.title}</Text>
                                    <View style={{ width: 80, height: 4, borderRadius: 2, backgroundColor: theme.border, overflow: 'hidden' }}>
                                      <View style={{ width: `${s}%`, height: '100%', backgroundColor: c }} />
                                    </View>
                                    <Text style={{ color: c, fontSize: 12, fontWeight: '900', minWidth: 36, textAlign: 'right' }}>{s}%</Text>
                                  </View>
                                );
                              })}
                              {/* All retired habits collapse into ONE muted row —
                                  their earned score still counts toward the grade,
                                  but they're a single "done" line, not clutter. */}
                              {retired.length > 0 && (() => {
                                const rScores = retired.map(h => calculateStrengthScore(h, getFormatDateStr()));
                                const rAvg = rScores.length ? Math.round(rScores.reduce((a, b) => a + b, 0) / rScores.length) : 0;
                                return (
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border }}>
                                    <Feather name="award" size={14} color={theme.textSub} />
                                    <Text style={{ flex: 1, color: theme.textSub, fontSize: 13, fontWeight: '800', fontStyle: 'italic' }} numberOfLines={1}>Retired · {retired.length}</Text>
                                    <View style={{ width: 80, height: 4, borderRadius: 2, backgroundColor: theme.border, overflow: 'hidden' }}>
                                      <View style={{ width: `${rAvg}%`, height: '100%', backgroundColor: theme.textSub }} />
                                    </View>
                                    <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '900', minWidth: 36, textAlign: 'right' }}>{rAvg}%</Text>
                                  </View>
                                );
                              })()}
                            </ScrollView>
                          </>
                        );
                      })()}
                    </>
                  );
                })()}
              </View>
            </View>
          </Modal>

          {/* ── NOTE DELETE CONFIRMATION ── */}
          <Modal visible={!!noteDeleteTarget} transparent animationType="fade" onRequestClose={() => setNoteDeleteTarget(null)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
              <View style={{ backgroundColor: theme.surface, width: '100%', maxWidth: 340, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.border }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: hexToRgba(theme.danger, 0.15), justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                  <Feather name="alert-triangle" size={24} color={theme.danger} />
                </View>
                <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: '900', marginBottom: 8 }}>Delete Note</Text>
                <Text style={{ color: theme.textSub, fontSize: 14, lineHeight: 22, marginBottom: 24 }}>Remove this completion note? This cannot be undone.</Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity onPress={() => setNoteDeleteTarget(null)} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}>
                    <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 14 }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => {
                    if (noteDeleteTarget) {
                      setHabitCompletionNote(noteDeleteTarget.habitId, noteDeleteTarget.dateStr, '');
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      // Refresh detail view
                      const fresh = useAppStore.getState().habits.find(h => h.id === noteDeleteTarget.habitId);
                      if (fresh && detailHabit) setDetailHabit({ ...fresh });
                    }
                    setNoteDeleteTarget(null);
                  }} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: theme.danger }}>
                    <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 14 }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* ── COMPLETION NOTE MODAL ── */}
          <Modal visible={!!noteModal} transparent animationType="fade" onRequestClose={() => setNoteModal(null)}>
            <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 }} onPress={() => setNoteModal(null)}>
              <Pressable onPress={() => {}} style={{ backgroundColor: theme.surface, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.border }}>
                <Text style={{ color: theme.textMain, fontSize: 18, fontWeight: '900', marginBottom: 4 }}>Completion Note</Text>
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginBottom: 16 }}>{noteModal ? (() => {
                  const [y, m, d] = noteModal.dateStr.split('-').map(Number);
                  const date = new Date(y, m - 1, d);
                  if (calendarType === 'shamsi') { const p = getShamsiDateParts(date); return `${p.day} ${S_MONTHS[p.month - 1].slice(0, 3)} ${p.year}`; }
                  return `${d} ${G_MONTHS[m - 1]} ${y}`;
                })() : ''}</Text>
                <View style={{ backgroundColor: theme.bg, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 16, minHeight: 100, marginBottom: 20 }}>
                  <TextInput
                    value={noteModal?.text || ''}
                    onChangeText={(t) => setNoteModal(prev => prev ? { ...prev, text: t } : null)}
                    placeholder="How did it go?"
                    placeholderTextColor={theme.textSub + '80'}
                    style={[{ color: theme.textMain, fontSize: 15, fontWeight: '500', lineHeight: 24, textAlignVertical: 'top', textAlign: (noteModal?.text && /[\u0600-\u06FF]/.test(noteModal.text)) ? 'right' : 'auto' }, persianSafeInputStyle]}
                    multiline
                    maxLength={200}
                    autoFocus
                  />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
                  <Pressable onPress={() => setNoteModal(null)} style={{ paddingHorizontal: 20, paddingVertical: 12, borderRadius: 100 }}>
                    <Text style={{ color: theme.textSub, fontWeight: '800', fontSize: 14 }}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={saveCompletionNote} style={{ paddingHorizontal: 20, paddingVertical: 12, borderRadius: 100, backgroundColor: theme.textMain }}>
                    <Text style={{ color: theme.bg, fontWeight: '900', fontSize: 14 }}>Save</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </Modal>

          {/* ── GORHOM STORAGE SHEET ── */}
          <BottomSheetModal ref={storageSheetRef} snapPoints={snapPoints} enableDynamicSizing={false} index={0} topInset={insets.top} onChange={setStorageIndex} backdropComponent={renderBackdrop} backgroundStyle={{ backgroundColor: theme.bg, borderRadius: 32 }} handleIndicatorStyle={{ backgroundColor: theme.border, width: 40, height: 5 }}>
            <View style={{ paddingHorizontal: 24, paddingTop: 10, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 28, fontWeight: '900', color: theme.textMain, letterSpacing: -1 }}>Storage.</Text>
              <TouchableOpacity onPress={closeStorage} hitSlop={15}><Feather name="x" size={24} color={theme.textMain} /></TouchableOpacity>
            </View>
            {/* Segmented tabs — Trophies (retired, merged in here) / Active / Paused. */}
            <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 24, marginBottom: 18 }}>
              {([['trophies', 'Trophies', retiredHabits.length], ['active', 'Active', storageActive.length], ['paused', 'Paused', storageArchived.length]] as const).map(([key, label, count]) => {
                const on = storageTab === key;
                return (
                  <TouchableOpacity key={key} onPress={() => { setStorageTab(key); setBringBackId(null); }} style={{ flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: 'center', backgroundColor: on ? theme.textMain : theme.surface, borderWidth: 1, borderColor: on ? theme.textMain : theme.border }}>
                    <Text style={{ color: on ? theme.bg : theme.textSub, fontWeight: '800', fontSize: 13 }}>{label}</Text>
                    <Text style={{ color: on ? theme.bg : theme.textSub, fontSize: 10, fontWeight: '700', opacity: 0.7, marginTop: 1 }}>{count}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
              {/* TROPHIES — retired habits as medallions; long-press one to Bring back. */}
              {storageTab === 'trophies' && (
                retiredHabits.length === 0
                  ? <View style={{ alignItems: 'center', marginTop: 40 }}><Feather name="award" size={40} color={theme.textSub} style={{ opacity: 0.2 }} /></View>
                  : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                      {retiredHabits.map((h: Habit) => {
                        const totalDays = new Set(h.history).size;
                        const best = longestRun(h.history);
                        return (
                          <TouchableOpacity key={h.id} onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setBringBackId(bringBackId === h.id ? null : h.id); }} delayLongPress={400} activeOpacity={0.85} style={{ width: '47%', padding: 14, borderRadius: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: hexToRgba(h.color, 0.15), alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}><Feather name="award" size={25} color={h.color} /></View>
                            <Text numberOfLines={1} style={{ color: theme.textMain, fontSize: 13.5, fontWeight: '800', marginBottom: 8 }}>{h.title}</Text>
                            {bringBackId === h.id ? (
                              <TouchableOpacity onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); unretireHabit(h.id, getFormatDateStr()); setBringBackId(null); }} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.textMain }}>
                                <Text style={{ color: theme.bg, fontSize: 11, fontWeight: '900' }}>Bring back</Text>
                              </TouchableOpacity>
                            ) : (
                              <View style={{ flexDirection: 'row', gap: 12 }}>
                                <View style={{ alignItems: 'center' }}><Text style={{ color: h.color, fontSize: 15, fontWeight: '900' }}>{best}</Text><Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '700' }}>BEST</Text></View>
                                <View style={{ width: 1, backgroundColor: theme.border }} />
                                <View style={{ alignItems: 'center' }}><Text style={{ color: theme.textMain, fontSize: 15, fontWeight: '900' }}>{totalDays}</Text><Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '700' }}>DAYS</Text></View>
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
              )}
              {/* ACTIVE — tap to edit, archive, or delete (only if never completed). */}
              {storageTab === 'active' && (
                storageActive.length === 0
                  ? <View style={{ alignItems: 'center', marginTop: 40 }}><Feather name="list" size={40} color={theme.textSub} style={{ opacity: 0.2 }} /></View>
                  : storageActive.map((h: Habit) => (
                      <View key={h.id} style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center' }}>
                        <TouchableOpacity style={{ flex: 1 }} onPress={() => { closeStorage(); openSheet(h); }}>
                          <Text style={{ color: theme.textMain, fontSize: 16, fontWeight: '800' }}>{h.title}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                            <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' }}>{h.timeBlock}</Text>
                            <Feather name="edit-2" size={10} color={theme.textSub} />
                          </View>
                        </TouchableOpacity>
                        <View style={{ flexDirection: 'row', gap: 12 }}>
                          <TouchableOpacity onPress={() => updateHabitStatus(h.id, 'archived')} hitSlop={15} style={{ padding: 8, backgroundColor: theme.bg, borderRadius: 8 }}><Feather name="archive" size={18} color={theme.textSub} /></TouchableOpacity>
                          {h.history.length === 0 && <TouchableOpacity onPress={() => setDeleteConfirmId(h.id)} hitSlop={15} style={{ padding: 8, backgroundColor: theme.bg, borderRadius: 8 }}><Feather name="trash-2" size={18} color={theme.danger} /></TouchableOpacity>}
                        </View>
                      </View>
                    ))
              )}
              {/* PAUSED — archived; restore or delete (only if never completed). */}
              {storageTab === 'paused' && (
                storageArchived.length === 0
                  ? <View style={{ alignItems: 'center', marginTop: 40 }}><Feather name="archive" size={40} color={theme.textSub} style={{ opacity: 0.2 }} /></View>
                  : storageArchived.map((h: Habit) => (
                      <View key={h.id} style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.textMain, fontSize: 16, fontWeight: '800' }}>{h.title}</Text>
                          <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', textTransform: 'capitalize', marginTop: 4 }}>{h.timeBlock}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 12 }}>
                          <TouchableOpacity onPress={() => updateHabitStatus(h.id, 'active')} hitSlop={15} style={{ padding: 8, backgroundColor: theme.bg, borderRadius: 8 }}><Feather name="refresh-ccw" size={18} color={theme.success} /></TouchableOpacity>
                          {h.history.length === 0 && <TouchableOpacity onPress={() => setDeleteConfirmId(h.id)} hitSlop={15} style={{ padding: 8, backgroundColor: theme.bg, borderRadius: 8 }}><Feather name="trash-2" size={18} color={theme.danger} /></TouchableOpacity>}
                        </View>
                      </View>
                    ))
              )}
            </BottomSheetScrollView>
          </BottomSheetModal>

          {/* ── EDIT HABIT — pageSheet Modal (Persian-safe, stable layout, keyboard handled by KeyboardAvoidingView) ── */}
          <Modal
            visible={habitModalVisible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => {
              setHabitModalVisible(false);
              // Refresh detail view with latest habit data if it's open
              if (detailHabit) {
                const h = useAppStore.getState().habits.find(hb => hb.id === detailHabit.id);
                if (h) setDetailHabit({ ...h });
              }
            }}
            onDismiss={() => {
              if (detailHabit) {
                const h = useAppStore.getState().habits.find(hb => hb.id === detailHabit.id);
                if (h) setDetailHabit({ ...h });
              }
            }}
          >
            <View style={{ flex: 1, backgroundColor: theme.surface }}>
              <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.bg }}>
                  <Pressable hitSlop={15} onPress={closeSheet}>
                    <Text style={{ color: theme.textSub, fontWeight: '800', fontSize: 16 }}>Cancel</Text>
                  </Pressable>
                  <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>{editingId ? 'EDIT HABIT' : 'NEW HABIT'}</Text>
                  <Pressable onPress={saveHabit} style={{ backgroundColor: theme.textMain, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100 }}>
                    <Text style={{ color: theme.bg, fontWeight: '900', fontSize: 13 }}>Commit</Text>
                  </Pressable>
                </View>
            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 16, paddingBottom: 60, paddingHorizontal: 24 }} keyboardShouldPersistTaps="handled">
              
              <TextInput style={[{ fontSize: 28, fontWeight: '900', marginBottom: 12, color: theme.textMain }, persianSafeInputStyle]} placeholder="What's the habit?" placeholderTextColor={theme.textSub} value={newTitle} onChangeText={setNewTitle} />

              <TextInput style={[{ fontSize: 15, fontWeight: '500', lineHeight: 22, marginBottom: 24, color: theme.textSub }, persianSafeInputStyle]} placeholder="Why it matters (optional)" placeholderTextColor={theme.textSub} value={newDescription} onChangeText={setNewDescription} multiline maxLength={200} />

              <View style={{flexDirection: 'row', gap: 15, marginBottom: 30}}>
                <View style={{flex: 1}}>
                  <Text style={{ fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, color: theme.textSub, marginBottom: 8 }}>Daily Target</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDarkMode ? '#111' : '#F0F0F0', borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNewTargetCount(prev => Math.max(1, parseInt(prev||'1') - 1).toString()); }} style={{ padding: 12 }}><Feather name="minus" size={20} color={theme.textMain} /></Pressable>
                    <TextInput style={{ flex: 1, color: theme.textMain, fontSize: 18, fontWeight: '800', textAlign: 'center' }} value={newTargetCount} onChangeText={(val) => setNewTargetCount(val.replace(/[^0-9]/g, ''))} keyboardType="numeric" />
                    <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNewTargetCount(prev => (parseInt(prev||'1') + 1).toString()); }} style={{ padding: 12 }}><Feather name="plus" size={20} color={theme.textMain} /></Pressable>
                  </View>
                </View>
                <View style={{flex: 1}}>
                  <Text style={{ fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, color: theme.textSub, marginBottom: 8 }}>Unit</Text>
                  <TextInput style={[{ fontSize: 16, fontWeight: '700', paddingHorizontal: 16, borderRadius: 14, backgroundColor: isDarkMode ? '#111' : '#F0F0F0', color: theme.textMain, flex: 1, paddingVertical: 0 }, persianSafeInputStyle]} placeholder="e.g. ml" placeholderTextColor={theme.textSub} value={newUnit} onChangeText={setNewUnit} />
                </View>
              </View>

              <View style={{ marginBottom: 30 }}>
                <Text style={{ fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, color: theme.textSub, marginBottom: 12 }}>Time Block</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  {TIME_BLOCKS.map(block => {
                    const isSelected = newTimeBlock === block.id;
                    return (
                      <Pressable key={block.id} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNewTimeBlock(block.id); }} style={{ width: '48%', padding: 16, borderRadius: 20, borderWidth: 1, backgroundColor: isSelected ? theme.textMain : theme.bg, borderColor: isSelected ? theme.textMain : theme.border }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}><Feather name={block.icon} size={22} color={isSelected ? theme.bg : theme.textSub} />{isSelected && <Feather name="check-circle" size={16} color={theme.bg} />}</View>
                        <Text style={{ color: isSelected ? theme.bg : theme.textMain, fontSize: 16, fontWeight: '800', marginTop: 12 }}>{block.label}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>

              <View style={{ marginBottom: 30 }}>
                <Text style={{ fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, color: theme.textSub, marginBottom: 12 }}>How Often?</Text>
                <View style={{ flexDirection: 'row', backgroundColor: theme.bg, padding: 4, borderRadius: 12, borderWidth: 1, borderColor: theme.border, marginBottom: 16 }}>
                  {(['days', 'interval'] as const).map(type => (
                    <Pressable key={type} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNewScheduleType(type); }} style={{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: newScheduleType === type ? theme.surface : 'transparent', borderRadius: 8 }}>
                      <Text style={{ color: newScheduleType === type ? theme.textMain : theme.textSub, fontWeight: '800', fontSize: 13, textTransform: 'capitalize' }}>{type === 'days' ? 'Specific Days' : 'Intervals'}</Text>
                    </Pressable>
                  ))}
                </View>
                
                <View>
                  {newScheduleType === 'days' ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                      {UI_DAYS.map(day => {
                        const isSelected = newFrequency.includes(day);
                        return (
                          <Pressable key={day} onPress={() => handleFrequencyToggle(day)} style={{ paddingHorizontal: 0, paddingVertical: 10, borderRadius: 12, width: '22%', minWidth: 60, alignItems: 'center', borderWidth: 1, backgroundColor: isSelected ? theme.textMain : theme.bg, borderColor: isSelected ? theme.textMain : theme.border }}>
                            <Text style={{ color: isSelected ? theme.bg : theme.textSub, fontWeight: '800', fontSize: 12, textTransform: 'uppercase' }}>{day}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  ) : (
                    <View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bg, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 16 }}>
                        <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 16, flex: 1 }}>Every</Text>
                        <TextInput style={{ fontSize: 16, fontWeight: '700', paddingHorizontal: 16, borderRadius: 14, backgroundColor: isDarkMode ? '#111' : '#F0F0F0', color: theme.textMain, width: 80, textAlign: 'center', paddingVertical: 8, marginHorizontal: 12 }} value={newIntervalDays} onChangeText={setNewIntervalDays} keyboardType="numeric" />
                        <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 16, flex: 1 }}>Days</Text>
                      </View>
                      <Text style={{ fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, color: theme.textSub, marginTop: 16, marginBottom: 8 }}>Starting From:</Text>
                      <GHScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 5 }}>
                        {next14Days.map(date => {
                          const dStr = getFormatDateStr(date);
                          const isSelected = newStartDate === dStr;
                          const isToday = dStr === getFormatDateStr(new Date());
                          const dateNum = calendarType === 'shamsi' ? getShamsiDateParts(date).day : date.getDate();
                          return (
                            <Pressable key={dStr} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNewStartDate(dStr); }} style={{ paddingVertical: 10, borderRadius: 12, borderWidth: 1, width: 'auto', paddingHorizontal: 16, backgroundColor: isSelected ? theme.textMain : theme.surface, borderColor: isSelected ? theme.textMain : theme.border, alignItems: 'center' }}>
                              <Text style={{ color: isSelected ? theme.bg : theme.textSub, fontWeight: '800', fontSize: 10, textTransform: 'uppercase' }}>{isToday ? 'Today' : JS_DAYS[date.getDay()]}</Text>
                              <Text style={{ color: isSelected ? theme.bg : theme.textMain, fontWeight: '900', fontSize: 16, marginTop: 2 }}>{dateNum}</Text>
                            </Pressable>
                          )
                        })}
                      </GHScrollView>
                    </View>
                  )}
                </View>
              </View>

              <View style={{ marginBottom: 30 }}>
                <Text style={{ fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, color: theme.textSub, marginBottom: 12 }}>Appearance</Text>
                <ColorPicker colors={PALETTE} value={newColor} onChange={setNewColor} ringColor={theme.textMain} borderColor={theme.border} style={{ marginBottom: 20 }} />
                <GHScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                  {ICONS.map(i => (
                    <Pressable key={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNewIcon(i); }} style={{ padding: 12, backgroundColor: newIcon === i ? theme.textMain : theme.bg, borderRadius: 14, borderWidth: 1, borderColor: newIcon === i ? theme.textMain : theme.border }}>
                      <Feather name={i} size={22} color={newIcon === i ? theme.bg : theme.textSub} />
                    </Pressable>
                  ))}
                </GHScrollView>
              </View>

              <View>
                <Text style={{ fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, color: theme.textSub, marginBottom: 12 }}>Alert</Text>
                <View style={{ backgroundColor: theme.bg, borderRadius: 16, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' }}>
                  <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNewHasReminder(!newHasReminder); }} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Feather name="bell" size={20} color={newHasReminder ? theme.textMain : theme.textSub} /><Text style={{ color: theme.textMain, fontSize: 16, fontWeight: '700' }}>Send Notification</Text></View>
                    <View style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: newHasReminder ? theme.textMain : theme.surface, borderWidth: 1, borderColor: theme.border, justifyContent: 'center', paddingHorizontal: 2 }}>
                      <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: newHasReminder ? theme.bg : theme.textSub, alignSelf: newHasReminder ? 'flex-end' : 'flex-start' }} />
                    </View>
                  </Pressable>
                  {newHasReminder && (
                    <View style={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 5, borderTopWidth: 1, borderTopColor: theme.border }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15 }}>
                        <Text style={{ color: theme.textSub, fontWeight: '800', flex: 1 }}>Time (24h)</Text>
                        <TextInput 
                          style={{ fontSize: 16, fontWeight: '700', paddingHorizontal: 16, borderRadius: 14, backgroundColor: isDarkMode ? '#111' : '#F0F0F0', color: theme.textMain, width: 90, textAlign: 'center', paddingVertical: 8 }} 
                          placeholder="08:30" 
                          placeholderTextColor={theme.textSub} 
                          value={newReminderTime} 
                          onChangeText={handleReminderTimeChange} 
                          onBlur={() => setNewReminderTime(parseTimeString(newReminderTime))} 
                          keyboardType="numeric" 
                        />
                      </View>
                    </View>
                  )}
                </View>
              </View>

              {editingId && (() => {
                // Habits with real history can only be Retired (progress is
                // respected); only a blank, never-completed habit can be Removed.
                const editingHabit = useAppStore.getState().habits.find(h => h.id === editingId);
                const hasHistory = (editingHabit?.history?.length || 0) > 0;
                if (hasHistory) {
                  return (
                    <TouchableOpacity
                      style={{ marginTop: 24, padding: 16, backgroundColor: theme.surface, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: theme.border }}
                      onPress={() => { closeSheet(); if (editingHabit) setRetireTarget(editingHabit); }}
                    >
                      <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 16 }}>Retire Habit</Text>
                    </TouchableOpacity>
                  );
                }
                return (
                  <TouchableOpacity
                    style={{ marginTop: 24, padding: 16, backgroundColor: theme.danger + '15', borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: theme.danger + '30' }}
                    onPress={() => { setDeleteConfirmId(editingId); }}
                  >
                    <Text style={{ color: theme.danger, fontWeight: '800', fontSize: 16 }}>Remove Habit</Text>
                  </TouchableOpacity>
                );
              })()}

              </ScrollView>
            </KeyboardAvoidingView>
              </SafeAreaView>
            </View>
          </Modal>


          {/* ── HABIT DETAIL VIEW — positioned overlay so BottomSheet edit can stack above it ── */}
          {detailHabit && (() => {
              const dh = useAppStore.getState().habits.find(h => h.id === detailHabit.id) || detailHabit;
              const dhStrength = calculateStrengthScore(dh, getFormatDateStr());
              const dhStreak = calculateStreak(dh);
              const dhCreated = new Date(dh.createdAt);
              const dhDaysActive = diffInDays(getFormatDateStr(dhCreated), getFormatDateStr());
              const dhTotalCompletions = dh.history.length;
              const dhNotes = Object.entries(dh.completionNotes || {}).sort(([a], [b]) => b.localeCompare(a));

              // Cross-tab: challenges that link this habit (only active ones worth showing).
              // Reads the new `links` model, with a legacy linkedHabitIds fallback for
              // any challenge not yet migrated.
              const linkedChallenges = (useAppStore.getState().challenges || []).filter(
                c => (c.links?.some(l => l.habitId === dh.id) || c.linkedHabitIds?.includes(dh.id)) && c.deadState === 'active'
              );

              // Format a YYYY-MM-DD string according to the active calendar
              const formatCalDate = (dateStr: string) => {
                const [y, m, d] = dateStr.split('-').map(Number);
                const date = new Date(y, m - 1, d);
                if (calendarType === 'shamsi') {
                  const parts = getShamsiDateParts(date);
                  return `${parts.day} ${S_MONTHS[parts.month - 1].slice(0, 3)} ${parts.year}`;
                }
                return `${d} ${G_MONTHS[m - 1]} ${y}`;
              };

              return (
                <Animated.View entering={FadeInDown.duration(260)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.bg, zIndex: 50 }}>
                  <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                    {/* Header */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                      <TouchableOpacity onPress={() => setDetailHabit(null)} hitSlop={15} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Feather name="chevron-left" size={22} color={theme.textMain} />
                        <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: '700' }}>Habits</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => { openSheet(dh); }} style={{ backgroundColor: theme.surface, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100, borderWidth: 1, borderColor: theme.border }}>
                        <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 13 }}>Edit</Text>
                      </TouchableOpacity>
                    </View>

                    <GHScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingBottom: 120 }}>
                      {/* Title + icon */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: hexToRgba(dh.color, 0.15), justifyContent: 'center', alignItems: 'center' }}>
                          <Feather name={dh.icon} size={24} color={dh.color} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.textMain, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 }}>{dh.title}</Text>
                          <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', marginTop: 2 }}>{dh.targetCount} {dh.unit} • {dh.timeBlock} • {dhDaysActive}d active</Text>
                        </View>
                      </View>

                      {/* Description — the "why", shown only when set */}
                      {dh.description ? (
                        <Text style={{ color: theme.textMain, fontSize: 15, fontWeight: '500', lineHeight: 22, marginBottom: 24, opacity: 0.85 }}>{dh.description}</Text>
                      ) : null}

                      {/* Strength Score — large */}
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
                        <View style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 16, paddingVertical: 18, paddingHorizontal: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 32, fontWeight: '900', color: dhStrength >= 80 ? dh.color : dhStrength >= 50 ? theme.textSub : theme.danger }}>{dhStrength}%</Text>
                          <Text numberOfLines={1} style={{ fontSize: 10, fontWeight: '700', color: theme.textSub, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Strength</Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 16, paddingVertical: 18, paddingHorizontal: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 32, fontWeight: '900', color: dhStreak > 0 ? '#FF8C00' : theme.textSub }}>{dhStreak}</Text>
                          <Text numberOfLines={1} style={{ fontSize: 10, fontWeight: '700', color: theme.textSub, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Streak</Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 16, paddingVertical: 18, paddingHorizontal: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 32, fontWeight: '900', color: theme.textMain }}>{dhTotalCompletions}</Text>
                          <Text numberOfLines={1} style={{ fontSize: 10, fontWeight: '700', color: theme.textSub, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total</Text>
                        </View>
                      </View>

                      {/* 30-day strip — larger version */}
                      <View style={{ marginBottom: 24 }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: theme.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Last 30 days</Text>
                        <View style={{ flexDirection: 'row', gap: 3, flexWrap: 'nowrap' }}>
                          {Array.from({ length: 30 }).map((_, i) => {
                            const d = new Date(); d.setDate(d.getDate() - (29 - i));
                            const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                            const count = dh.history.filter((h: string) => h === dStr).length;
                            const isDone = count >= dh.targetCount;
                            const isRest = dh.restDays?.includes(dStr);
                            const isSkip = dh.skippedDays?.includes(dStr);
                            const isFut = dStr > getFormatDateStr();
                            const color = isFut ? theme.border + '30' : isDone ? dh.color : isRest ? theme.freeze + '60' : isSkip ? theme.danger + '60' : theme.border + '40';
                            return <View key={i} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: color }} />;
                          })}
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                          <Text style={{ fontSize: 9, fontWeight: '700', color: theme.textSub, opacity: 0.5 }}>30d ago</Text>
                          <Text style={{ fontSize: 9, fontWeight: '700', color: theme.textSub, opacity: 0.5 }}>Today</Text>
                        </View>
                      </View>

                      {/* Schedule info */}
                      <View style={{ backgroundColor: theme.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: theme.border, marginBottom: 24 }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: theme.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Schedule</Text>
                        <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '600' }}>
                          {dh.scheduleType === 'interval' ? `Every ${dh.intervalDays} days` : dh.frequency.length === 0 || dh.frequency.length === 7 ? 'Every day' : dh.frequency.join(', ')}
                        </Text>
                        {dh.hasReminder && <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginTop: 4 }}>Reminder at {dh.reminderTime}</Text>}
                      </View>

                      {/* Linked challenges — cross-tab reference */}
                      {linkedChallenges.length > 0 && (
                        <View style={{ marginBottom: 24 }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: theme.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Powers</Text>
                          {linkedChallenges.map(c => (
                            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: theme.border, borderLeftWidth: 3, borderLeftColor: c.color, marginBottom: 8 }}>
                            <Feather name="award" size={16} color={c.color} />
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '800' }} numberOfLines={1}>{c.title}</Text>
                              <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600', marginTop: 2 }}>{c.current}/{c.target} {c.unit}</Text>
                            </View>
                            <View style={{ width: 60, height: 3, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden' }}>
                              <View style={{ width: `${Math.min(100, (c.current / c.target) * 100)}%`, height: '100%', backgroundColor: c.color }} />
                            </View>
                          </View>
                          ))}
                        </View>
                      )}

                      {/* Completion notes */}
                      {dhNotes.length > 0 && (
                        <View style={{ marginBottom: 24 }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: theme.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Notes</Text>
                          {dhNotes.slice(0, 10).map(([date, note]) => {
                            const noteIsRtl = /[\u0600-\u06FF]/.test(note);
                            const daysSince = diffInDays(date, getFormatDateStr());
                            const isEditable = daysSince <= 3;
                            return (
                              <Pressable
                                key={date}
                                onPress={() => {
                                  if (!isEditable) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); return; }
                                  setDetailHabit(null);
                                  setTimeout(() => handleNotePress(dh.id, date), 250);
                                }}
                                onLongPress={() => {
                                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                                  setNoteDeleteTarget({ habitId: dh.id, dateStr: date });
                                }}
                                delayLongPress={1500}
                                style={{ backgroundColor: theme.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: theme.border, marginBottom: 8, opacity: isEditable ? 1 : 0.75 }}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                  <Text style={{ fontSize: 10, fontWeight: '800', color: theme.textSub }}>{formatCalDate(date)}</Text>
                                  {!isEditable && <Feather name="lock" size={9} color={theme.textSub} style={{ opacity: 0.5 }} />}
                                </View>
                                <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '500', lineHeight: 20, textAlign: noteIsRtl ? 'right' : 'left', writingDirection: noteIsRtl ? 'rtl' : 'ltr' }}>{note}</Text>
                              </Pressable>
                            );
                          })}
                          <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '600', opacity: 0.5, marginTop: 4, fontStyle: 'italic' }}>Tap within 3 days to edit. Hold to delete.</Text>
                        </View>
                      )}
                    </GHScrollView>

                    {/* Bottom bar — sits on the scene's bottom; tab layout already handles home indicator */}
                    <View style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingHorizontal: 24, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: theme.bg }}>
                      {/* Archive = long-pause: set it aside, comes back later. */}
                      <TouchableOpacity onPress={() => { updateHabitStatus(dh.id, 'archived'); setDetailHabit(null); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); }} hitSlop={15} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Feather name="archive" size={18} color={theme.textSub} />
                        <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '800' }}>Archive</Text>
                      </TouchableOpacity>
                      {dh.history.length === 0 ? (
                        // No track record yet → a clean Remove is allowed (mistake scrub).
                        <TouchableOpacity onPress={() => { setDetailHabit(null); setDeleteConfirmId(dh.id); }} hitSlop={15} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Feather name="trash-2" size={18} color={theme.danger} />
                          <Text style={{ color: theme.danger, fontSize: 13, fontWeight: '800' }}>Remove</Text>
                        </TouchableOpacity>
                      ) : (
                        // Has history → honor it: Retire keeps the trophy + frozen score.
                        <TouchableOpacity onPress={() => setRetireTarget(dh)} hitSlop={15} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Feather name="award" size={18} color={theme.textMain} />
                          <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '800' }}>Retire</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </SafeAreaView>
                </Animated.View>
              );
            })()}

          {/* ── RETIRED (trophies) SCREEN ── kept retired habits; their frozen
              strength still counts toward the grade. */}
          {/* ── PACT SETUP MODAL (pick a habit) ── */}
          <Modal visible={showPactSetup} transparent animationType="fade" onRequestClose={() => setShowPactSetup(false)}>
            <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }} onPress={() => setShowPactSetup(false)}>
              <Pressable onPress={() => {}} style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 50, maxHeight: '70%' }}>
                <Text style={{ fontSize: 22, fontWeight: '900', color: theme.textMain, marginBottom: 4 }}>{pact ? 'Add to The Pact' : 'Start The Pact'}</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: theme.textSub, marginBottom: 20 }}>{pact ? 'Pick another habit to commit to.' : 'Pick one habit. Prove you can sustain it.'}</Text>
                <GHScrollView showsVerticalScrollIndicator={false}>
                  {habits.filter(h => h.status === 'active' && !(pact?.habits || []).some(ph => ph.id === h.id)).map(h => (
                    <TouchableOpacity key={h.id} onPress={() => pact ? addHabitToPact(h.id) : startPact(h.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexToRgba(h.color, 0.15), justifyContent: 'center', alignItems: 'center' }}>
                        <Feather name={h.icon} size={16} color={h.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.textMain, fontSize: 15, fontWeight: '700' }}>{h.title}</Text>
                        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600', marginTop: 2 }}>{h.targetCount} {h.unit} • {h.timeBlock}</Text>
                      </View>
                      <Feather name="chevron-right" size={18} color={theme.textSub} />
                    </TouchableOpacity>
                  ))}
                </GHScrollView>
              </Pressable>
            </Pressable>
          </Modal>

          {/* ── PACT HISTORY MODAL ── */}
          <Modal visible={showPactHistory} transparent animationType="fade" onRequestClose={() => setShowPactHistory(false)}>
            <Pressable onPress={() => setShowPactHistory(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' }}>
              <Pressable onPress={() => {}} style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, maxHeight: '80%' }}>
                <View style={{ paddingHorizontal: 28, paddingTop: 24, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View>
                    <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 }}>Pact History</Text>
                    <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginTop: 4 }}>{pact?.history?.length || 0} past level{(pact?.history?.length || 0) === 1 ? '' : 's'}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setShowPactHistory(false)} hitSlop={15}>
                    <Feather name="x" size={22} color={theme.textSub} />
                  </TouchableOpacity>
                </View>
                <GHScrollView contentContainerStyle={{ paddingHorizontal: 28, paddingBottom: 40, gap: 12 }}>
                  {(!pact?.history || pact.history.length === 0) && (
                    <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                      <Feather name="clock" size={40} color={theme.textSub} style={{ opacity: 0.2, marginBottom: 14 }} />
                      <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600' }}>No past levels yet.</Text>
                    </View>
                  )}
                  {pact?.history?.slice().reverse().map((snap, idx) => {
                    const duration = diffInDays(snap.startedAt, snap.endedAt);
                    const outcomeColor = snap.outcome === 'completed' ? theme.success : theme.danger;
                    return (
                      <View key={`${snap.level}-${snap.endedAt}-${idx}`} style={{ backgroundColor: theme.bg, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: theme.border, borderLeftWidth: 3, borderLeftColor: outcomeColor }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '900', letterSpacing: -0.3 }}>Level {snap.level}</Text>
                            <Text style={{ color: outcomeColor, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' }}>{snap.outcome}</Text>
                          </View>
                          <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '700' }}>{duration}d · {snap.endedAt}</Text>
                        </View>
                        {snap.habits.map((h, i) => {
                          const done = h.completed >= h.required;
                          const tierLabel = h.tier === 1 ? '' : h.tier === 2 ? ' ••' : ' •••';
                          return (
                            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 }}>
                              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: done ? theme.success : theme.danger }} />
                              <Text style={{ flex: 1, color: theme.textMain, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>{h.title}<Text style={{ color: theme.textSub, fontSize: 10 }}>{tierLabel}</Text></Text>
                              <Text style={{ color: done ? theme.success : theme.textSub, fontSize: 11, fontWeight: '800' }}>{h.completed}/{h.required}</Text>
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </GHScrollView>
              </Pressable>
            </Pressable>
          </Modal>

          {/* ── PACT DECISION MODAL ── */}
          <Modal visible={showPactDecision} transparent animationType="fade" onRequestClose={() => { setShowPactDecision(false); setPactOutcomeOverride(null); }}>
            {(() => {
              // Determine outcome: override (from dev) or real data
              const isActive = pactOutcomeOverride === null && !pactStatus?.allDone && !pactStatus?.isExpired;
              const won = !isActive && (pactOutcomeOverride === 'won' ? true : pactOutcomeOverride === 'lost' ? false : !!pactStatus?.allDone);

              // Smart feedback — only surface when performance is notable
              let feedback: string | null = null;
              if (won && pact && pactStatus) {
                const bufferUsage = computeBufferUsage();
                if (bufferUsage < 0.4) {
                  feedback = 'Finished well ahead of schedule. Going deeper is on the table.';
                } else if (bufferUsage < 0.65 && pact.habits.length < 4) {
                  feedback = 'Room was managed well. Adding another directive is reasonable.';
                }
              } else if (!won && !isActive && pact && pactStatus) {
                // Count shortfall — how much did they miss by?
                const totalRequired = pactStatus.habitProgress.reduce((sum, hp) => sum + hp.required, 0);
                const totalCompleted = pactStatus.habitProgress.reduce((sum, hp) => sum + Math.min(hp.completed, hp.required), 0);
                const shortfallRatio = totalRequired > 0 ? 1 - (totalCompleted / totalRequired) : 1;
                if (shortfallRatio < 0.2) {
                  feedback = 'Close. Same target is worth another attempt.';
                } else if (shortfallRatio > 0.5 && (pact.habits.length > 1 || pact.habits[0]?.tier > 1)) {
                  feedback = 'The gap was significant. Scaling back is the wise call.';
                }
              }
              return (
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 24 }}>
                  <View style={{ backgroundColor: theme.surface, borderRadius: 24, padding: 28, borderWidth: 1, borderColor: isActive ? theme.border : won ? theme.success + '30' : theme.danger + '30' }}>
                    <Text style={{ fontSize: 24, fontWeight: '900', color: theme.textMain, marginBottom: 8, letterSpacing: -0.5 }}>
                      {isActive ? 'The Pact' : won ? 'Pact Kept.' : 'Pact Expired.'}
                    </Text>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: theme.textSub, lineHeight: 22, marginBottom: feedback ? 4 : 8 }}>
                      {isActive ? `Level ${pactStatus?.level}. ${pactStatus?.daysLeft}d remaining.` : won ? "You delivered. What's next?" : "The deadline passed. That's data, not failure."}
                    </Text>
                    {feedback && (
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 12, paddingTop: 8, paddingBottom: 4 }}>
                        <View style={{ width: 3, alignSelf: 'stretch', backgroundColor: won ? theme.success : theme.danger, borderRadius: 2, opacity: 0.5 }} />
                        <Text style={{ flex: 1, fontSize: 12, fontWeight: '600', color: theme.textMain, fontStyle: 'italic', lineHeight: 18, paddingLeft: 8 }}>{feedback}</Text>
                      </View>
                    )}

                    {/* Progress summary */}
                    {pactStatus && (
                      <View style={{ marginBottom: 20, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: theme.bg }}>
                        {pactStatus.habitProgress.map(hp => (
                          <View key={hp.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: hp.color }} />
                            <Text style={{ flex: 1, color: theme.textSub, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>{hp.title}</Text>
                            <Text style={{ fontSize: 12, fontWeight: '800', color: hp.completed >= hp.required ? theme.success : theme.danger }}>{hp.completed}/{hp.required}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    <View style={{ gap: 10 }}>
                      {/* ── WIN OPTIONS ── */}
                      {!isActive && won && (
                        <>
                          <TouchableOpacity onPress={() => { setPactOutcomeOverride(null); handlePactDecision('add'); }} style={{ paddingVertical: 14, borderRadius: 14, backgroundColor: theme.textMain, alignItems: 'center' }}>
                            <Text style={{ color: theme.bg, fontWeight: '900', fontSize: 15 }}>+1 Habit</Text>
                            <Text style={{ color: theme.bg, fontWeight: '600', fontSize: 11, opacity: 0.6, marginTop: 2 }}>Existing load eases to make room</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => { setPactOutcomeOverride(null); handlePactDecision('deeper'); }} style={{ paddingVertical: 14, borderRadius: 14, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                            <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 15 }}>Go Deeper</Text>
                            <Text style={{ color: theme.textSub, fontWeight: '600', fontSize: 11, marginTop: 2 }}>Tighter deadline, higher requirements</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => { setPactOutcomeOverride(null); handlePactDecision('hold'); }} style={{ paddingVertical: 14, borderRadius: 14, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                            <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 15 }}>Hold</Text>
                            <Text style={{ color: theme.textSub, fontWeight: '600', fontSize: 11, marginTop: 2 }}>Same commitment, fresh deadline</Text>
                          </TouchableOpacity>
                        </>
                      )}
                      {/* ── LOSS OPTIONS ── */}
                      {!isActive && !won && (
                        <>
                          <TouchableOpacity onPress={() => { setPactOutcomeOverride(null); handlePactDecision('retry'); }} style={{ paddingVertical: 14, borderRadius: 14, backgroundColor: theme.textMain, alignItems: 'center' }}>
                            <Text style={{ color: theme.bg, fontWeight: '900', fontSize: 15 }}>Try Again</Text>
                            <Text style={{ color: theme.bg, fontWeight: '600', fontSize: 11, opacity: 0.6, marginTop: 2 }}>Same level, fresh deadline</Text>
                          </TouchableOpacity>
                          {pact && (pact.habits.length > 1 || (pact.habits[0]?.tier || 1) > 1) && (
                            <TouchableOpacity onPress={() => { setPactOutcomeOverride(null); handlePactDecision('scale_back'); }} style={{ paddingVertical: 14, borderRadius: 14, backgroundColor: hexToRgba(theme.danger, 0.1), alignItems: 'center' }}>
                              <Text style={{ color: theme.danger, fontWeight: '800', fontSize: 15 }}>Scale Back</Text>
                              <Text style={{ color: theme.textSub, fontWeight: '600', fontSize: 11, marginTop: 2 }}>{pact.habits.length > 1 ? 'Drop the last habit' : 'Lower difficulty'}</Text>
                            </TouchableOpacity>
                          )}
                        </>
                      )}
                      {/* Close — primary when active, secondary otherwise */}
                      {isActive && (
                        <TouchableOpacity onPress={() => { setShowPactDecision(false); setPactOutcomeOverride(null); }} style={{ paddingVertical: 14, borderRadius: 14, backgroundColor: theme.textMain, alignItems: 'center' }}>
                          <Text style={{ color: theme.bg, fontWeight: '900', fontSize: 15 }}>Close</Text>
                        </TouchableOpacity>
                      )}
                      {/* Secondary action: history (auto-note toggle removed
                          when auto-notes themselves were retired). */}
                      {pact && pact.history && pact.history.length > 0 ? (
                        <View style={{ marginTop: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.border }}>
                          <TouchableOpacity onPress={() => { setShowPactDecision(false); setPactOutcomeOverride(null); setTimeout(() => setShowPactHistory(true), 250); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Feather name="clock" size={12} color={theme.textSub} />
                            <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>History ({pact.history.length})</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                      <TouchableOpacity onPress={() => {
                        setShowPactDecision(false);
                        setPactOutcomeOverride(null);
                        setTimeout(() => {
                          setDeleteConfirmId('__PACT_DISSOLVE__');
                        }, 300);
                      }} style={{ paddingVertical: 12, alignItems: 'center' }}>
                        <Text style={{ color: theme.textSub, fontWeight: '700', fontSize: 13 }}>Dissolve The Pact</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })()}
          </Modal>

          {/* ── WHISPER TOAST — V4 Bare Sentence with glass panel ── */}
          {whisperText && (
            <Animated.View
              entering={FadeIn.duration(900).easing(Easing.out(Easing.cubic))}
              exiting={FadeOut.duration(700).easing(Easing.in(Easing.cubic))}
              style={{
                position: 'absolute', bottom: 130, left: 24, right: 24, zIndex: 999,
                borderRadius: 20, overflow: 'hidden',
                ...Platform.select({
                  ios: { shadowColor: '#000', shadowOpacity: isDarkMode ? 0.55 : 0.18, shadowRadius: 30, shadowOffset: { width: 0, height: 12 } },
                  android: {}, // elevation causes a square opaque shadow that ignores borderRadius — skip
                }),
              }}
              pointerEvents="none"
            >
              <BlurView
                intensity={isDarkMode ? 40 : 60}
                tint={isDarkMode ? 'dark' : 'light'}
                style={{
                  paddingHorizontal: 24, paddingVertical: 18,
                  alignItems: 'center',
                  backgroundColor: isDarkMode ? 'rgba(20,20,22,0.55)' : 'rgba(255,255,255,0.55)',
                  borderWidth: 1,
                  borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                }}
              >
                <Text style={{
                  color: theme.textMain, fontSize: 17, fontWeight: '500', textAlign: 'center',
                  lineHeight: 26, fontStyle: 'italic', letterSpacing: 0.3,
                }}>{whisperText}</Text>
              </BlurView>
            </Animated.View>
          )}

        </SafeAreaView>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
