import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Modal, TextInput, ScrollView,
  Platform, Switch, LayoutAnimation, UIManager, Animated as RNAnimated,
  Easing as RNEasing, LogBox, BackHandler, Keyboard, Pressable, useWindowDimensions
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { GestureHandlerRootView, Swipeable, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { KeyboardStickyView, KeyboardAvoidingView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import * as Notifications from 'expo-notifications';
import { TASK_CHANNEL_ID } from '../../lib/notifChannels';
import Animated, { FadeInDown, FadeOut, FadeIn, LinearTransition, Easing, useAnimatedStyle } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';

import { FlashList } from '@shopify/flash-list';
import { BottomSheetModal, BottomSheetModalProvider, BottomSheetBackdrop, BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useAppStore, Task, Project, SubTask, Priority, CalendarSystem, RecurType, UrgencyLevel, TaskStatus, ProjectStatus, DeepWorkIntent, DeepWorkSession, Challenge, Habit, DayRating, makeLedgerEntry } from '../../store/useAppStore';
import { FEATURE_IDS, useIsUnlocked, useIsNew, isUnlocked } from '../../lib/unlocks';
import { useTabBarMetrics } from '../../lib/tabBarMetrics';

LogBox.ignoreLogs(['setLayoutAnimationEnabledExperimental', 'SafeAreaView has been deprecated']);
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try { UIManager.setLayoutAnimationEnabledExperimental(true); } catch (e) {}
}

// ─── NOTIFICATION CONFIG ───
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true,
  }),
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const COLORS = [
  // row 1 — originals
  '#3B82F6', '#10B981', '#F59E0B', '#F43F5E', '#8B5CF6', '#2DD4BF', '#EC4899', '#64748B',
  // row 2 — expansion
  '#EF4444', '#F97316', '#EAB308', '#84CC16', '#06B6D4', '#6366F1', '#A855F7', '#92400E',
];
const REPEAT_OPTIONS = ['none', 'daily', 'weekly', 'monthly', 'custom'] as RecurType[];
const JS_DAY_MAP: Record<number, string> = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };
const JS_DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHAMSI_MONTHS = ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'];
const GREGORIAN_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ─── HELPER FUNCTIONS ───
const handleTimeChange = (t: string, setter: (s: string) => void) => {
  let raw = t.replace(/[^0-9]/g, ''); if (raw.length > 4) raw = raw.slice(0,4);
  if (raw.length >= 3) setter(`${raw.slice(0,2)}:${raw.slice(2,4)}`); else setter(raw);
};
const handleTimeBlur = (val: string, setter: (s: string) => void) => {
  let raw = val.replace(/[^0-9]/g, ''); if (!raw) { setter(''); return; }
  let h = 0, m = 0;
  if (raw.length <= 2) { h = parseInt(raw); } else if (raw.length === 3) { h = parseInt(raw.slice(0,1)); m = parseInt(raw.slice(1,3)); } else if (raw.length === 4) { h = parseInt(raw.slice(0,2)); m = parseInt(raw.slice(2,4)); }
  if (h > 23) h = 23; if (m > 59) m = 59;
  setter(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
};
const calculateProgress = (subTasks?: SubTask[]) => {
  if (!subTasks || subTasks.length === 0) return 0;
  return Math.round((subTasks.filter(x => x.completed).length / subTasks.length) * 100);
};

// RTL detection for Arabic/Persian characters — apply to title/notes/subtasks
const isRtl = (text?: string) => !!text && /[\u0600-\u06FF]/.test(text);
// For display Text — safe to switch writingDirection freely
const rtlTextStyle = (text?: string) => isRtl(text) ? { writingDirection: 'rtl' as const, textAlign: 'right' as const } : null;
// For editable TextInput — writingDirection mid-typing can drop characters on iOS/Android, so only flip alignment
const rtlInputStyle = (text?: string) => isRtl(text) ? { textAlign: 'right' as const } : null;
// Android-only: disable font padding so deep descenders (ر / ز / ژ) don't bump the TextInput's measured height.
// Ignored on iOS. Apply to every TextInput that can receive Persian/Arabic input.
const persianSafeInputStyle = { includeFontPadding: false as const };

// ─── CALENDAR MATH ───
function g2j(gy: number, gm: number, gd: number) {
  let g_d_m = [0,31,28,31,30,31,30,31,31,30,31,30,31]; let jy, jm, jd; let gy2=(gm>2)?(gy+1):gy;
  let days=355666+(365*gy)+Math.floor((gy2+3)/4)-Math.floor((gy2+99)/100)+Math.floor((gy2+399)/400)+gd+g_d_m.slice(0,gm).reduce((a,b)=>a+b,0);
  jy=-1595+33*Math.floor(days/12053);days%=12053;jy+=4*Math.floor(days/1461);days%=1461;
  if(days>365){jy+=Math.floor((days-1)/365);days=(days-1)%365;}
  jm=(days<186)?1+Math.floor(days/31):7+Math.floor((days-186)/30); jd=1+((days<186)?(days%31):((days-186)%30));return[jy,jm,jd];
}
function j2g(jy: number, jm: number, jd: number) {
  let gy=(jy<=979)?621:1600;jy-=(jy<=979)?0:979;
  let days=(365*jy)+Math.floor(jy/33)*8+Math.floor(((jy%33)+3)/4)+78+jd+((jm<7)?(jm-1)*31:((jm-7)*30)+186);
  gy+=400*Math.floor(days/146097);days%=146097; if(days>36524){gy+=100*Math.floor(--days/36524);days%=36524;if(days>=365)days++;}
  gy+=4*Math.floor(days/1461);days%=1461; if(days>365){gy+=Math.floor((days-1)/365);days=(days-1)%365;}
  let gd=days+1;let sal_a=[0,31,((gy%4===0&&gy%100!==0)||(gy%400===0))?29:28,31,30,31,30,31,31,30,31,30,31];
  let gm;for(gm=1;gm<=12;gm++){let v=sal_a[gm];if(gd<=v)break;gd-=v;}return[gy,gm,gd];
}
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

// ─── HABIT SCHEDULING ───────────────────────────────────────────────────────
// Ported from Timeline alongside the Deep Work / ADHD move so the ADHD pool can
// compute today's incomplete habits without re-importing Timeline internals.
function isHabitToday(h: Habit, today: string): boolean {
  if (h.status !== 'active') return false;
  if (h.scheduleType === 'days') {
    if (!h.frequency?.length) return true;
    const abbrs: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
    return h.frequency.includes(abbrs[new Date().getDay()]);
  }
  if (h.scheduleType === 'interval' && h.startDate && h.intervalDays) {
    const [sy, sm, sd] = h.startDate.split('-').map(Number);
    const [ty, tm, td] = today.split('-').map(Number);
    const diff = Math.floor((Date.UTC(ty, tm - 1, td) - Date.UTC(sy, sm - 1, sd)) / 86400000);
    return diff >= 0 && diff % h.intervalDays === 0;
  }
  return false;
}
const formatDisplayDate = (dStr: string, cal: CalendarSystem) => {
  if (!dStr) return ''; const [y, m, d] = dStr.split('-').map(Number);
  if (cal === 'shamsi') { const [jy, jm, jd] = g2j(y, m, d); return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`; }
  return dStr;
};

// ─── NEXT WAKE DATE ───
function calculateNextOccurrence(task: Task): string {
  const today = new Date(); const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (task.recurType === 'daily') { date.setDate(date.getDate() + 1); }
  else if (task.recurType === 'weekly' && task.recurDays && task.recurDays.length > 0) {
    const targetDayIndex = JS_DAY_SHORT.indexOf(task.recurDays[0]); let daysUntil = targetDayIndex - date.getDay();
    if (daysUntil <= 0) daysUntil += 7; date.setDate(date.getDate() + daysUntil);
  } else if (task.recurType === 'monthly' && task.recurDayOfMonth) {
    let nextMonth = date.getMonth() + 1; let year = date.getFullYear();
    if (nextMonth > 11) { nextMonth = 0; year += 1; }
    // Clamp to actual days-in-month — without this, "31st of every month" on
    // a Feb/Apr/Jun/Sep/Nov rollover causes setFullYear to spill into the
    // following month (Feb 31 → Mar 3), and subsequent recurrences then
    // anchor off the rolled date and drift permanently. With the clamp,
    // months without 31 land on their last day instead.
    const daysInTarget = new Date(year, nextMonth + 1, 0).getDate();
    const day = Math.min(task.recurDayOfMonth, daysInTarget);
    date.setFullYear(year, nextMonth, day);
  } else if (task.recurType === 'custom' && task.recurDays && task.recurDays.length > 0) {
    let found = false;
    for (let i = 1; i <= 7; i++) { date.setDate(date.getDate() + 1); if (task.recurDays.includes(JS_DAY_SHORT[date.getDay()])) { found = true; break; } }
    if (!found) date.setDate(date.getDate() + 1);
  } else { date.setDate(date.getDate() + 7); }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// ─── URGENCY & AUTO-SORTING ───
function getUrgency(t: Task): UrgencyLevel {
  if (!t.deadlineDate || t.completed) return 'none';
  const now = Date.now(); let deadlineMs: number;
  try {
    const [y,m,d] = t.deadlineDate.split('-').map(Number); const dt = new Date(y, m-1, d);
    if (t.deadlineTime) { const [h,mn]=t.deadlineTime.split(':').map(Number);dt.setHours(h,mn,0,0); } else dt.setHours(23,59,59,999);
    deadlineMs = dt.getTime();
  } catch { return 'none'; }
  if (deadlineMs < now) return 'overdue';
  const hoursLeft = (deadlineMs - now) / 3600000;
  if (hoursLeft <= 3) return 'critical'; if (hoursLeft <= 24) return 'high'; if (hoursLeft <= 72) return 'medium'; if (hoursLeft <= 168) return 'low';
  return 'none';
}
const sortTasks = (taskList: Task[]) => {
  const urgencyScore = (t: Task) => { const u = getUrgency(t); return u === 'overdue' ? 1000 : u === 'critical' ? 800 : u === 'high' ? 600 : u === 'medium' ? 400 : u === 'low' ? 200 : 0; };
  const priorityScore = (p: Priority) => p === 'High' ? 30 : p === 'Medium' ? 20 : 10;
  return [...taskList].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const scoreA = urgencyScore(a) + priorityScore(a.priority); const scoreB = urgencyScore(b) + priorityScore(b.priority);
    if (scoreA === scoreB) return b.createdAt - a.createdAt; return scoreB - scoreA;
  });
};

// ─── THEME ───
type Theme = { bg: string; surface: string; border: string; textMain: string; textSub: string; danger: string; warning: string; success: string; accent: string; };
function getTheme(mode: 'light' | 'dark' | 'blue'): Theme {
  switch (mode) {
    case 'blue':
      return { bg:'#0B1A2B', surface:'#122A40', border:'#1E3A52', textMain:'#E8F0F8', textSub:'#7FA0BC', danger:'#F43F5E', warning:'#F59E0B', success:'#10B981', accent:'#82AAFF' };
    case 'dark':
      return { bg:'#121214', surface:'#1C1C20', border:'#2C2C30', textMain:'#F4F4F5', textSub:'#8A8A92', danger:'#F43F5E', warning:'#F59E0B', success:'#10B981', accent:'#3B82F6' };
    default:
      return { bg:'#F8F9FA', surface:'#FFFFFF', border:'#E5E5EA', textMain:'#111111', textSub:'#888888', danger:'#F43F5E', warning:'#F59E0B', success:'#10B981', accent:'#3B82F6' };
  }
}
function hexToRgba(hex: string, a: number) {
  const h = hex.replace('#',''); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16); return `rgba(${r},${g},${b},${a})`;
}

// ─── CUSTOM UI COMPONENTS ───
const EmptyArt = ({ icon, message, theme }: { icon: any, message: string, theme: Theme }) => (
  <View style={{ alignItems: 'center', justifyContent: 'center', marginTop: 80, paddingHorizontal: 40, paddingBottom: 60 }}>
    <Feather name={icon} size={64} color={theme.textSub} style={{ opacity: 0.15, marginBottom: 20 }} />
    <Text style={{ color: theme.textSub, fontSize: 15, fontWeight: '700', textAlign: 'center', opacity: 0.6, lineHeight: 22 }}>{message}</Text>
  </View>
);

const CustomConfirmModal = ({ visible, title, message, destructiveLabel = "Delete", onCancel, onConfirm, theme }: any) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <View style={{ backgroundColor: theme.surface, width: '100%', maxWidth: 340, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.border }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: hexToRgba(theme.danger, 0.15), justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}><Feather name="alert-triangle" size={24} color={theme.danger} /></View>
        <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: '900', marginBottom: 8 }}>{title}</Text>
        <Text style={{ color: theme.textSub, fontSize: 14, lineHeight: 22, marginBottom: 24 }}>{message}</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity onPress={onCancel} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}><Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 14 }}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity onPress={onConfirm} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: theme.danger }}><Text style={{ color: '#FFF', fontWeight: '900', fontSize: 14 }}>{destructiveLabel}</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

const CalendarPicker = ({ value, onChange, theme, calSystem, minDate }: { value: string; onChange: (s: string) => void; theme: Theme; calSystem: CalendarSystem; minDate?: string; }) => {
  const isShamsi = calSystem === 'shamsi'; const today = new Date();
  const initYear = () => {
    if (value) { const [gy, gm, gd] = value.split('-').map(Number); if (isShamsi) { const [jy, jm] = g2j(gy, gm, gd); return { y: jy, m: jm }; } return { y: gy, m: gm }; }
    if (isShamsi) { const [jy,jm] = g2j(today.getFullYear(), today.getMonth()+1, today.getDate()); return { y: jy, m: jm }; }
    return { y: today.getFullYear(), m: today.getMonth()+1 };
  };
  const init = initYear(); const [vy, setVy] = useState(init.y); const [vm, setVm] = useState(init.m);
  const changeMonth = (dir: number) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); let nm = vm + dir, ny = vy; if (nm > 12) { nm = 1; ny++; } else if (nm < 1) { nm = 12; ny--; } setVm(nm); setVy(ny); };
  const buildGrid = () => { if (isShamsi) { const dim = vm <= 6 ? 31 : vm <= 11 ? 30 : 29; const [gy, gm, gd] = j2g(vy, vm, 1); const first = new Date(gy, gm-1, gd).getDay(); const offset = (first + 1) % 7; return { dim, offset }; } return { dim: new Date(vy, vm, 0).getDate(), offset: new Date(vy, vm-1, 1).getDay() }; };
  const { dim, offset } = buildGrid();
  const monthLabel = isShamsi ? `${SHAMSI_MONTHS[vm-1]} ${vy}` : `${GREGORIAN_MONTHS[vm-1]} ${vy}`;
  const wdays = isShamsi ? ['Sa','Su','Mo','Tu','We','Th','Fr'] : ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const isSelected = (d: number) => { let gy = vy, gm = vm, gd = d; if (isShamsi) [gy, gm, gd] = j2g(vy, vm, d); return value === `${gy}-${String(gm).padStart(2,'0')}-${String(gd).padStart(2,'0')}`; };
  const now = new Date(); now.setHours(0,0,0,0);
  return (
    <View style={{ backgroundColor: theme.bg, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: theme.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <TouchableOpacity onPress={() => changeMonth(-1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Feather name="chevron-left" size={18} color={theme.textMain} /></TouchableOpacity>
        <Text style={{ color: theme.textMain, fontWeight: '900', fontSize: 13 }}>{monthLabel}</Text>
        <TouchableOpacity onPress={() => changeMonth(1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Feather name="chevron-right" size={18} color={theme.textMain} /></TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {wdays.map((d, i) => <Text key={i} style={{ width: '14.28%', textAlign: 'center', color: theme.textSub, fontSize: 10, fontWeight: '900', paddingVertical: 4 }}>{d}</Text>)}
        {Array.from({ length: offset }).map((_, i) => <View key={`b${i}`} style={{ width: '14.28%', height: 32 }} />)}
        {Array.from({ length: dim }, (_, i) => i + 1).map(d => {
          const sel = isSelected(d); let gy = vy, gm = vm, gd = d; if (isShamsi) [gy, gm, gd] = j2g(vy, vm, d);
          const thisStr = `${gy}-${String(gm).padStart(2,'0')}-${String(gd).padStart(2,'0')}`;
          const isPast = new Date(gy, gm - 1, gd).getTime() < now.getTime();
          const beforeMin = !!minDate && thisStr < minDate;
          const isDisabled = isPast || beforeMin;
          return (
            <TouchableOpacity key={d} disabled={isDisabled} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(sel ? '' : thisStr); }} style={{ width: '14.28%', height: 32, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: sel ? theme.textMain : 'transparent', opacity: isDisabled ? 0.2 : 1 }}>
              <Text style={{ color: sel ? theme.bg : theme.textMain, fontWeight: sel ? '900' : '600', fontSize: 13 }}>{d}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

// ─── SWIPE ACTION RENDERERS (stable, defined outside component) ───
// eslint-disable-next-line react/display-name -- Swipeable render callback, not a component
const makeTaskRightActions = (theme: Theme) => (p: any, d: any) => {
  const scale = d.interpolate({ inputRange: [-100, 0], outputRange: [1, 0.5], extrapolate: 'clamp' });
  return (
    <View style={{ backgroundColor: theme.danger, width: '100%', justifyContent: 'center', alignItems: 'flex-end', paddingRight: 24, marginBottom: 12, borderRadius: 16 }}>
      <RNAnimated.View style={{ transform: [{ scale }] }}><Feather name="trash-2" size={24} color="#FFF" /></RNAnimated.View>
    </View>
  );
};
// eslint-disable-next-line react/display-name -- Swipeable render callback, not a component
const makeTaskLeftActions = (theme: Theme) => (p: any, d: any) => {
  const scale = d.interpolate({ inputRange: [0, 100], outputRange: [0.5, 1], extrapolate: 'clamp' });
  return (
    <View style={{ backgroundColor: theme.textMain, width: '100%', justifyContent: 'center', alignItems: 'flex-start', paddingLeft: 24, marginBottom: 12, borderRadius: 16 }}>
      <RNAnimated.View style={{ transform: [{ scale }] }}><Feather name="archive" size={24} color={theme.bg} /></RNAnimated.View>
    </View>
  );
};

// ─── MEMOIZED TASK CARD ───
// urgency is pre-computed in feedData — zero date math at render time
const TaskCard = React.memo(function TaskCard({
  task, urgency, isExp, isSeed, delayIdx, isFirstInFolder, indentInFolder, theme, calSystem, activeProjects,
  onCheck, onSubCheck, onTrash, onArchive, onEdit, onExpand, onReclaim, onRest
}: any) {
  const isUrgent = urgency === 'overdue' || urgency === 'critical' || urgency === 'high';

  // Stable swipe renderers — memoized per theme, Swipeable never gets a new ref
  const renderRightActions = useMemo(() => makeTaskRightActions(theme), [theme]);
  const renderLeftActions = useMemo(() => makeTaskLeftActions(theme), [theme]);

  // Lifeless state — deadline passed, task not completed. Colors drain to grey;
  // only the red date pill retains its alarm-color. The card still reads as a task,
  // just one that the world has moved past.
  const isDead = urgency === 'overdue' && !task.completed;
  const deadColor = theme.textSub; // muted grey for title + checkbox + border when dead

  // Promise visual state — drives the left accent stripe + "kept/broken"
  // micro-badge. `isBroken` is permanent (set ONCE by the sweep), so it
  // persists even after the user later completes or archives the task —
  // the scar doesn't fade. `isKept` is also permanent (set on completion
  // before deadline). `isPromisePending` covers the live, in-flight state
  // — promised, not yet kept or broken.
  const isBroken = !!task.promiseBrokenAt;
  const isKept = !!task.promiseKeptAt;
  const isPromisePending = !!task.promised && !isBroken && !isKept;
  const promiseStripeWidth = (task.promised || isBroken || isKept) ? 5 : 3;

  if (isSeed && !isExp && !task.completed) {
    const daysAgo = Math.floor((Date.now() - (task.lastTouchedAt || task.createdAt)) / 86400000);
    return (
      <View style={{ marginBottom: 16, borderWidth: 1, borderLeftWidth: 4, borderColor: theme.border, borderLeftColor: '#10B981', borderRadius: 16, overflow: 'hidden', backgroundColor: theme.surface }}>
        <View style={{ padding: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <Text style={{ fontSize: 22 }}>🌱</Text>
            <View style={{ flex: 1 }}>
              <Text style={[{ color: theme.textMain, fontSize: 18, fontWeight: '800' }, rtlTextStyle(task.text)]}>{task.text}</Text>
              <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginTop: 3 }}>Planted {daysAgo} days ago.</Text>
            </View>
          </View>
          <Text style={{ color: theme.textSub, fontSize: 12, lineHeight: 18, marginBottom: 16, opacity: 0.8 }}>This task has been sitting untouched for over a month. It might be time to either take action, or let it go.</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={() => onReclaim(task.id)} style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: '#10B981', alignItems: 'center' }}><Text style={{ color: '#10B981', fontSize: 13, fontWeight: '900' }}>Take Action</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => onTrash(task)} style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}><Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '700' }}>Let it go</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View
      style={{ paddingHorizontal: indentInFolder ? 16 : 0, paddingBottom: indentInFolder && !isExp && task.completed ? 8 : 0, marginTop: isFirstInFolder ? 16 : 0 }}
    >
      <Swipeable renderLeftActions={renderLeftActions} renderRightActions={renderRightActions} onSwipeableOpen={dir => { if (dir === 'right') onTrash(task); else if (dir === 'left') onArchive(task); }}>
        <View style={{ marginBottom: 12, backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderLeftWidth: promiseStripeWidth, borderColor: theme.border, borderLeftColor: isBroken ? theme.textSub : (isDead ? deadColor : task.color), overflow: 'hidden', opacity: task.completed ? 0.65 : 1 }}>
          <TouchableOpacity activeOpacity={0.85} onLongPress={() => onEdit(task)} delayLongPress={250} onPress={() => onExpand(task.id)} style={{ flexDirection: 'row', alignItems: 'center', padding: 18 }}>
            <TouchableOpacity onPress={() => onCheck(task.id)} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }} style={{ marginRight: 16 }}>
              {(task.subTasks || []).length > 0 ? (
                <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: isDead ? deadColor : task.color, overflow: 'hidden', justifyContent: 'flex-end' }}>
                  <View style={{ height: `${task.progress}%`, backgroundColor: isDead ? deadColor : task.color, width: '100%' }} />
                </View>
              ) : (
                <Feather name={task.completed ? "check-circle" : "circle"} size={26} color={isDead ? deadColor : task.color} />
              )}
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={[{ color: isDead ? theme.textSub : theme.textMain, fontSize: 17, fontWeight: isDead ? '600' : '800', marginBottom: 6, textDecorationLine: task.completed ? 'line-through' : 'none' }, rtlTextStyle(task.text)]} numberOfLines={isExp ? undefined : 2}>{task.text}</Text>

              {isDead ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', fontStyle: 'italic' }}>Deadline passed</Text>
                  {/* Broken promise scar — stays visible in the dead state so
                      the user sees the cost of the missed commitment. */}
                  {isBroken ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5, borderWidth: 1, borderColor: theme.border }}>
                      <Feather name="shield-off" size={9} color={theme.textSub} />
                      <Text style={{ fontSize: 9, fontWeight: '900', color: theme.textSub, letterSpacing: 0.5, opacity: 0.8 }}>BROKEN</Text>
                    </View>
                  ) : null}
                </View>
              ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {task.deadlineDate ? (
                  isUrgent && !task.completed ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: hexToRgba(theme.danger, 0.1), gap: 6 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.danger }} />
                      <Text style={{ color: theme.danger, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 }}>{(formatDisplayDate(task.deadlineDate, calSystem) + (task.deadlineTime ? `, ${task.deadlineTime}` : '')).toUpperCase()}</Text>
                    </View>
                  ) : (
                    <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textSub, marginRight: 4 }}>{formatDisplayDate(task.deadlineDate, calSystem)}</Text>
                  )
                ) : null}

                {task.priority !== 'Low' && !task.completed ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: theme.border, gap: 6 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: task.priority === 'High' ? theme.warning : '#3B82F6' }} />
                    <Text style={{ fontSize: 10, fontWeight: '900', color: task.priority === 'High' ? theme.warning : '#3B82F6', letterSpacing: 0.5 }}>{task.priority.toUpperCase()}</Text>
                  </View>
                ) : null}

                {task.hasReminder && !task.completed ? <Feather name="bell" size={12} color={theme.textSub} style={{ opacity: 0.7 }} /> : null}

                {/* Promise micro-badge — three exclusive states. Pending shows
                    the shield icon only (the stripe carries the color cue);
                    Kept/Broken show a small text label so the permanent
                    record is legible at a glance. Broken stays even after
                    completion/archive — the scar is the point. */}
                {isPromisePending ? (
                  <Feather name="shield" size={11} color={task.color} style={{ opacity: 0.9 }} />
                ) : null}
                {isKept ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5, backgroundColor: hexToRgba(theme.success, 0.12) }}>
                    <Feather name="shield" size={9} color={theme.success} />
                    <Text style={{ fontSize: 9, fontWeight: '900', color: theme.success, letterSpacing: 0.5 }}>KEPT</Text>
                  </View>
                ) : null}
                {isBroken ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5, borderWidth: 1, borderColor: theme.border }}>
                    <Feather name="shield-off" size={9} color={theme.textSub} />
                    <Text style={{ fontSize: 9, fontWeight: '900', color: theme.textSub, letterSpacing: 0.5, opacity: 0.8 }}>BROKEN</Text>
                  </View>
                ) : null}
              </View>
              )}
            </View>
          </TouchableOpacity>

          {isExp && !task.completed ? (
            <View style={{ paddingHorizontal: 18, paddingBottom: 18, paddingTop: 6 }}>
              {/* Metadata strip — shows fields that are set but not already on the collapsed card */}
              {(() => {
                const proj = task.projectId && activeProjects ? activeProjects.find((p: any) => p.id === task.projectId) : null;
                const hasStart = !!task.startDate;
                const hasRecur = task.recurType && task.recurType !== 'none';
                const offsetLabel = task.reminderOffsetDays === 1 ? '1 day before' : task.reminderOffsetDays === 2 ? '2 days before' : task.reminderOffsetDays === 7 ? '1 week before' : task.hasReminder ? 'same day' : null;
                const showStrip = proj || hasStart || hasRecur || (task.hasReminder && offsetLabel);
                if (!showStrip) return null;
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                    {proj ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: proj.color }} />
                        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700' }}>{proj.name}</Text>
                      </View>
                    ) : null}
                    {hasStart ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Feather name="play" size={10} color={theme.textSub} />
                        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700' }}>Start {formatDisplayDate(task.startDate, calSystem)}</Text>
                      </View>
                    ) : null}
                    {task.hasReminder && offsetLabel ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Feather name="bell" size={10} color={theme.textSub} />
                        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700' }}>{offsetLabel}{task.reminderTime ? ` · ${task.reminderTime}` : ''}</Text>
                      </View>
                    ) : null}
                    {hasRecur ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Feather name="repeat" size={10} color={theme.textSub} />
                        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', textTransform: 'capitalize' }}>{task.recurType}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })()}
              {task.notes ? <Text style={[{ color: theme.textSub, fontSize: 14, marginBottom: 16 }, rtlTextStyle(task.notes)]}>{task.notes}</Text> : null}

              {(task.subTasks || []).length > 0 ? (
                <View style={{ marginBottom: 4, paddingLeft: 8 }}>
                  {(task.subTasks || []).map((sub: SubTask, index: number) => (
                    <View key={sub.id} style={{ flexDirection: 'row', alignItems: 'center', height: 32, gap: 12 }}>
                      <View style={{ position: 'absolute', left: 4, top: 0, bottom: index === task.subTasks.length - 1 ? '50%' : 0, width: 1.5, backgroundColor: theme.border }} />
                      <TouchableOpacity onPress={() => onSubCheck(task.id, sub.id)} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: sub.completed ? theme.border : task.color, zIndex: 2 }} />
                      <Text style={[{ flex: 1, color: sub.completed ? theme.textSub : theme.textMain, fontSize: 14, fontWeight: sub.completed ? '500' : '600', textDecorationLine: sub.completed ? 'line-through' : 'none', opacity: sub.completed ? 0.5 : 1 }, rtlTextStyle(sub.text)]}>{sub.text}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Action row. Overdue tasks swap Archive → Rest because that's
                  the actually-useful move when a deadline has passed: snooze
                  it forward and bring it back when the user can engage. Edit
                  (lets them change the deadline) and Trash (lets it go) stay
                  on both variants. */}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                <TouchableOpacity onPress={() => onEdit(task)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg }}><Feather name="edit-3" size={14} color={theme.textSub} /><Text style={{ fontSize: 12, fontWeight: '800', color: theme.textSub }}>Edit</Text></TouchableOpacity>
                {isDead && onRest ? (
                  <TouchableOpacity onPress={() => onRest(task)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg }}><Feather name="moon" size={14} color={theme.textSub} /><Text style={{ fontSize: 12, fontWeight: '800', color: theme.textSub }}>Rest</Text></TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => onArchive(task)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg }}><Feather name="archive" size={14} color={theme.textSub} /><Text style={{ fontSize: 12, fontWeight: '800', color: theme.textSub }}>Archive</Text></TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => onTrash(task)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: hexToRgba(theme.danger, 0.2), backgroundColor: theme.bg }}><Feather name="trash-2" size={14} color={theme.danger} /><Text style={{ fontSize: 12, fontWeight: '800', color: theme.danger }}>Trash</Text></TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      </Swipeable>
    </View>
  );
}, (prev, next) => {
  // Deep field check — prev.task === next.task is always false after Zustand spreads
  return (
    prev.task.id === next.task.id &&
    prev.task.text === next.task.text &&
    prev.task.completed === next.task.completed &&
    prev.task.progress === next.task.progress &&
    prev.task.color === next.task.color &&
    prev.task.priority === next.task.priority &&
    prev.task.deadlineDate === next.task.deadlineDate &&
    prev.task.deadlineTime === next.task.deadlineTime &&
    prev.task.hasReminder === next.task.hasReminder &&
    prev.task.notes === next.task.notes &&
    prev.task.subTasks === next.task.subTasks &&
    prev.task.projectId === next.task.projectId &&
    prev.task.promised === next.task.promised &&
    prev.task.promiseBrokenAt === next.task.promiseBrokenAt &&
    prev.task.promiseKeptAt === next.task.promiseKeptAt &&
    prev.urgency === next.urgency &&
    prev.isExp === next.isExp &&
    prev.isSeed === next.isSeed &&
    prev.indentInFolder === next.indentInFolder &&
    prev.theme === next.theme &&
    prev.calSystem === next.calSystem &&
    prev.activeProjects === next.activeProjects
  );
});

// ─── MAIN TODO SCREEN ───
export default function TodoScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  // Exact rendered tab-bar height (measured via onLayout in AnimatedTabBar).
  // The nav hook above is close but not pixel-identical to what the bar paints,
  // so the quick-add bar keys its keyboard offset off this instead. Falls back
  // to the hook value for the first frame before onLayout has fired.
  const measuredTabBarH = useTabBarMetrics(s => s.height);
  const { height: windowH } = useWindowDimensions();

  const { tasks, projects, isDarkMode, calendarType, toggleCalendar, setTasks, setProjects, addOrUpdateProject, deleteProject, markWhisperSeen } = useAppStore();
  const habits = useAppStore(s => s.habits) as Habit[];
  const challenges = useAppStore(s => s.challenges) as Challenge[];
  const deepWorkSessions = useAppStore(s => s.deepWorkSessions);
  const addDeepWorkSession = useAppStore(s => s.addDeepWorkSession);
  const deleteDeepWorkSession = useAppStore(s => s.deleteDeepWorkSession);
  const toggleHabitAction = useAppStore(s => s.toggleHabitAction);
  // Progressive feature unlocks — one reactive hook per gated feature. All
  // gating logic in this file routes through these booleans; the FEATURE_IDS
  // constants from lib/unlocks.ts are the single source of truth for keys.
  // isUnlocked drives "render or not"; isNew drives the new-dot indicator
  // AND the FadeIn entrance animation (each plays until the user touches the
  // section, at which point markDotSeen clears both).
  const subtasksUnlocked = useIsUnlocked(FEATURE_IDS.SUBTASKS);
  const subtasksIsNew = useIsNew(FEATURE_IDS.SUBTASKS);
  const promiseUnlocked = useIsUnlocked(FEATURE_IDS.PROMISE);
  const promiseIsNew = useIsNew(FEATURE_IDS.PROMISE);
  const deepWorkUnlocked = useIsUnlocked(FEATURE_IDS.DEEP_WORK);
  const recurringUnlocked = useIsUnlocked(FEATURE_IDS.RECURRING);
  const recurringIsNew = useIsNew(FEATURE_IDS.RECURRING);
  const projectsUnlocked = useIsUnlocked(FEATURE_IDS.PROJECTS);
  const projectsIsNew = useIsNew(FEATURE_IDS.PROJECTS);
  const adhdModeUnlocked = useIsUnlocked(FEATURE_IDS.ADHD_MODE);
  const markDotSeen = useAppStore(s => s.markDotSeen);
  // Promise stats — separate selector so the inbox banner doesn't re-render
  // when unrelated slices of state change.
  const promiseStats = useAppStore(s => s.promiseStats);
  const recordPromiseMade = useAppStore(s => s.recordPromiseMade);
  const recordPromiseKept = useAppStore(s => s.recordPromiseKept);
  const recordPromiseBroken = useAppStore(s => s.recordPromiseBroken);
  const syncPromiseMonth = useAppStore(s => s.syncPromiseMonth);
  const themeMode = useAppStore(s => s.themeMode);
  const theme = useMemo(() => getTheme(themeMode), [themeMode]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  // Once we've auto-expanded the most-urgent project on tab focus (smart
  // auto-expand), the ref blocks re-firing. Whether the user collapsed it,
  // expanded a different one, or left the auto-expand alone — all three count
  // as "they've seen the tab now," so we don't override their state on
  // subsequent focuses. Resets on app restart (refs are session-scoped).
  const autoExpandedRef = useRef(false);
  const [quickTaskText, setQuickTaskText] = useState('');
  const [scheduledOpen, setScheduledOpen] = useState(false);
  // Keyboard handling is now owned by react-native-keyboard-controller — KeyboardStickyView for the quick-add bar,
  // KeyboardAwareScrollView inside the task edit Modal. No more manual Keyboard.addListener + kbHeight math.

  // ── Whisper system ──
  const [whisperText, setWhisperText] = useState<string | null>(null);
  const lastWhisperRef = useRef(0);
  const showWhisper = useCallback((text: string) => {
    if (Date.now() - lastWhisperRef.current < 10000) return;
    lastWhisperRef.current = Date.now();
    setWhisperText(text);
    setTimeout(() => setWhisperText(null), 4000);
  }, []);


  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const vaultSheetRef = useRef<BottomSheetModal>(null);
  const projectFolderSheetRef = useRef<BottomSheetModal>(null);
  const projectModalRef = useRef<BottomSheetModal>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  const snapPoints = useMemo(() => ['90%'], []);
  const projectModalSnapPoints = useMemo(() => ['80%'], []);
  // Lock the sheet's top position so it can't expand upward when the keyboard opens.
  // Sheet snap 80% from bottom → top sits at 20% from top → topInset = 20% of window.
  // This gives ~340px visible above a ~300px keyboard: 250px content + ~90px whitespace buffer.
  const projectModalTopInset = useMemo(() => Math.round(windowH * 0.2), [windowH]);
  const [sheetIndex, setSheetIndex] = useState(-1);

  useEffect(() => {
    const backAction = () => {
      if (taskModalVisible) { setTaskModalVisible(false); return true; }
      if (sheetIndex >= 0) {
        projectModalRef.current?.dismiss();
        vaultSheetRef.current?.dismiss();
        projectFolderSheetRef.current?.dismiss();
        return true;
      }
      return false;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [sheetIndex, taskModalVisible]);

  const renderBackdrop = useCallback((props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.6} />, []);

  // ── Keyboard-driven sheet bottom padding ──
  const kbAnim = useReanimatedKeyboardAnimation();
  const sheetBottomPadStyle = useAnimatedStyle(() => ({
    paddingBottom: (Math.max(insets.bottom, 16) + 16) * (1 - kbAnim.progress.value),
  }));

  // ── Pull-to-reveal tools: Deep Work + ADHD tiles ──────────────────────────
  // Tiles live as the FlashList's ListHeaderComponent. On every tab focus we
  // scroll the list past them (to NAV_HEIGHT - PEEK) so the user lands on
  // tasks, not tools — the tab reads as "tasks first." Pulling/scrolling up
  // reveals the tiles via the platform's own scroll mechanics: GPU-driven,
  // never touches layout, frame-perfect on both iOS and Android. PEEK leaves
  // a thin strip of the tile bottoms visible as a discovery hint so first
  // time users know the row exists.
  //
  // Previous version drove the tile container's `height` via a Reanimated
  // shared value off a Pan gesture. That works fine above a plain ScrollView
  // (which is what Timeline uses), but a height-changing parent forces a
  // virtualized FlashList to re-measure its viewport on every animation
  // frame — devastating jank with a long task list. This rebuild drops the
  // entire worklet apparatus and leans on native scroll, which is what
  // every well-behaved mail/list app does.
  const NAV_HEIGHT = 74; // marginTop 8 + tile row ~52 + marginBottom 14
  const PEEK = 14;
  const listRef = useRef<any>(null);

  // Modal States
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [activeProjectFolderId, setActiveProjectFolderId] = useState<string | null>(null);
  const [vaultTab, setVaultTab] = useState<'trash' | 'archived' | 'projects'>('trash');
  // Tap-to-expand for archived project folders — without this, tasks inside
  // an archived project are completely inaccessible (filtered out of the
  // main feed by archivedProjectIds, not surfaced in the Archived tab
  // either). Tapping a folder reveals its tasks read-only so users can
  // see what's inside before deciding to restore or delete the project.
  const [expandedArchivedProjectId, setExpandedArchivedProjectId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ visible: boolean, title: string, message: string, destructiveLabel: string, onConfirm: () => void } | null>(null);

  // ── Pull-from-inbox picker ── shown from the empty-today CTA. Single-tap
  // promotes an inbox task to today (stamps startDate = today). Multi-select
  // would invite the user to over-commit; the single-tap-and-close shape
  // matches the "what's the ONE thing today is for" framing.
  const [pickFromInboxVisible, setPickFromInboxVisible] = useState(false);

  // ── Rest picker ── shown when the user taps "Rest" on an overdue task.
  // Holds the target task so the modal can show "rest WHICH task" + apply
  // the wake date to the correct id. Closed by selecting an option or by
  // tapping the backdrop.
  const [restTarget, setRestTarget] = useState<Task | null>(null);

  // ── Delete-project modal ── replaces a plain confirm dialog because we
  // surface an opt-in toggle: by default the project's tasks move back to
  // Inbox (safer, the user usually wants them somewhere), with a toggle to
  // bulk-trash them alongside the project. Default off so a casual tap on
  // "Delete project" doesn't nuke a folder of work.
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [deleteProjectAlsoTasks, setDeleteProjectAlsoTasks] = useState(false);

  // ── Deep Work state ──
  const [dwPickerVisible, setDwPickerVisible] = useState(false);
  const [dwFocusVisible, setDwFocusVisible] = useState(false);
  const [dwReflectVisible, setDwReflectVisible] = useState(false);
  const [dwIntent, setDwIntent] = useState<DeepWorkIntent>('free');
  const [dwTargetId, setDwTargetId] = useState<string | undefined>();
  const [dwTargetTitle, setDwTargetTitle] = useState<string>('');
  const [dwFreeLabel, setDwFreeLabel] = useState<string>('');
  const [dwDurationMin, setDwDurationMin] = useState<number>(45);
  const [dwCustomMin, setDwCustomMin] = useState<string>('');
  const [dwOpenMode, setDwOpenMode] = useState<boolean>(false);
  const [dwSession, setDwSession] = useState<{ startedAt: number; durationMs: number; intent: DeepWorkIntent; targetId?: string; targetTitle: string; open: boolean } | null>(null);
  const [dwNow, setDwNow] = useState<number>(Date.now());
  const [dwReflectionRating, setDwReflectionRating] = useState<DayRating | null>(null);
  const [dwReflectionText, setDwReflectionText] = useState<string>('');
  // Mark-done toggle on the reflection sheet — only meaningful when the session
  // was tied to a task / habit / challenge. Holds the user's choice until they
  // tap Save, at which point saveDeepWorkReflection applies the appropriate
  // action (complete task, log habit, +1 challenge). Reset alongside the other
  // reflection state so re-entering the sheet never carries over a stale opt-in.
  const [dwMarkDone, setDwMarkDone] = useState<boolean>(false);
  const [dwCelebrating, setDwCelebrating] = useState(false);
  const [dwHistoryVisible, setDwHistoryVisible] = useState(false);
  const [dwHistoryExpanded, setDwHistoryExpanded] = useState<string | null>(null);

  // ── ADHD mode state ──
  const [adhdVisible, setAdhdVisible] = useState(false);
  const [adhdCelebrating, setAdhdCelebrating] = useState(false);
  const [adhdJustDone, setAdhdJustDone] = useState<string>('');

  // Task Form States
  const [txt, setTxt] = useState(''); const [notes, setNotes] = useState(''); const [color, setColor] = useState(COLORS[0]);
  const [priority, setPriority] = useState<Priority>('Medium'); const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [calOpen, setCalOpen] = useState(false); const [startDate, setStartDate] = useState(''); const [deadlineDate, setDeadlineDate] = useState(''); const [deadlineTime, setDeadlineTime] = useState('');
  const [dateTab, setDateTab] = useState<'start' | 'due'>('due');
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
  const [reminderOffsetDays, setReminderOffsetDays] = useState<number>(0);
  const flashScheduleNotice = useCallback((msg: string) => {
    setScheduleNotice(msg);
    setTimeout(() => setScheduleNotice(null), 3000);
  }, []);
  const [hasReminder, setHasReminder] = useState(false); const [reminderTime, setReminderTime] = useState('');
  const [recurType, setRecurType] = useState<RecurType>('none'); const [recurDays, setRecurDays] = useState<string[]>([]); const [recurDayOfMonth, setRecurDayOfMonth] = useState<number | undefined>(undefined);
  const [subTasks, setSubTasks] = useState<SubTask[]>([]); const [newSubTxt, setNewSubTxt] = useState(''); const [err, setErr] = useState('');
  // Promise toggle — see store comment for semantics. We only track the
  // *current* boolean here; the editor doesn't surface scar state.
  const [promised, setPromised] = useState<boolean>(false);

  // Project Form States
  const [newProjName, setNewProjName] = useState(''); const [newProjColor, setNewProjColor] = useState(COLORS[0]);

  // ─── PHOENIX & NOTIFICATIONS ───
  // getState() — no stale closure, `tasks` removed from deps
  const wakePhoenixTasks = useCallback(() => {
    const currentTasks = useAppStore.getState().tasks;
    let changed = false; const today = todayStr();
    const updated = currentTasks.map((t): Task => {
      if (t.status !== 'resting') return t;
      // Wake when EITHER the explicit nextWakeDate has arrived (set by code
      // that wants a controlled re-surface independent of deadline) OR the
      // deadline itself has arrived. Previously only deadlineDate was checked
      // — nextWakeDate was a defined Task field with no readers, which silently
      // broke any caller relying on it.
      const wakeAnchor = t.nextWakeDate || t.deadlineDate;
      if (wakeAnchor && wakeAnchor <= today) { changed = true; return { ...t, status: undefined, nextWakeDate: undefined }; }
      return t;
    });
    if (changed) setTasks(updated);
  }, [setTasks]);

  // ── PROMISE SWEEP ── stamp `promiseBrokenAt` on any promised, uncompleted
  // task whose deadline has passed. Runs on focus alongside the phoenix
  // wake. Each newly-broken promise increments the broken counter. The
  // scar is permanent — completing or archiving the task afterward will
  // not clear `promiseBrokenAt`.
  //
  // We also call `syncPromiseMonth` here to handle the edge case where
  // the user opens the app after a month boundary without making any
  // new promises (which would otherwise be the only trigger to roll the
  // monthly counter).
  const sweepBrokenPromises = useCallback(() => {
    const state = useAppStore.getState();
    state.syncPromiseMonth();
    const currentTasks = state.tasks;
    const now = Date.now();
    let brokenCount = 0;
    const updated = currentTasks.map((t): Task => {
      if (!t.promised) return t;
      if (t.completed) return t;
      if (t.promiseBrokenAt) return t;        // already scarred — no-op
      if (t.promiseKeptAt) return t;          // kept already — won't break
      if (!t.deadlineDate) return t;          // no deadline = no breakable moment
      if (t.status === 'trash' || t.status === 'archived') return t;
      // Compute the same end-of-day deadline boundary getUrgency uses, so
      // a "due today" task with no time isn't flagged broken at 00:00.
      let deadlineMs: number;
      try {
        const [y, m, d] = t.deadlineDate.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        if (t.deadlineTime) {
          const [h, mn] = t.deadlineTime.split(':').map(Number);
          dt.setHours(h, mn, 0, 0);
        } else {
          dt.setHours(23, 59, 59, 999);
        }
        deadlineMs = dt.getTime();
      } catch {
        return t;
      }
      if (deadlineMs >= now) return t;        // not yet past deadline
      brokenCount++;
      return { ...t, promiseBrokenAt: now };
    });
    if (brokenCount > 0) {
      setTasks(updated);
      // Fire one increment per detected break. Done outside the map to
      // keep the iteration referentially clean — no side effects inside
      // the mapper.
      for (let i = 0; i < brokenCount; i++) recordPromiseBroken();
    }
  }, [setTasks, recordPromiseBroken]);

  // Per-focus side-effects. Stable deps so this only fires on actual focus
  // events — not on every expand/collapse interaction, which would otherwise
  // yank the user's scroll position back to the header. Wake resting tasks,
  // sweep broken promises, ensure notification permission, and land past the
  // tile-row header. requestAnimationFrame defers one frame past initial
  // render so the FlashList has its content sized before we scroll.
  useFocusEffect(useCallback(() => {
    wakePhoenixTasks();
    sweepBrokenPromises();
    const checkPermissions = async () => {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') await Notifications.requestPermissionsAsync();
    };
    checkPermissions();
    requestAnimationFrame(() => {
      // The ListHeaderComponent now holds ONLY the Deep Work tile (ADHD Mode
      // moved to the tab header as a view-switcher). So the header exists iff
      // Deep Work is unlocked — when it's locked the list has no header to
      // scroll past and we land at offset 0 with the first task visible.
      // isUnlocked() also honours the returning-user allFeaturesUnlocked
      // override, which a raw unlockedFeatures lookup would miss.
      const hasHeader = isUnlocked(FEATURE_IDS.DEEP_WORK);
      const offset = hasHeader ? NAV_HEIGHT - PEEK : 0;
      listRef.current?.scrollToOffset({ offset, animated: false });
    });
  }, [wakePhoenixTasks, sweepBrokenPromises]));

  // Smart auto-expand — separated from the per-focus effect above so its
  // dependency on expandedProjectId doesn't cause the scrollToOffset there to
  // re-fire every time the user expands or collapses a project. Ref-guarded
  // so it never repeats once it's fired once this session; respects every
  // form of user override (manual collapse, opening a different project).
  useFocusEffect(useCallback(() => {
    if (autoExpandedRef.current) return;
    if (expandedProjectId !== null) return;
    const state = useAppStore.getState();
    const archivedIds = new Set(state.projects.filter(p => p.status === 'archived').map(p => p.id));
    const candidates = state.tasks.filter(x =>
      x.status !== 'trash' && x.status !== 'archived' && x.status !== 'resting' &&
      !x.completed && x.projectId && !archivedIds.has(x.projectId)
    );
    const rank = (u: UrgencyLevel) => u === 'overdue' ? 5 : u === 'critical' ? 4 : u === 'high' ? 3 : 0;
    let bestProj: string | undefined;
    let bestRank = 0;
    for (const t of candidates) {
      const r = rank(getUrgency(t));
      if (r >= 3 && r > bestRank) {
        bestProj = t.projectId;
        bestRank = r;
      }
    }
    if (bestProj) {
      setExpandedProjectId(bestProj);
      autoExpandedRef.current = true;
    }
  }, [expandedProjectId]));

  // The Tasks-tab unlock check used to live here as a local migration +
  // runtime-check useEffect pair (against lib/taskUnlocks). Both are gone now
  // — the central trigger engine in app/_layout.tsx evaluates lib/unlockTriggers
  // on every snapshot change, so per-tab effects are obsolete. The counter
  // (incrementTotalTasksCreated) and the active-count selector in the root
  // layout drive the same thresholds without scattered checks.

  const scheduleNotificationForTask = async (taskData: Partial<Task>): Promise<string | undefined> => {
    if (!taskData.hasReminder || !taskData.deadlineDate || !taskData.reminderTime || taskData.completed) return undefined;
    try {
      const [y, m, d] = taskData.deadlineDate.split('-').map(Number); const [h, mn] = taskData.reminderTime.split(':').map(Number);
      const offset = taskData.reminderOffsetDays || 0;
      const triggerDate = new Date(y, m - 1, d - offset, h, mn, 0);
      if (triggerDate.getTime() > Date.now()) {
        const offsetLabel = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : `in ${offset} days`;
        const body = taskData.notes ? taskData.notes.substring(0, 80) : (offset > 0 ? `Due ${offsetLabel} at ${taskData.deadlineTime || taskData.reminderTime}` : `Reminder for task due at ${taskData.deadlineTime || 'today'}`);
        return await Notifications.scheduleNotificationAsync({
          content: { title: taskData.priority === 'High' ? `🔴 ${taskData.text}` : taskData.text, body, sound: true },
          // channelId on the Android trigger routes through the MAX-importance
          // task-reminders channel created in lib/notifChannels.ts so the alert
          // pops up as a heads-up banner instead of sitting silently in the tray.
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate, channelId: TASK_CHANNEL_ID },
        });
      }
    } catch (e) { console.error("Failed to schedule notification:", e); }
    return undefined;
  };
  const cancelTaskNotification = async (notificationId?: string) => {
    // Swallow errors — already-fired, already-cancelled, or invalid IDs all
    // throw on some Android versions, and propagating that aborts the
    // save-flow await chain (the new notificationId never gets persisted,
    // leaving the task stamped with the OLD id pointing at nothing).
    if (!notificationId) return;
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    } catch {
      // The notification's gone either way; nothing to recover.
    }
  };

  // ─── OPTIMISTIC ACTIONS — all use getState() to avoid stale closures ───
  const handleQuickAdd = useCallback(() => {
    // ── The Void easter egg: exactly one space — creates an empty, uncompleted task ──
    if (quickTaskText === ' ') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const now = Date.now();
      const voidTask: Task = { id: now.toString(), text: ' ', notes: '', completed: false, createdAt: now, deadlineDate: '', deadlineTime: '', hasReminder: false, priority: 'Low', color: COLORS[7], subTasks: [], hasProgress: false, progress: 0, recurType: 'none', lastTouchedAt: now };
      setTasks([...useAppStore.getState().tasks, voidTask]);
      // Void still counts toward the unlock counter — it's a real (if weird)
      // task creation, and excluding it would be a side channel.
      useAppStore.getState().incrementTotalTasksCreated();
      setQuickTaskText('');
      return;
    }
    if (!quickTaskText.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const now = Date.now();
    const currentTasks = useAppStore.getState().tasks;
    const seen = useAppStore.getState().whispersSeen || {};
    const fireFirstTask = currentTasks.length === 0 && !seen['first_task'];
    const newT: Task = { id: now.toString(), text: quickTaskText.trim(), notes: '', completed: false, createdAt: now, deadlineDate: '', deadlineTime: '', hasReminder: false, priority: 'Medium', color: COLORS[1], subTasks: [], hasProgress: false, progress: 0, recurType: 'none', lastTouchedAt: now };
    setTasks([...currentTasks, newT]);
    // Monotonic counter — feeds the SUBTASKS / RECURRING / PROJECTS triggers.
    useAppStore.getState().incrementTotalTasksCreated();
    setQuickTaskText('');
    if (fireFirstTask) {
      markWhisperSeen('first_task');
      setTimeout(() => showWhisper("First task captured. The list begins."), 450);
    }
  }, [quickTaskText, setTasks, markWhisperSeen, showWhisper]);

  const handleSaveTaskFromSheet = useCallback(async () => {
    // ── The Void easter egg from sheet — creates an empty, uncompleted task ──
    if (txt === ' ' && !editingTask) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const now = Date.now();
      const voidTask: Task = { id: now.toString(), text: ' ', notes: '', completed: false, createdAt: now, deadlineDate: '', deadlineTime: '', hasReminder: false, priority: 'Low', color: COLORS[7], subTasks: [], hasProgress: false, progress: 0, recurType: 'none', lastTouchedAt: now };
      setTasks([...useAppStore.getState().tasks, voidTask]);
      useAppStore.getState().incrementTotalTasksCreated();
      setTaskModalVisible(false);
      return;
    }
    if (!txt.trim()) { setErr('Task name is required.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const now = Date.now();
    const currentEditingTask = editingTask;
    const targetId = currentEditingTask?.id || now.toString();
    const data: Partial<Task> = { text: txt.trim(), notes: notes.trim(), color, priority, projectId, startDate: calOpen ? startDate : '', deadlineDate: calOpen ? deadlineDate : '', deadlineTime: calOpen ? deadlineTime : '', hasReminder: calOpen ? hasReminder : false, reminderTime: calOpen ? reminderTime : '', reminderOffsetDays: calOpen && hasReminder ? reminderOffsetDays : 0, recurType, recurDays, recurDayOfMonth, subTasks, hasProgress: subTasks.length > 0, promised };

    // Always read current tasks from store — avoids stale closure
    const currentTasks = useAppStore.getState().tasks;
    const seen = useAppStore.getState().whispersSeen || {};
    const fireFirstTask = !currentEditingTask && currentTasks.length === 0 && !seen['first_task'];

    // Promise transition detection — increment madeTotal/monthlyMade ONLY on
    // false→true. Toggling off then on doesn't double-count, but a task
    // that was promised, kept, and re-promised legitimately counts twice
    // (each ON cycle is a fresh commitment). We also clear an old
    // promiseBrokenAt scar when the user un-promises, since the dim mark
    // should match the current promise state — un-promising is a deliberate
    // "I'm letting this one go" act.
    const wasPromised = !!currentEditingTask?.promised;
    const promiseTurnedOn = promised && !wasPromised;
    if (promiseTurnedOn) recordPromiseMade();
    // When un-promising, wipe the kept/broken stamps so the next promise
    // cycle starts clean. Lifetime totals are unaffected — they remain
    // the source of truth for "wrapped".
    const promiseFields: Partial<Task> = promised
      ? {}
      : { promiseBrokenAt: null, promiseKeptAt: undefined };

    let updatedTasks = [...currentTasks];
    if (currentEditingTask) { updatedTasks = updatedTasks.map(t => t.id === targetId ? { ...t, ...data, ...promiseFields, lastTouchedAt: now, progress: calculateProgress(data.subTasks), hasProgress: (data.subTasks?.length || 0) > 0 } : t); }
    else { updatedTasks.push({ id: targetId, completed: false, createdAt: now, hasProgress: (data.subTasks?.length || 0) > 0, progress: calculateProgress(data.subTasks), lastTouchedAt: now, ...data } as Task); }

    setTasks(updatedTasks);
    // Only fresh creations push the counter; editing an existing task doesn't
    // count as a new task event.
    if (!currentEditingTask) useAppStore.getState().incrementTotalTasksCreated();
    setTaskModalVisible(false);
    if (fireFirstTask) {
      markWhisperSeen('first_task');
      setTimeout(() => showWhisper("First task captured. The list begins."), 450);
    }

    let newNotifId: string | undefined;
    if (currentEditingTask && currentEditingTask.notificationId) await cancelTaskNotification(currentEditingTask.notificationId);
    if (data.deadlineDate) newNotifId = await scheduleNotificationForTask(data);

    // Re-read after async gap to avoid stale spread
    setTasks(useAppStore.getState().tasks.map(t => t.id === targetId ? { ...t, notificationId: newNotifId } : t));
  }, [txt, notes, color, priority, projectId, startDate, deadlineDate, deadlineTime, hasReminder, reminderTime, reminderOffsetDays, recurType, recurDays, recurDayOfMonth, subTasks, calOpen, editingTask, setTasks, markWhisperSeen, showWhisper, promised, recordPromiseMade]);

  const handleCheck = useCallback(async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const now = Date.now(); let targetNotifId: string | undefined; let voidCompleted = false; let justCompleted = false;
    // Track promise-kept transition so we can fire the stat increment AFTER
    // the setTasks call resolves (avoids any chance of the increment beating
    // the task update through a render).
    let promiseKeptThisCheck = false;
    const updated = useAppStore.getState().tasks.map((t): Task => {
      if (t.id !== id) return t;
      if (t.completed) return { ...t, completed: false, progress: 0, completedAt: undefined };
      targetNotifId = t.notificationId;
      if (t.text === ' ') voidCompleted = true;
      // Recurring tasks: advance BOTH startDate AND deadlineDate to the next occurrence.
      // Task reappears in the SCHEDULED section (not hidden) so the user can see the next instance
      // coming without relying on the Sweep button. On the new date, Today/Inbox filters pick it up.
      if (t.recurType && t.recurType !== 'none') {
        const nextDate = calculateNextOccurrence(t);
        return { ...t, completed: false, status: undefined, startDate: nextDate, deadlineDate: nextDate, lastTouchedAt: now, notificationId: undefined };
      }
      justCompleted = true;
      // Promise-kept detection — completing a promised task that hasn't
      // already been scarred = kept. We stamp `promiseKeptAt` once and
      // never clear it (parallels promiseBrokenAt's permanence). If the
      // user un-completes and re-completes, the stat counter doesn't fire
      // again because `promiseKeptAt` is already set.
      const isKeepingPromise = !!t.promised && !t.promiseBrokenAt && !t.promiseKeptAt;
      if (isKeepingPromise) promiseKeptThisCheck = true;
      return {
        ...t,
        completed: true,
        progress: 100,
        completedAt: now,
        lastTouchedAt: now,
        notificationId: undefined,
        ...(isKeepingPromise ? { promiseKeptAt: now } : {}),
      };
    });
    setTasks(updated);
    if (promiseKeptThisCheck) recordPromiseKept();
    // Auto-tick any intent items linked to this task. Cheap, idempotent — won't
    // re-tick already-checked intents.
    if (justCompleted) {
      useAppStore.getState().autoCheckIntentsForTask(id);
    }
    if (targetNotifId) cancelTaskNotification(targetNotifId);
    const seen = useAppStore.getState().whispersSeen || {};
    if (voidCompleted && !seen['the_void']) {
      markWhisperSeen('the_void');
      setTimeout(() => showWhisper("You created nothing. The system accepted it. Some days are like that."), 400);
      return;
    }
    if (justCompleted && !seen['fifty_tasks']) {
      const completedCount = updated.filter(x => x.completed && x.completedAt).length;
      if (completedCount >= 50) {
        markWhisperSeen('fifty_tasks');
        setTimeout(() => showWhisper("50 down. You're not just planning anymore."), 450);
      }
    }
  }, [setTasks, markWhisperSeen, showWhisper, recordPromiseKept]);

  const handleSubCheck = useCallback((taskId: string, subId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTasks(useAppStore.getState().tasks.map(t => {
      if (t.id !== taskId) return t;
      const subs = (t.subTasks || []).map(s => s.id === subId ? { ...s, completed: !s.completed } : s);
      return { ...t, subTasks: subs, progress: calculateProgress(subs), lastTouchedAt: Date.now() };
    }));
  }, [setTasks]);

  const handleTrash = useCallback((t: Task) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (t.notificationId) cancelTaskNotification(t.notificationId);
    setTasks(useAppStore.getState().tasks.map(x => x.id === t.id ? { ...x, status: 'trash' as TaskStatus, notificationId: undefined } : x));
  }, [setTasks]);

  const handleArchiveTask = useCallback((t: Task) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (t.notificationId) cancelTaskNotification(t.notificationId);
    setTasks(useAppStore.getState().tasks.map(x => x.id === t.id ? { ...x, status: 'archived' as TaskStatus, notificationId: undefined } : x));
  }, [setTasks]);

  // Opens the rest picker for an overdue task. The very first time the user
  // sees this picker (per the 'rest_intro' whisper key), fire a single line
  // introducing the feature — context-of-use teaching, no separate tutorial.
  // Subsequent overdue tasks just open the picker silently.
  const handleRestTask = useCallback((t: Task) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRestTarget(t);
    const seen = useAppStore.getState().whispersSeen || {};
    if (!seen['rest_intro']) {
      markWhisperSeen('rest_intro');
      setTimeout(() => showWhisper("That deadline passed. Rest this one — bring it back when you're ready."), 500);
    }
  }, [markWhisperSeen, showWhisper]);

  // Applies the chosen wake date and puts the task into 'resting' status. The
  // phoenix wake logic in wakePhoenixTasks (runs on focus) will surface the
  // task back into the active list when nextWakeDate <= today. Notification
  // is cancelled — it'd misfire while the task is dormant.
  const restTaskUntil = useCallback((task: Task, wakeDate: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (task.notificationId) cancelTaskNotification(task.notificationId);
    setTasks(useAppStore.getState().tasks.map(x => x.id === task.id ? {
      ...x,
      status: 'resting' as TaskStatus,
      nextWakeDate: wakeDate,
      notificationId: undefined,
      lastTouchedAt: Date.now(),
    } : x));
    setRestTarget(null);
  }, [setTasks]);

  const clearDoneTasks = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const now = Date.now(); const nextTasks: Task[] = [];
    // Three branches for completed tasks:
    //   - Recurring (inbox or project): spawn the next instance via recurrence
    //     logic. Previously the `!t.projectId` guard meant project-scoped
    //     recurring tasks were completed-and-killed without ever recurring
    //     — recurrence is a property of the task, not of where it lives.
    //   - Inbox non-recurring: removed from the list (cancel its notification).
    //   - Project non-recurring: kept in the list as a "trophy" so users see
    //     what they finished inside that project. Original behavior, preserved.
    useAppStore.getState().tasks.forEach((t) => {
      if (t.completed && t.status !== 'trash' && t.status !== 'archived') {
        if (t.recurType !== 'none') {
          nextTasks.push({ ...t, completed: false, status: 'resting' as TaskStatus, deadlineDate: calculateNextOccurrence(t), lastTouchedAt: now });
        } else if (!t.projectId) {
          if (t.notificationId) cancelTaskNotification(t.notificationId);
        } else {
          nextTasks.push(t);
        }
      } else { nextTasks.push(t); }
    });
    setTasks(nextTasks);
  }, [setTasks]);

  // Opens the delete-project modal with the toggle reset to off. We always
  // reset on open — leaking the previous "also delete tasks" state across
  // unrelated project deletions would invite very expensive accidents.
  const handleDeleteProject = useCallback((pid: string) => {
    setDeleteProjectAlsoTasks(false);
    setDeleteProjectId(pid);
  }, []);

  // Applies the delete. With the toggle off, tasks inside the project lose
  // their projectId and re-emerge in the Inbox (current default behavior).
  // With the toggle on, those same tasks are moved to status='trash' — that
  // way the user keeps recovery via the trash vault instead of vaporising
  // potentially weeks of work. Notifications on those tasks are cancelled
  // either way to keep the scheduler clean.
  const confirmDeleteProject = useCallback(() => {
    if (!deleteProjectId) return;
    const pid = deleteProjectId;
    const alsoDelete = deleteProjectAlsoTasks;
    const now = Date.now();
    const current = useAppStore.getState().tasks;
    if (alsoDelete) {
      // Bulk-trash. Cancel any pending notifications for the affected tasks
      // before the array is mutated so we still have access to their IDs.
      for (const t of current) {
        if (t.projectId === pid && t.notificationId) {
          cancelTaskNotification(t.notificationId);
        }
      }
      setTasks(current.map(t => t.projectId === pid
        ? { ...t, status: 'trash' as TaskStatus, projectId: undefined, notificationId: undefined, lastTouchedAt: now }
        : t));
    } else {
      setTasks(current.map(t => t.projectId === pid ? { ...t, projectId: undefined } : t));
    }
    deleteProject(pid);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDeleteProjectId(null);
  }, [deleteProjectId, deleteProjectAlsoTasks, setTasks, deleteProject]);

  // getState() removes `projects` from deps — feedData no longer re-runs on unrelated project changes
  const handleArchiveProject = useCallback((pid: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const p = useAppStore.getState().projects.find(x => x.id === pid);
    if (p) addOrUpdateProject({ ...p, status: 'archived' });
    setExpandedProjectId(null);
  }, [addOrUpdateProject]);

  // ── RECLAIM ── one-time whisper shared by task + folder Take Action
  const fireReclaimWhisper = useCallback(() => {
    const seen = useAppStore.getState().whispersSeen || {};
    if (!seen['reclaim_first']) {
      markWhisperSeen('reclaim_first');
      setTimeout(() => showWhisper("Reclaimed. The drift ends."), 350);
    }
  }, [markWhisperSeen, showWhisper]);

  // Take Action on a seed TASK — bumps priority one tier, refreshes lastTouchedAt (unseeds it), fires whisper
  const handleReclaimTask = useCallback((taskId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const now = Date.now();
    setTasks(useAppStore.getState().tasks.map(t => {
      if (t.id !== taskId) return t;
      const bumped: Priority = t.priority === 'Low' ? 'Medium' : t.priority === 'Medium' ? 'High' : 'High';
      return { ...t, priority: bumped, lastTouchedAt: now };
    }));
    fireReclaimWhisper();
  }, [setTasks, fireReclaimWhisper]);

  // Take Action on a seed FOLDER — stamps lastTouchedAt on folder and all its active tasks (unseeds it), fires whisper
  const handleReclaimProject = useCallback((pid: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const now = Date.now();
    const p = useAppStore.getState().projects.find(x => x.id === pid);
    if (p) addOrUpdateProject({ ...p, lastTouchedAt: now });
    setTasks(useAppStore.getState().tasks.map(t => (t.projectId === pid && t.status !== 'trash' && t.status !== 'archived') ? { ...t, lastTouchedAt: now } : t));
    fireReclaimWhisper();
  }, [addOrUpdateProject, setTasks, fireReclaimWhisper]);

  // projectForNew pre-selects a project for a NEW task. It's passed explicitly
  // (not read from state) because callers set it and open the sheet in the same
  // tick — a state value would still be stale in this closure. null/undefined =
  // Inbox. Ignored when editing (the task's own projectId wins).
  const openTaskSheet = useCallback((task?: Task, projectForNew?: string | null) => {
    Keyboard.dismiss(); setErr('');
    setScheduleNotice(null);
    if (task) {
      setEditingTask(task); setTxt(task.text); setNotes(task.notes || ''); setColor(task.color); setPriority(task.priority); setProjectId(task.projectId);
      setStartDate(task.startDate || ''); setDeadlineDate(task.deadlineDate || ''); setDeadlineTime(task.deadlineTime || ''); setHasReminder(task.hasReminder || false); setReminderTime(task.reminderTime || ''); setReminderOffsetDays(task.reminderOffsetDays || 0);
      setCalOpen(!!(task.startDate || task.deadlineDate || task.hasReminder)); setDateTab(task.deadlineDate ? 'due' : (task.startDate ? 'start' : 'due'));
      setRecurType(task.recurType || 'none'); setRecurDays(task.recurDays || []); setRecurDayOfMonth(task.recurDayOfMonth); setSubTasks(task.subTasks || []);
      setPromised(!!task.promised);
    } else {
      setEditingTask(null); setTxt(''); setNotes(''); setColor(COLORS[0]); setPriority('Medium'); setProjectId(projectForNew ?? undefined);
      setStartDate(''); setDeadlineDate(''); setDeadlineTime(''); setCalOpen(false); setDateTab('due'); setHasReminder(false); setReminderTime(''); setReminderOffsetDays(0);
      setRecurType('none'); setRecurDays([]); setRecurDayOfMonth(undefined); setSubTasks([]); setNewSubTxt('');
      setPromised(false);
    }
    setTaskModalVisible(true);
  }, []);

  // Promote an inbox task into "today" by stamping startDate = today. We use
  // startDate (not deadlineDate) deliberately — the user is choosing to work on
  // it today, not declaring a deadline. Stamps lastTouchedAt so the seed-task
  // dormancy timer also resets. Closes the picker so the user lands back on
  // their freshly-populated today section.
  const promoteToToday = useCallback((taskId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const t = todayStr();
    const cur = useAppStore.getState().tasks;
    setTasks(cur.map(x => x.id === taskId ? { ...x, startDate: t, lastTouchedAt: Date.now() } : x));
    setPickFromInboxVisible(false);
  }, [setTasks]);

  // ── DEEP WORK HANDLERS ──────────────────────────────────────────────────────

  const openDeepWorkPicker = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDwIntent('free');
    setDwTargetId(undefined); setDwTargetTitle('');
    setDwFreeLabel('');
    setDwDurationMin(45); setDwCustomMin('');
    setDwOpenMode(false);
    setDwPickerVisible(true);
  }, []);

  const beginDeepWork = useCallback(() => {
    let durationMs: number;
    if (dwOpenMode) {
      durationMs = 0;
    } else {
      const minsRaw = dwCustomMin ? parseInt(dwCustomMin, 10) : dwDurationMin;
      const mins = isNaN(minsRaw) || minsRaw <= 0 ? dwDurationMin : Math.min(minsRaw, 600);
      durationMs = mins * 60 * 1000;
    }
    let targetTitle = '';
    if (dwIntent === 'task') {
      const t = tasks.find(x => x.id === dwTargetId);
      targetTitle = t?.text || '';
    } else if (dwIntent === 'habit') {
      const h = habits.find(x => x.id === dwTargetId);
      targetTitle = h?.title || '';
    } else if (dwIntent === 'challenge') {
      const c = challenges.find(x => x.id === dwTargetId);
      targetTitle = c?.title || '';
    } else {
      targetTitle = dwFreeLabel.trim() || 'Free focus';
    }
    if (dwIntent !== 'free' && !dwTargetId) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setDwSession({
      startedAt: Date.now(),
      durationMs,
      intent: dwIntent,
      targetId: dwIntent === 'free' ? undefined : dwTargetId,
      targetTitle,
      open: dwOpenMode,
    });
    setDwNow(Date.now());
    setDwPickerVisible(false);
    setDwFocusVisible(true);
  }, [dwIntent, dwTargetId, dwFreeLabel, dwDurationMin, dwCustomMin, dwOpenMode, tasks, habits, challenges]);

  const cancelDeepWork = useCallback(() => {
    if (!dwSession) { setDwFocusVisible(false); return; }
    const elapsed = Math.max(0, Date.now() - dwSession.startedAt);

    // Open sessions: tapping cancel IS the natural completion (no fixed
    // duration to complete against). Celebrate, then route to reflection —
    // unchanged from prior behaviour.
    if (dwSession.open) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 200);
      setDwSession({ ...dwSession, durationMs: elapsed });
      setDwCelebrating(true);
      setDwReflectionRating(null);
      setDwReflectionText('');
      setDwMarkDone(false);
      setTimeout(() => {
        setDwCelebrating(false);
        setDwFocusVisible(false);
        setDwReflectVisible(true);
      }, 1800);
      return;
    }

    // Timed early-exit: previously this confirmed "won't be saved" and threw
    // away whatever the user had done — losing a 1.5h chunk of a planned 2h
    // session was the worst case. New shape: any session over 60s routes to
    // the same reflection sheet as a naturally-completed session, with elapsed
    // time captured. The reflection's "Skip this one" button remains the
    // explicit discard path, so the user keeps control without an extra
    // confirm. Sub-60s (mistaps, immediate "never mind") discard silently —
    // popping a sheet over 20s of work would be noise.
    const MIN_KEEP_MS = 60 * 1000;
    if (elapsed >= MIN_KEEP_MS) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDwSession({ ...dwSession, durationMs: elapsed });
      setDwReflectionRating(null);
      setDwReflectionText('');
      setDwMarkDone(false);
      setDwFocusVisible(false);
      setDwReflectVisible(true);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDwFocusVisible(false);
    setDwSession(null);
  }, [dwSession]);

  useEffect(() => {
    if (!dwFocusVisible || !dwSession) return;
    const id = setInterval(() => {
      const now = Date.now();
      setDwNow(now);
      if (dwSession.open) return;
      const elapsed = now - dwSession.startedAt;
      if (elapsed >= dwSession.durationMs) {
        clearInterval(id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 200);
        setDwCelebrating(true);
        setDwReflectionRating(null);
        setDwReflectionText('');
        setDwMarkDone(false);
        setTimeout(() => {
          setDwCelebrating(false);
          setDwFocusVisible(false);
          setDwReflectVisible(true);
        }, 1800);
      }
    }, 500);
    return () => clearInterval(id);
  }, [dwFocusVisible, dwSession]);

  const saveDeepWorkReflection = useCallback(() => {
    if (!dwSession) { setDwReflectVisible(false); return; }
    const session: DeepWorkSession = {
      id: `dw_${dwSession.startedAt}`,
      startedAt: dwSession.startedAt,
      endedAt: dwSession.startedAt + dwSession.durationMs,
      durationMs: dwSession.durationMs,
      intent: dwSession.intent,
      intentTargetId: dwSession.targetId,
      intentTargetTitle: dwSession.targetTitle,
      reflection: dwReflectionText.trim() || undefined,
      rating: dwReflectionRating || undefined,
    };
    addDeepWorkSession(session);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // In-sheet "Mark done" — applies the user's opt-in BEFORE the session is
    // persisted so any downstream side-effects (intent auto-check, challenge
    // achievement, linked-habit advancement) see a consistent state. Previously
    // a post-save confirm asked the same question only for tasks, and not at
    // all for habits/challenges; the toggle on the reflection sheet replaces
    // that with explicit, in-context closure. All three branches are
    // idempotent: task already complete → no-op above (toggle hidden); habit
    // already at target → no-op above; challenge already logged today → the
    // logDates check below short-circuits.
    if (dwMarkDone && dwSession.targetId) {
      const today = todayStr();
      if (dwSession.intent === 'task') {
        const cur = useAppStore.getState().tasks;
        setTasks(cur.map(t => t.id === dwSession.targetId
          ? { ...t, completed: true, completedAt: Date.now(), progress: 100, lastTouchedAt: Date.now() }
          : t));
        useAppStore.getState().autoCheckIntentsForTask(dwSession.targetId);
      } else if (dwSession.intent === 'habit') {
        useAppStore.getState().toggleHabitAction(dwSession.targetId, 'done', today);
        useAppStore.getState().autoCheckIntentsForHabit(dwSession.targetId, today);
        useAppStore.getState().advanceLinkedChallengesForHabit(dwSession.targetId, today);
      } else if (dwSession.intent === 'challenge') {
        const cur = useAppStore.getState().challenges;
        const c = cur.find(x => x.id === dwSession.targetId);
        if (c) {
          const existingLogs = c.logDates || [];
          if (!existingLogs.includes(today)) {
            const newCurrent = Math.min(c.target, c.current + 1);
            const appliedDelta = newCurrent - c.current;
            const isAchieved = newCurrent >= c.target && c.deadState === 'active';
            useAppStore.getState().setChallenges(cur.map(x => x.id === c.id ? {
              ...x, current: newCurrent, lastLoggedAt: Date.now(),
              logDates: [...existingLogs, today],
              ledger: [...(x.ledger || []), makeLedgerEntry(appliedDelta, 'deepwork')],
              ...(isAchieved ? { deadState: 'achieved' as const, achievedAt: Date.now() } : {}),
            } : x));
            useAppStore.getState().autoCheckIntentsForChallenge(c.id, today);
          }
        }
      }
    }

    setDwReflectVisible(false);
    setDwSession(null);
    setDwMarkDone(false);
  }, [dwSession, dwReflectionText, dwReflectionRating, dwMarkDone, addDeepWorkSession, setTasks]);

  const skipDeepWorkReflection = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDwReflectVisible(false);
    setDwSession(null);
    setDwMarkDone(false);
  }, []);

  // Linked-target descriptor for the reflection sheet's Mark Done row. Returns
  // null when the session was Free, when there's no linkable target, or when
  // the target is already in a "no-op" state (task completed, habit at target,
  // challenge dead / logged today / at target). null hides the toggle entirely.
  const linkedTarget = useMemo(() => {
    if (!dwSession || !dwSession.targetId) return null;
    const today = todayStr();
    if (dwSession.intent === 'task') {
      const t = tasks.find(x => x.id === dwSession.targetId);
      if (!t || t.completed) return null;
      return { kind: 'task' as const, label: 'Mark task done', icon: 'check-circle' as keyof typeof Feather.glyphMap };
    }
    if (dwSession.intent === 'habit') {
      const h = habits.find(x => x.id === dwSession.targetId);
      if (!h) return null;
      const todayCount = h.history.filter(d => d === today).length;
      if (todayCount >= h.targetCount) return null;
      const after = todayCount + 1;
      return {
        kind: 'habit' as const,
        label: h.targetCount > 1 ? `Log habit (${after}/${h.targetCount})` : 'Log habit for today',
        icon: 'repeat' as keyof typeof Feather.glyphMap,
      };
    }
    if (dwSession.intent === 'challenge') {
      const c = challenges.find(x => x.id === dwSession.targetId);
      if (!c) return null;
      const isOpen = c.deadState === 'active' || c.deadState === 'resurrected';
      if (!isOpen) return null;
      if ((c.logDates || []).includes(today)) return null;
      if (c.current >= c.target) return null;
      const unit = c.unit ? ` ${c.unit}` : '';
      return {
        kind: 'challenge' as const,
        label: `+1 progress (${c.current + 1} / ${c.target}${unit})`,
        icon: 'arrow-up-right' as keyof typeof Feather.glyphMap,
      };
    }
    return null;
  }, [dwSession, tasks, habits, challenges]);

  // ── ADHD HANDLERS ────────────────────────────────────────────────────────

  const openAdhdMode = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAdhdJustDone('');
    setAdhdVisible(true);
  }, []);

  const closeAdhdMode = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAdhdVisible(false);
    setAdhdJustDone('');
  }, []);

  const completeAdhdItem = useCallback((kind: 'task' | 'habit', id: string, title: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (kind === 'task') {
      const cur = useAppStore.getState().tasks;
      setTasks(cur.map(t => t.id === id ? { ...t, completed: true, completedAt: Date.now() } : t));
    } else {
      toggleHabitAction(id, 'done', todayStr());
    }
    setAdhdJustDone(title);
    setAdhdCelebrating(true);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 150);
    setTimeout(() => {
      setAdhdCelebrating(false);
      setAdhdJustDone('');
    }, 1400);
  }, [setTasks, toggleHabitAction]);

  // ─── FLASHLIST DATA PREP ───
  // getUrgency pre-computed here — TaskCard.render does zero date math
  // Tasks inside archived projects are treated as archived too — they stay attached to the folder
  // (so restoring the folder restores them) but don't render in any active section.
  const archivedProjectIds = useMemo(() => new Set(projects.filter(p => p.status === 'archived').map(p => p.id)), [projects]);
  const baseActiveTasks = useMemo(() => tasks.filter(t =>
    t.status !== 'trash' && t.status !== 'archived' && t.status !== 'resting' &&
    !(t.projectId && archivedProjectIds.has(t.projectId))
  ), [tasks, archivedProjectIds]);
  const displayTasks = useMemo(() => sortTasks(baseActiveTasks), [baseActiveTasks]);
  const today = useMemo(() => todayStr(), [tasks.length]);
  // Tasks with future start date are hidden from main feed until their date arrives
  const scheduledTasks = useMemo(() => displayTasks.filter(t => !t.completed && t.startDate && t.startDate > today), [displayTasks, today]);
  const scheduledIds = useMemo(() => new Set(scheduledTasks.map(t => t.id)), [scheduledTasks]);
  const visibleTasks = useMemo(() => displayTasks.filter(t => !scheduledIds.has(t.id)), [displayTasks, scheduledIds]);
  // Today: any visible task due today OR starting today (across all folders)
  const todayTasks = useMemo(() => visibleTasks.filter(t => !t.completed && (t.deadlineDate === today || t.startDate === today)), [visibleTasks, today]);
  const todayIds = useMemo(() => new Set(todayTasks.map(t => t.id)), [todayTasks]);
  const inboxTasks = useMemo(() => visibleTasks.filter(t => !t.projectId), [visibleTasks]);
  const rawActiveInbox = useMemo(() => inboxTasks.filter(t => !t.completed && !todayIds.has(t.id)), [inboxTasks, todayIds]);
  const completedInbox = useMemo(() => inboxTasks.filter(t => t.completed), [inboxTasks]);
  const seedTasks = useMemo(() => rawActiveInbox.filter(t => (Date.now() - (t.lastTouchedAt || t.createdAt)) >= THIRTY_DAYS_MS), [rawActiveInbox]);
  const seedTaskIds = useMemo(() => new Set(seedTasks.map(t => t.id)), [seedTasks]);
  // Seeds bubble to top of inbox — forces the user to make a decision before normal work
  const activeInbox = useMemo(() => {
    const seeds = rawActiveInbox.filter(t => seedTaskIds.has(t.id));
    const rest = rawActiveInbox.filter(t => !seedTaskIds.has(t.id));
    return [...seeds, ...rest];
  }, [rawActiveInbox, seedTaskIds]);

  // Memoized vault lists — never computed inline in JSX
  const trashTasks = useMemo(() => tasks.filter(t => t.status === 'trash'), [tasks]);

  // Bulk-purge everything in the trash. Mirrors the per-item "Purge Forever"
  // action but for the whole trash at once; confirmed before it runs.
  const purgeAllTrash = useCallback(() => {
    if (useAppStore.getState().tasks.filter(t => t.status === 'trash').length === 0) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setConfirmDialog({ visible: true, title: 'Purge trash?', message: "Permanently delete every task in the trash? This can't be undone.", destructiveLabel: 'Purge all', onConfirm: () => {
      setTasks(useAppStore.getState().tasks.filter(t => t.status !== 'trash'));
      setConfirmDialog(null);
    } });
  }, [setTasks]);
  const archivedTasks = useMemo(() => tasks.filter(t => t.status === 'archived'), [tasks]);
  const archivedProjects = useMemo(() => projects.filter(p => p.status === 'archived'), [projects]);
  const rawActiveProjects = useMemo(() => projects.filter(p => p.status !== 'archived'), [projects]);

  // ── SEED PROJECTS ── dormant ≥14d with zero completions; forced to top so user confronts them
  const projectSeedInfo = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, { isSeed: boolean; daysDormant: number }>();
    rawActiveProjects.forEach(p => {
      const ptasks = tasks.filter(t => t.projectId === p.id && t.status !== 'trash' && t.status !== 'archived');
      const hasAnyCompletion = ptasks.some(t => t.completed || (t.progress && t.progress > 0));
      const taskMax = ptasks.length > 0 ? Math.max(...ptasks.map(t => t.lastTouchedAt || t.createdAt)) : 0;
      const lastActivity = Math.max(taskMax, p.lastTouchedAt || 0, p.createdAt);
      const dormantMs = now - lastActivity;
      const isSeed = !hasAnyCompletion && dormantMs >= FOURTEEN_DAYS_MS;
      map.set(p.id, { isSeed, daysDormant: Math.floor(dormantMs / 86400000) });
    });
    return map;
  }, [rawActiveProjects, tasks]);

  // Seed projects bubble to top of the folder list
  const activeProjects = useMemo(() => {
    const seeds = rawActiveProjects.filter(p => projectSeedInfo.get(p.id)?.isSeed);
    const rest = rawActiveProjects.filter(p => !projectSeedInfo.get(p.id)?.isSeed);
    return [...seeds, ...rest];
  }, [rawActiveProjects, projectSeedInfo]);

  // ── TODAY HABITS ──
  const todayHabits = useMemo(() => habits.filter(h => isHabitToday(h, today)), [habits, today]);

  // ── ADHD pool ──
  // Open commitments the user might want to knock out. Order: most-urgent task first,
  // then any unfinished today habits. Caps task list at 10 to keep relief mode manageable.
  const adhdPool = useMemo(() => {
    type AdhdItem = { kind: 'task' | 'habit'; id: string; title: string; color: string };
    const items: AdhdItem[] = [];
    displayTasks.slice(0, 10).forEach(t => items.push({ kind: 'task', id: t.id, title: t.text, color: t.color }));
    todayHabits
      .filter(h => h.history.filter(d => d === today).length < h.targetCount)
      .forEach(h => items.push({ kind: 'habit', id: h.id, title: h.title, color: h.color }));
    return items;
  }, [displayTasks, todayHabits, today]);

  const feedData = useMemo(() => {
    const flatData: any[] = [];

    // ── PROMISE TALLY ── reflective monthly stat. Only renders once the
    // user has made at least one promise this month (or has a lifetime
    // record) — otherwise it'd be a confusing "0 / 0" with no context.
    // Placed above the TODAY section so it's the first thing seen on
    // open, but stays compact (single row, no decorative chrome).
    const showPromiseTally =
      promiseStats.monthKey === (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      })()
        ? (promiseStats.monthlyMade + promiseStats.monthlyKept + promiseStats.monthlyBroken) > 0
        : promiseStats.madeTotal > 0;
    if (showPromiseTally) {
      flatData.push({ type: 'promise_tally', id: 'sys_promise_tally' });
    }

    // ── TODAY SECTION ── always visible when any active task exists
    if (baseActiveTasks.length > 0) {
      flatData.push({ type: 'today_header', id: 'sys_today_hdr', count: todayTasks.length, sweepCount: completedInbox.length });
      if (todayTasks.length > 0) {
        todayTasks.forEach((t, i) => {
          const urgency = getUrgency(t);
          flatData.push({ type: 'task', id: t.id, task: t, urgency, isExp: expandedId === t.id, isSeed: false, delayIdx: i, isFirstInFolder: false, indentInFolder: false });
        });
      } else {
        flatData.push({ type: 'today_empty', id: 'sys_today_empty' });
      }
    }

    // Empty state — fires when nothing is visible to the user, not just when
    // tasks.length === 0. Previous check missed the case where every task was
    // in trash/archived/resting and there were no active projects → no feed
    // items rendered → tab showed as blank white. Now: if no active tasks
    // anywhere AND no project folders to show, drop the empty card.
    if (baseActiveTasks.length === 0 && activeProjects.length === 0) {
      flatData.push({ type: 'empty_art', id: 'sys_empty' });
    }

    // Projects section header — variant 4 accent-underline style, matches TODAY / INBOX / SCHEDULED / COMPLETED rhythm
    if (activeProjects.length > 0) {
      flatData.push({ type: 'projects_header', id: 'sys_proj_hdr', count: activeProjects.length });
    }

    activeProjects.forEach(p => {
      const ptasks = visibleTasks.filter(t => t.projectId === p.id);
      const active = ptasks.filter(t => !t.completed);
      const comp = ptasks.filter(t => t.completed);
      const pct = ptasks.length > 0 ? Math.round((comp.length / ptasks.length) * 100) : 0;
      const isProjExp = expandedProjectId === p.id;

      const seedInfo = projectSeedInfo.get(p.id);
      flatData.push({ type: 'project_header', id: `p_${p.id}`, project: p, activeCount: active.length, pct, isExp: isProjExp, isSeed: !!seedInfo?.isSeed, daysDormant: seedInfo?.daysDormant || 0 });

      // Conditional urgent-task preview under collapsed projects. Surfaces the
      // single highest-urgency task in the folder when it's at level "high" or
      // worse (≤24h / critical / overdue). Silent when calm — keeps the project
      // list quiet by default, vocal only when something needs attention.
      // Tapping the preview opens the project AND expands the task so the user
      // lands directly on the actionable thing instead of having to scan again.
      if (!isProjExp && active.length > 0) {
        const rank = (u: UrgencyLevel) => u === 'overdue' ? 5 : u === 'critical' ? 4 : u === 'high' ? 3 : 0;
        let topUrgent: Task | null = null;
        let topUrgency: UrgencyLevel = 'none';
        let topRank = 0;
        for (const t of active) {
          const u = getUrgency(t);
          const r = rank(u);
          if (r >= 3 && r > topRank) {
            topUrgent = t;
            topUrgency = u;
            topRank = r;
          }
        }
        if (topUrgent) {
          flatData.push({ type: 'project_urgent_preview', id: `p_urg_${p.id}`, task: topUrgent, urgency: topUrgency, projectId: p.id, projectColor: p.color });
        }
      }

      if (isProjExp) {
        if (pct === 100 && ptasks.length > 0) flatData.push({ type: 'project_arc_btn', id: `p_arc_${p.id}`, projectId: p.id });
        if (ptasks.length === 0) flatData.push({ type: 'project_empty', id: `p_mt_${p.id}` });
        if (seedInfo?.isSeed) flatData.push({ type: 'project_seed_ctas', id: `p_sctas_${p.id}`, project: p });

        active.forEach((t, i) => {
          const urgency = getUrgency(t); // pre-computed once per task per feedData run
          flatData.push({ type: 'task', id: t.id, task: t, urgency, isExp: expandedId === t.id, isSeed: seedTasks.some(s => s.id === t.id), delayIdx: i, isFirstInFolder: i === 0, indentInFolder: true });
        });
        if (comp.length > 0) {
          flatData.push({ type: 'project_comp_header', id: `p_ch_${p.id}` });
          comp.forEach(t => {
            const urgency = getUrgency(t);
            flatData.push({ type: 'task', id: t.id, task: t, urgency, isExp: false, isSeed: false, delayIdx: 0, isFirstInFolder: false, indentInFolder: true });
          });
        }
        if (!seedInfo?.isSeed) flatData.push({ type: 'project_add_btn', id: `p_add_${p.id}`, project: p });
      }
    });

    if (activeInbox.length > 0) {
      if (activeProjects.length > 0 || todayTasks.length > 0) flatData.push({ type: 'inbox_header', id: 'sys_inb_hdr', count: activeInbox.length });
      activeInbox.forEach((t, i) => {
        const urgency = getUrgency(t);
        flatData.push({ type: 'task', id: t.id, task: t, urgency, isExp: expandedId === t.id, isSeed: seedTasks.some(s => s.id === t.id), delayIdx: i, isFirstInFolder: false, indentInFolder: false });
      });
    }

    // ── SCHEDULED SECTION (collapsible) ──
    if (scheduledTasks.length > 0) {
      flatData.push({ type: 'scheduled_header', id: 'sys_sched_hdr', count: scheduledTasks.length, firstDate: scheduledTasks[0]?.startDate, isOpen: scheduledOpen });
      if (scheduledOpen) {
        scheduledTasks.forEach((t, i) => {
          const urgency = getUrgency(t);
          flatData.push({ type: 'task', id: t.id, task: t, urgency, isExp: expandedId === t.id, isSeed: false, delayIdx: i, isFirstInFolder: false, indentInFolder: false });
        });
      }
    }

    if (completedInbox.length > 0) {
      flatData.push({ type: 'inbox_comp_header', id: 'sys_inb_comp_hdr', count: completedInbox.length });
      completedInbox.forEach(t => {
        const urgency = getUrgency(t);
        flatData.push({ type: 'task', id: t.id, task: t, urgency, isExp: false, isSeed: false, delayIdx: 0, isFirstInFolder: false, indentInFolder: false });
      });
    }

    return flatData;
  }, [tasks, activeProjects, expandedProjectId, expandedId, visibleTasks, seedTasks, completedInbox, activeInbox, todayTasks, scheduledTasks, scheduledOpen, baseActiveTasks, projectSeedInfo, promiseStats]);

  // Stable date label — useMemo string, not a function call in JSX
  const todayLabel = useMemo(() => {
    const d = new Date();
    if (calendarType === 'shamsi') { const [jy, jm, jd] = g2j(d.getFullYear(), d.getMonth()+1, d.getDate()); return `${JS_DAY_MAP[d.getDay()]}, ${SHAMSI_MONTHS[jm-1].slice(0, 3)} ${jd}`; }
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }, [calendarType]);

  // Stable expand handler — isCurrentlyExp passed from feedData item so no closure needed
  const handleExpand = useCallback((id: string, isCurrentlyExp: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedId(isCurrentlyExp ? null : id);
  }, []);

  const renderFlashListItem = useCallback(({ item }: any) => {
    if (item.type === 'empty_art') {
      // Richer empty state than the EmptyArt utility — that one is right for
      // vault sub-tabs (trash / archive / projects), where the user is
      // expected to find an empty list and move on. The main tab being empty
      // is a moment that deserves more weight: typography hierarchy (title +
      // body), a real CTA, and an icon with enough presence to read against
      // the bg. Voice line preserved verbatim from the original.
      return (
        <View style={{ alignItems: 'center', paddingTop: 56, paddingHorizontal: 32, paddingBottom: 80 }}>
          <View style={{
            width: 72, height: 72, borderRadius: 36,
            backgroundColor: hexToRgba(theme.textMain, 0.05),
            borderWidth: 1, borderColor: theme.border,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 24,
          }}>
            <Feather name="check-circle" size={30} color={theme.textMain} style={{ opacity: 0.4 }} />
          </View>
          <Text style={{
            color: theme.textMain, fontSize: 22, fontWeight: '900',
            letterSpacing: -0.5, marginBottom: 10, textAlign: 'center',
          }}>
            All caught up.
          </Text>
          <Text style={{
            color: theme.textSub, fontSize: 14, fontWeight: '500',
            lineHeight: 21, textAlign: 'center', marginBottom: 28,
            maxWidth: 280,
          }}>
            Add anything you want to track. Deadlines, recurring stuff, half-thoughts — capture it here.
          </Text>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              openTaskSheet();
            }}
            activeOpacity={0.85}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12,
              backgroundColor: theme.textMain,
            }}
          >
            <Feather name="plus" size={14} color={theme.bg} />
            <Text style={{ color: theme.bg, fontSize: 13, fontWeight: '900', letterSpacing: 0.3 }}>
              Capture a task
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (item.type === 'promise_tally') {
      // Reflective, not punitive — neutral palette, no exclamation marks,
      // no "you broke X promises" framing. The stat is a quiet record;
      // the user reads it and makes their own meaning.
      const kept = promiseStats.monthlyKept;
      const broken = promiseStats.monthlyBroken;
      const pendingPromises = tasks.filter(t => t.promised && !t.completed && !t.promiseBrokenAt && t.status !== 'trash' && t.status !== 'archived').length;
      return (
        <View style={{ marginTop: 4, marginBottom: 14, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Feather name="shield" size={14} color={theme.textSub} />
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
              <Text style={{ color: theme.success, fontSize: 14, fontWeight: '900' }}>{kept}</Text>
              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }}>KEPT</Text>
            </View>
            <View style={{ width: 1, height: 12, backgroundColor: theme.border }} />
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
              <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '900' }}>{broken}</Text>
              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }}>BROKEN</Text>
            </View>
            {pendingPromises > 0 ? (
              <>
                <View style={{ width: 1, height: 12, backgroundColor: theme.border }} />
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                  <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '900' }}>{pendingPromises}</Text>
                  <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }}>PENDING</Text>
                </View>
              </>
            ) : null}
          </View>
          <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, opacity: 0.7 }}>THIS MONTH</Text>
        </View>
      );
    }
    if (item.type === 'projects_header') return (
      <View style={{ marginTop: 18, marginBottom: 14 }}>
        <Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '900', letterSpacing: 1.8, marginLeft: 4, marginBottom: 6 }}>PROJECTS · {item.count}</Text>
        <View style={{ height: 2, backgroundColor: theme.textMain, width: 22, borderRadius: 1, marginLeft: 4 }} />
      </View>
    );
    if (item.type === 'today_header') return (
      <View style={{ marginBottom: 18, marginTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
            <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '900', letterSpacing: 1.5 }}>TODAY</Text>
            {item.count > 0 ? (
              <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>{item.count}</Text>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {item.sweepCount > 0 ? (
              <TouchableOpacity onPress={clearDoneTasks} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}>
                <Feather name="wind" size={12} color={theme.textSub} />
                <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>SWEEP {item.sweepCount}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        {/* Accent underline — marks Today as the primary section */}
        <View style={{ height: 2, backgroundColor: theme.textMain, width: 28, borderRadius: 1 }} />
      </View>
    );
    if (item.type === 'today_empty') {
      // When the inbox has open items, the empty-today state is also an
      // invitation: "pull something forward." The CTA isn't auto-applied
      // because being clamped with new deadlines without consent feels worse
      // than being asked. With no inbox, fall back to the plain quiet line.
      const hasInbox = activeInbox.length > 0;
      return (
        <View style={{ paddingVertical: 18, paddingHorizontal: 14, marginBottom: 16, borderRadius: 12, borderWidth: 1, borderColor: theme.border, borderStyle: 'dashed', alignItems: 'center', gap: hasInbox ? 12 : 0 }}>
          <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700', opacity: 0.7, textAlign: 'center' }}>
            {hasInbox ? "Nothing on today's plate. Pull from the inbox?" : "Nothing scheduled for today."}
          </Text>
          {hasInbox ? (
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPickFromInboxVisible(true); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.textMain }}
            >
              <Feather name="inbox" size={13} color={theme.bg} />
              <Text style={{ color: theme.bg, fontSize: 12, fontWeight: '900', letterSpacing: 0.3 }}>Add from inbox</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }
    if (item.type === 'scheduled_header') return (
      <View style={{ marginTop: 14, marginBottom: 14 }}>
        <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setScheduledOpen(!item.isOpen); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '900', letterSpacing: 1.8 }}>SCHEDULED · {item.count}</Text>
            {item.firstDate ? <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '600', opacity: 0.6 }}>· first {formatDisplayDate(item.firstDate, calendarType)}</Text> : null}
          </View>
          <Feather name={item.isOpen ? "chevron-up" : "chevron-down"} size={16} color={theme.textSub} />
        </TouchableOpacity>
        <View style={{ height: 2, backgroundColor: theme.textMain, width: 22, borderRadius: 1, marginTop: 6, marginLeft: 4 }} />
      </View>
    );
    if (item.type === 'inbox_header') return (
      <View style={{ marginTop: 14, marginBottom: 14 }}>
        <Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '900', letterSpacing: 1.8, marginLeft: 4, marginBottom: 6 }}>INBOX · {item.count}</Text>
        <View style={{ height: 2, backgroundColor: theme.textMain, width: 22, borderRadius: 1, marginLeft: 4 }} />
      </View>
    );
    if (item.type === 'inbox_comp_header') return (
      <View style={{ marginTop: 18, marginBottom: 14 }}>
        <Text style={{ color: theme.textMain, fontSize: 11, fontWeight: '900', letterSpacing: 1.8, marginLeft: 4, marginBottom: 6 }}>COMPLETED · {item.count}</Text>
        <View style={{ height: 2, backgroundColor: theme.textMain, width: 22, borderRadius: 1, marginLeft: 4 }} />
      </View>
    );
    if (item.type === 'project_arc_btn') return (
      <TouchableOpacity onPress={() => handleArchiveProject(item.projectId)} style={{ backgroundColor: hexToRgba(theme.success, 0.15), borderWidth: 1, borderColor: theme.success, borderRadius: 12, padding: 12, alignItems: 'center', marginBottom: 16, flexDirection: 'row', justifyContent: 'center', gap: 8, marginHorizontal: 16 }}>
        <Feather name="archive" size={16} color={theme.success} /><Text style={{ color: theme.success, fontWeight: '900', fontSize: 13 }}>Archive Completed Project</Text>
      </TouchableOpacity>
    );
    if (item.type === 'project_empty') return <Text style={{ color: theme.textSub, fontSize: 13, textAlign: 'center', marginVertical: 16 }}>Project is empty.</Text>;
    if (item.type === 'project_seed_ctas') return (
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, marginHorizontal: 16 }}>
        <TouchableOpacity onPress={() => handleReclaimProject(item.project.id)} style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: '#10B981', alignItems: 'center' }}>
          <Text style={{ color: '#10B981', fontSize: 13, fontWeight: '900' }}>Take Action</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDeleteProject(item.project.id)} style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
          <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '700' }}>Dissolve</Text>
        </TouchableOpacity>
      </View>
    );
    if (item.type === 'project_comp_header') return <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 8, marginLeft: 20, marginTop: 12 }}>COMPLETED</Text>;
    if (item.type === 'project_add_btn') return (
      <TouchableOpacity onPress={() => { openTaskSheet(undefined, item.project.id); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, borderStyle: 'dashed', marginTop: 8, marginHorizontal: 16, marginBottom: 16 }}>
        <Feather name="plus" size={16} color={theme.textSub} /><Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '800' }}>Add Task to {item.project.name}</Text>
      </TouchableOpacity>
    );
    if (item.type === 'project_header') return (
      <View style={{ marginBottom: item.isExp ? 0 : 16, backgroundColor: theme.bg, borderRadius: 20, borderWidth: 1, borderLeftWidth: item.isSeed ? 4 : 1, borderColor: theme.border, borderLeftColor: item.isSeed ? '#10B981' : theme.border, overflow: 'hidden' }}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setExpandedProjectId(item.isExp ? null : item.project.id); }}
          onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setActiveProjectFolderId(item.project.id); projectFolderSheetRef.current?.present(); }}
          delayLongPress={300}
          style={{ flexDirection: 'row', alignItems: 'center', padding: 20, backgroundColor: item.isExp ? hexToRgba(item.project.color, 0.05) : theme.surface }}
        >
          {item.isSeed ? (
            <Text style={{ fontSize: 18, marginRight: 14 }}>🌱</Text>
          ) : (
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: item.project.color, marginRight: 14 }} />
          )}
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={[{ color: theme.textMain, fontSize: 18, fontWeight: '900', letterSpacing: -0.5 }, rtlTextStyle(item.project.name)]}>{item.project.name}</Text>
            <Text style={[{ color: item.isSeed ? '#10B981' : theme.textSub, fontSize: 11, fontWeight: '700', marginTop: 2 }, rtlTextStyle(item.project.name)]}>
              {item.isSeed ? `Dormant ${item.daysDormant}d · take action or dissolve` : `${item.activeCount} active · ${item.pct}% done`}
            </Text>
          </View>
          <Feather name={item.isExp ? "chevron-up" : "chevron-down"} size={20} color={theme.textSub} />
        </TouchableOpacity>
      </View>
    );
    if (item.type === 'project_urgent_preview') {
      // Visually nested under its project header: negative marginTop pulls it
      // up into the header's 16px bottom margin, left indent + project-colored
      // left border signal "this belongs to the project above". Tap routes
      // straight to the urgent task: open the project AND expand the task.
      const urg = item.urgency as UrgencyLevel;
      const urgColor = urg === 'overdue' || urg === 'critical' || urg === 'high' ? theme.danger : theme.warning;
      const urgLabel = urg === 'overdue' ? 'OVERDUE' : urg === 'critical' ? 'CRITICAL' : urg === 'high' ? '< 24H' : urg.toUpperCase();
      return (
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setExpandedProjectId(item.projectId);
            setExpandedId(item.task.id);
          }}
          activeOpacity={0.85}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: -8, marginBottom: 14, marginLeft: 16, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: theme.bg, borderLeftWidth: 3, borderLeftColor: item.projectColor }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: urgColor }} />
          <Text style={[{ flex: 1, color: theme.textMain, fontSize: 12, fontWeight: '700' }, rtlTextStyle(item.task.text)]} numberOfLines={1}>{item.task.text}</Text>
          <Text style={{ color: urgColor, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>{urgLabel}</Text>
        </TouchableOpacity>
      );
    }

    // urgency pre-computed in feedData — TaskCard does zero work
    return <TaskCard
      task={item.task}
      urgency={item.urgency}
      isExp={item.isExp}
      isSeed={item.isSeed}
      delayIdx={item.delayIdx}
      isFirstInFolder={item.isFirstInFolder}
      indentInFolder={item.indentInFolder}
      theme={theme}
      calSystem={calendarType}
      activeProjects={activeProjects}
      onCheck={handleCheck}
      onSubCheck={handleSubCheck}
      onTrash={handleTrash}
      onArchive={handleArchiveTask}
      onEdit={openTaskSheet}
      onExpand={(id: string) => handleExpand(id, item.isExp)}
      onReclaim={handleReclaimTask}
      onRest={handleRestTask}
    />;
  }, [theme, completedInbox.length, calendarType, clearDoneTasks, handleArchiveProject, openTaskSheet, handleCheck, handleSubCheck, handleTrash, handleArchiveTask, handleExpand, scheduledOpen, handleReclaimTask, handleReclaimProject, handleDeleteProject, handleRestTask, activeProjects, promiseStats, tasks, activeInbox.length]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
      <BottomSheetModalProvider>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={{ flex: 1 }}>

            {/* ── HEADER ── */}
            <View style={{ paddingHorizontal: 24, paddingTop: 30, paddingBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ fontSize: 36, fontWeight: '900', color: theme.textMain, letterSpacing: -1 }}>Tasks.</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 }}>
                  <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '700' }}>{todayLabel}</Text>
                  <TouchableOpacity onPress={toggleCalendar} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                    <Text style={{ fontSize: 9, color: theme.textSub, opacity: 0.5, fontWeight: '900', letterSpacing: 0.5 }}>• {calendarType === 'shamsi' ? 'SHAMSI' : 'GREGORIAN'}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
                {/* ADHD Mode lives as a tile next to Deep Work (below), not as
                    a header icon — keeps the header uncluttered. */}
                {/* Folder-plus appears only after the Projects unlock crosses
                    (8 total tasks). Per spec the new-dot lives on the Projects
                    section header inside the add/edit sheet, not here — this
                    button just appears/disappears with the unlock. */}
                {projectsUnlocked ? (
                  <TouchableOpacity onPress={() => {
                    setEditingProjectId(null);
                    setNewProjName('');
                    setNewProjColor(COLORS[0]);
                    projectModalRef.current?.present();
                  }} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                    <Feather name="folder-plus" size={20} color={theme.textMain} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={() => vaultSheetRef.current?.present()} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                  <Feather name="archive" size={20} color={theme.textMain} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { openTaskSheet(); }} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                  <Feather name="plus-circle" size={22} color={theme.textMain} />
                </TouchableOpacity>
              </View>
            </View>

            {/* ── FLASHLIST ── Deep Work + ADHD tiles live as ListHeaderComponent
                — first scroll positions in the list, hidden by a one-shot
                scrollToOffset on focus that lands the user past them with a
                PEEK strip visible as discovery hint. Pulling up = scrolling
                to top = native scroll mechanics = 120fps smooth on any device. */}
            <View style={{ flex: 1 }}>
              <FlashList
                ref={listRef}
                data={feedData}
                keyExtractor={item => item.id}
                renderItem={renderFlashListItem}
                // @ts-ignore
                estimatedItemSize={120}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="always"
                ListHeaderComponent={
                  // Deep Work + ADHD (Focus Mode) tiles, side by side. Each is
                  // gated independently; flex:1 each so a missing sibling lets
                  // the other take the full width. ADHD also needs a non-empty
                  // pool to be worth showing. Neither unlocked → null header
                  // (no row, no margin, no peek).
                  (() => {
                    const showDeepWork = deepWorkUnlocked;
                    const showAdhd = adhdModeUnlocked && adhdPool.length > 0;
                    if (!showDeepWork && !showAdhd) return null;
                    return (
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, marginBottom: 14 }}>
                        {showDeepWork ? (
                          <TouchableOpacity
                            onPress={openDeepWorkPicker}
                            activeOpacity={0.85}
                            style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14, backgroundColor: theme.textMain, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                          >
                            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: hexToRgba('#FFFFFF', 0.14), alignItems: 'center', justifyContent: 'center' }}>
                              <Feather name="circle" size={12} color={theme.bg} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: theme.bg, fontSize: 13, fontWeight: '900', letterSpacing: -0.2 }}>Deep Work</Text>
                              <Text style={{ color: theme.bg, fontSize: 10, fontWeight: '600', opacity: 0.6, marginTop: 1 }} numberOfLines={1}>
                                {deepWorkSessions.length === 0 ? 'Focus session' : `${deepWorkSessions.length} kept`}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ) : null}
                        {showAdhd ? (
                          <TouchableOpacity
                            onPress={openAdhdMode}
                            activeOpacity={0.85}
                            style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                          >
                            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: hexToRgba(theme.textMain, 0.08), alignItems: 'center', justifyContent: 'center' }}>
                              <Feather name="zap" size={12} color={theme.textMain} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '900', letterSpacing: -0.2 }}>ADHD Mode</Text>
                              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '600', marginTop: 1 }} numberOfLines={1}>
                                {adhdPool.length} pending
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })()
                }
              />
            </View>

            {/* ── QUICK ADD BAR ── KeyboardStickyView glues it to the keyboard top ── */}
            {/* When open, translateY = (−keyboardHeight) + offset.opened, so a LARGER
                positive `opened` drops the bar DOWN. The scene lays out above the tab
                bar, so the bar's resting bottom sits a full tab-bar height off the
                screen bottom — `opened` must equal that to land it flush on the
                keyboard. useBottomTabBarHeight() ALREADY includes the tab bar's bottom
                safe-area padding (AnimatedTabBar pads Math.max(insets.bottom,10)+6), so
                do NOT add insets.bottom again — that double-counts the inset and drops
                the bar ~half its height below the keyboard top.
                We feed the MEASURED tab-bar height (not the nav hook) so the bar lands
                pixel-flush on the keyboard; the hook is a few px off what the bar
                actually paints. Falls back to the hook until the measurement lands. */}
            <KeyboardStickyView offset={{ closed: 0, opened: measuredTabBarH || tabBarHeight }}>
              <View style={{ paddingHorizontal: 20, paddingVertical: 12, backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bg, borderRadius: 16, paddingHorizontal: 16, borderWidth: 1, borderColor: theme.border }}>
                  <TextInput style={[{ flex: 1, color: theme.textMain, fontSize: 15, paddingVertical: 16, fontWeight: '600' }, persianSafeInputStyle, rtlInputStyle(quickTaskText)]} placeholder="Quick add to inbox..." placeholderTextColor={theme.textSub} value={quickTaskText} onChangeText={setQuickTaskText} onSubmitEditing={handleQuickAdd} returnKeyType="done" />
                    <TouchableOpacity onPress={handleQuickAdd} disabled={!quickTaskText} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} style={{ opacity: quickTaskText ? 1 : 0.3, padding: 8 }}>
                    <Feather name="arrow-up-circle" size={24} color={theme.textMain} />
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardStickyView>

            {/* ── MODALS & SHEETS ── */}
            {confirmDialog ? (
              <CustomConfirmModal visible={confirmDialog.visible} title={confirmDialog.title} message={confirmDialog.message} destructiveLabel={confirmDialog.destructiveLabel} theme={theme} onCancel={() => setConfirmDialog(null)} onConfirm={confirmDialog.onConfirm} />
            ) : null}

            {/* ADD/EDIT PROJECT — fixed-position sheet; topInset clamps it so keyboard slides into reserved whitespace below */}
            <BottomSheetModal
              ref={projectModalRef}
              snapPoints={projectModalSnapPoints}
              topInset={projectModalTopInset}
              enableDynamicSizing={false}
              keyboardBlurBehavior="restore"
              android_keyboardInputMode="adjustPan"
              onChange={setSheetIndex}
              onDismiss={() => { setNewProjName(''); setNewProjColor(COLORS[0]); setEditingProjectId(null); }}
              backdropComponent={renderBackdrop}
              backgroundStyle={{ backgroundColor: theme.bg, borderRadius: 32 }}
              handleIndicatorStyle={{ backgroundColor: theme.border, width: 40, height: 5 }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                <Pressable hitSlop={15} onPress={() => projectModalRef.current?.dismiss()}>
                  <Text style={{ color: theme.textSub, fontWeight: '800', fontSize: 15 }}>Cancel</Text>
                </Pressable>
                <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>{editingProjectId ? 'EDIT PROJECT' : 'NEW PROJECT'}</Text>
                <Pressable onPress={() => {
                  if (!newProjName.trim()) return;
                  Keyboard.dismiss();
                  if (editingProjectId) {
                    const existing = projects.find(p => p.id === editingProjectId);
                    if (existing) addOrUpdateProject({ ...existing, name: newProjName.trim(), color: newProjColor });
                  } else {
                    addOrUpdateProject({ id: 'p_' + Date.now(), name: newProjName.trim(), color: newProjColor, createdAt: Date.now() });
                  }
                  projectModalRef.current?.dismiss();
                }} style={{ backgroundColor: theme.textMain, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100, opacity: newProjName.trim() ? 1 : 0.4 }}>
                  <Text style={{ color: theme.bg, fontWeight: '900', fontSize: 13 }}>{editingProjectId ? 'Save' : 'Create'}</Text>
                </Pressable>
              </View>
              <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
                {/* Name first (most important). Colors below. Whitespace absorbs the keyboard — sheet itself stays locked by topInset. */}
                <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 1.3, marginBottom: 8 }}>NAME</Text>
                <BottomSheetTextInput style={[{ backgroundColor: theme.surface, color: theme.textMain, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, fontSize: 15, fontWeight: '700', marginBottom: 20, borderWidth: 1, borderColor: theme.border }, persianSafeInputStyle, rtlInputStyle(newProjName)]} placeholder="Project name..." placeholderTextColor={theme.textSub} value={newProjName} onChangeText={setNewProjName} />
                <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 1.3, marginBottom: 10 }}>COLOR</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                  {COLORS.slice(0, 8).map(c => (
                    <TouchableOpacity key={c} onPress={() => setNewProjColor(c)} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, alignItems: 'center', justifyContent: 'center' }}>
                      {newProjColor === c ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFF' }} /> : null}
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  {COLORS.slice(8, 16).map(c => (
                    <TouchableOpacity key={c} onPress={() => setNewProjColor(c)} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, alignItems: 'center', justifyContent: 'center' }}>
                      {newProjColor === c ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFF' }} /> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </BottomSheetModal>

            {/* ADD/EDIT TASK — pageSheet Modal (iOS: card-sheet that slides from bottom; Android: fullscreen fallback) */}
            {/* Stable layout + KeyboardAvoidingView pads smoothly. No re-scroll on suggestion-strip height changes, so Persian composition never causes visual jump. */}
            <Modal visible={taskModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTaskModalVisible(false)}>
              <View style={{ flex: 1, backgroundColor: theme.surface }}>
                <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                  {/* ── TOP BAR: Cancel | Commit ── */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.bg }}>
                    <Pressable hitSlop={15} onPress={() => setTaskModalVisible(false)}>
                      <Text style={{ color: theme.textSub, fontWeight: '800', fontSize: 16 }}>Cancel</Text>
                    </Pressable>
                    <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>{editingTask ? 'EDIT TASK' : 'NEW TASK'}</Text>
                    <Pressable onPress={handleSaveTaskFromSheet} style={{ backgroundColor: theme.textMain, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100 }}>
                      <Text style={{ color: theme.bg, fontWeight: '900', fontSize: 13 }}>Commit</Text>
                    </Pressable>
                  </View>
                  <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 18, paddingBottom: 60, paddingHorizontal: 20 }} keyboardShouldPersistTaps="handled">
                {/* ── HEAVY TIER — title + notes (content being written) ── */}
                <View style={{ backgroundColor: theme.bg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12, borderWidth: 1, borderColor: theme.border }}>
                  <TextInput style={[{ fontSize: 18, fontWeight: '800', color: theme.textMain, padding: 0 }, persianSafeInputStyle, rtlInputStyle(txt)]} placeholder="Task name..." placeholderTextColor={theme.textSub} value={txt} onChangeText={t => { setTxt(t); if (err) setErr(''); }} />
                </View>
                <View style={{ backgroundColor: theme.bg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 26, borderWidth: 1, borderColor: theme.border, minHeight: 72 }}>
                  <TextInput style={[{ fontSize: 14, fontWeight: '500', color: theme.textMain, padding: 0, textAlignVertical: 'top', lineHeight: 20 }, persianSafeInputStyle, rtlInputStyle(notes)]} placeholder="Add details or notes..." placeholderTextColor={theme.textSub} multiline value={notes} onChangeText={setNotes} />
                </View>

                {/* ── QUICK TIER — priority, color, project (tight, visual pickers, 9pt labels) ── */}
                <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 1.3, marginBottom: 8 }}>PRIORITY</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                  {(['Low', 'Medium', 'High'] as Priority[]).map(p => (
                    <TouchableOpacity key={p} onPress={() => setPriority(p)} style={{ flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: theme.bg, borderWidth: 1, borderColor: priority === p ? theme.textMain : theme.border, alignItems: 'center' }}>
                      <Text style={{ color: priority === p ? theme.textMain : theme.textSub, fontSize: 12, fontWeight: '800' }}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 1.3, marginBottom: 8 }}>COLOR</Text>
                <View style={{ marginBottom: 14 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                    {COLORS.slice(0, 8).map(c => (
                      <TouchableOpacity key={c} onPress={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, alignItems: 'center', justifyContent: 'center' }}>
                        {color === c ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFF' }} /> : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    {COLORS.slice(8, 16).map(c => (
                      <TouchableOpacity key={c} onPress={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, alignItems: 'center', justifyContent: 'center' }}>
                        {color === c ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFF' }} /> : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* PROJECT picker — gated on the PROJECTS unlock (8 total
                    tasks). Hides if no projects exist yet (user creates one
                    via the folder-plus button in the tab header). The new-dot
                    on the PROJECT label is this feature's only announcement —
                    the unlock fires no whisper. FadeIn plays on first open
                    after unlock (projectsIsNew), then settles once the user
                    taps a chip (markDotSeen clears both dot and fade). */}
                {projectsUnlocked && activeProjects.length > 0 ? (
                  <Animated.View entering={projectsIsNew ? FadeIn.duration(300) : undefined} style={{ marginBottom: 26 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 }}>PROJECT</Text>
                      {projectsIsNew ? (
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#3B82F6', marginLeft: 6 }} />
                      ) : null}
                    </View>
                    <GHScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      <TouchableOpacity onPress={() => { markDotSeen(FEATURE_IDS.PROJECTS); setProjectId(undefined); }} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: !projectId ? theme.textMain : theme.bg, borderWidth: 1, borderColor: !projectId ? theme.textMain : theme.border, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: !projectId ? theme.bg : theme.textSub }} />
                        <Text style={{ color: !projectId ? theme.bg : theme.textSub, fontSize: 12, fontWeight: '800' }}>Inbox</Text>
                      </TouchableOpacity>
                      {activeProjects.map((p: Project) => (
                        <TouchableOpacity key={p.id} onPress={() => { markDotSeen(FEATURE_IDS.PROJECTS); setProjectId(p.id); }} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: projectId === p.id ? p.color : theme.bg, borderWidth: 1, borderColor: projectId === p.id ? p.color : theme.border, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: projectId === p.id ? '#FFF' : p.color }} />
                          <Text style={{ color: projectId === p.id ? '#FFF' : theme.textSub, fontSize: 12, fontWeight: '800' }}>{p.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </GHScrollView>
                  </Animated.View>
                ) : <View style={{ marginBottom: 14 }} />}

                {/* ── DEFERRED TIER — schedule, repeat, subtasks (spacious, 10pt labels) ── */}
                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 12 }}>SCHEDULE</Text>
                <TouchableOpacity onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setCalOpen(!calOpen); }} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: theme.bg, borderRadius: 12, borderWidth: 1, borderColor: theme.border, borderStyle: 'dashed', marginBottom: 24 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Feather name="calendar" size={16} color={calOpen ? theme.accent : theme.textSub} /><Text style={{ color: calOpen ? theme.accent : theme.textSub, fontSize: 14, fontWeight: '800' }}>{calOpen ? 'Hide Schedule' : 'Set Start Date, Deadline & Reminders'}</Text></View>
                  <Feather name={calOpen ? "chevron-up" : "chevron-down"} size={16} color={calOpen ? theme.accent : theme.textSub} />
                </TouchableOpacity>

                {calOpen ? (
                  <View style={{ backgroundColor: theme.bg, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: theme.border, marginBottom: 24, marginTop: -12 }}>
                    {/* Start / Due tab switch */}
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                      <TouchableOpacity onPress={() => setDateTab('start')} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: dateTab === 'start' ? theme.textMain : theme.surface, borderWidth: 1, borderColor: dateTab === 'start' ? theme.textMain : theme.border }}>
                        <Text style={{ color: dateTab === 'start' ? theme.bg : theme.textSub, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>START{startDate ? ` · ${formatDisplayDate(startDate, calendarType)}` : ''}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setDateTab('due')} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: dateTab === 'due' ? theme.textMain : theme.surface, borderWidth: 1, borderColor: dateTab === 'due' ? theme.textMain : theme.border }}>
                        <Text style={{ color: dateTab === 'due' ? theme.bg : theme.textSub, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>DUE{deadlineDate ? ` · ${formatDisplayDate(deadlineDate, calendarType)}` : ''}</Text>
                      </TouchableOpacity>
                    </View>

                    {dateTab === 'start' ? (
                      <>
                        <CalendarPicker value={startDate} onChange={(s) => {
                          setStartDate(s);
                          if (s && deadlineDate && deadlineDate < s) {
                            setDeadlineDate(''); setDeadlineTime(''); setHasReminder(false); setReminderTime('');
                            flashScheduleNotice('Deadline cleared — it was before the new start date.');
                          }
                        }} theme={theme} calSystem={calendarType} />
                        {startDate ? (
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                            <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', opacity: 0.7 }}>Hidden from feed until this date</Text>
                            <TouchableOpacity onPress={() => setStartDate('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Text style={{ color: theme.danger, fontSize: 12, fontWeight: '800' }}>Clear Start</Text></TouchableOpacity>
                          </View>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <CalendarPicker value={deadlineDate} onChange={setDeadlineDate} theme={theme} calSystem={calendarType} minDate={startDate || undefined} />
                        {deadlineDate ? (
                          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                            <TouchableOpacity onPress={() => { setDeadlineDate(''); setDeadlineTime(''); setHasReminder(false); setReminderTime(''); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Text style={{ color: theme.danger, fontSize: 12, fontWeight: '800' }}>Clear Deadline</Text></TouchableOpacity>
                          </View>
                        ) : null}
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                          <TextInput style={{ flex: 1, backgroundColor: theme.surface, color: theme.textMain, padding: 12, borderRadius: 10, textAlign: 'center', fontWeight: '700', fontSize: 13, borderWidth: 1, borderColor: theme.border }} placeholder="Due time (HH:MM)" placeholderTextColor={theme.textSub} value={deadlineTime} onChangeText={(t) => handleTimeChange(t, setDeadlineTime)} onBlur={() => handleTimeBlur(deadlineTime, setDeadlineTime)} keyboardType="numeric" />
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingHorizontal: 4 }}>
                          <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 14 }}>Remind Me</Text>
                          <Switch value={hasReminder} onValueChange={setHasReminder} trackColor={{ true: theme.textMain }} thumbColor="#FFF" />
                        </View>
                        {hasReminder ? (
                          <View style={{ marginTop: 12 }}>
                            <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 1.5, marginBottom: 8 }}>WHEN</Text>
                            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                              {([{ v: 0, l: 'Same day' }, { v: 1, l: '1 day before' }, { v: 2, l: '2 days before' }, { v: 7, l: '1 week before' }]).map(o => (
                                <TouchableOpacity key={o.v} onPress={() => setReminderOffsetDays(o.v)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: reminderOffsetDays === o.v ? theme.textMain : theme.surface, borderWidth: 1, borderColor: reminderOffsetDays === o.v ? theme.textMain : theme.border }}>
                                  <Text style={{ color: reminderOffsetDays === o.v ? theme.bg : theme.textSub, fontWeight: '800', fontSize: 11 }}>{o.l}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                            <TextInput style={{ backgroundColor: theme.surface, color: theme.textMain, padding: 12, borderRadius: 10, textAlign: 'center', fontWeight: '700', fontSize: 13, borderWidth: 1, borderColor: theme.border }} placeholder="Alert time (HH:MM)" placeholderTextColor={theme.textSub} value={reminderTime} onChangeText={(t) => handleTimeChange(t, setReminderTime)} onBlur={() => handleTimeBlur(reminderTime, setReminderTime)} keyboardType="numeric" />
                          </View>
                        ) : null}
                      </>
                    )}
                    {scheduleNotice ? (
                      <Text style={{ color: theme.warning, fontSize: 11, fontWeight: '700', marginTop: 12, textAlign: 'center' }}>{scheduleNotice}</Text>
                    ) : null}
                  </View>
                ) : null}

                {/* ── PROMISE ── opt-in commitment that adds a "kept" or
                     "broken" mark to the permanent record at the deadline.
                     Only meaningful with a deadline set; we surface it here
                     (right after the schedule block) so users see it in
                     context. When no deadline is set, the toggle still
                     works but the dim sub-label tells them it won't track
                     until they add a date — better than hiding the toggle
                     entirely (would feel arbitrary). Gated on the commitment
                     unlock (4 active tasks); same threshold also unlocks
                     Deep Work, but they're surfaced in different places. */}
                {promiseUnlocked ? (
                  <Animated.View entering={promiseIsNew ? FadeIn.duration(300) : undefined}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                      <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }}>PROMISE</Text>
                      {promiseIsNew ? (
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#3B82F6', marginLeft: 8 }} />
                      ) : null}
                    </View>
                    <TouchableOpacity
                      onPress={() => { markDotSeen(FEATURE_IDS.PROMISE); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPromised(p => !p); }}
                      activeOpacity={0.85}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, backgroundColor: theme.bg, borderRadius: 12, borderWidth: 1, borderColor: promised ? color : theme.border, borderLeftWidth: promised ? 4 : 1, borderLeftColor: promised ? color : theme.border, marginBottom: 24 }}
                    >
                      <Feather name={promised ? 'shield' : 'shield-off'} size={18} color={promised ? color : theme.textSub} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: promised ? theme.textMain : theme.textSub, fontSize: 14, fontWeight: '900', letterSpacing: -0.2 }}>
                          {promised ? 'Promised' : 'Promise this?'}
                        </Text>
                        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600', marginTop: 3, opacity: 0.8 }}>
                          {promised
                            ? (deadlineDate ? 'Kept by deadline = mark. Missed = scar.' : 'Set a deadline to lock the promise in.')
                            : 'Track it on your record. No pressure.'}
                        </Text>
                      </View>
                      <Switch value={promised} onValueChange={(v) => { markDotSeen(FEATURE_IDS.PROMISE); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPromised(v); }} trackColor={{ true: color }} thumbColor="#FFF" />
                    </TouchableOpacity>
                  </Animated.View>
                ) : null}

                {/* REPEAT ROUTINE — gated on the recurring unlock (5 total
                    tasks). Once unlocked, this block carries the repeat type
                    selector, the weekly/custom day picker, the monthly day
                    input, and the next-instance preview below. Dot on the
                    label acknowledges on any recur option tap. */}
                {recurringUnlocked ? (
                  <Animated.View entering={recurringIsNew ? FadeIn.duration(300) : undefined}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                      <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }}>REPEAT ROUTINE</Text>
                      {recurringIsNew ? (
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#3B82F6', marginLeft: 8 }} />
                      ) : null}
                    </View>
                    <GHScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 24 }}>
                      {REPEAT_OPTIONS.map(rt => (
                        <TouchableOpacity key={rt} onPress={() => { markDotSeen(FEATURE_IDS.RECURRING); setRecurType(rt); if (rt !== 'weekly' && rt !== 'custom') setRecurDays([]); if (rt !== 'monthly') setRecurDayOfMonth(undefined); }} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.bg, borderWidth: 1, borderColor: recurType === rt ? theme.textMain : theme.border }}>
                          <Text style={{ color: recurType === rt ? theme.textMain : theme.textSub, fontSize: 11, fontWeight: '800', textTransform: 'capitalize' }}>{rt}</Text>
                        </TouchableOpacity>
                      ))}
                    </GHScrollView>

                    {recurType === 'weekly' || recurType === 'custom' ? (
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 24 }}>
                        {JS_DAY_SHORT.map(d => {
                          const isSel = recurDays.includes(d);
                          return (
                            <TouchableOpacity key={d} onPress={() => { if (recurType === 'custom') { setRecurDays(p => isSel ? p.filter(x => x !== d) : [...p, d]); } else { setRecurDays([d]); } }} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.bg, borderWidth: 1, borderColor: isSel ? theme.textMain : theme.border }}>
                              <Text style={{ color: isSel ? theme.textMain : theme.textSub, fontWeight: '800', fontSize: 11 }}>{d}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ) : null}

                    {recurType === 'monthly' ? (
                      <View style={{ marginBottom: 24 }}>
                        <TextInput style={{ backgroundColor: theme.bg, color: theme.textMain, padding: 12, borderRadius: 10, fontSize: 13, borderWidth: 1, borderColor: theme.border }} placeholder="Day of the month (1-31)" placeholderTextColor={theme.textSub} keyboardType="numeric" value={recurDayOfMonth?.toString() || ''} onChangeText={t => { let val = parseInt(t.replace(/[^0-9]/g, '')); if (val > 31) val = 31; if (val < 1) val = 1; setRecurDayOfMonth(isNaN(val) ? undefined : val); }} />
                      </View>
                    ) : null}
                  </Animated.View>
                ) : null}

                {/* Next-instance preview — closes the gap between "I picked a
                    schedule" and "what does that mean?" Reuses the same
                    calculateNextOccurrence helper that the recurrence engine
                    uses at runtime, so the preview is exactly what the user
                    will see after they save and complete the current
                    instance. Hidden when the schedule needs more input
                    (weekly/custom with no day picked, monthly with no day). */}
                {(() => {
                  if (recurType === 'none') return null;
                  if ((recurType === 'weekly' || recurType === 'custom') && recurDays.length === 0) return null;
                  if (recurType === 'monthly' && !recurDayOfMonth) return null;
                  const previewTask: Task = {
                    id: 'preview', text: '', notes: '', completed: false, createdAt: 0,
                    deadlineDate: '', deadlineTime: '', hasReminder: false,
                    priority: 'Low', color: '#000', subTasks: [], hasProgress: false,
                    progress: 0, recurType, recurDays, recurDayOfMonth,
                  };
                  const next = calculateNextOccurrence(previewTask);
                  // Format as "Mon, May 13" for clarity. Falls back to ISO
                  // date if the parse fails defensively.
                  const [yy, mm, dd] = next.split('-').map(Number);
                  const d = new Date(yy, (mm || 1) - 1, dd || 1);
                  const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
                  const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
                  const label = isNaN(d.getTime()) ? next : `${dayName}, ${monthName} ${d.getDate()}`;
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: theme.bg, borderRadius: 10, borderWidth: 1, borderColor: theme.border }}>
                      <Feather name="calendar" size={13} color={theme.textSub} />
                      <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>NEXT</Text>
                      <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '700' }}>{label}</Text>
                    </View>
                  );
                })()}

                {/* SUB-TASKS — gated on the subtasks unlock (3 total tasks).
                    Dot on the label acknowledges on first interaction with
                    either an existing subtask input, the add-step input, or
                    the plus button. */}
                {subtasksUnlocked ? (
                  <Animated.View entering={subtasksIsNew ? FadeIn.duration(300) : undefined}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                      <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }}>SUB-TASKS</Text>
                      {subtasksIsNew ? (
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#3B82F6', marginLeft: 8 }} />
                      ) : null}
                    </View>
                    {subTasks.map((s, i) => (
                      <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                        <TextInput style={[{ flex: 1, backgroundColor: theme.bg, color: theme.textMain, padding: 12, borderRadius: 10, fontSize: 14 }, persianSafeInputStyle, rtlInputStyle(s.text)]} value={s.text} onChangeText={t => { markDotSeen(FEATURE_IDS.SUBTASKS); setSubTasks(prev => prev.map((x, j) => j === i ? { ...x, text: t } : x)); }} placeholder="Step..." placeholderTextColor={theme.textSub} />
                        <TouchableOpacity onPress={() => setSubTasks(p => p.filter(x => x.id !== s.id))} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} style={{ padding: 4 }}><Feather name="x" size={16} color={theme.danger} /></TouchableOpacity>
                      </View>
                    ))}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TextInput style={[{ flex: 1, backgroundColor: theme.bg, color: theme.textMain, padding: 12, borderRadius: 10, fontSize: 14 }, persianSafeInputStyle, rtlInputStyle(newSubTxt)]} placeholder="Add step..." placeholderTextColor={theme.textSub} value={newSubTxt} onChangeText={(t) => { markDotSeen(FEATURE_IDS.SUBTASKS); setNewSubTxt(t); }} onSubmitEditing={() => { if (newSubTxt.trim()) { setSubTasks(p => [...p, { id: Date.now().toString(), text: newSubTxt.trim(), completed: false }]); setNewSubTxt(''); } }} returnKeyType="done" />
                      <TouchableOpacity onPress={() => { markDotSeen(FEATURE_IDS.SUBTASKS); if (newSubTxt.trim()) { setSubTasks(p => [...p, { id: Date.now().toString(), text: newSubTxt.trim(), completed: false }]); setNewSubTxt(''); } }} style={{ backgroundColor: theme.textMain, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' }}><Feather name="plus" size={16} color={theme.bg} /></TouchableOpacity>
                    </View>
                  </Animated.View>
                ) : null}

                    </ScrollView>
                  </KeyboardAvoidingView>
                </SafeAreaView>
              </View>
            </Modal>

            {/* VAULT SHEET */}
            <BottomSheetModal ref={vaultSheetRef} snapPoints={['100%']} enableDynamicSizing={false} index={0} topInset={insets.top} onChange={setSheetIndex} backdropComponent={renderBackdrop} backgroundStyle={{ backgroundColor: theme.bg, borderRadius: 32 }} handleIndicatorStyle={{ backgroundColor: theme.border, width: 40, height: 5 }}>
              <View style={{ paddingHorizontal: 24, paddingTop: 10, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 28, fontWeight: '900', color: theme.textMain, letterSpacing: -1 }}>Vault.</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
                  {vaultTab === 'trash' && trashTasks.length > 0 && (
                    <TouchableOpacity onPress={purgeAllTrash} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Text style={{ color: theme.danger, fontWeight: '800', fontSize: 14 }}>Purge all</Text></TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => vaultSheetRef.current?.dismiss()} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="x" size={24} color={theme.textMain} /></TouchableOpacity>
                </View>
              </View>
              <View style={{ paddingHorizontal: 24, marginBottom: 20 }}>
                <GHScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {(['trash', 'archived', 'projects'] as const).map(t => (
                    <TouchableOpacity key={t} onPress={() => setVaultTab(t)} style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, backgroundColor: vaultTab === t ? theme.textMain : theme.surface, borderWidth: 1, borderColor: theme.border }}>
                      <Text style={{ color: vaultTab === t ? theme.bg : theme.textSub, fontWeight: '800', fontSize: 13, textTransform: 'capitalize' }}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </GHScrollView>
              </View>
              <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
                {vaultTab === 'trash' && trashTasks.length === 0 ? <EmptyArt icon="trash" message="Trash is empty. Your deleted tasks will appear here." theme={theme} /> : null}
                {vaultTab === 'archived' && archivedTasks.length === 0 ? <EmptyArt icon="archive" message="Archive is empty. Tasks you tuck away for later will live here." theme={theme} /> : null}
                {vaultTab === 'projects' && archivedProjects.length === 0 ? <EmptyArt icon="folder" message="No archived projects yet. Completed ones will rest here." theme={theme} /> : null}

                {(vaultTab === 'trash' ? trashTasks : vaultTab === 'archived' ? archivedTasks : []).map((t: Task) => (
                  <View key={t.id} style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}><Text style={[{ color: theme.textSub, fontSize: 15, fontWeight: '700', textDecorationLine: t.completed ? 'line-through' : 'none' }, rtlTextStyle(t.text)]}>{t.text}</Text></View>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <TouchableOpacity onPress={() => setTasks(useAppStore.getState().tasks.map(x => x.id === t.id ? { ...x, status: undefined } : x))} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} style={{ padding: 8, backgroundColor: theme.bg, borderRadius: 8 }}><Feather name="refresh-ccw" size={16} color={theme.success} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => setConfirmDialog({ visible: true, title: vaultTab === 'archived' ? 'Delete Archived Task' : 'Purge Task', message: "Are you sure? This cannot be undone.", destructiveLabel: "Purge Forever", onConfirm: () => { setTasks(useAppStore.getState().tasks.filter(x => x.id !== t.id)); setConfirmDialog(null); } })} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} style={{ padding: 8, backgroundColor: theme.bg, borderRadius: 8 }}><Feather name="x" size={16} color={theme.danger} /></TouchableOpacity>
                    </View>
                  </View>
                ))}

                {vaultTab === 'projects' && (() => {
                  // Partition archived folders by completion. Pending first (actionable — user might revive),
                  // Completed second (trophies). Section labels only when BOTH groups exist.
                  const entries = archivedProjects.map((p: Project) => {
                    const ptasks = tasks.filter(t => t.projectId === p.id && t.status !== 'trash');
                    const totalCount = ptasks.length;
                    const doneCount = ptasks.filter(t => t.completed).length;
                    const isComplete = totalCount > 0 && doneCount === totalCount;
                    return { p, totalCount, doneCount, isComplete };
                  });
                  const pending = entries.filter(e => !e.isComplete);
                  const completed = entries.filter(e => e.isComplete);
                  const showLabels = pending.length > 0 && completed.length > 0;

                  const renderFolder = ({ p, totalCount, doneCount, isComplete }: typeof entries[number]) => {
                    const pendingCount = totalCount - doneCount;
                    const expanded = expandedArchivedProjectId === p.id;
                    const childTasks = tasks.filter(t => t.projectId === p.id && t.status !== 'trash');
                    return (
                      <View key={p.id} style={{ marginBottom: 12 }}>
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setExpandedArchivedProjectId(prev => prev === p.id ? null : p.id); }}
                          style={{ backgroundColor: theme.surface, borderRadius: expanded ? 16 : 16, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: expanded ? 0 : 16, borderBottomRightRadius: expanded ? 0 : 16, padding: 16, borderWidth: 1, borderColor: isComplete ? hexToRgba(theme.success, 0.4) : theme.border, flexDirection: 'row', alignItems: 'center', borderBottomWidth: expanded ? 0 : 1 }}
                        >
                          {isComplete ? (
                            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: hexToRgba(theme.success, 0.18), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                              <Feather name="check" size={13} color={theme.success} />
                            </View>
                          ) : (
                            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: p.color, marginRight: 14 }} />
                          )}
                          <View style={{ flex: 1 }}>
                            <Text style={[{ color: theme.textMain, fontSize: 16, fontWeight: '800' }, rtlTextStyle(p.name)]}>{p.name}</Text>
                            <Text style={{ color: isComplete ? theme.success : theme.textSub, fontSize: 11, fontWeight: '700', marginTop: 3, opacity: 0.9 }}>
                              {isComplete ? `Completed · ${totalCount} done` : totalCount === 0 ? 'Empty project' : `Pending · ${pendingCount} unfinished`}
                            </Text>
                          </View>
                          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                            {totalCount > 0 ? (
                              <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={theme.textSub} />
                            ) : null}
                            <TouchableOpacity onPress={() => addOrUpdateProject({ ...p, status: undefined })} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} style={{ padding: 8, backgroundColor: theme.bg, borderRadius: 8 }}><Feather name="refresh-ccw" size={16} color={theme.success} /></TouchableOpacity>
                            <TouchableOpacity onPress={() => setConfirmDialog({ visible: true, title: 'Delete Project', message: "Deleting this project will permanently erase it and send all contained tasks to the Trash.", destructiveLabel: "Purge Forever", onConfirm: () => { deleteProject(p.id); setTasks(useAppStore.getState().tasks.map(t => t.projectId === p.id ? { ...t, projectId: undefined } : t)); setConfirmDialog(null); } })} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} style={{ padding: 8, backgroundColor: theme.bg, borderRadius: 8 }}><Feather name="x" size={16} color={theme.danger} /></TouchableOpacity>
                          </View>
                        </TouchableOpacity>
                        {expanded && childTasks.length > 0 ? (
                          <View style={{ backgroundColor: theme.bg, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, borderWidth: 1, borderTopWidth: 0, borderColor: isComplete ? hexToRgba(theme.success, 0.4) : theme.border, paddingVertical: 4 }}>
                            {childTasks.map(t => (
                              <View key={t.id} style={{ paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                <Feather name={t.completed ? 'check-square' : 'square'} size={14} color={t.completed ? theme.success : theme.textSub} style={{ opacity: t.completed ? 1 : 0.5 }} />
                                <Text
                                  numberOfLines={1}
                                  style={[{ flex: 1, color: theme.textSub, fontSize: 13, fontWeight: '600', textDecorationLine: t.completed ? 'line-through' : 'none' }, rtlTextStyle(t.text)]}
                                >
                                  {t.text || '(empty)'}
                                </Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    );
                  };

                  return (
                    <>
                      {showLabels && pending.length > 0 ? (
                        <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 10, marginLeft: 4 }}>PENDING · {pending.length}</Text>
                      ) : null}
                      {pending.map(renderFolder)}
                      {showLabels && completed.length > 0 ? (
                        <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 10, marginTop: 12, marginLeft: 4 }}>COMPLETED · {completed.length}</Text>
                      ) : null}
                      {completed.map(renderFolder)}
                    </>
                  );
                })()}
              </BottomSheetScrollView>
            </BottomSheetModal>

            {/* PROJECT DETAIL SHEET */}
            <BottomSheetModal ref={projectFolderSheetRef} snapPoints={snapPoints} onChange={setSheetIndex} backdropComponent={renderBackdrop} backgroundStyle={{ backgroundColor: theme.bg, borderRadius: 32 }} handleIndicatorStyle={{ backgroundColor: theme.border, width: 40, height: 5 }}>
              <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
                {(() => {
                  const p = projects.find(x => x.id === activeProjectFolderId);
                  if (!p) return null;
                  const ptasks = tasks.filter(t => t.projectId === p.id && t.status !== 'trash' && t.status !== 'archived');
                  const active = sortTasks(ptasks.filter(t => !t.completed));
                  const comp = ptasks.filter(t => t.completed);
                  const pct = ptasks.length > 0 ? Math.round((comp.length / ptasks.length) * 100) : 0;
                  const seedInfo = projectSeedInfo.get(p.id);
                  const isSeed = !!seedInfo?.isSeed;
                  const isComplete = pct === 100 && ptasks.length > 0;
                  return (
                    <View>
                      {/* ── HERO HEADER ── color chip + name + rename, then progress bar or seed-pressure row */}
                      <View style={{ marginBottom: 20, marginTop: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: p.color }} />
                          <Text style={[{ flex: 1, fontSize: 28, fontWeight: '900', color: theme.textMain, letterSpacing: -1 }, rtlTextStyle(p.name)]} numberOfLines={1}>{p.name}</Text>
                          <TouchableOpacity
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setEditingProjectId(p.id); setNewProjName(p.name); setNewProjColor(p.color); projectModalRef.current?.present(); }}
                            hitSlop={12}
                            style={{ padding: 6 }}
                          >
                            <Feather name="edit-3" size={18} color={theme.textSub} />
                          </TouchableOpacity>
                        </View>
                        {isSeed ? (
                          <View style={{ marginTop: 14, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: hexToRgba('#10B981', 0.4), backgroundColor: hexToRgba('#10B981', 0.08), flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <Feather name="alert-circle" size={14} color="#10B981" />
                            <Text style={{ color: '#10B981', fontWeight: '800', fontSize: 12, flex: 1 }}>Dormant {seedInfo?.daysDormant}d — take action or dissolve</Text>
                          </View>
                        ) : (
                          <View style={{ marginTop: 14 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                              <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
                                {active.length} ACTIVE · {comp.length} DONE
                              </Text>
                              <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '900' }}>{pct}%</Text>
                            </View>
                            <View style={{ height: 3, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden' }}>
                              <View style={{ height: 3, width: `${pct}%`, backgroundColor: p.color, borderRadius: 2 }} />
                            </View>
                          </View>
                        )}
                      </View>

                      {isComplete ? (
                        <TouchableOpacity onPress={() => { handleArchiveProject(p.id); projectFolderSheetRef.current?.dismiss(); }} style={{ backgroundColor: hexToRgba(theme.success, 0.15), borderWidth: 1, borderColor: theme.success, borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 20, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
                          <Feather name="archive" size={18} color={theme.success} />
                          <Text style={{ color: theme.success, fontWeight: '900', fontSize: 14 }}>Project Complete. Archive.</Text>
                        </TouchableOpacity>
                      ) : null}

                      {active.length === 0 && comp.length === 0 ? (
                        <View style={{ paddingVertical: 36, alignItems: 'center' }}>
                          <Feather name="folder" size={32} color={theme.border} />
                          <Text style={{ color: theme.textSub, marginTop: 12, fontSize: 13, fontWeight: '700' }}>This project is empty</Text>
                        </View>
                      ) : null}

                      {/* ── ACTIVE TASKS — urgency-sorted, tap to edit ── */}
                      {active.map((t: Task) => {
                        const urgency = getUrgency(t);
                        const accentColor = urgency === 'overdue' ? theme.danger : urgency === 'critical' || urgency === 'high' ? theme.warning : p.color;
                        const subDone = t.subTasks?.filter(s => s.completed).length || 0;
                        const subTotal = t.subTasks?.length || 0;
                        const hasMeta = !!t.deadlineDate || t.priority === 'High' || subTotal > 0;
                        return (
                          <TouchableOpacity
                            key={t.id}
                            activeOpacity={0.7}
                            onPress={() => openTaskSheet(t)}
                            style={{ padding: 14, backgroundColor: theme.surface, borderRadius: 16, marginBottom: 10, borderWidth: 1, borderColor: theme.border, borderLeftWidth: 3, borderLeftColor: accentColor }}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <TouchableOpacity onPress={() => handleCheck(t.id)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={{ marginRight: 14 }}>
                                <Feather name="circle" size={22} color={p.color} />
                              </TouchableOpacity>
                              <Text style={[{ flex: 1, color: theme.textMain, fontSize: 15, fontWeight: '700' }, rtlTextStyle(t.text)]} numberOfLines={2}>{t.text}</Text>
                            </View>
                            {hasMeta ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginLeft: 36, flexWrap: 'wrap' }}>
                                {t.deadlineDate ? (
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <Feather name="calendar" size={10} color={urgency === 'overdue' ? theme.danger : theme.textSub} />
                                    <Text style={{ color: urgency === 'overdue' ? theme.danger : theme.textSub, fontSize: 11, fontWeight: '800' }}>
                                      {formatDisplayDate(t.deadlineDate, calendarType)}{t.deadlineTime ? ` · ${t.deadlineTime}` : ''}
                                    </Text>
                                  </View>
                                ) : null}
                                {t.priority === 'High' ? (
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: theme.warning }} />
                                    <Text style={{ color: theme.warning, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 }}>HIGH</Text>
                                  </View>
                                ) : null}
                                {subTotal > 0 ? (
                                  <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '800' }}>{subDone}/{subTotal}</Text>
                                ) : null}
                              </View>
                            ) : null}
                          </TouchableOpacity>
                        );
                      })}

                      {/* ── ADD TASK TO FOLDER — inline dashed button, layer-on-layer over folder sheet ── */}
                      {!isComplete ? (
                        <TouchableOpacity
                          onPress={() => { openTaskSheet(undefined, p.id); }}
                          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, borderStyle: 'dashed', marginTop: 4, marginBottom: 4 }}
                        >
                          <Feather name="plus" size={14} color={theme.textSub} />
                          <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 }}>ADD TASK</Text>
                        </TouchableOpacity>
                      ) : null}

                      {comp.length > 0 ? (
                        <View style={{ marginTop: 24 }}>
                          <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 12 }}>COMPLETED · {comp.length}</Text>
                          {comp.map((t: Task) => (
                            <TouchableOpacity key={t.id} onPress={() => handleCheck(t.id)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: theme.surface, borderRadius: 16, marginBottom: 10, opacity: 0.65, borderWidth: 1, borderColor: theme.border }}>
                              <View style={{ marginRight: 14 }}>
                                <Feather name="check-circle" size={20} color={p.color} />
                              </View>
                              <Text style={[{ color: theme.textSub, fontSize: 14, fontWeight: '700', flex: 1, textDecorationLine: 'line-through' }, rtlTextStyle(t.text)]} numberOfLines={1}>{t.text}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}

                      {/* ── FOLDER ACTIONS ── Archive keeps folder + tasks (restorable from vault). Delete returns tasks to Inbox. */}
                      <View style={{ marginTop: 32, paddingTop: 20, borderTopWidth: 1, borderTopColor: theme.border, flexDirection: 'row', gap: 10 }}>
                        <TouchableOpacity onPress={() => { handleArchiveProject(p.id); projectFolderSheetRef.current?.dismiss(); }} style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
                          <Feather name="archive" size={14} color={theme.textSub} />
                          <Text style={{ color: theme.textSub, fontWeight: '800', fontSize: 13 }}>Archive</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { projectFolderSheetRef.current?.dismiss(); setTimeout(() => handleDeleteProject(p.id), 250); }} style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: hexToRgba(theme.danger, 0.3), alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
                          <Feather name="trash-2" size={14} color={theme.danger} />
                          <Text style={{ color: theme.danger, fontWeight: '800', fontSize: 13 }}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })()}
              </BottomSheetScrollView>
            </BottomSheetModal>

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
                    android: {},
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

          {/* ── DEEP WORK MODALS ── */}
          {/* Stage 1: PICKER — intent + target + duration setup */}
          <Modal visible={dwPickerVisible} transparent animationType="slide" onRequestClose={() => setDwPickerVisible(false)}>
            <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setDwPickerVisible(false)} />
              <Animated.View style={[{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingHorizontal: 24, paddingTop: 16, maxHeight: '88%' }, sheetBottomPadStyle]}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 16 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <Text style={{ color: theme.textMain, fontSize: 26, fontWeight: '900', letterSpacing: -0.8 }}>Deep Work.</Text>
                  {deepWorkSessions.length > 0 ? (
                    <TouchableOpacity
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDwHistoryExpanded(null); setDwHistoryVisible(true); }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}
                    >
                      <Feather name="clock" size={12} color={theme.textSub} />
                      <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '800' }}>History · {deepWorkSessions.length}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', marginBottom: 22 }}>Pick a target. Pick a length. Begin.</Text>

                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets={false} contentContainerStyle={{ paddingBottom: 8 }}>
                  <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }}>TOWARD WHAT</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: 18, backgroundColor: isDarkMode ? '#111' : theme.bg, borderRadius: 12, padding: 4 }}>
                    {([
                      { key: 'free' as DeepWorkIntent, label: 'Free' },
                      { key: 'task' as DeepWorkIntent, label: 'Task' },
                      { key: 'habit' as DeepWorkIntent, label: 'Habit' },
                      { key: 'challenge' as DeepWorkIntent, label: 'Goal' },
                    ]).map(opt => {
                      const active = dwIntent === opt.key;
                      return (
                        <TouchableOpacity
                          key={opt.key}
                          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDwIntent(opt.key); setDwTargetId(undefined); setDwTargetTitle(''); }}
                          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: active ? theme.textMain : 'transparent', alignItems: 'center' }}
                        >
                          <Text style={{ color: active ? theme.bg : theme.textSub, fontSize: 12, fontWeight: '900', letterSpacing: 0.3 }}>{opt.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {dwIntent === 'free' ? (
                    <View style={{ marginBottom: 22 }}>
                      <TextInput
                        value={dwFreeLabel}
                        onChangeText={setDwFreeLabel}
                        placeholder="What are you focusing on? (optional)"
                        placeholderTextColor={theme.border}
                        style={{ backgroundColor: isDarkMode ? '#111' : theme.bg, color: theme.textMain, padding: 14, borderRadius: 12, fontSize: 15, fontWeight: '600' }}
                      />
                    </View>
                  ) : (
                    <View style={{ marginBottom: 22, maxHeight: 220 }}>
                      <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                        {(() => {
                          let rows: { id: string; title: string; sub?: string; color?: string }[] = [];
                          if (dwIntent === 'task') {
                            rows = tasks
                              .filter(t => !t.completed && (t.status ?? 'active') === 'active')
                              .slice(0, 30)
                              .map(t => ({ id: t.id, title: t.text, sub: t.deadlineDate || undefined, color: t.color }));
                          } else if (dwIntent === 'habit') {
                            rows = habits
                              .filter(h => h.status === 'active')
                              .map(h => ({ id: h.id, title: h.title, color: h.color }));
                          } else if (dwIntent === 'challenge') {
                            rows = challenges
                              .filter(c => c.deadState === 'active' || c.deadState === 'resurrected')
                              .map(c => ({ id: c.id, title: c.title, sub: `${c.current}/${c.target} ${c.unit}`, color: c.color }));
                          }
                          if (rows.length === 0) {
                            return <Text style={{ color: theme.textSub, fontSize: 13, fontStyle: 'italic', paddingVertical: 18, textAlign: 'center' }}>Nothing here yet.</Text>;
                          }
                          return rows.map(row => {
                            const sel = dwTargetId === row.id;
                            return (
                              <TouchableOpacity
                                key={row.id}
                                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDwTargetId(row.id); setDwTargetTitle(row.title); }}
                                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, marginBottom: 6, backgroundColor: sel ? hexToRgba(row.color || theme.textMain, 0.12) : (isDarkMode ? '#111' : theme.bg), borderWidth: 1, borderColor: sel ? (row.color || theme.textMain) : 'transparent' }}
                              >
                                {row.color ? <View style={{ width: 4, height: 28, borderRadius: 2, backgroundColor: row.color }} /> : null}
                                <View style={{ flex: 1 }}>
                                  <Text numberOfLines={1} style={{ color: theme.textMain, fontSize: 14, fontWeight: '700' }}>{row.title}</Text>
                                  {row.sub ? <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600', marginTop: 2 }}>{row.sub}</Text> : null}
                                </View>
                                {sel ? <Feather name="check" size={16} color={row.color || theme.textMain} /> : null}
                              </TouchableOpacity>
                            );
                          });
                        })()}
                      </ScrollView>
                    </View>
                  )}

                  <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }}>DURATION</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
                    {[15, 25, 45, 60, 90].map(min => {
                      const active = !dwOpenMode && !dwCustomMin && dwDurationMin === min;
                      return (
                        <TouchableOpacity
                          key={min}
                          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDwOpenMode(false); setDwDurationMin(min); setDwCustomMin(''); }}
                          style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: active ? theme.textMain : (isDarkMode ? '#111' : theme.bg), alignItems: 'center', borderWidth: 1, borderColor: active ? theme.textMain : theme.border, opacity: dwOpenMode ? 0.4 : 1 }}
                        >
                          <Text style={{ color: active ? theme.bg : theme.textMain, fontSize: 13, fontWeight: '900' }}>{min}m</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', opacity: dwOpenMode ? 0.4 : 1 }}>or custom</Text>
                    <TextInput
                      value={dwCustomMin}
                      onChangeText={t => { setDwOpenMode(false); setDwCustomMin(t.replace(/[^0-9]/g, '').slice(0, 3)); }}
                      placeholder="min"
                      placeholderTextColor={theme.border}
                      keyboardType="number-pad"
                      editable={!dwOpenMode}
                      style={{ flex: 1, backgroundColor: isDarkMode ? '#111' : theme.bg, color: theme.textMain, padding: 10, borderRadius: 10, fontSize: 13, fontWeight: '700', textAlign: 'center', borderWidth: 1, borderColor: dwCustomMin && !dwOpenMode ? theme.textMain : 'transparent', opacity: dwOpenMode ? 0.4 : 1 }}
                    />
                  </View>
                  <TouchableOpacity
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDwOpenMode(o => !o); }}
                    activeOpacity={0.85}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12, marginBottom: 24, backgroundColor: dwOpenMode ? theme.textMain : (isDarkMode ? '#111' : theme.bg), borderWidth: 1, borderColor: dwOpenMode ? theme.textMain : theme.border }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={{ color: dwOpenMode ? theme.bg : theme.textMain, fontSize: 18, fontWeight: '900' }}>∞</Text>
                      <View>
                        <Text style={{ color: dwOpenMode ? theme.bg : theme.textMain, fontSize: 13, fontWeight: '900' }}>Open · no limit</Text>
                        <Text style={{ color: dwOpenMode ? theme.bg : theme.textSub, fontSize: 10, fontWeight: '600', opacity: dwOpenMode ? 0.7 : 1, marginTop: 2 }}>Stopwatch. End whenever.</Text>
                      </View>
                    </View>
                    <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: dwOpenMode ? theme.bg : theme.border, alignItems: 'center', justifyContent: 'center' }}>
                      {dwOpenMode ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.bg }} /> : null}
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={beginDeepWork}
                    disabled={dwIntent !== 'free' && !dwTargetId}
                    activeOpacity={0.85}
                    style={{ paddingVertical: 17, borderRadius: 16, backgroundColor: theme.textMain, alignItems: 'center', opacity: dwIntent !== 'free' && !dwTargetId ? 0.4 : 1 }}
                  >
                    <Text style={{ color: theme.bg, fontSize: 15, fontWeight: '900', letterSpacing: 0.3 }}>Begin Deep Work</Text>
                  </TouchableOpacity>
                </ScrollView>
              </Animated.View>
            </KeyboardAvoidingView>
          </Modal>

          {/* Stage 2: FOCUS — full-screen takeover during the live session */}
          <Modal visible={dwFocusVisible} animationType="fade" transparent={false} onRequestClose={cancelDeepWork} statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: '#000' }}>
              <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
                {(() => {
                  if (!dwSession) return null;
                  const elapsed = dwNow - dwSession.startedAt;
                  const isOpen = dwSession.open;
                  const totalSec = isOpen
                    ? Math.floor(elapsed / 1000)
                    : Math.ceil(Math.max(0, dwSession.durationMs - elapsed) / 1000);
                  const showHours = isOpen && totalSec >= 3600;
                  const h = Math.floor(totalSec / 3600);
                  const m = Math.floor((totalSec % 3600) / 60);
                  const sec = totalSec % 60;
                  const progress = isOpen ? 0 : Math.min(1, elapsed / dwSession.durationMs);
                  return (
                    <View style={{ flex: 1, justifyContent: 'space-between', paddingHorizontal: 32, paddingVertical: 24 }}>
                      <TouchableOpacity onPress={cancelDeepWork} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} style={{ alignSelf: 'flex-start' }}>
                        <Text style={{ color: isOpen ? '#888' : '#444', fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>
                          {isOpen ? 'END SESSION' : 'END EARLY'}
                        </Text>
                      </TouchableOpacity>

                      <View style={{ alignItems: 'center', gap: 32 }}>
                        <View style={{ alignItems: 'center' }}>
                          {isOpen ? (
                            <Text style={{ color: '#666', fontSize: 10, fontWeight: '900', letterSpacing: 4, marginBottom: 14 }}>OPEN</Text>
                          ) : null}
                          <Text style={{ color: '#FFF', fontSize: showHours ? 72 : 88, fontWeight: '900', letterSpacing: -4, fontVariant: ['tabular-nums'] }}>
                            {showHours
                              ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
                              : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'center', gap: 6 }}>
                          <Text style={{ color: '#444', fontSize: 10, fontWeight: '900', letterSpacing: 2 }}>TOWARD</Text>
                          <Text style={{ color: '#FFF', fontSize: 17, fontWeight: '700', textAlign: 'center', maxWidth: 280 }} numberOfLines={2}>
                            {dwSession.targetTitle}
                          </Text>
                        </View>
                      </View>

                      {isOpen ? (
                        <View style={{ height: 2 }} />
                      ) : (
                        <View style={{ height: 2, backgroundColor: '#1A1A1A', borderRadius: 1, overflow: 'hidden' }}>
                          <View style={{ width: `${progress * 100}%`, height: '100%', backgroundColor: '#FFF', borderRadius: 1 }} />
                        </View>
                      )}
                    </View>
                  );
                })()}

                {dwCelebrating && (
                  <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#FFF', opacity: 0.85, justifyContent: 'center', alignItems: 'center' }]}>
                    <Text style={{ color: '#000', fontSize: 18, fontWeight: '900', letterSpacing: 4 }}>DEEP WORK COMPLETE</Text>
                  </View>
                )}
              </SafeAreaView>
            </View>
          </Modal>

          {/* Stage 3: REFLECTION — save to record, skip to discard */}
          <Modal visible={dwReflectVisible} transparent animationType="slide" onRequestClose={skipDeepWorkReflection}>
            <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
              <Animated.View style={[{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 28, paddingBottom: 0 }, sheetBottomPadStyle]}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 24 }} />
                {dwSession && (
                  <>
                    <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 10 }}>SESSION COMPLETE</Text>
                    <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, marginBottom: 6 }}>
                      {Math.round(dwSession.durationMs / 60000)} minutes on
                    </Text>
                    <Text style={{ color: theme.textMain, fontSize: 18, fontWeight: '700', marginBottom: linkedTarget ? 16 : 24 }} numberOfLines={2}>
                      {dwSession.targetTitle}
                    </Text>
                  </>
                )}

                {/* Mark Done — only rendered when the session was linked to a
                    target that's still actionable. Toggle, not immediate
                    action: holds the user's choice and applies on Save so they
                    can change their mind. Copy varies by intent (mark task /
                    log habit / +1 challenge). */}
                {linkedTarget ? (
                  <TouchableOpacity
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDwMarkDone(v => !v); }}
                    activeOpacity={0.85}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 22, borderRadius: 12, backgroundColor: dwMarkDone ? hexToRgba(theme.success, 0.12) : (isDarkMode ? '#111' : theme.bg), borderWidth: 1, borderColor: dwMarkDone ? theme.success : theme.border }}
                  >
                    <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: dwMarkDone ? theme.success : theme.border, backgroundColor: dwMarkDone ? theme.success : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {dwMarkDone ? <Feather name="check" size={14} color="#FFF" /> : null}
                    </View>
                    <Text style={{ flex: 1, color: dwMarkDone ? theme.success : theme.textMain, fontSize: 14, fontWeight: '800' }}>
                      {linkedTarget.label}
                    </Text>
                    <Feather name={linkedTarget.icon} size={14} color={dwMarkDone ? theme.success : theme.textSub} />
                  </TouchableOpacity>
                ) : null}

                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }}>HOW WAS IT?</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
                  {([
                    { r: 'rough' as DayRating, label: 'Off', color: '#F43F5E' },
                    { r: 'ok' as DayRating, label: 'Steady', color: '#F59E0B' },
                    { r: 'strong' as DayRating, label: 'Strong', color: '#10B981' },
                  ]).map(({ r, label, color }) => {
                    const sel = dwReflectionRating === r;
                    return (
                      <TouchableOpacity
                        key={r}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDwReflectionRating(sel ? null : r); }}
                        activeOpacity={0.75}
                        style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: sel ? color : (isDarkMode ? '#111' : theme.bg), borderWidth: 1, borderColor: sel ? color : theme.border, alignItems: 'center', gap: 8 }}
                      >
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sel ? '#FFF' : color }} />
                        <Text style={{ color: sel ? '#FFF' : theme.textMain, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 8 }}>THOUGHTS · OPTIONAL</Text>
                <TextInput
                  value={dwReflectionText}
                  onChangeText={setDwReflectionText}
                  placeholder="Anything worth remembering?"
                  placeholderTextColor={theme.border}
                  multiline
                  style={{ backgroundColor: isDarkMode ? '#111' : theme.bg, color: theme.textMain, padding: 14, borderRadius: 12, minHeight: 64, fontSize: 14, fontWeight: '600', textAlignVertical: 'top', marginBottom: 22 }}
                />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    onPress={skipDeepWorkReflection}
                    style={{ flex: 1, paddingVertical: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                  >
                    <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '800' }}>Skip this one</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={saveDeepWorkReflection}
                    style={{ flex: 2, paddingVertical: 16, borderRadius: 14, backgroundColor: theme.textMain, alignItems: 'center' }}
                  >
                    <Text style={{ color: theme.bg, fontSize: 13, fontWeight: '900', letterSpacing: 0.3 }}>Save session</Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            </KeyboardAvoidingView>
          </Modal>

          {/* Deep Work History Modal */}
          <Modal visible={dwHistoryVisible} transparent animationType="slide" onRequestClose={() => setDwHistoryVisible(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setDwHistoryVisible(false)} />
              <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 16) + 8, maxHeight: '88%' }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 16 }} />
                {(() => {
                  const sorted = [...deepWorkSessions].sort((a, b) => b.startedAt - a.startedAt);
                  const totalMs = sorted.reduce((acc, s) => acc + s.durationMs, 0);
                  const totalH = Math.floor(totalMs / 3600000);
                  const totalM = Math.floor((totalMs % 3600000) / 60000);
                  const totalLabel = totalH > 0 ? `${totalH}h ${totalM}m` : `${totalM}m`;
                  return (
                    <>
                      <View style={{ paddingHorizontal: 24, marginBottom: 18 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <View>
                            <Text style={{ color: theme.textMain, fontSize: 24, fontWeight: '900', letterSpacing: -0.6 }}>History</Text>
                            <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginTop: 2 }}>
                              {sorted.length} session{sorted.length === 1 ? '' : 's'} · {totalLabel} total
                            </Text>
                          </View>
                          <TouchableOpacity onPress={() => setDwHistoryVisible(false)} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                            <Feather name="x" size={22} color={theme.textSub} />
                          </TouchableOpacity>
                        </View>
                      </View>

                      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                        {sorted.length === 0 ? (
                          <View style={{ paddingVertical: 60, alignItems: 'center' }}>
                            <Feather name="clock" size={48} color={theme.textSub} style={{ opacity: 0.2, marginBottom: 14 }} />
                            <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '700' }}>No sessions yet.</Text>
                          </View>
                        ) : sorted.map(s => {
                          const expanded = dwHistoryExpanded === s.id;
                          const d = new Date(s.startedAt);
                          const today = new Date(); today.setHours(0, 0, 0, 0);
                          const sd = new Date(s.startedAt); sd.setHours(0, 0, 0, 0);
                          const dayDiff = Math.round((today.getTime() - sd.getTime()) / 86400000);
                          const dayLabel = dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Yesterday' : dayDiff < 7 ? `${dayDiff}d ago` : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                          const hh = String(d.getHours()).padStart(2, '0');
                          const mm = String(d.getMinutes()).padStart(2, '0');
                          const sessH = Math.floor(s.durationMs / 3600000);
                          const sessM = Math.floor((s.durationMs % 3600000) / 60000);
                          const durLabel = sessH > 0 ? `${sessH}h ${sessM}m` : sessM > 0 ? `${sessM}m` : `${Math.max(1, Math.round(s.durationMs / 1000))}s`;
                          const ratingMeta = s.rating === 'strong' ? { label: 'Strong', c: '#10B981' } : s.rating === 'ok' ? { label: 'Steady', c: '#F59E0B' } : s.rating === 'rough' ? { label: 'Off', c: '#F43F5E' } : null;
                          const intentChip = s.intent === 'task' ? 'TASK' : s.intent === 'habit' ? 'HABIT' : s.intent === 'challenge' ? 'GOAL' : 'FREE';
                          return (
                            <TouchableOpacity
                              key={s.id}
                              activeOpacity={0.85}
                              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDwHistoryExpanded(expanded ? null : s.id); }}
                              style={{ marginBottom: 10, padding: 14, borderRadius: 14, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}
                            >
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }}>{dayLabel.toUpperCase()} · {hh}:{mm}</Text>
                                <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: hexToRgba(theme.textMain, 0.08) }}>
                                  <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{intentChip}</Text>
                                </View>
                                <View style={{ flex: 1 }} />
                                {ratingMeta ? (
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, backgroundColor: hexToRgba(ratingMeta.c, 0.12) }}>
                                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: ratingMeta.c }} />
                                    <Text style={{ color: ratingMeta.c, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>{ratingMeta.label.toUpperCase()}</Text>
                                  </View>
                                ) : null}
                                <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '900' }}>{durLabel}</Text>
                              </View>
                              <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '700' }} numberOfLines={expanded ? undefined : 1}>{s.intentTargetTitle || 'Free focus'}</Text>
                              {expanded && s.reflection ? (
                                <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '500', lineHeight: 19, marginTop: 10, fontStyle: 'italic' }}>&quot;{s.reflection}&quot;</Text>
                              ) : null}
                              {expanded ? (
                                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                                  <TouchableOpacity
                                    onPress={() => {
                                      setConfirmDialog({
                                        visible: true, title: 'Delete this session?', message: 'It will be removed from your history permanently.', destructiveLabel: 'Delete',
                                        onConfirm: () => {
                                          deleteDeepWorkSession(s.id);
                                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                          setDwHistoryExpanded(null);
                                          setConfirmDialog(null);
                                        }
                                      });
                                    }}
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: hexToRgba(theme.danger || '#F43F5E', 0.3) }}
                                  >
                                    <Feather name="trash-2" size={12} color={theme.danger || '#F43F5E'} />
                                    <Text style={{ color: theme.danger || '#F43F5E', fontSize: 12, fontWeight: '800' }}>Delete</Text>
                                  </TouchableOpacity>
                                </View>
                              ) : null}
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </>
                  );
                })()}
              </View>
            </View>
          </Modal>

          {/* Pull-from-inbox picker — opens from the empty-today CTA. List of
              active inbox tasks; single tap promotes one to today and closes.
              Bottom-sheet styling matches the reflection sheet for consistency. */}
          <Modal visible={pickFromInboxVisible} transparent animationType="slide" onRequestClose={() => setPickFromInboxVisible(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPickFromInboxVisible(false)} />
              <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 16) + 8, maxHeight: '80%' }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 16 }} />
                <View style={{ paddingHorizontal: 24, marginBottom: 14 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 }}>Add to today</Text>
                      <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginTop: 4 }}>Tap a task to pull it forward.</Text>
                    </View>
                    <TouchableOpacity onPress={() => setPickFromInboxVisible(false)} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                      <Feather name="x" size={22} color={theme.textSub} />
                    </TouchableOpacity>
                  </View>
                </View>
                <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
                  {activeInbox.length === 0 ? (
                    <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                      <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '700' }}>Inbox is empty.</Text>
                    </View>
                  ) : activeInbox.map(t => {
                    const u = getUrgency(t);
                    const urgentChipColor = u === 'overdue' || u === 'critical' ? theme.danger : u === 'high' ? theme.danger : u === 'medium' ? theme.warning : null;
                    return (
                      <TouchableOpacity
                        key={t.id}
                        onPress={() => promoteToToday(t.id)}
                        activeOpacity={0.85}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8, borderRadius: 12, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}
                      >
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.color }} />
                        <Text style={[{ flex: 1, color: theme.textMain, fontSize: 14, fontWeight: '700' }, rtlTextStyle(t.text)]} numberOfLines={1}>{t.text}</Text>
                        {urgentChipColor ? (
                          <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, backgroundColor: hexToRgba(urgentChipColor, 0.12) }}>
                            <Text style={{ color: urgentChipColor, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>{u === 'overdue' ? 'OVERDUE' : u === 'critical' ? 'CRITICAL' : u.toUpperCase()}</Text>
                          </View>
                        ) : t.priority === 'High' ? (
                          <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1, borderColor: theme.border }}>
                            <Text style={{ color: theme.warning, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>HIGH</Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          </Modal>

          {/* Rest picker — opens from the Rest button on an overdue task's
              expanded card. Three quick offsets (tomorrow / 3 days / next week)
              cover the common cases without forcing a full calendar interaction
              for what's usually a 5-second decision. Selecting one stamps
              status='resting' + nextWakeDate; phoenix wake (in the existing
              focus effect) surfaces the task back when wake date arrives. */}
          <Modal visible={!!restTarget} transparent animationType="slide" onRequestClose={() => setRestTarget(null)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setRestTarget(null)} />
              <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 16) + 16, paddingHorizontal: 24 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 16 }} />
                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 8 }}>REST UNTIL</Text>
                <Text style={[{ color: theme.textMain, fontSize: 20, fontWeight: '900', letterSpacing: -0.5, marginBottom: 6 }, rtlTextStyle(restTarget?.text)]} numberOfLines={2}>
                  {restTarget?.text}
                </Text>
                <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', marginBottom: 22 }}>
                  Snooze the task. It&apos;ll come back into view on the date you pick.
                </Text>

                {(() => {
                  // Compute the wake date strings inline. dateStringOffset
                  // honors the user's local date boundaries so "tomorrow" is
                  // the actual next calendar day rather than 24h from now.
                  const offsetDate = (days: number): string => {
                    const d = new Date();
                    d.setDate(d.getDate() + days);
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                  };
                  const options: { label: string; sub: string; days: number }[] = [
                    { label: 'Tomorrow', sub: 'One day off', days: 1 },
                    { label: 'In 3 days', sub: 'Short breather', days: 3 },
                    { label: 'Next week', sub: '7 days from now', days: 7 },
                  ];
                  return (
                    <View style={{ gap: 8, marginBottom: 14 }}>
                      {options.map(o => (
                        <TouchableOpacity
                          key={o.days}
                          onPress={() => restTarget && restTaskUntil(restTarget, offsetDate(o.days))}
                          activeOpacity={0.85}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}
                        >
                          <Feather name="moon" size={16} color={theme.textMain} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '900', letterSpacing: -0.2 }}>{o.label}</Text>
                            <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600', marginTop: 2 }}>{o.sub}</Text>
                          </View>
                          <Feather name="chevron-right" size={14} color={theme.textSub} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  );
                })()}

                <TouchableOpacity
                  onPress={() => setRestTarget(null)}
                  style={{ paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                >
                  <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '800' }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* Delete-project modal — replaces a plain confirm so the user can
              opt into bulk-trashing the project's tasks. Default-off toggle
              keeps the safe behaviour (move to Inbox) as the one-tap path; an
              explicit flick says "yes, take everything inside with it." */}
          {(() => {
            const proj = deleteProjectId ? projects.find(p => p.id === deleteProjectId) : null;
            const taskCount = deleteProjectId
              ? tasks.filter(t => t.projectId === deleteProjectId && t.status !== 'trash' && t.status !== 'archived').length
              : 0;
            return (
              <Modal visible={!!deleteProjectId} transparent animationType="fade" onRequestClose={() => setDeleteProjectId(null)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
                  <View style={{ backgroundColor: theme.surface, width: '100%', maxWidth: 360, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.border }}>
                    <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: hexToRgba(theme.danger, 0.15), justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                      <Feather name="alert-triangle" size={24} color={theme.danger} />
                    </View>
                    <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: '900', marginBottom: 6 }}>
                      Delete project?
                    </Text>
                    <Text style={[{ color: theme.textMain, fontSize: 15, fontWeight: '700', marginBottom: 12 }, rtlTextStyle(proj?.name)]} numberOfLines={2}>
                      {proj?.name || ''}
                    </Text>
                    <Text style={{ color: theme.textSub, fontSize: 13, lineHeight: 20, marginBottom: 18 }}>
                      {deleteProjectAlsoTasks
                        ? (taskCount > 0
                            ? `${taskCount} task${taskCount === 1 ? '' : 's'} inside will be moved to trash. Recoverable from the vault until you empty it.`
                            : 'No tasks inside — the project record alone will be removed.')
                        : (taskCount > 0
                            ? `${taskCount} task${taskCount === 1 ? '' : 's'} inside will move to your Inbox so nothing's lost.`
                            : 'No tasks inside — only the project record will be removed.')}
                    </Text>
                    {taskCount > 0 ? (
                      <TouchableOpacity
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDeleteProjectAlsoTasks(v => !v); }}
                        activeOpacity={0.85}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: theme.bg, borderRadius: 12, borderWidth: 1, borderColor: deleteProjectAlsoTasks ? theme.danger : theme.border, marginBottom: 18 }}
                      >
                        <Feather name="trash-2" size={15} color={deleteProjectAlsoTasks ? theme.danger : theme.textSub} />
                        <Text style={{ flex: 1, color: deleteProjectAlsoTasks ? theme.textMain : theme.textSub, fontSize: 13, fontWeight: '800' }}>
                          Also delete the tasks inside
                        </Text>
                        <Switch
                          value={deleteProjectAlsoTasks}
                          onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDeleteProjectAlsoTasks(v); }}
                          trackColor={{ true: theme.danger }}
                          thumbColor="#FFF"
                        />
                      </TouchableOpacity>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <TouchableOpacity onPress={() => setDeleteProjectId(null)} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}>
                        <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 14 }}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={confirmDeleteProject} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: theme.danger }}>
                        <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 14 }}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </Modal>
            );
          })()}

          {/* ADHD Mode Modal */}
          <Modal visible={adhdVisible} animationType="fade" transparent={false} onRequestClose={closeAdhdMode} statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: '#000' }}>
              <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
                <View style={{ flex: 1, paddingHorizontal: 32, paddingVertical: 24 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                    <TouchableOpacity onPress={closeAdhdMode} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                      <Text style={{ color: '#444', fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>EXIT</Text>
                    </TouchableOpacity>
                    <Text style={{ color: '#444', fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>
                      {adhdPool.length > 0 ? `${adhdPool.length} LEFT` : 'CLEAR'}
                    </Text>
                  </View>

                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    {adhdPool.length === 0 ? (
                      <View style={{ alignItems: 'center', gap: 16 }}>
                        <Text style={{ color: '#FFF', fontSize: 32, fontWeight: '900', letterSpacing: -1 }}>Nothing left.</Text>
                        <Text style={{ color: '#666', fontSize: 14, fontWeight: '600' }}>You&apos;re clear. Take a breath.</Text>
                        <TouchableOpacity
                          onPress={closeAdhdMode}
                          style={{ marginTop: 32, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 14, borderWidth: 1, borderColor: '#333' }}
                        >
                          <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '900', letterSpacing: 1.5 }}>EXIT</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      (() => {
                        const item = adhdPool[0];
                        return (
                          <View style={{ alignItems: 'center', gap: 24, width: '100%' }}>
                            <Text style={{ color: '#666', fontSize: 11, fontWeight: '900', letterSpacing: 3 }}>
                              {item.kind === 'task' ? 'TASK' : 'HABIT'}
                            </Text>
                            <Text style={{ color: '#FFF', fontSize: 32, fontWeight: '900', letterSpacing: -1, textAlign: 'center', lineHeight: 38, paddingHorizontal: 16 }} numberOfLines={4}>
                              {item.title}
                            </Text>
                            <TouchableOpacity
                              onPress={() => completeAdhdItem(item.kind, item.id, item.title)}
                              activeOpacity={0.8}
                              style={{ marginTop: 24, paddingVertical: 28, paddingHorizontal: 56, borderRadius: 28, backgroundColor: item.color, alignItems: 'center', minWidth: 220 }}
                            >
                              <Text style={{ color: '#FFF', fontSize: 18, fontWeight: '900', letterSpacing: 2 }}>DONE</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })()
                    )}
                  </View>
                </View>

                {adhdCelebrating && (
                  <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#FFF', opacity: 0.92, justifyContent: 'center', alignItems: 'center', padding: 48 }]}>
                    <Text style={{ color: '#000', fontSize: 28, fontWeight: '900', letterSpacing: -0.5, textAlign: 'center' }}>{adhdJustDone}</Text>
                    <Text style={{ color: '#000', fontSize: 12, fontWeight: '900', letterSpacing: 4, marginTop: 12 }}>DONE</Text>
                  </View>
                )}
              </SafeAreaView>
            </View>
          </Modal>

          </View>
        </SafeAreaView>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}