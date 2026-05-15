import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Platform, UIManager, Pressable, Keyboard, Dimensions, Modal, Animated as RNAnimated, BackHandler, TextInput } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import notifee, { TriggerType, RepeatFrequency } from '@notifee/react-native';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { GestureHandlerRootView, Swipeable, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, { FadeInDown, FadeIn, FadeOut, Easing, useAnimatedStyle, withSpring, useSharedValue, withTiming, runOnJS, cancelAnimation, withSequence, LinearTransition, withDelay, interpolate, Extrapolation } from 'react-native-reanimated';

import { useFocusEffect } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { BottomSheetModal, BottomSheetModalProvider, BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useAppStore, Habit, HabitStatus, TimeBlock, Note } from '../../store/useAppStore';
import { calculateStrengthScore } from '../../lib/habitScore';
import {
  Eclipse_Silence, Eclipse_Brutal, Eclipse_Hour, Eclipse_Horizon, Eclipse_NightSky,
  pickEclipseVariation, EclipseVariationKey,
} from '../../components/DayConqueredVariations';

const SCREEN_HEIGHT = Dimensions.get('window').height;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try { UIManager.setLayoutAnimationEnabledExperimental(true); } catch(e){}
}

const COLORS = [
  // row 1 — originals
  '#3B82F6', // blue
  '#10B981', // emerald
  '#F59E0B', // amber
  '#F43F5E', // rose
  '#8B5CF6', // violet
  '#2DD4BF', // teal
  '#EC4899', // pink
  '#64748B', // slate
  // row 2 — expansion
  '#EF4444', // red — intense
  '#F97316', // orange — warm
  '#EAB308', // yellow — bright
  '#84CC16', // lime — fresh
  '#06B6D4', // cyan — cool
  '#6366F1', // indigo — deep
  '#A855F7', // fuchsia-purple
  '#92400E', // bronze — earthy
];
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

const calculateStreak = (history: string[], restDays: string[], skippedDays: string[], targetCount: number) => {
  if (!history || history.length === 0) return 0;
  const dateCounts: Record<string, number> = {};
  history.forEach(d => { dateCounts[d] = (dateCounts[d] || 0) + 1; });
  const completedDates = Object.keys(dateCounts).filter(d => dateCounts[d] >= targetCount);
  
  const today = getFormatDateStr(); let checkDate = new Date(); checkDate.setMinutes(checkDate.getMinutes() - checkDate.getTimezoneOffset());
  let streak = 0;
  if (!completedDates.includes(today) && !restDays.includes(today)) checkDate.setDate(checkDate.getDate() - 1); 

  while (true) {
    const checkDateStr = checkDate.toISOString().split('T')[0];
    if (skippedDays.includes(checkDateStr)) break; 
    if (completedDates.includes(checkDateStr)) { streak++; checkDate.setDate(checkDate.getDate() - 1); } 
    else if (restDays.includes(checkDateStr)) { checkDate.setDate(checkDate.getDate() - 1); } 
    else break; 
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
const makeLeftActions = (theme: any) => (p: any, d: RNAnimated.AnimatedInterpolation<any>) => {
  const s = d.interpolate({ inputRange: [0, 100], outputRange: [0.5, 1], extrapolate: 'clamp' });
  return (
    <View style={{ justifyContent: 'center', width: '100%', borderRadius: 16, backgroundColor: theme.textMain, paddingLeft: 24, alignItems: 'flex-start', marginBottom: 12 }}>
      <RNAnimated.View style={{ transform: [{ scale: s }] }}><Feather name="archive" size={20} color={theme.bg} /></RNAnimated.View>
    </View>
  );
};

const makeRightActions = (theme: any, habitId: string, selectedDateStr: string, onAction: any, isFuture: boolean) => () => (
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 10, gap: 10, width: 140, marginBottom: 12, opacity: isFuture ? 0.3 : 1 }}>
    <Pressable onPress={() => { if (isFuture) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onAction(habitId, 'rest', selectedDateStr); }} style={{ backgroundColor: theme.freeze, padding: 12, borderRadius: 12 }}><Feather name="coffee" size={18} color="#FFF" /></Pressable>
    <Pressable onPress={() => { if (isFuture) return; Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); onAction(habitId, 'skipped', selectedDateStr); }} style={{ backgroundColor: theme.danger, padding: 12, borderRadius: 12 }}><Feather name="x" size={18} color="#FFF" /></Pressable>
  </View>
);

// ─── MEMOIZED HABIT CARD ───
const HabitCard = React.memo(({ habit, selectedDateStr, todayCount, currentStatus, currentStreak, strengthScore, theme, onToggle, onAction, onOpen, onArchive, onNotePress }: any) => {
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
      setTimeout(() => { isSweeping.current = false; }, 50);
    }
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
    onToggle(habit.id, selectedDateStr);
  }, [habit.id, selectedDateStr, onToggle]);

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
    <Animated.View layout={LinearTransition.springify().damping(22).stiffness(250)}>
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
                {currentStatus === 'skipped' && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: theme.danger + '20' }}><Text style={{ fontSize: 10, fontWeight: '800', color: theme.danger }}>STREAK BROKEN</Text></View>}
                {currentStatus === 'rest' && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: theme.freeze + '20' }}><Text style={{ fontSize: 10, fontWeight: '800', color: theme.freeze }}>REST DAY</Text></View>}
                {currentStatus === 'pending' && habit.targetCount > 1 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#222' }}><Text style={{ fontSize: 10, fontWeight: '800', color: theme.textSub }}>{todayCount} / {habit.targetCount} {habit.unit}</Text></View>}
                {strengthScore > 0 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: hexToRgba(strengthScore >= 80 ? habit.color : strengthScore >= 50 ? theme.textSub : theme.danger, 0.15) }}><Text style={{ fontSize: 10, fontWeight: '900', color: strengthScore >= 80 ? habit.color : strengthScore >= 50 ? theme.textSub : theme.danger }}>{strengthScore}%</Text></View>}
                {habit.hasReminder && currentStatus === 'pending' && <Feather name="bell" size={10} color={theme.textSub} style={{ opacity: 0.4 }} />}
                {currentStatus === 'done' && (
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
    prev.theme === next.theme
  );
});

// ─── MAIN ENGINE ───
export default function HabitsScreen() {
  const insets = useSafeAreaInsets();
  
  const {
    habits, isDarkMode, calendarType, toggleCalendar,
    addOrUpdateHabit, deleteHabit, updateHabitStatus, toggleHabitAction,
    setHabitCompletionNote, markWhisperSeen,
    lastEclipseVariation, setLastEclipseVariation,
    pactAutoNote, setPactAutoNote,
  } = useAppStore();

  // Active Day Conquered variation — null when nothing is showing
  const [activeEclipse, setActiveEclipse] = useState<EclipseVariationKey | null>(null);

  // Strength history modal
  const [showStrengthHistory, setShowStrengthHistory] = useState(false);

  // Pact history modal
  const [showPactHistory, setShowPactHistory] = useState(false);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [noteModal, setNoteModal] = useState<{ habitId: string; dateStr: string; text: string } | null>(null);
  const [noteDeleteTarget, setNoteDeleteTarget] = useState<{ habitId: string; dateStr: string } | null>(null);
  const [showWeeklyReview, setShowWeeklyReview] = useState(false);
  const { lastWeeklyReviewDismissed, setLastWeeklyReviewDismissed, pact, setPact } = useAppStore();
  const [showPactSetup, setShowPactSetup] = useState(false);

  // Clean up old pact schema if present
  useEffect(() => { if (pact && !pact.habits) setPact(undefined); }, []);
  const [showPactDecision, setShowPactDecision] = useState(false);
  const [pactOutcomeOverride, setPactOutcomeOverride] = useState<'won' | 'lost' | null>(null);
  const [detailHabit, setDetailHabit] = useState<Habit | null>(null);
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
  const [vaultTab, setVaultTab] = useState<'all' | 'archived'>('all');

  const [habitModalVisible, setHabitModalVisible] = useState(false);
  const vaultSheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['90%'], []);
  const [vaultIndex, setVaultIndex] = useState(-1);

  // Safe Android Back Handler
  useEffect(() => {
    const backAction = () => {
      if (habitModalVisible) { setHabitModalVisible(false); return true; }
      if (vaultIndex >= 0) { vaultSheetRef.current?.dismiss(); return true; }
      if (detailHabit) { setDetailHabit(null); return true; }
      return false;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [habitModalVisible, vaultIndex, detailHabit]);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.6} />,
    []
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newTargetCount, setNewTargetCount] = useState('1');
  const [newUnit, setNewUnit] = useState('');
  const [newTimeBlock, setNewTimeBlock] = useState<TimeBlock>('morning');
  const [newColor, setNewColor] = useState(COLORS[0]);
  const [newIcon, setNewIcon] = useState<keyof typeof Feather.glyphMap>('activity');
  const [newScheduleType, setNewScheduleType] = useState<'days' | 'interval'>('days');
  const [newFrequency, setNewFrequency] = useState<string[]>(UI_DAYS);
  const [newIntervalDays, setNewIntervalDays] = useState('2');
  const [newStartDate, setNewStartDate] = useState(getFormatDateStr());
  const [newHasReminder, setNewHasReminder] = useState(false);
  const [newReminderTime, setNewReminderTime] = useState('');

  const theme = useMemo(() => ({
    bg: isDarkMode ? '#000000' : '#F8F9FA', surface: isDarkMode ? '#0A0A0A' : '#FFFFFF', 
    border: isDarkMode ? '#1A1A1A' : '#E5E5EA', textMain: isDarkMode ? '#FFFFFF' : '#111111', 
    textSub: isDarkMode ? '#666666' : '#888888', accent: isDarkMode ? '#FFFFFF' : '#000000',
    danger: '#F43F5E', freeze: '#F59E0B', success: '#10B981'
  }), [isDarkMode]);

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
            }, { type: TriggerType.TIMESTAMP, timestamp: getNextTriggerTimestamp(hrs, mins) });
          }
        }

        // Streak-at-risk check: only nag on habits where there's actually momentum to lose.
        const streak = calculateStreak(h.history, h.restDays || [], h.skippedDays || [], h.targetCount);
        if (streak >= 3) atRisk.push({ habit: h, streak });
      }

      // ── Streak-at-risk evening warning ───────────────────────────────────
      // One consolidated notification at 8 PM listing every habit with a 3+
      // day streak that's still incomplete. Single ping (not one per habit) so
      // it never devolves into a wall of notifications. Skipped if 8 PM has
      // already passed today — re-runs throughout the day catch the user as
      // they complete habits and prune the at-risk list.
      if (atRisk.length > 0) {
        const target = new Date(); target.setHours(20, 0, 0, 0);
        if (target.getTime() > Date.now()) {
          const titles = atRisk.map(x => x.habit.title);
          const title = atRisk.length === 1
            ? `${titles[0]} streak at risk`
            : `${atRisk.length} streaks at risk`;
          const body = atRisk.length === 1
            ? `Don't break your ${atRisk[0].streak}-day streak — open Habits.`
            : `Still pending: ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? ` + ${titles.length - 3} more` : ''}.`;
          await notifee.createTriggerNotification({
            id: `habit_streak_warn_${today.replace(/-/g, '')}`,
            title, body,
            android: { channelId: `notif_pop_v4` },
            ios: { sound: `pop.wav` },
          }, { type: TriggerType.TIMESTAMP, timestamp: target.getTime() });
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
            }, { type: TriggerType.TIMESTAMP, timestamp: target.getTime() });
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
  // Sunday Weekly Review trigger
  useFocusEffect(useCallback(() => {
    const today = new Date();
    const todayStr = getFormatDateStr();
    if (today.getDay() === 0 && lastWeeklyReviewDismissed !== todayStr) {
      if (habits.some(h => h.status === 'active')) {
        setTimeout(() => setShowWeeklyReview(true), 800);
      }
    }
  }, [habits, lastWeeklyReviewDismissed]));

  // Focus-triggered whispers — each key fires exactly ONCE, ever. No per-session repetition.
  useFocusEffect(useCallback(() => {
    const todayStr = getFormatDateStr();
    const activeHabits = habits.filter(h => h.status === 'active');
    if (activeHabits.length === 0) return;
    const seen = useAppStore.getState().whispersSeen || [];

    const tryFire = (key: string, line: string, delay = 1500) => {
      if (seen.includes(key)) return false;
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
      setEditingId(habit.id); setNewTitle(habit.title); setNewColor(habit.color); setNewIcon(habit.icon);
      setNewTargetCount(habit.targetCount.toString()); setNewUnit(habit.unit || ''); setNewTimeBlock(habit.timeBlock);
      setNewScheduleType(habit.scheduleType || 'days'); setNewFrequency(habit.frequency || []);
      setNewIntervalDays(habit.intervalDays?.toString() || '2'); setNewStartDate(habit.startDate || getFormatDateStr());
      setNewHasReminder(habit.hasReminder || false); setNewReminderTime(habit.reminderTime || '');
    } else {
      setEditingId(null); setNewTitle(''); setNewTargetCount('1'); setNewUnit(''); setNewTimeBlock('morning');
      setNewScheduleType('days'); setNewFrequency(UI_DAYS); setNewIntervalDays('2'); setNewStartDate(getFormatDateStr());
      setNewHasReminder(false); setNewReminderTime('');
    }
    setHabitModalVisible(true);
  }, []);

  const closeSheet = useCallback(() => {
    Keyboard.dismiss();
    setHabitModalVisible(false);
  }, []);

  const openVault = useCallback(() => {
    Keyboard.dismiss();
    vaultSheetRef.current?.present();
  }, []);

  const closeVault = useCallback(() => {
    vaultSheetRef.current?.dismiss();
  }, []);

  const saveHabit = useCallback(() => {
    if (!newTitle.trim()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Always read the current snapshot from the store — avoids stale closure bug
    const existing = editingId ? useAppStore.getState().habits.find((h: Habit) => h.id === editingId) : null;
    const newHabit: Habit = {
      id: editingId || Date.now().toString(), 
      title: newTitle.trim(), color: newColor, icon: newIcon, timeBlock: newTimeBlock,
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
      status: 'active',
    };
    addOrUpdateHabit(newHabit);
    closeSheet();
    // First-habit onboarding whisper — fires exactly once ever when user creates their first habit
    if (!editingId) {
      const allHabits = useAppStore.getState().habits;
      const seen = useAppStore.getState().whispersSeen || [];
      if (allHabits.length <= 1 && !seen.includes('first_habit')) {
        markWhisperSeen('first_habit');
        setTimeout(() => showWhisper("One habit. That's how everything starts."), 800);
      }
    }
  }, [
    newTitle, newColor, newIcon, newTimeBlock, newTargetCount, newUnit,
    newScheduleType, newFrequency, newIntervalDays, newStartDate,
    newHasReminder, newReminderTime, editingId, addOrUpdateHabit, closeSheet,
    markWhisperSeen, showWhisper,
  ]);

  // --- DATA PREP ---
  // Stable date string — only recomputes when selectedDate actually changes
  const selectedDateStr = useMemo(() => getFormatDateStr(selectedDate), [selectedDate]);
  const selectedJsDayName = useMemo(() => JS_DAYS[selectedDate.getDay()], [selectedDate]);

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
          const currentStreak = calculateStreak(h.history, h.restDays || [], h.skippedDays || [], h.targetCount);
          const strengthScore = calculateStrengthScore(h, selectedDateStr);

          data.push({ type: 'habit', id: h.id, habit: h, todayCount, currentStatus, currentStreak, strengthScore });
        });
      }
    });

    if (data.length === 0) data.push({ type: 'empty', id: 'empty' });
    return data;
  }, [scheduledHabits, selectedDateStr]);

  // Memoized vault list
  const vaultItems = useMemo(
    () => habits.filter((h: Habit) => vaultTab === 'archived' ? h.status === 'archived' : h.status === 'active'),
    [habits, vaultTab]
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
    if (isAllDone && !prevIsAllDone.current && eclipseFiredForDate.current !== selectedDateStr) {
      eclipseFiredForDate.current = selectedDateStr;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft), 1000);

      // Compute context for variation selection
      const todayStr = getFormatDateStr();
      const activeHabits = habits.filter(h => h.status === 'active');

      // Helper: was a given date fully conquered?
      const wasDayConquered = (checkStr: string, checkDate: Date) => {
        const dayName = JS_DAYS[checkDate.getDay()];
        const dayHabits = activeHabits.filter(h => {
          if (new Date(h.createdAt) > checkDate) return false;
          if (h.scheduleType === 'interval') {
            if (!h.startDate) return false;
            const diff = diffInDays(h.startDate, checkStr);
            return diff >= 0 && diff % (h.intervalDays || 1) === 0;
          }
          return h.frequency.length === 0 || h.frequency.includes(dayName);
        });
        if (dayHabits.length === 0) return null; // no scheduled habits that day
        return dayHabits.every(h => {
          const c = h.history.filter(d => d === checkStr).length;
          return h.skippedDays?.includes(checkStr) || h.restDays?.includes(checkStr) || c >= h.targetCount;
        });
      };

      // Consecutive conquered days (walking backward, stop on first non-conquered)
      let consecutiveConqueredDays = 1; // today
      for (let back = 1; back < 30; back++) {
        const checkDate = new Date();
        checkDate.setDate(checkDate.getDate() - back);
        const checkStr = getFormatDateStr(checkDate);
        const res = wasDayConquered(checkStr, checkDate);
        if (res === null) continue; // no scheduled habits — don't break, don't count
        if (!res) break;
        consecutiveConqueredDays++;
      }

      // Incomplete days in last 7 (any day that had scheduled habits but wasn't fully done)
      let incompleteDaysLast7 = 0;
      for (let back = 1; back <= 7; back++) {
        const checkDate = new Date();
        checkDate.setDate(checkDate.getDate() - back);
        const checkStr = getFormatDateStr(checkDate);
        const res = wasDayConquered(checkStr, checkDate);
        if (res === false) incompleteDaysLast7++;
      }

      // Yesterday was rest-or-skip across all scheduled habits
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = getFormatDateStr(yesterday);
      const yDayName = JS_DAYS[yesterday.getDay()];
      const ySched = activeHabits.filter(h => {
        if (new Date(h.createdAt) > yesterday) return false;
        if (h.scheduleType === 'interval') {
          if (!h.startDate) return false;
          const diff = diffInDays(h.startDate, yStr);
          return diff >= 0 && diff % (h.intervalDays || 1) === 0;
        }
        return h.frequency.length === 0 || h.frequency.includes(yDayName);
      });
      const yesterdayWasRestOrSkip = ySched.length > 0 && ySched.every(h =>
        h.restDays?.includes(yStr) || h.skippedDays?.includes(yStr)
      );

      // Pact completes today — heuristic
      let completesPactToday = false;
      if (pact && pact.habits) {
        completesPactToday = pact.habits.every(ph => {
          const h = habits.find(hb => hb.id === ph.id);
          if (!h) return false;
          const countPerDay: Record<string, number> = {};
          h.history.filter(d => d >= pact.startedAt && d <= todayStr).forEach(d => { countPerDay[d] = (countPerDay[d] || 0) + 1; });
          const daysCompleted = Object.values(countPerDay).filter(c => c >= h.targetCount).length;
          return daysCompleted >= 2;
        });
      }

      const pick = pickEclipseVariation({
        hour: new Date().getHours(),
        dayOfWeek: new Date().getDay(),
        consecutiveConqueredDays,
        incompleteDaysLast7,
        yesterdayWasRestOrSkip,
        completesPactToday,
      });
      setActiveEclipse(pick);
      setLastEclipseVariation(pick);
    }
    prevIsAllDone.current = isAllDone;
  }, [isAllDone, habits, pact, lastEclipseVariation, setLastEclipseVariation]);

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
          const seen = useAppStore.getState().whispersSeen || [];
          if (!seen.includes('recovery')) {
            markWhisperSeen('recovery');
            setTimeout(() => showWhisper("You missed. You returned. The record continues."), 1000);
          }
        }
        // Past-completion whisper — fires exactly once ever
        const gap = diffInDays(dateStr, todayStr);
        if (gap >= 1 && gap <= 3) {
          const seen = useAppStore.getState().whispersSeen || [];
          if (!seen.includes('past_completion')) {
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
        strengthScore={item.strengthScore}
        theme={theme}
        onToggle={handleHabitAction}
        onAction={handleHabitAction}
        onOpen={handleOpenDetail}
        onArchive={updateHabitStatus}
        onNotePress={handleNotePress}
      />
    );
  }, [selectedDateStr, theme, handleHabitAction, handleOpenDetail, updateHabitStatus, handleNotePress]);

  const getTodayLabel = useCallback(() => {
    const dayName = FULL_DAYS[selectedDate.getDay()];
    if (calendarType === 'shamsi') { const parts = getShamsiDateParts(selectedDate); return `${dayName}, ${S_MONTHS[parts.month - 1].slice(0, 3)} ${parts.day}`; }
    return `${dayName}, ${G_MONTHS[selectedDate.getMonth()]} ${selectedDate.getDate()}`;
  }, [selectedDate, calendarType]);

  const globalStrength = useMemo(() => {
    const active = habits.filter(h => h.status === 'active');
    if (active.length === 0) return null;
    const todayStr = getFormatDateStr();
    const scores = active.map(h => calculateStrengthScore(h, todayStr));
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }, [habits]);

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
      // Auto-create failure note (gated by user preference, default on)
      const { addOrUpdateNote, pactAutoNote: autoNoteOn } = useAppStore.getState();
      if (autoNoteOn !== false) {
        const progressLines = pactStatus?.habitProgress.map(hp => `- ${hp.title}: ${hp.completed}/${hp.required}${hp.completed >= hp.required ? ' ✓' : ''}`) || [];
        const failNote: Note = {
          id: `pact_fail_${Date.now()}`, title: `Pact Level ${pact.level} — Failed`, group: 'pact',
          content: `# Progress at deadline\n${progressLines.join('\n')}\n\nDeadline: ${pact.deadline}\nStarted: ${pact.startedAt}`,
          color: '#F43F5E', createdAt: Date.now(), isPinned: false, isLocked: false, order: -Date.now(), status: 'active',
        };
        addOrUpdateNote(failNote);
      }
      const deadline = calculatePactDeadline(pact.habits);
      setPact({ ...pact, startedAt: todayStr, deadline, history });
      setShowPactDecision(false);
      pactDecisionShown.current = false;
      showWhisper("Same target. Deadline reset.");
    } else if (choice === 'scale_back') {
      // Auto-create failure note
      if (pactStatus?.isExpired) {
        const { addOrUpdateNote, pactAutoNote: autoNoteOn } = useAppStore.getState();
        if (autoNoteOn !== false) {
          const progressLines = pactStatus?.habitProgress.map(hp => `- ${hp.title}: ${hp.completed}/${hp.required}${hp.completed >= hp.required ? ' ✓' : ''}`) || [];
          const failNote: Note = {
            id: `pact_fail_${Date.now()}`, title: `Pact Level ${pact.level} — Scaled Back`, group: 'pact',
            content: `# Progress at deadline\n${progressLines.join('\n')}\n\nDeadline: ${pact.deadline}\nStarted: ${pact.startedAt}`,
            color: '#F43F5E', createdAt: Date.now(), isPinned: false, isLocked: false, order: -Date.now(), status: 'active',
          };
          addOrUpdateNote(failNote);
        }
      }
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
          <Modal visible={!!activeEclipse} transparent animationType="none" statusBarTranslucent onRequestClose={() => setActiveEclipse(null)}>
            <View style={{ flex: 1 }} pointerEvents="none">
              {activeEclipse === 'brutal' && <Eclipse_Brutal theme={theme} onDone={() => setActiveEclipse(null)} />}
              {activeEclipse === 'horizon' && <Eclipse_Horizon theme={theme} onDone={() => setActiveEclipse(null)} />}
              {activeEclipse === 'nightsky' && <Eclipse_NightSky theme={theme} onDone={() => setActiveEclipse(null)} />}
            </View>
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
                  {globalStrength !== null && (
                    <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowStrengthHistory(true); }} hitSlop={10} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: hexToRgba(globalStrength >= 80 ? '#10B981' : globalStrength >= 50 ? theme.textSub : theme.danger, 0.15) }}>
                      <Text style={{ fontSize: 10, fontWeight: '900', color: globalStrength >= 80 ? '#10B981' : globalStrength >= 50 ? theme.textSub : theme.danger }}>{globalStrength}%</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
                <TouchableOpacity onPress={openVault} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Feather name="archive" size={20} color={theme.textMain} />
                    {habits.filter(h => h.status === 'archived').length > 0 && (
                      <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', opacity: 0.5, fontVariant: ['tabular-nums'] }}>{habits.filter(h => h.status === 'archived').length}</Text>
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
                    ) : habits.some(h => h.status === 'active') ? (
                      <TouchableOpacity onPress={() => setShowPactSetup(true)} style={{ marginBottom: 16, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.border, borderStyle: 'dashed', alignItems: 'center' }}>
                        <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>Start The Pact — build habits one at a time</Text>
                      </TouchableOpacity>
                    ) : null}
                  </>
                }
              />
            </View>
          </Animated.View>

          {/* DELETE MODAL */}
          {deleteConfirmId && (
            <CustomConfirmModal 
              visible={!!deleteConfirmId}
              title={deleteConfirmId === '__PACT_DISSOLVE__' ? "Dissolve The Pact" : "Obliterate Habit"}
              message={deleteConfirmId === '__PACT_DISSOLVE__' ? "This will end The Pact and erase all progress. Your habits stay, but the commitment is gone." : "Are you sure? This will permanently delete this habit and erase all its history."}
              destructiveLabel={deleteConfirmId === '__PACT_DISSOLVE__' ? "Dissolve" : "Purge"} theme={theme}
              onCancel={() => setDeleteConfirmId(null)}
              onConfirm={() => {
                if (deleteConfirmId === '__PACT_DISSOLVE__') {
                  setPact(undefined); pactDecisionShown.current = false;
                  showWhisper("Pact dissolved. The record remains.");
                } else {
                  deleteHabit(deleteConfirmId); closeSheet();
                }
                setDeleteConfirmId(null);
              }} 
            />
          )}

          {/* ── STRENGTH HISTORY MODAL ── */}
          <Modal visible={showStrengthHistory} transparent animationType="fade" onRequestClose={() => setShowStrengthHistory(false)}>
            <Pressable onPress={() => setShowStrengthHistory(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
              <Pressable onPress={() => {}} style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 28, paddingBottom: 48, paddingHorizontal: 28, minHeight: '62%' }}>
                {(() => {
                  const active = habits.filter(h => h.status === 'active');
                  if (active.length === 0) {
                    return (
                      <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                        <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: '600' }}>No active habits.</Text>
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
                    const scores = active
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

                      {/* Per-habit breakdown — show each habit's current score */}
                      <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>By habit</Text>
                      <View style={{ gap: 10 }}>
                        {active.map(h => {
                          const s = calculateStrengthScore(h, getFormatDateStr());
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
                      </View>
                    </>
                  );
                })()}
              </Pressable>
            </Pressable>
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

          {/* ── GORHOM VAULT SHEET ── */}
          <BottomSheetModal ref={vaultSheetRef} snapPoints={snapPoints} onChange={setVaultIndex} backdropComponent={renderBackdrop} backgroundStyle={{ backgroundColor: theme.bg, borderRadius: 32 }} handleIndicatorStyle={{ backgroundColor: theme.border, width: 40, height: 5 }}>
            <View style={{ paddingHorizontal: 24, paddingTop: 10, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 28, fontWeight: '900', color: theme.textMain, letterSpacing: -1 }}>Vault.</Text>
              <TouchableOpacity onPress={closeVault} hitSlop={15}><Feather name="x" size={24} color={theme.textMain} /></TouchableOpacity>
            </View>
            <View style={{ paddingHorizontal: 24, marginBottom: 20 }}>
              <GHScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {(['all', 'archived'] as const).map(t => (
                  <TouchableOpacity key={t} onPress={() => setVaultTab(t)} style={{ paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20, backgroundColor: vaultTab === t ? theme.textMain : theme.surface, borderWidth: 1, borderColor: theme.border }}>
                    <Text style={{ color: vaultTab === t ? theme.bg : theme.textSub, fontWeight: '800', fontSize: 13, textTransform: 'capitalize' }}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </GHScrollView>
            </View>
            <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
              {vaultItems.length === 0 ? <View style={{ alignItems: 'center', marginTop: 40 }}><Feather name={vaultTab === 'archived' ? 'archive' : 'list'} size={40} color={theme.textSub} style={{ opacity: 0.2 }} /></View> : null}
              {vaultItems.map((h: Habit) => (
                <View key={h.id} style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => vaultTab === 'all' ? (closeVault(), openSheet(h)) : null} disabled={vaultTab === 'archived'}>
                    <Text style={{ color: theme.textMain, fontSize: 16, fontWeight: '800' }}>{h.title}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' }}>{h.timeBlock}</Text>
                      {vaultTab === 'all' && <Feather name="edit-2" size={10} color={theme.textSub} />}
                    </View>
                  </TouchableOpacity>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    {vaultTab === 'all' && <TouchableOpacity onPress={() => updateHabitStatus(h.id, 'archived')} hitSlop={15} style={{ padding: 8, backgroundColor: theme.bg, borderRadius: 8 }}><Feather name="archive" size={18} color={theme.textSub} /></TouchableOpacity>}
                    {vaultTab === 'archived' && <TouchableOpacity onPress={() => updateHabitStatus(h.id, 'active')} hitSlop={15} style={{ padding: 8, backgroundColor: theme.bg, borderRadius: 8 }}><Feather name="refresh-ccw" size={18} color={theme.success} /></TouchableOpacity>}
                    <TouchableOpacity onPress={() => setDeleteConfirmId(h.id)} hitSlop={15} style={{ padding: 8, backgroundColor: theme.bg, borderRadius: 8 }}><Feather name="trash-2" size={18} color={theme.danger} /></TouchableOpacity>
                  </View>
                </View>
              ))}
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
              
              <TextInput style={[{ fontSize: 28, fontWeight: '900', marginBottom: 20, color: theme.textMain }, persianSafeInputStyle]} placeholder="What's the habit?" placeholderTextColor={theme.border} value={newTitle} onChangeText={setNewTitle} />
              
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
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                  {COLORS.map(c => (
                    <Pressable key={c} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNewColor(c); }} style={{ width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center', backgroundColor: c }} >
                      {newColor === c && <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFF' }} />}
                    </Pressable>
                  ))}
                </View>
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

              {editingId && (
                <TouchableOpacity
                  style={{ marginTop: 24, padding: 16, backgroundColor: theme.danger + '15', borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: theme.danger + '30' }}
                  onPress={() => { setDeleteConfirmId(editingId); }}
                >
                  <Text style={{ color: theme.danger, fontWeight: '800', fontSize: 16 }}>Delete Habit</Text>
                </TouchableOpacity>
              )}

              </ScrollView>
            </KeyboardAvoidingView>
              </SafeAreaView>
            </View>
          </Modal>

          {/* ── SUNDAY WEEKLY REVIEW ── */}
          <Modal visible={showWeeklyReview} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { setShowWeeklyReview(false); setLastWeeklyReviewDismissed(getFormatDateStr()); }}>
            <View style={{ flex: 1, backgroundColor: theme.bg }}>
              <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <View style={{ paddingHorizontal: 24, paddingTop: 30, paddingBottom: 20 }}>
                  <Text style={{ fontSize: 28, fontWeight: '900', color: theme.textMain, letterSpacing: -0.5 }}>Weekly Review</Text>
                  <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', marginTop: 4 }}>60 seconds. Be honest.</Text>
                </View>
                <GHScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 120 }}>
                  <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>This week's performance</Text>
                  {habits.filter(h => h.status === 'active').map(h => {
                    const todayStr = getFormatDateStr();
                    const weekScore = (() => {
                      const [ry, rm, rd] = todayStr.split('-').map(Number);
                      const refUTC = Date.UTC(ry, rm - 1, rd);
                      const dateCounts: Record<string, number> = {};
                      h.history.forEach(d => { dateCounts[d] = (dateCounts[d] || 0) + 1; });
                      let scheduled = 0, completed = 0;
                      for (let i = 0; i < 7; i++) {
                        const d = new Date(refUTC - i * 86400000);
                        const checkStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
                        if (h.restDays?.includes(checkStr)) continue;
                        let isScheduled = false;
                        if (h.scheduleType === 'interval') {
                          if (h.startDate) { const diff = diffInDays(h.startDate, checkStr); isScheduled = diff >= 0 && diff % (h.intervalDays || 1) === 0; }
                        } else { isScheduled = h.frequency.length === 0 || h.frequency.includes(JS_DAYS[d.getUTCDay()]); }
                        if (!isScheduled) continue;
                        scheduled++;
                        if ((dateCounts[checkStr] || 0) >= h.targetCount) completed++;
                      }
                      return scheduled === 0 ? 100 : Math.round((completed / scheduled) * 100);
                    })();
                    return (
                      <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: h.color }} />
                          <Text style={{ color: theme.textMain, fontSize: 15, fontWeight: '700', flex: 1 }} numberOfLines={1}>{h.title}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <Text style={{ fontSize: 14, fontWeight: '900', color: weekScore >= 80 ? h.color : weekScore >= 50 ? theme.textSub : theme.danger }}>{weekScore}%</Text>
                          <TouchableOpacity onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); updateHabitStatus(h.id, 'archived'); }} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: hexToRgba(theme.danger, 0.1) }}>
                            <Text style={{ color: theme.danger, fontSize: 11, fontWeight: '800' }}>Kill</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                  <View style={{ marginTop: 30, alignItems: 'center' }}>
                    <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', fontStyle: 'italic', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>If a habit feels like a chore, kill it or commit harder. There's no middle ground.</Text>
                    <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowWeeklyReview(false); setLastWeeklyReviewDismissed(getFormatDateStr()); }} style={{ backgroundColor: theme.textMain, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 100 }}>
                      <Text style={{ color: theme.bg, fontWeight: '900', fontSize: 16 }}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </GHScrollView>
              </SafeAreaView>
            </View>
          </Modal>

          {/* ── HABIT DETAIL VIEW — positioned overlay so BottomSheet edit can stack above it ── */}
          {detailHabit && (() => {
              const dh = useAppStore.getState().habits.find(h => h.id === detailHabit.id) || detailHabit;
              const dhStrength = calculateStrengthScore(dh, getFormatDateStr());
              const dhStreak = calculateStreak(dh.history, dh.restDays || [], dh.skippedDays || [], dh.targetCount);
              const dhCreated = new Date(dh.createdAt);
              const dhDaysActive = diffInDays(getFormatDateStr(dhCreated), getFormatDateStr());
              const dhTotalCompletions = dh.history.length;
              const dhNotes = Object.entries(dh.completionNotes || {}).sort(([a], [b]) => b.localeCompare(a));

              // Cross-tab: challenges that link this habit (only active ones worth showing)
              const linkedChallenges = (useAppStore.getState().challenges || []).filter(
                c => c.linkedHabitIds?.includes(dh.id) && c.deadState === 'active'
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
                      <TouchableOpacity onPress={() => { updateHabitStatus(dh.id, 'archived'); setDetailHabit(null); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); }} hitSlop={15}>
                        <Feather name="archive" size={20} color={theme.textSub} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => { setDetailHabit(null); setDeleteConfirmId(dh.id); }} hitSlop={15}>
                        <Feather name="trash-2" size={20} color={theme.textSub} />
                      </TouchableOpacity>
                    </View>
                  </SafeAreaView>
                </Animated.View>
              );
            })()}

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
                      {/* Secondary actions: history + auto-note toggle */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.border }}>
                        {pact && pact.history && pact.history.length > 0 ? (
                          <TouchableOpacity onPress={() => { setShowPactDecision(false); setPactOutcomeOverride(null); setTimeout(() => setShowPactHistory(true), 250); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Feather name="clock" size={12} color={theme.textSub} />
                            <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>History ({pact.history.length})</Text>
                          </TouchableOpacity>
                        ) : <View />}
                        <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPactAutoNote(pactAutoNote === false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600' }}>Auto-note on failure</Text>
                          <View style={{ width: 28, height: 16, borderRadius: 8, backgroundColor: pactAutoNote !== false ? theme.textMain : theme.border, padding: 2 }}>
                            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.bg, transform: [{ translateX: pactAutoNote !== false ? 12 : 0 }] }} />
                          </View>
                        </TouchableOpacity>
                      </View>
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
