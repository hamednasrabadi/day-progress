import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as Clipboard from "expo-clipboard";
import { copyAsync, deleteAsync, documentDirectory, writeAsStringAsync } from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import * as Sharing from "expo-sharing";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { CAPSULE_CHANNEL_ID } from "../../lib/notifChannels";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { DiaryView } from "../../components/notes/DiaryView";
import { MoodDiaryComposer } from "../../components/notes/MoodDiaryComposer";
import { AudioPlayer } from "../../components/notes/AudioPlayer";
import { CalendarPicker } from "../../components/CalendarPicker";
import { isRtl, rtlInputStyle, rtlTextStyle, persianSafeInputStyle } from "../../lib/rtl";
import { stripInlineMarkdown, stripAllMarkdown, lineDirectionText } from "../../lib/notesRichText";
import { exportNotesAsMarkdown } from "../../lib/notesExport";
import { getUnlockMoment } from "../../lib/capsule";
import {
  AppState,
  BackHandler,
  Keyboard,
  LayoutAnimation,
  Modal,
  Platform,
  Animated as RNAnimated,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import { GestureHandlerRootView, Swipeable } from "react-native-gesture-handler";
import ImageViewer from "react-native-image-zoom-viewer";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import { KeyboardAwareScrollView, KeyboardProvider } from "react-native-keyboard-controller";
import { PALETTE, DEFAULT_COLOR } from "../../lib/palette";
import { ColorPicker } from "../../components/ColorPicker";
import { FEATURE_IDS, useIsUnlocked, useDaysSinceInstall } from "../../lib/unlocks";

import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetModalProvider, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { FlashList } from "@shopify/flash-list";
import { AudioMemo, CalendarSystem, Note, NoteSnapshot, NoteStatus, useAppStore } from "../../store/useAppStore";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  try { UIManager.setLayoutAnimationEnabledExperimental(true); } catch (e) {}
}

// Note color palette now lives in lib/palette.ts (single source of truth).
const artAccent = "#8B5CF6";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type Theme = { bg: string; surface: string; border: string; textMain: string; textSub: string; danger: string; success: string; focusText: string; accent: string; };
function getTheme(mode: 'light' | 'dark' | 'blue' | 'sovereign'): Theme {
  switch (mode) {
    case 'sovereign':
      return { bg: "#120A22", surface: "#1E1538", border: "#342856", textMain: "#EAE5F5", textSub: "#988BBC", danger: "#F43F5E", success: "#10B981", focusText: "#DED5F1", accent: "#A855F7" };
    case 'blue':
      return { bg: "#0B1A2B", surface: "#122A40", border: "#1E3A52", textMain: "#E8F0F8", textSub: "#7FA0BC", danger: "#F43F5E", success: "#10B981", focusText: "#D8E6F4", accent: "#8B5CF6" };
    case 'dark':
      return { bg: "#121214", surface: "#1C1C20", border: "#2C2C30", textMain: "#F4F4F5", textSub: "#8A8A92", danger: "#F43F5E", success: "#10B981", focusText: "#DDDDDD", accent: "#8B5CF6" };
    default:
      return { bg: "#F8F9FA", surface: "#FFFFFF", border: "#E5E5EA", textMain: "#111111", textSub: "#888888", danger: "#F43F5E", success: "#10B981", focusText: "#333333", accent: "#8B5CF6" };
  }
}

const JS_DAY_MAP: Record<number, string> = { 0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday" };
const GREGORIAN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHAMSI_MONTHS = ["Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar", "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand"];

function g2j(gy: number, gm: number, gd: number) {
  let g_d_m = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let jy: any, jm: any, jd: any;
  let gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g_d_m.slice(0, gm).reduce((a, b) => a + b, 0);
  jy = -1595 + 33 * Math.floor(days / 12053); days %= 12053; jy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

// Days-in-month for both calendars. Powers the seal-modal dial — without
// this, the dial happily let users pick e.g. February 31, which then rolled
// over into March on save. Now the dial day caps at the real month length
// and an overflow press wraps to day 1 of the next month.
const isJalaliLeap = (jy: number): boolean => {
  // Round-trip Esfand 30 through j2g→g2j. If the algorithm preserves it, jy
  // is a leap year; otherwise it normalised to Farvardin 1 of the next year.
  const [gy, gm, gd] = j2g(jy, 12, 30);
  const back = g2j(gy, gm, gd);
  return back[0] === jy && back[1] === 12 && back[2] === 30;
};
const daysInMonth = (y: number, m: number, cal: 'gregorian' | 'jalali'): number => {
  if (cal === 'gregorian') {
    // `new Date(y, m+1, 0)` rolls into the last day of month m.
    return new Date(y, m + 1, 0).getDate();
  }
  if (m < 6) return 31;     // Farvardin..Shahrivar — first 6 months
  if (m < 11) return 30;    // Mehr..Bahman — next 5 months
  return isJalaliLeap(y) ? 30 : 29; // Esfand
};

function j2g(jy: number, jm: number, jd: number) {
  let gy = (jy <= 979) ? 621 : 1600;
  jy -= (jy <= 979) ? 0 : 979;
  let days = (365 * jy) + (Math.floor(jy / 33) * 8) + Math.floor(((jy % 33) + 3) / 4) + 78 + jd + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
  gy += 400 * Math.floor(days / 146097); days %= 146097;
  if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1;
  let sal_a = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm;
  for (gm = 0; gm < 13; gm++) { let v = sal_a[gm]; if (gd <= v) break; gd -= v; }
  return [gy, gm, gd];
}

const formatDisplayDate = (ms: number, cal: CalendarSystem) => {
  const d = new Date(ms);
  if (cal === "shamsi") {
    const [jy, jm, jd] = g2j(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return `${jd} ${SHAMSI_MONTHS[jm - 1]} ${jy}`;
  }
  return `${d.getDate()} ${GREGORIAN_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

const formatDuration = (millis: number) => {
  const totalSeconds = Math.floor(millis / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
};

const getDaysUntil = (ms: number) => Math.ceil((ms - Date.now()) / 86400000);

// getUnlockMoment now lives in lib/capsule.ts (imported above) — the export
// path needs the same answer, and a drifting twin predicate is how a capsule
// could leak into an export early.
const CAPSULE_NOTIF_PREFIX = 'capsule-unlock-';

// eslint-disable-next-line react/display-name -- Swipeable render callback, not a component
const makeLeftActions = (theme: Theme, status: NoteStatus) => (p: any, d: RNAnimated.AnimatedInterpolation<any>) => {
  const action = status === "active" ? "archive" : "corner-up-left";
  const scale = d.interpolate({ inputRange: [0, 100], outputRange: [0.5, 1], extrapolate: "clamp" });
  return (
    <View style={{ justifyContent: "center", width: "100%", borderRadius: 16, backgroundColor: theme.textMain, paddingLeft: 24, alignItems: "flex-start", marginBottom: 12 }}>
      <RNAnimated.View style={{ transform: [{ scale }] }}><Feather name={action} size={24} color={theme.bg} /></RNAnimated.View>
    </View>
  );
};

// eslint-disable-next-line react/display-name -- Swipeable render callback, not a component
const makeRightActions = (theme: Theme, status: NoteStatus) => (p: any, d: RNAnimated.AnimatedInterpolation<any>) => {
  const isTrash = status === "trash";
  const scale = d.interpolate({ inputRange: [-100, 0], outputRange: [1, 0.5], extrapolate: "clamp" });
  return (
    <View style={{ justifyContent: "center", width: "100%", borderRadius: 16, backgroundColor: theme.danger, paddingRight: 24, alignItems: "flex-end", marginBottom: 12 }}>
      <RNAnimated.View style={{ transform: [{ scale }] }}><Feather name={isTrash ? "x-circle" : "trash-2"} size={24} color="#FFF" /></RNAnimated.View>
    </View>
  );
};

const CustomConfirmModal = ({ visible, title, message, destructiveLabel = "Delete", onCancel, onConfirm, theme, isSuccess = false }: any) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 }}>
      <View style={{ backgroundColor: theme.surface, width: "100%", maxWidth: 340, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.border }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: isSuccess ? hexToRgba(artAccent, 0.15) : hexToRgba(theme.danger, 0.15), justifyContent: "center", alignItems: "center", marginBottom: 16 }}>
          <Feather name={isSuccess ? "unlock" : "alert-triangle"} size={24} color={isSuccess ? artAccent : theme.danger} />
        </View>
        <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: "900", marginBottom: 8 }}>{title}</Text>
        <Text style={{ color: theme.textSub, fontSize: 14, lineHeight: 22, marginBottom: 24 }}>{message}</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <TouchableOpacity onPress={onCancel} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center", backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}>
            <Text style={{ color: theme.textMain, fontWeight: "800", fontSize: 14 }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onConfirm} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center", backgroundColor: isSuccess ? artAccent : theme.danger }}>
            <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 14 }}>{destructiveLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

// AudioPlayer extracted to components/notes/AudioPlayer.tsx so DiaryView and
// the regular editor share one implementation. Imported above.

// Highlight palette — keys are the names users can type in markdown
// (=={yellow}text== etc). Tuned to read on both dark and light backgrounds.
// Single alpha (0.32) chosen by eye; saturated enough to stand out on dark,
// not so bright as to wash out body text on light.
// Diary mood options — five vibe icons + colors. Stored in note.mood as the
// icon id. Choices intentionally avoid pure happy/sad framing (which feels
// like a mood-tracker app); these are atmospheres you can scan past entries
// by. Coloring uses the same alpha treatment as the highlight palette so
// they feel native to the rest of the app.
const MOOD_OPTIONS: { id: string; label: string; icon: string; color: string }[] = [
  { id: 'heart',       label: 'Loved',  icon: 'heart',          color: '#F472B6' },
  { id: 'sun',         label: 'Bright', icon: 'sun',            color: '#FACC15' },
  { id: 'cloud',       label: 'Calm',   icon: 'cloud',          color: '#60A5FA' },
  { id: 'cloud-rain',  label: 'Rough',  icon: 'cloud-rain',     color: '#94A3B8' },
  { id: 'moon',        label: 'Heavy',  icon: 'moon',           color: '#A78BFA' },
];
const MOOD_BY_ID: Record<string, typeof MOOD_OPTIONS[number]> = MOOD_OPTIONS.reduce(
  (acc, m) => { acc[m.id] = m; return acc; },
  {} as Record<string, typeof MOOD_OPTIONS[number]>
);

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#FACC15',
  green:  '#4ADE80',
  blue:   '#60A5FA',
  pink:   '#F472B6',
  orange: '#FB923C',
  purple: '#A78BFA',
};
const HIGHLIGHT_ALPHA = 0.32;
const DEFAULT_HIGHLIGHT_COLOR = 'yellow';
const HIGHLIGHT_NAMES = Object.keys(HIGHLIGHT_COLORS);

function resolveHighlightColor(name?: string): string {
  if (!name) return HIGHLIGHT_COLORS[DEFAULT_HIGHLIGHT_COLOR];
  const trimmed = name.trim().toLowerCase();
  if (HIGHLIGHT_COLORS[trimmed]) return HIGHLIGHT_COLORS[trimmed];
  // Allow raw hex too (=={#FFEB3B}text==), forgiving of the leading hash.
  if (/^#?[0-9a-f]{6}$/i.test(trimmed)) return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return HIGHLIGHT_COLORS[DEFAULT_HIGHLIGHT_COLOR];
}

// Recursive inline parser. Walks the string left-to-right matching the FIRST
// of (URL, **bold**, =={color}highlight==, ==highlight==), and recurses into
// the inner content of bold/highlight so the formats compose: a heading can
// be highlighted, a highlight can be bold, a bold can be highlighted, etc.
//
// Nested Text inherits parent style in RN, so wrapping the heading line in a
// big-font Text and putting parsed inline elements inside means a highlight
// inside a heading naturally picks up the heading's font size and weight.
const parseInlineFormatting = (content: string, color: string, theme: Theme): React.ReactNode[] => {
  // One pass: try to match anything formatting-related. The order in the
  // alternation matters — URLs first (most specific terminal pattern),
  // colored highlights before plain ones (so the {color} prefix wins).
  const pattern = /(https?:\/\/[^\s]+)|\*\*([\s\S]+?)\*\*|==\{([^}]+)\}([\s\S]+?)==|==([\s\S]+?)==/g;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    if (m.index > cursor) {
      out.push(<Text key={key++}>{content.slice(cursor, m.index)}</Text>);
    }
    if (m[1]) {
      const url = m[1];
      out.push(
        <Text key={key++} style={{ color: color || artAccent, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(url)}>
          {url}
        </Text>
      );
    } else if (m[2] !== undefined) {
      // No nested writingDirection — inner Text components inherit the
      // outer line's direction. Setting it per-span fights RN's BiDi
      // resolution and was the actual cause of mixed-content paragraphs
      // rendering inconsistently.
      out.push(
        <Text key={key++} style={{ fontWeight: '900' }}>
          {parseInlineFormatting(m[2], color, theme)}
        </Text>
      );
    } else if (m[3] !== undefined) {
      const colorHex = resolveHighlightColor(m[3]);
      out.push(
        <Text key={key++} style={{ backgroundColor: hexToRgba(colorHex, HIGHLIGHT_ALPHA), color: theme.textMain }}>
          {parseInlineFormatting(m[4], color, theme)}
        </Text>
      );
    } else if (m[5] !== undefined) {
      const colorHex = resolveHighlightColor();
      out.push(
        <Text key={key++} style={{ backgroundColor: hexToRgba(colorHex, HIGHLIGHT_ALPHA), color: theme.textMain }}>
          {parseInlineFormatting(m[5], color, theme)}
        </Text>
      );
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < content.length) {
    out.push(<Text key={key++}>{content.slice(cursor)}</Text>);
  }
  return out;
};

const RichTextContent = React.memo(function RichTextContent({ text, color, isExpanded, theme, onToggleCheckbox }: any) {
  const lines = text.split("\n");
  const maxLines = isExpanded ? lines.length : 4;
  const displayLines = lines.slice(0, maxLines);
  const hasMore = lines.length > 4 && !isExpanded;

  return (
    <View style={{ marginTop: 2 }}>
      {displayLines.map((line: string, i: number) => {
        const isCheckbox = line.startsWith("[ ] ");
        const isChecked = line.startsWith("[x] ") || line.startsWith("[X] ");
        const isBullet = line.startsWith("- ");
        const isHeading = line.startsWith("# ");
        // lineDirectionText strips highlight INNER content before resolving
        // direction, so a line like "==some english== چیزی" still reads RTL
        // (the Persian outside the highlight wins). Otherwise the highlight's
        // English would force the whole line LTR via the first-strong rule.
        const isLineRtl = isRtl(lineDirectionText(line));

        let content = line;
        if (isCheckbox || isChecked) content = content.slice(4);
        else if (isBullet || isHeading) content = content.slice(2);

        const textElements = parseInlineFormatting(content, color, theme);

        // Per-line direction is set ONCE on the outer Text via baseStyle.
        // Inner spans (bold, highlight, plain) inherit it via RN's nested-Text
        // style propagation. No View wrapper around plain/heading lines —
        // Text alone is enough and is what worked in the prior version. The
        // bullet/checkbox cases still use a View because they need
        // flexDirection for the icon-then-text layout.
        const baseStyle = { fontWeight: "500" as const, lineHeight: isExpanded ? 30 : 26, color: isExpanded ? theme.focusText : theme.textSub, fontSize: isExpanded ? 18 : 16, textAlign: (isLineRtl ? "right" : "left") as "right" | "left", writingDirection: (isLineRtl ? "rtl" : "ltr") as "rtl" | "ltr" };

        if (isHeading) return <Text key={i} style={[baseStyle, { fontWeight: "900", fontSize: isExpanded ? 24 : 18, color: isExpanded ? theme.textMain : theme.textSub, marginTop: 8, marginBottom: 4 }]}>{textElements}</Text>;
        if (isCheckbox || isChecked) {
          return (
            <View key={i} style={{ flexDirection: isLineRtl ? "row-reverse" : "row", alignItems: "flex-start", marginTop: 6 }}>
              {onToggleCheckbox ? (
                <TouchableOpacity onPress={() => onToggleCheckbox(i)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Feather name={isChecked ? "check-square" : "square"} size={isExpanded ? 18 : 16} color={isChecked ? (color || artAccent) : theme.textSub} style={{ marginTop: isExpanded ? 6 : 3, marginHorizontal: 8, opacity: isChecked ? 1 : 0.6 }} />
                </TouchableOpacity>
              ) : (
                <Feather name={isChecked ? "check-square" : "square"} size={isExpanded ? 18 : 16} color={isChecked ? (color || artAccent) : theme.textSub} style={{ marginTop: isExpanded ? 6 : 3, marginHorizontal: 8, opacity: isChecked ? 1 : 0.6 }} />
              )}
              <Text style={[baseStyle, { flex: 1, color: isChecked ? theme.textSub : isExpanded ? theme.focusText : theme.textSub, textDecorationLine: isChecked ? "line-through" : "none" }]}>{textElements}</Text>
            </View>
          );
        }
        if (isBullet) {
          return (
            <View key={i} style={{ flexDirection: isLineRtl ? "row-reverse" : "row", alignItems: "flex-start", marginTop: 4 }}>
              <Text style={[baseStyle, { marginHorizontal: 8, fontWeight: "900" }]}>•</Text>
              <Text style={[baseStyle, { flex: 1 }]}>{textElements}</Text>
            </View>
          );
        }
        return <Text key={i} style={baseStyle}>{textElements}</Text>;
      })}
      {hasMore && <Text style={{ color: theme.textSub, marginTop: 4, fontWeight: "800", textAlign: isRtl(text) ? "right" : "left" }}>...</Text>}
    </View>
  );
});

// --- MONOLITH DESIGN ---
const CapsuleCard = React.memo(function CapsuleCard({ note, theme, onOpenCapsule, onStatusChange, onDeleteForever }: any) {
  const renderLeft = useMemo(() => makeLeftActions(theme, note.status), [theme, note.status]);
  const renderRight = useMemo(() => makeRightActions(theme, note.status), [theme, note.status]);

  // Two unlock modes:
  //   1. Date-locked  — capsule has unlockDate, opens when clock passes it.
  //   2. Event-locked — capsule has unlockOnChallengeId, stays sealed until the
  //      Challenges tab flips isSealed=false + stamps unlockDate on completion.
  // Once unlocked (either mode), unlockDate is in the past and isSealed is false.
  const eventLocked = !!note.unlockOnChallengeId && !note.unlockDate && !note.unlockDateStr;
  const unlockMoment = getUnlockMoment(note);
  const isLocked = eventLocked || (note.isSealed && Date.now() < unlockMoment);
  const isReady = !isLocked && note.status === 'active';
  const daysLeft = getDaysUntil(unlockMoment);

  // Progress Bar Logic — only meaningful for date-locked capsules.
  const totalDuration = unlockMoment - note.createdAt;
  const passedDuration = Date.now() - note.createdAt;
  const progressPercent = totalDuration > 0 ? Math.max(0, Math.min(1, passedDuration / totalDuration)) * 100 : 0;

  const bgColor = isReady ? artAccent : isLocked ? theme.surface : theme.bg;
  const titleColor = isReady ? '#FFFFFF' : theme.textMain;
  const subColor = isReady ? 'rgba(255,255,255,0.7)' : theme.textSub;
  const displayTitle = "Anonymous Memory";
  // Event-locked capsules show a dedicated subtitle instead of a date countdown
  // since there's no clock to count toward — only the challenge. Date-locked:
  // when daysLeft hits 0 we're past the calendar boundary but possibly still
  // locked (unlockDate is at midnight, the user could be reading at 11pm the
  // night before — getDaysUntil rounds up so it shows "1 day" until midnight,
  // then drops to 0 once unlockDate is in the past). Showing "0 days remaining"
  // when the card is still locked reads as a bug; "Unlocks today" tells the
  // user the lock is hours-from-now, not days.
  const subtitleText = isReady
    ? "Ready for extraction"
    : eventLocked
      ? "Awaiting completion"
      : daysLeft <= 0
        ? "Unlocks today"
        : daysLeft === 1
          ? "1 day remaining"
          : `${daysLeft} days remaining`;

  return (
    <View style={{ marginBottom: 12 }}>
      <Swipeable activeOffsetX={[-40, 40]} renderLeftActions={renderLeft} renderRightActions={renderRight} onSwipeableOpen={(dir) => {
        if (dir === "left") onStatusChange(note.id, note.status === "active" ? "archived" : "active");
        else if (dir === "right") { if (note.status === "trash") onDeleteForever(note.id); else onStatusChange(note.id, "trash"); }
      }}>
        <TouchableOpacity activeOpacity={isLocked ? 0.9 : 0.7} onPress={() => {
            if (isLocked) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            else onOpenCapsule(note);
        }} style={{ backgroundColor: bgColor, borderRadius: 32, borderWidth: isLocked ? 1 : 0, borderColor: theme.border, paddingVertical: 24, paddingHorizontal: 20 }}>
          
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1, paddingRight: 16 }}>
              <Text style={{ color: titleColor, fontSize: 20, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 }} numberOfLines={1}>
                {isLocked ? "Sealed Object" : displayTitle}
              </Text>
              <Text style={{ color: subColor, fontSize: 14, fontWeight: '700' }}>
                  {subtitleText}
              </Text>
            </View>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: isReady ? 'rgba(255,255,255,0.2)' : theme.bg, justifyContent: 'center', alignItems: 'center' }}>
              <Feather name={isReady ? 'zap' : 'lock'} size={20} color={isReady ? '#FFF' : theme.textMain} />
            </View>
          </View>
          
          {/* Progress Bar for date-locked State only — event-locked capsules
              have no time arc, so we render a quiet hairline instead. */}
          {isLocked && !eventLocked && (
            <View style={{ height: 4, backgroundColor: theme.bg, borderRadius: 2, marginTop: 20, overflow: 'hidden' }}>
              <View style={{ width: `${progressPercent}%`, height: '100%', backgroundColor: theme.textSub, borderRadius: 2 }} />
            </View>
          )}
          {isLocked && eventLocked && (
            <View style={{ height: 1, backgroundColor: theme.border, marginTop: 20 }} />
          )}

        </TouchableOpacity>
      </Swipeable>
    </View>
  );
});

// Day on which SEALING unlocks — mirrors the daysSinceInstall >= 10 predicate
// in lib/unlockTriggers.ts. Kept as a local const only to drive the locked
// Seal pill's countdown; the trigger remains the single source of the actual
// unlock. If the threshold ever moves, change it in BOTH places.
const SEALING_UNLOCK_DAY = 10;

const HighlightText = ({ text, highlight, style, theme }: { text: string; highlight: string; style: any; theme: Theme }) => {
  if (!highlight || highlight.length < 2) return <Text style={style}>{text}</Text>;
  const parts = text.split(new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase()
          ? <Text key={i} style={{ backgroundColor: hexToRgba(artAccent, 0.3), color: theme.textMain, borderRadius: 2 }}>{part}</Text>
          : part
      )}
    </Text>
  );
};

const NoteCard = React.memo(function NoteCard({ note, theme, calSystem, onOpen, onStatusChange, onPin, onDeleteForever, searchQuery }: any) {
  const renderLeft = useMemo(() => makeLeftActions(theme, note.status), [theme, note.status]);
  const renderRight = useMemo(() => makeRightActions(theme, note.status), [theme, note.status]);

  const dateStr = formatDisplayDate(note.createdAt, calSystem);
  const editedStr = note.updatedAt ? formatDisplayDate(note.updatedAt, calSystem) : null;
  // Direction detection deliberately uses the markdown-stripped + highlight-
  // sanitized text so a line like `==hello== چیزی` reads RTL (the Persian
  // outside the highlight is dominant) instead of LTR (which the raw `h` in
  // `==hello==` would otherwise force via the first-strong rule).
  const titleClean = stripInlineMarkdown(note.title || '');
  const contentClean = lineDirectionText(note.content || '');
  const titleIsRtl = isRtl(titleClean);
  const contentIsRtl = isRtl(contentClean);

  return (
    <View style={{ marginBottom: 12 }}>
      <Swipeable activeOffsetX={[-40, 40]} renderLeftActions={renderLeft} renderRightActions={renderRight} onSwipeableOpen={(dir) => {
        if (dir === "left") onStatusChange(note.id, note.status === "active" ? "archived" : "active");
        else if (dir === "right") { if (note.status === "trash") onDeleteForever(note.id); else onStatusChange(note.id, "trash"); }
      }}>
        <TouchableOpacity activeOpacity={0.7} onPress={() => onOpen(note)} onLongPress={() => onPin(note.id)} delayLongPress={400}>
          <View style={{ backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderLeftWidth: 4, borderColor: theme.border, borderLeftColor: note.color, padding: 20 }}>
            {/* Header row */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: note.title ? 8 : 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1, paddingRight: 8 }}>
                <Text style={{ fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, color: theme.textSub }}>
                  {dateStr}{editedStr ? ` • Edited` : ""}
                </Text>
                {note.group && <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: theme.border }}><Text style={{ fontSize: 10, fontWeight: "800", color: theme.textSub, textTransform: "capitalize" }}>{note.group}</Text></View>}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {note.imageUris && note.imageUris.length > 0 && <Feather name="image" size={12} color={theme.textSub} style={{ opacity: 0.5 }} />}
                {note.audio && note.audio.length > 0 && <Feather name="mic" size={12} color={theme.textSub} style={{ opacity: 0.5 }} />}
                {note.isPinned && <Feather name="map-pin" size={12} color={theme.textMain} />}
              </View>
            </View>

            {/* Title — same markdown-strip rationale as the preview below.
                Search-match highlighting still works because we strip BEFORE
                feeding the text to HighlightText. */}
            {note.title ? (
              searchQuery ? (
                <HighlightText text={titleClean} highlight={searchQuery} theme={theme} style={{ color: theme.textMain, fontSize: 18, fontWeight: "900", marginBottom: 6, letterSpacing: -0.5, textAlign: titleIsRtl ? "right" : "left", writingDirection: titleIsRtl ? "rtl" : "ltr" }} />
              ) : (
                <Text style={{ color: theme.textMain, fontSize: 18, fontWeight: "900", marginBottom: 6, letterSpacing: -0.5, textAlign: titleIsRtl ? "right" : "left", writingDirection: titleIsRtl ? "rtl" : "ltr" }} numberOfLines={1}>{titleClean}</Text>
              )
            ) : null}

            {/* Preview — first 3 non-empty paragraphs, each rendered with
                its own direction. Mirrors the reader's per-line model so a
                mixed-language note doesn't get pulled into one direction
                because of its first line. ALL markdown stripped here
                (inline + block) because the preview is a glanceable
                summary; checkboxes become unicode glyphs (✓/○) so the
                preview still hints at their structure without showing `[ ]`. */}
            {(() => {
              const previewLines = stripAllMarkdown(note.content || '')
                .split('\n')
                .filter(l => l.trim().length > 0)
                .slice(0, 3);
              return previewLines.map((line, i) => {
                const lineRtl = isRtl(lineDirectionText(line));
                return (
                  <Text
                    key={i}
                    numberOfLines={1}
                    style={{
                      color: theme.textSub,
                      fontSize: 14,
                      fontWeight: "500",
                      lineHeight: 22,
                      textAlign: lineRtl ? "right" : "left",
                      writingDirection: lineRtl ? "rtl" : "ltr",
                    }}
                  >
                    {line}
                  </Text>
                );
              });
            })()}
          </View>
        </TouchableOpacity>
      </Swipeable>
    </View>
  );
}, (prev, next) => {
  return (
    prev.note.id === next.note.id &&
    prev.note.content === next.note.content &&
    prev.note.title === next.note.title &&
    prev.note.updatedAt === next.note.updatedAt &&
    prev.note.color === next.note.color &&
    prev.note.isPinned === next.note.isPinned &&
    prev.note.isLocked === next.note.isLocked &&
    prev.note.group === next.note.group &&
    prev.note.status === next.note.status &&
    prev.note.imageUris === next.note.imageUris &&
    prev.note.audio === next.note.audio &&
    prev.theme === next.theme &&
    prev.calSystem === next.calSystem &&
    prev.searchQuery === next.searchQuery
  );
});

// END OF PART 1

// ─── PART 2: MAIN SCREEN & ENGINE ───
export default function NotesScreen() {
  const {
    notes,
    isDarkMode,
    calendarType,
    toggleCalendar,
    addOrUpdateNote,
    deleteNote,
    updateNoteStatus,
    toggleNoteLock,
    toggleNotePin,
    updateNoteContent,
  } = useAppStore();
  const themeMode = useAppStore(s => s.themeMode);
  const theme = useMemo(() => getTheme(themeMode), [themeMode]);
  const insets = useSafeAreaInsets();

  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>("$SYS_ALL");

  // ── Progressive unlock gates ──
  // diary (3 notes) → the book-open toggle + diary mode; highlight (same
  // trigger) → the H tool in the editor toolbar; mood (1 diary entry) → the
  // mood chip in the diary editor; sealing (10 days) → the Seal pill. Each is
  // absent when locked and fades in on first appearance.
  const diaryUnlocked = useIsUnlocked(FEATURE_IDS.DIARY);
  const highlightColorsUnlocked = useIsUnlocked(FEATURE_IDS.HIGHLIGHT_COLORS);
  const moodTaggingUnlocked = useIsUnlocked(FEATURE_IDS.MOOD_TAGGING);
  const sealingUnlocked = useIsUnlocked(FEATURE_IDS.SEALING);
  // Drives the Sealed Messages teaser countdown. daysLeft <= 0 means the
  // trigger is about to (or just did) flip sealingUnlocked, so the teaser
  // stops rendering on that tick.
  const daysSinceInstall = useDaysSinceInstall();
  const sealingDaysLeft = Math.max(0, SEALING_UNLOCK_DAY - daysSinceInstall);
  // Diary mode: when true, the tab swaps the regular notes feed for the
  // chronological DiaryView. Diary entries are still notes (Note objects with
  // kind === 'diary'); the toggle just changes what's rendered and how new
  // entries are tagged on save.
  const [diaryMode, setDiaryMode] = useState(false);
  // Once the user has authenticated for diary this session, don't re-prompt
  // every time they toggle in/out. Reset on tab/app blur so a phone left
  // unattended doesn't leak diary access.
  const diaryAuthedRef = useRef(false);
  const diaryLocked = useAppStore(s => s.diaryLocked);
  const setDiaryLocked = useAppStore(s => s.setDiaryLocked);
  const [diarySettingsVisible, setDiarySettingsVisible] = useState(false);
  // App-level blur: the focus-effect cleanup below covers tab switches, but
  // not the home button / app switcher — without this, a locked diary left
  // open stayed readable when the phone came back from the background. Drop
  // the cached auth and re-lock the moment the app backgrounds. 'background'
  // only, NOT 'inactive': 'inactive' fires for the iOS app-switcher swipe,
  // control centre, and the biometric prompt itself, which would re-lock the
  // diary mid-authentication. (A system picker launched from the diary
  // composer backgrounds the app on Android — the composer modal itself stays
  // mounted; only the diary list behind it re-locks.)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'background') return;
      diaryAuthedRef.current = false;
      if (useAppStore.getState().diaryLocked) setDiaryMode(false);
    });
    return () => sub.remove();
  }, []);

  // Interaction States
  const [viewingImages, setViewingImages] = useState<{ uris: string[]; index: number; } | null>(null);
  const [activeAudioUri, setActiveAudioUri] = useState<string | null>(null);
  const [isEditorVisible, setIsEditorVisible] = useState(false);
  const [editorReturnToReader, setEditorReturnToReader] = useState(false);
  const [readingNote, setReadingNote] = useState<Note | null>(null);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  
  // Time Capsule States
  const [isSealing, setIsSealing] = useState(false);
  const [readingCapsule, setReadingCapsule] = useState<Note | null>(null);
  // Pending seal date held while the editor is open. null = no seal queued
  // (commit will save a regular note). A timestamp = "the user has chosen
  // this unlock date; the note will be sealed when Commit fires." Decoupling
  // the seal config from the save action means the user can write/edit
  // freely after picking the date, change their mind, or change the date,
  // all without re-entering the modal multiple times.
  const [pendingSealMs, setPendingSealMs] = useState<number | null>(null);

  // Version History
  const [historyNote, setHistoryNote] = useState<Note | null>(null);
  const [viewingSnapshot, setViewingSnapshot] = useState<NoteSnapshot | null>(null);

  // Narrator toast
  const [narratorToast, setNarratorToast] = useState<string | null>(null);

  // Group management
  const [groupModal, setGroupModal] = useState<{ group: string; action: "rename" | "delete" } | null>(null);
  const [renameText, setRenameText] = useState("");
  
  // Custom Dial State (Dual Calendar)
  const [calType, setCalType] = useState<'gregorian' | 'jalali'>('gregorian');
  const [dial, setDial] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
  });

  // Memoized — only recomputes when the dial or calendar type changes, not on every render
  const { targetMs, daysLeft, isPast } = useMemo(() => {
    let ms = Date.now();
    if (calType === 'gregorian') {
      ms = new Date(dial.y, dial.m, dial.d).getTime();
    } else {
      const [gy, gm, gd] = j2g(dial.y, dial.m + 1, dial.d);
      ms = new Date(gy, gm - 1, gd).getTime();
    }
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const targetStart = new Date(ms).setHours(0, 0, 0, 0);
    const days = Math.ceil((targetStart - todayStart) / 86400000);
    return { targetMs: ms, daysLeft: days, isPast: days <= 0 };
  }, [dial, calType]);

  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; label: string; isSuccess?: boolean; onConfirm: () => void; } | null>(null);

  const storageSheetRef = useRef<BottomSheetModal>(null);
  // Close the storage when leaving this tab — a sheet shouldn't linger open across
  // a tab switch. useFocusEffect's cleanup runs on blur.
  useFocusEffect(useCallback(() => () => storageSheetRef.current?.dismiss(), []));
  const [sheetIndex, setSheetIndex] = useState(-1);
  const [storageTab, setStorageTab] = useState<"archived" | "trash" | "capsules">("archived");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteGroup, setNoteGroup] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteColor, setNoteColor] = useState(DEFAULT_COLOR);
  const [showColors, setShowColors] = useState(false);
  // Mirror of showColors for the highlight tool — a small palette pops up
  // beneath the toolbar when the H button is tapped, lets the user pick
  // which of the 6 highlighter colors to apply to the current selection.
  const [showHighlightColors, setShowHighlightColors] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });

  const [editorImageUris, setEditorImageUris] = useState<string[]>([]);
  const [editorAudio, setEditorAudio] = useState<AudioMemo[]>([]);
  const [mediaCollapsed, setMediaCollapsed] = useState(false);
  // URIs of files copied to documentDirectory THIS editor session that aren't
  // yet committed to a saved note. If the user cancels the editor, these are
  // deleted to prevent a slow storage leak. On save, the set is cleared (the
  // URIs become part of the persisted note and are managed by deleteForever).
  const dirtyMediaUrisRef = useRef<Set<string>>(new Set());
  // Tracks whether the currently-open editor session is for a diary entry,
  // so saveNote can stamp kind='diary' without requiring the parent button
  // handler to plumb it through every save call (sealing, image-add, etc.).
  const editingDiaryRef = useRef<boolean>(false);
  // Entry date for diary entries — separate from createdAt so users can
  // backdate ("yesterday I…" written today). null when not editing a diary
  // entry. Persisted to note.entryDate on save.
  const [editorEntryDate, setEditorEntryDate] = useState<number | null>(null);
  // Mood — single emoji selected for a diary entry. Optional; null when
  // not editing a diary entry or when the user hasn't picked one. Persisted
  // to note.mood on save. Five-emoji palette (great → terrible) keeps
  // the picker minimal and avoids the over-engineered Daylio-style mood
  // analytics — that's not what we're building.
  const [editorMood, setEditorMood] = useState<string | null>(null);
  const [moodPickerVisible, setMoodPickerVisible] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  // Long-press on a diary entry opens this action sheet — Edit / Delete.
  // Diary entries don't get archived; trashing is the only "remove" path
  // because diary is private memory, not project material that's worth
  // a separate archived state.
  const [diaryActionTarget, setDiaryActionTarget] = useState<Note | null>(null);

  const [recording, setRecording] = useState<Audio.Recording | undefined>();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTimer, setRecordingTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const renderBackdrop = useCallback((props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.6} />, []);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => { setIsKeyboardOpen(true); setShowColors(false); });
    const hideSub = Keyboard.addListener(hideEvent, () => { setIsKeyboardOpen(false); });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const closeEditor = useCallback((savedNoteId?: string) => {
    setIsEditorVisible(false);
    // Reset pending seal — leaking a "will seal" intent into the next editor
    // session would be the worst kind of footgun (user opens a new note, taps
    // commit, gets an unexpected capsule).
    setPendingSealMs(null);
    // Clean up media files copied to documentDirectory during this editor
    // session that didn't make it into the persisted note — either because the
    // user cancelled (no savedNoteId) or because they added then removed media
    // mid-edit. Without this, every cancelled image/recording would leave a
    // permanent file on disk.
    const dirtyUris = Array.from(dirtyMediaUrisRef.current);
    if (dirtyUris.length > 0) {
      const savedUris = new Set<string>();
      if (savedNoteId) {
        const saved = useAppStore.getState().notes.find(n => n.id === savedNoteId);
        if (saved) {
          saved.imageUris?.forEach(u => savedUris.add(u));
          saved.audio?.forEach(m => savedUris.add(m.uri));
        }
      }
      for (const uri of dirtyUris) {
        if (!savedUris.has(uri)) {
          deleteAsync(uri, { idempotent: true }).catch(e => console.warn('[notes] failed to clean up orphan media', uri, e));
        }
      }
      dirtyMediaUrisRef.current = new Set();
    }
    if (editorReturnToReader) {
      // Reader is still mounted underneath — just refresh its data
      const id = savedNoteId || editingId;
      if (id) {
        const fresh = useAppStore.getState().notes.find(n => n.id === id);
        if (fresh) setReadingNote({ ...fresh });
      }
      setEditorReturnToReader(false);
    }
  }, [editorReturnToReader, editingId]);

  // ── Capsule notification reconciliation ─────────────────────────────────
  // On every focus, re-anchor each sealed note's unlock notification to the
  // user's CURRENT local-midnight of unlockDateStr. Without this, capsules
  // sealed in one timezone would fire at the wrong wall-clock hour after the
  // user travels (the original behavior used an absolute timestamp captured
  // at seal time).
  // Also migrates legacy capsules (unlockDate but no unlockDateStr) by
  // deriving the date string from the original timestamp in the current
  // timezone — best-effort, may be off by one day for users who travelled
  // before this build landed.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    // Reset diary auth + drop user out of diary mode on tab blur. Phone left
    // unattended on the notes tab in diary mode shouldn't keep diary
    // accessible after the user switches tabs and comes back.
    const resetDiaryAuthOnBlur = () => {
      diaryAuthedRef.current = false;
      // Only collapse diary mode if locking is active — otherwise users
      // who don't lock would lose their place every time they switch tabs.
      if (useAppStore.getState().diaryLocked) {
        setDiaryMode(false);
      }
    };
    (async () => {
      try {
        const allNotes = useAppStore.getState().notes;
        const sealed = allNotes.filter(n => n.isSealed);
        for (const note of sealed) {
          if (cancelled) return;
          // Accumulate field changes into one write at the end so migration +
          // force-surface don't clobber each other.
          const patch: Partial<Note> = {};
          // Migration: derive unlockDateStr from legacy unlockDate if missing.
          let dateStr = note.unlockDateStr;
          if (!dateStr && note.unlockDate) {
            const d = new Date(note.unlockDate);
            dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            patch.unlockDateStr = dateStr;
          }
          if (!dateStr) continue; // event-locked or otherwise no date
          const targetMs = getUnlockMoment({ unlockDateStr: dateStr });
          // If the unlock moment has passed but the capsule is buried in
          // trash/archive, force it back to active so the ready message
          // surfaces instead of staying hidden where the user never sees it.
          if (targetMs <= Date.now() && note.status !== 'active') {
            patch.status = 'active';
          }
          if (Object.keys(patch).length > 0) addOrUpdateNote({ ...note, ...patch });
          const notifId = `${CAPSULE_NOTIF_PREFIX}${note.id}`;
          // Cancel any stale schedule first — scheduleNotificationAsync with the
          // same identifier replaces, but cancelling first means we never leave
          // an orphan when the unlock has already passed.
          try { await Notifications.cancelScheduledNotificationAsync(notifId); } catch {}
          if (targetMs > Date.now()) {
            try {
              await Notifications.scheduleNotificationAsync({
                identifier: notifId,
                content: { title: "A message from your past self is ready.", body: "A Time Capsule you sealed has been unlocked.", sound: true },
                trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(targetMs), channelId: CAPSULE_CHANNEL_ID },
              });
            } catch (e) { console.warn('[notes] failed to reschedule capsule unlock', note.id, e); }
          }
        }
      } catch (e) { console.warn('[notes] capsule reconciliation failed', e); }
    })();
    return () => { cancelled = true; resetDiaryAuthOnBlur(); };
  }, [addOrUpdateNote]));

  useEffect(() => {
    const backAction = () => {
      if (viewingSnapshot) { setViewingSnapshot(null); return true; }
      if (historyNote) { setHistoryNote(null); return true; }
      if (readingNote) { setReadingNote(null); return true; }
      if (readingCapsule) { setReadingCapsule(null); return true; }
      if (viewingImages) { setViewingImages(null); return true; }
      if (isSealing) { setIsSealing(false); return true; }
      if (isEditorVisible) { closeEditor(); return true; }
      if (sheetIndex >= 0) { storageSheetRef.current?.dismiss(); return true; }
      return false;
    };
    const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);
    return () => backHandler.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetIndex, viewingImages, isEditorVisible, isSealing, readingCapsule, readingNote, historyNote, viewingSnapshot]);

  const toggleCalendarDial = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (calType === 'gregorian') {
        const [jy, jm, jd] = g2j(dial.y, dial.m + 1, dial.d);
        setDial({ y: jy, m: jm - 1, d: jd });
        setCalType('jalali');
    } else {
        const [gy, gm, gd] = j2g(dial.y, dial.m + 1, dial.d);
        setDial({ y: gy, m: gm - 1, d: gd });
        setCalType('gregorian');
    }
  };

  const handleOpenSealModal = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // If the user already picked a seal date this session, re-open the dial
    // on THAT date instead of "tomorrow." Makes "tap the lit Sealing pill to
    // edit the date" feel like edit-in-place rather than a fresh pick.
    const base = pendingSealMs ? new Date(pendingSealMs) : (() => {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      return t;
    })();
    if (calType === 'gregorian') {
      setDial({ y: base.getFullYear(), m: base.getMonth(), d: base.getDate() });
    } else {
      const [jy, jm, jd] = g2j(base.getFullYear(), base.getMonth() + 1, base.getDate());
      setDial({ y: jy, m: jm - 1, d: jd });
    }
    setIsSealing(true);
  };

  const CAPSULE_TOASTS = [
    "You kept your promise to wait.",
    "Time moved. So did you.",
    "The past version of you left this behind.",
    "Some things are worth the patience.",
    "Memory retrieved. Handle with care.",
  ];

  const handleOpenCapsule = useCallback((note: Note) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setReadingCapsule(note);
    addOrUpdateNote({ ...note, isSealed: false, status: 'archived', group: '$SYS_OPENED_CAPSULE' });
    // Narrator toast
    const msg = CAPSULE_TOASTS[Math.floor(Math.random() * CAPSULE_TOASTS.length)];
    setTimeout(() => {
      setNarratorToast(msg);
      setTimeout(() => setNarratorToast(null), 4000);
    }, 800);
  }, [addOrUpdateNote]);

  // Diary entries live in the same `notes` slice but render in DiaryView, so
  // every list/filter that powers the regular feed has to exclude them. Once
  // the user toggles diaryMode on, the regular feed is hidden anyway, but the
  // group chips, storage counts, and search results all keep working only
  // because diary is excluded here at the source.
  const activeUnlockedNotes = useMemo(() => notes.filter((n) => n.status === "active" && !n.isLocked && !n.isSealed && n.kind !== 'diary'), [notes]);
  const uniqueGroups = useMemo(() => Array.from(new Set(activeUnlockedNotes.map((n) => n.group).filter(g => g && g !== '$SYS_OPENED_CAPSULE'))) as string[], [activeUnlockedNotes]);

  // Diary feed — every diary-kind note still in active or archived state.
  // We deliberately keep archived diary entries visible; archiving in diary
  // context means "older / set aside," not "deleted." Trashed entries drop
  // out (they're in the storage).
  const diaryNotes = useMemo(
    () => notes.filter(n => n.kind === 'diary' && n.status !== 'trash'),
    [notes]
  );

  // Storage Data
  const archivedNotes = useMemo(() => notes.filter((n) => n.status === "archived" && n.group !== '$SYS_OPENED_CAPSULE' && n.kind !== 'diary'), [notes]);
  const trashNotes = useMemo(() => notes.filter((n) => n.status === "trash"), [notes]);
  const storageCapsules = useMemo(() => notes.filter((n) => n.group === '$SYS_OPENED_CAPSULE' && n.status !== 'trash'), [notes]);

  // Capsules that have unlocked but haven't been opened yet — still sealed
  // (the user hasn't read them), unlock moment passed, and not an event-locked
  // capsule still waiting on its challenge. Drives the purple "you have a
  // message waiting" dot on the Capsules filter chip; clears once each is
  // opened (opening flips isSealed false, dropping it from this set).
  const readyCapsules = useMemo(() => notes.filter((n) => {
    if (!n.isSealed || n.status !== 'active') return false;
    const eventLockedWaiting = !!n.unlockOnChallengeId && !n.unlockDate && !n.unlockDateStr;
    if (eventLockedWaiting) return false;
    return getUnlockMoment(n) <= Date.now();
  }), [notes]);

  const feedData = useMemo(() => {
    let raw = notes.filter((n) => {
      // Diary entries never appear in the regular feed — they have their own
      // chronological view, and surfacing them as cards alongside notes muddies
      // the mental model.
      if (n.kind === 'diary') return false;
      // SEARCH PATCH: Do not allow searching inside sealed capsules
      const matchesSearch = n.isSealed
        ? ("sealed object".includes(searchQuery.toLowerCase()))
        : (n.content.toLowerCase().includes(searchQuery.toLowerCase()) || (n.title && n.title.toLowerCase().includes(searchQuery.toLowerCase())));

      if (!matchesSearch) return false;
      // Challenge-linked capsules (event-locked, no unlock date yet) are
      // hidden EVERYWHERE — including the dedicated Capsules filter. The
      // whole point of a capsule sealed against a challenge outcome is that
      // the user forgets they wrote it; seeing it sitting in the list every
      // day erodes that forgetting. They reappear the instant the challenge
      // achieves and stamps an unlock date onto the note.
      const isHiddenEventCapsule = !!n.unlockOnChallengeId && !n.unlockDate && !n.unlockDateStr;
      if (isHiddenEventCapsule) return false;
      if (activeFilter === "$SYS_CAPSULES") return n.isSealed && n.status === "active";
      if (n.isSealed) return false;
      if (activeFilter === "$SYS_LOCKED") return n.isLocked && n.status === "active";
      if (n.isLocked) return false;
      if (activeFilter === "$SYS_ALL") return n.status === "active" && n.group !== '$SYS_OPENED_CAPSULE';
      return n.status === "active" && n.group === activeFilter;
    });
    const sorted = raw.sort((a, b) => a.isPinned === b.isPinned ? a.order - b.order : a.isPinned ? -1 : 1);
    return sorted.map((note, i) => ({
      note,
      isFirst: i === 0 || sorted[i - 1]?.isPinned !== note.isPinned,
      isLast: i === sorted.length - 1 || sorted[i + 1]?.isPinned !== note.isPinned,
    }));
  }, [notes, searchQuery, activeFilter]);

  const todayLabel = useMemo(() => {
    const d = new Date();
    if (calendarType === "shamsi") {
      const [jy, jm, jd] = g2j(d.getFullYear(), d.getMonth() + 1, d.getDate());
      return `${JS_DAY_MAP[d.getDay()]}, ${SHAMSI_MONTHS[jm - 1].slice(0, 3)} ${jd}`;
    }
    return `${JS_DAY_MAP[d.getDay()]}, ${GREGORIAN_MONTHS[d.getMonth()]} ${d.getDate()}`;
  }, [calendarType]);

  const handleFilterPress = async (id: string) => {
    if (id === "$SYS_LOCKED") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (hasHardware && isEnrolled) {
        const auth = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Biometric Storage" });
        if (auth.success) { setActiveFilter(id); } 
        else { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
      } else {
        setConfirmModal({ title: "Storage Unavailable", message: "No biometric security is configured on this device.", label: "OK", onConfirm: () => setConfirmModal(null) });
      }
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setActiveFilter(id);
    }
  };


  const deleteForever = useCallback((id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setConfirmModal({ title: "Obliterate Note", message: "This cannot be undone. Are you sure?", label: "Obliterate", onConfirm: () => {
      // Clean up files from filesystem. Log failures rather than swallowing them
      // silently so orphaned files become diagnosable in Sentry/dev console.
      const note = useAppStore.getState().notes.find(n => n.id === id);
      if (note) {
        note.imageUris?.forEach(uri => deleteAsync(uri, { idempotent: true }).catch(e => console.warn('[notes] failed to delete image', uri, e)));
        note.audio?.forEach(memo => deleteAsync(memo.uri, { idempotent: true }).catch(e => console.warn('[notes] failed to delete audio', memo.uri, e)));
      }
      deleteNote(id);
      setConfirmModal(null);
    } });
  }, [deleteNote]);

  const emptyTrash = useCallback(() => {
    const current = useAppStore.getState().notes.filter((n) => n.status === "trash");
    if (current.length === 0) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setConfirmModal({ title: "Purge trash?", message: "Permanently delete every note in the trash? This can't be undone.", label: "Purge all", onConfirm: () => {
      current.forEach((n) => {
        n.imageUris?.forEach(uri => deleteAsync(uri, { idempotent: true }).catch(e => console.warn('[notes] failed to delete image (empty trash)', uri, e)));
        n.audio?.forEach(memo => deleteAsync(memo.uri, { idempotent: true }).catch(e => console.warn('[notes] failed to delete audio (empty trash)', memo.uri, e)));
        deleteNote(n.id);
      });
      setConfirmModal(null);
    } });
  }, [deleteNote]);

  const handleToggleCheckbox = useCallback((noteId: string, lineIndex: number) => {
    const note = useAppStore.getState().notes.find((n) => n.id === noteId);
    if (!note) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const lines = note.content.split("\n");
    const targetLine = lines[lineIndex];
    if (targetLine.startsWith("[ ] ")) lines[lineIndex] = "[x] " + targetLine.slice(4);
    else if (targetLine.startsWith("[x] ") || targetLine.startsWith("[X] ")) lines[lineIndex] = "[ ] " + targetLine.slice(4);
    updateNoteContent(noteId, lines.join("\n"));
  }, [updateNoteContent]);


  const openDiaryActionsFor = useCallback((note: Note) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDiaryActionTarget(note);
  }, []);

  const handleOpenNote = useCallback((note: Note) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Re-read from store for freshest data
    const fresh = useAppStore.getState().notes.find(n => n.id === note.id);
    setReadingNote(fresh || note);
  }, []);

  // ── MOOD-DOOR DIARY COMPOSER ──────────────────────────────────────────────
  // The diary's new-entry + edit surface (components/notes/MoodDiaryComposer):
  // pick a feeling → write on a warm page → "Kept." `initial` null = new entry;
  // a Note = edit (its photos/audio survive — we merge onto the existing note).
  // Only reachable inside diaryMode, which is already biometric-gated, so there's
  // no extra auth here.
  const [moodComposer, setMoodComposer] = useState<{ initial: Note | null } | null>(null);
  const openMoodComposer = useCallback((initial: Note | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMoodComposer({ initial });
  }, []);

  // Recent moods (most-recent first) feed the composer's "lately" strip — the
  // payoff that makes picking a feeling worth it.
  const recentDiaryMoods = useMemo(() =>
    [...diaryNotes]
      .sort((a, b) => (b.entryDate ?? b.createdAt) - (a.entryDate ?? a.createdAt))
      .map(n => n.mood)
      .filter((m): m is string => !!m)
      .slice(0, 12),
  [diaryNotes]);

  // Format an entry's date the way the rest of the diary does (gregorian / shamsi).
  const formatDiaryDate = useCallback((ms: number) => {
    const d = new Date(ms);
    if (calendarType === 'shamsi') {
      const [, jm, jd] = g2j(d.getFullYear(), d.getMonth() + 1, d.getDate());
      return `${jd} ${SHAMSI_MONTHS[jm - 1]}`;
    }
    return `${d.getDate()} ${GREGORIAN_MONTHS[d.getMonth()]}`;
  }, [calendarType]);

  // Persist a mood-door entry. New → fresh diary Note + unlock ticks; edit →
  // merge onto the existing note so photos/audio/entryDate survive untouched.
  const persistDiaryEntry = useCallback((payload: { mood: string | null; content: string }) => {
    const target = moodComposer?.initial ?? null;
    const now = Date.now();
    const existing = target ? useAppStore.getState().notes.find(n => n.id === target.id) : null;
    if (existing) {
      addOrUpdateNote({ ...existing, content: payload.content, mood: payload.mood ?? undefined, kind: 'diary', updatedAt: now });
    } else {
      addOrUpdateNote({
        id: now.toString(), title: '', content: payload.content, color: DEFAULT_COLOR,
        createdAt: now, isPinned: false, isLocked: false, order: -now, status: 'active',
        imageUris: [], audio: [], kind: 'diary', mood: payload.mood ?? undefined, entryDate: now,
      });
      const st = useAppStore.getState();
      st.incrementTotalNotesCreated();
      st.incrementDiaryEntriesCreated();
    }
  }, [moodComposer, addOrUpdateNote]);

  // Stable identity for the composer's `initial` so its open-time re-seed effect
  // doesn't re-fire every render and wipe what the user is typing mid-entry.
  const composerInitial = useMemo(
    () => moodComposer?.initial
      ? { id: moodComposer.initial.id, mood: moodComposer.initial.mood, content: moodComposer.initial.content }
      : null,
    [moodComposer],
  );

  const handleGroupLongPress = useCallback((group: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRenameText(group);
    setGroupModal({ group, action: "rename" });
  }, []);

  const handleRenameGroup = useCallback(() => {
    if (!groupModal || !renameText.trim()) return;
    const oldGroup = groupModal.group;
    const newGroup = renameText.trim().toLowerCase();
    if (newGroup === oldGroup) { setGroupModal(null); return; }
    const allNotes = useAppStore.getState().notes;
    const performRename = () => {
      allNotes.filter(n => n.group === oldGroup).forEach(n => {
        addOrUpdateNote({ ...n, group: newGroup });
      });
      if (activeFilter === oldGroup) setActiveFilter(newGroup);
      setGroupModal(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };
    // If the target group name already exists, renaming silently merges the
    // two groups. That's surprising data loss in the user's mental model
    // (their notes "moved into" another folder). Surface the merge as an
    // explicit confirmation instead.
    const targetExists = allNotes.some(n => n.group === newGroup);
    if (targetExists) {
      const movingCount = allNotes.filter(n => n.group === oldGroup).length;
      setGroupModal(null);
      setConfirmModal({
        title: 'Merge into existing group?',
        message: `"${newGroup}" already exists. ${movingCount} ${movingCount === 1 ? 'note' : 'notes'} from "${oldGroup}" will be merged into it.`,
        label: 'Merge',
        onConfirm: () => { setConfirmModal(null); performRename(); },
      });
      return;
    }
    performRename();
  }, [groupModal, renameText, activeFilter, addOrUpdateNote]);

  const handleDeleteGroup = useCallback(() => {
    if (!groupModal) return;
    const allNotes = useAppStore.getState().notes;
    allNotes.filter(n => n.group === groupModal.group).forEach(n => {
      addOrUpdateNote({ ...n, group: undefined });
    });
    setActiveFilter("$SYS_ALL");
    setGroupModal(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [groupModal, addOrUpdateNote]);

  const handleShareNote = useCallback(async (note: Note) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const md = `${note.title ? `# ${note.title}\n\n` : ""}${note.content}`;
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        const filename = `${(note.title || "note").replace(/[^a-zA-Z0-9\u0600-\u06FF ]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "note"}.md`;
        const filePath = `${documentDirectory}${filename}`;
        await writeAsStringAsync(filePath, md);
        await Sharing.shareAsync(filePath, { mimeType: "text/markdown", dialogTitle: "Share Note" });
        deleteAsync(filePath, { idempotent: true }).catch(() => {});
      } else {
        await Share.share({ message: md });
      }
    } catch (e) { console.warn(e); }
  }, []);

  const handleShowHistory = useCallback((note: Note) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setHistoryNote(note);
  }, []);

  const handleRestoreSnapshot = useCallback((noteId: string, snapshot: NoteSnapshot) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const note = useAppStore.getState().notes.find(n => n.id === noteId);
    if (!note) return;
    addOrUpdateNote({ ...note, content: snapshot.content, title: snapshot.title });
    setViewingSnapshot(null);
    setHistoryNote(null);
    // Refresh the reader underneath with restored content
    setTimeout(() => {
      const fresh = useAppStore.getState().notes.find(n => n.id === noteId);
      if (fresh) setReadingNote({ ...fresh });
    }, 50);
  }, [addOrUpdateNote]);

  const pickImage = async (useCamera: boolean = false) => {
    try {
      const { status } = useCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") return;
      let result = useCamera ? await ImagePicker.launchCameraAsync({ quality: 0.8 }) : await ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: true, quality: 0.8 });
      if (!result.canceled && result.assets) {
        const newUris: string[] = [];
        for (const asset of result.assets) {
          const fileName = `img_${Date.now()}.jpg`;
          const permUri = `${documentDirectory}${fileName}`;
          await copyAsync({ from: asset.uri, to: permUri });
          newUris.push(permUri);
          dirtyMediaUrisRef.current.add(permUri);
        }
        setEditorImageUris((p) => [...p, ...newUris]);
      }
    } catch (e) { console.warn(e); }
  };

  const toggleRecord = async () => {
    try {
      if (isRecording && recording) {
        setIsRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
        try { const status = await recording.getStatusAsync(); if (status.canRecord) await recording.stopAndUnloadAsync(); } catch (err) {}
        const uri = recording.getURI();
        if (uri) {
          const permUri = `${documentDirectory}audio_${Date.now()}.m4a`;
          await copyAsync({ from: uri, to: permUri });
          dirtyMediaUrisRef.current.add(permUri);
          const newMemo: AudioMemo = { id: `a_${Date.now()}`, uri: permUri, duration: formatDuration(recordingTimer * 1000), name: `Voice Memo ${editorAudio.length + 1}` };
          setEditorAudio((prev) => [...prev, newMemo]);
        }
        setRecording(undefined);
      } else {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== "granted") return;
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording: newRec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        setRecording(newRec); setIsRecording(true); setRecordingTimer(0);
        timerRef.current = setInterval(() => setRecordingTimer((p) => p + 1), 1000);
      }
    } catch (e) { console.warn(e); setIsRecording(false); }
  };

  // newAsDiary: when opening a *new* entry from the diary toggle, the note is
  // saved with kind === 'diary' and pre-titled with today's date so the user
  // doesn't have to think about naming. Editing an existing note preserves
  // its existing kind regardless of where the editor was opened from.
  const openNoteSheet = useCallback((note?: Note, newAsDiary?: boolean) => {
      Keyboard.dismiss(); setShowColors(false);
      // Fresh editor session — reset the dirty-media tracker so we only delete
      // files actually created in THIS session, not URIs the existing note
      // already owns.
      dirtyMediaUrisRef.current = new Set();
      if (note) {
        setEditingId(note.id); setNoteTitle(note.title || ""); setNoteGroup(note.group || ""); setNoteText(note.content); setNoteColor(note.color); setEditorImageUris(note.imageUris || []); setEditorAudio(note.audio || []);
        editingDiaryRef.current = note.kind === 'diary';
        setEditorEntryDate(note.kind === 'diary' ? (note.entryDate ?? note.createdAt) : null);
        setEditorMood(note.kind === 'diary' ? (note.mood ?? null) : null);
      } else {
        setEditingId(null);
        editingDiaryRef.current = !!newAsDiary;
        setEditorEntryDate(newAsDiary ? Date.now() : null);
        setEditorMood(null);
        if (newAsDiary) {
          // Pre-title with today's display date so the diary entry's date is
          // obvious in the editor too, not just in the chronological view.
          const today = new Date();
          const titleStr = calendarType === 'shamsi'
            ? `${g2j(today.getFullYear(), today.getMonth() + 1, today.getDate())[2]} ${SHAMSI_MONTHS[g2j(today.getFullYear(), today.getMonth() + 1, today.getDate())[1] - 1]}`
            : `${today.getDate()} ${GREGORIAN_MONTHS[today.getMonth()]}`;
          setNoteTitle(titleStr);
        } else {
          setNoteTitle("");
        }
        setNoteGroup(newAsDiary ? "" : (activeFilter.startsWith("$SYS_") ? "" : activeFilter));
        setNoteText(""); setNoteColor(DEFAULT_COLOR); setEditorImageUris([]); setEditorAudio([]);
      }
      setMediaCollapsed(false);
      // Defensive: closeEditor already resets this, but mirroring on open
      // means an editor session never accidentally inherits the previous
      // session's seal-intent if something exotic skipped the close path.
      setPendingSealMs(null);
      setIsEditorVisible(true);
    }, [activeFilter, calendarType]);

  const saveNote = useCallback((sealed = false, targetTime = 0): string | null => {
      if (!noteText.trim() && !noteTitle.trim() && editorImageUris.length === 0 && editorAudio.length === 0) { closeEditor(); return null; }
      const existing = editingId ? useAppStore.getState().notes.find((n) => n.id === editingId) : null;

      const noteId = editingId || Date.now().toString();
      // Preserve user's chosen group when sealing — only fall back to 'capsules'
      // when the user hasn't named a group. This makes the capsule survive
      // unlocking back into its original folder. (Bug fix: previously the user's
      // group was silently dropped on every seal.)
      const trimmedGroup = noteGroup.trim().toLowerCase();
      // For sealed capsules, derive the calendar-date string from targetTime
      // (which is local-midnight at the moment of sealing). Storing both means
      // the reconciliation pass on focus can re-anchor unlockDate to local
      // midnight in the user's CURRENT timezone if they've travelled since.
      let unlockDateStr: string | undefined;
      if (sealed === true && targetTime > 0) {
        const d = new Date(targetTime);
        unlockDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      // Preserve diary-kind across edits; if the editor was opened from the
      // diary toggle for a NEW entry, editingDiaryRef.current === true.
      const isDiary = (existing?.kind === 'diary') || editingDiaryRef.current;
      const newNote: Note = {
        id: noteId,
        title: noteTitle.trim(),
        group: sealed ? (trimmedGroup || 'capsules') : trimmedGroup,
        content: noteText.trim(),
        color: noteColor,
        createdAt: existing?.createdAt ?? Date.now(),
        isPinned: existing?.isPinned ?? false,
        isLocked: existing?.isLocked ?? activeFilter === "$SYS_LOCKED",
        order: existing?.order ?? -Date.now(),
        status: existing?.status ?? "active",
        imageUris: editorImageUris,
        audio: editorAudio,
        isSealed: sealed === true,
        unlockDate: sealed === true ? targetTime : undefined,
        unlockDateStr,
        kind: isDiary ? 'diary' : existing?.kind,
        // Mood: only diary entries carry it. For diary entries, persist the
        // current editor pick (or null if cleared). For regular notes,
        // preserve whatever was there (defensive — mood shouldn't exist on
        // non-diary notes but legacy data might).
        mood: isDiary ? (editorMood ?? undefined) : existing?.mood,
        // entryDate only applies to diary entries — preserves any backdating
        // the user did via the date chip in the editor.
        entryDate: isDiary ? (editorEntryDate ?? existing?.entryDate ?? existing?.createdAt ?? Date.now()) : existing?.entryDate,
      };
      addOrUpdateNote(newNote);
      // Unlock counters — only NEW notes tick (editing an existing note is not
      // a creation). A new diary entry is still a note, so it ticks BOTH
      // totalNotesCreated and diaryEntriesCreated. Counters are monotonic.
      if (!existing) {
        const st = useAppStore.getState();
        st.incrementTotalNotesCreated();
        if (editingDiaryRef.current) st.incrementDiaryEntriesCreated();
      }
      closeEditor(noteId);
      return noteId;
    }, [noteText, noteTitle, editorImageUris, editorAudio, editingId, noteGroup, noteColor, activeFilter, addOrUpdateNote, closeEditor, editorEntryDate, editorMood]);

  const TEMPLATES: { name: string; icon: string; title: string; content: string }[] = [
    { name: "Daily Log", icon: "sun", title: "Daily Log", content: "# Morning\n- \n\n# Afternoon\n- \n\n# Evening\n- " },
    { name: "Meeting", icon: "users", title: "Meeting Notes", content: "# Attendees\n- \n\n# Agenda\n- \n\n# Action Items\n[ ] \n[ ] " },
    { name: "Book Notes", icon: "book", title: "", content: "# Core Argument\n\n\n# Key Ideas\n- \n- \n\n# My Takeaways\n[ ] \n\n# Best Quote\n" },
    { name: "Ideas", icon: "zap", title: "Ideas", content: "# Problem\n\n\n# Possible Solutions\n- \n- \n\n# Next Steps\n[ ] " },
    { name: "Review", icon: "bar-chart-2", title: "Weekly Review", content: "# Wins\n- \n\n# Struggles\n- \n\n# Next Week\n[ ] \n[ ] \n\n# One thing to stop doing\n" },
  ];

  const applyTemplate = (tmpl: typeof TEMPLATES[0]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setNoteTitle(tmpl.title);
    setNoteText(tmpl.content);
  };

  const insertMarkdown = (prefix: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const before = noteText.substring(0, selection.start);
    const after = noteText.substring(selection.end);
    const needsNewline = before.length > 0 && !before.endsWith("\n");
    setNoteText(before + (needsNewline ? "\n" : "") + prefix + after);
  };

  const moveAudio = (idx: number, dir: "up" | "down") => {
    const newArr = [...editorAudio];
    if (dir === "up" && idx > 0) [newArr[idx], newArr[idx - 1]] = [newArr[idx - 1], newArr[idx]];
    else if (dir === "down" && idx < newArr.length - 1) [newArr[idx], newArr[idx + 1]] = [newArr[idx + 1], newArr[idx]];
    setEditorAudio(newArr); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggleColors = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setShowColors(!showColors); setShowHighlightColors(false); };
  const selectColor = (c: string) => { setNoteColor(c); LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setShowColors(false); };

  const toggleHighlightColors = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowHighlightColors(prev => !prev);
    setShowColors(false);
  };

  // Wrap (or insert) the current selection with =={colorName}...== markers.
  // Default color name yields the bare ==text== form for readability — an
  // explicit prefix is only added for non-default colors, keeping notes that
  // only ever use yellow free of `{yellow}` clutter.
  const applyHighlight = (colorName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const before = noteText.substring(0, selection.start);
    const selected = noteText.substring(selection.start, selection.end);
    const after = noteText.substring(selection.end);
    const prefix = colorName === DEFAULT_HIGHLIGHT_COLOR ? '==' : `=={${colorName}}`;
    const suffix = '==';
    const inner = selected || 'text';
    setNoteText(before + prefix + inner + suffix + after);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowHighlightColors(false);
  };

  const renderItem = useCallback(({ item }: { item: { note: Note; isFirst: boolean; isLast: boolean } }) => {
      const { note } = item;
      if (note.isSealed) {
        return (
          <CapsuleCard
            note={note} theme={theme} calSystem={calendarType}
            onOpenCapsule={handleOpenCapsule}
            onStatusChange={updateNoteStatus} onDeleteForever={deleteForever}
          />
        );
      }
      return (
        <NoteCard
          note={note} theme={theme} calSystem={calendarType}
          onOpen={handleOpenNote} onStatusChange={updateNoteStatus}
          onPin={toggleNotePin} onDeleteForever={deleteForever}
          searchQuery={searchQuery}
        />
      );
    }, [theme, calendarType, updateNoteStatus, toggleNotePin, deleteForever, handleOpenCapsule, handleOpenNote, searchQuery]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: diaryMode ? (isDarkMode ? '#17130E' : '#F4EEE1') : theme.bg }}>
      <BottomSheetModalProvider>
        <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
          
          <View style={{ paddingHorizontal: 24, paddingTop: 30, paddingBottom: 15, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={{ fontSize: 36, fontWeight: "900", color: theme.textMain, letterSpacing: -1 }}>{diaryMode ? 'Diary.' : 'Notes.'}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 }}>
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: "700" }}>{todayLabel}</Text>
                <TouchableOpacity onPress={toggleCalendar} hitSlop={15}><Text style={{ fontSize: 9, color: theme.textSub, opacity: 0.5, fontWeight: "900", letterSpacing: 0.5 }}>• {calendarType.toUpperCase()}</Text></TouchableOpacity>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
              <TouchableOpacity onPress={() => {
                // Closing the search bar drops the query too. Otherwise the
                // search filter silently persists after the bar disappears
                // and feedData stays filtered with no visible affordance to
                // unfilter — users had to reopen, manually clear, then close.
                setIsSearchOpen(prev => {
                  if (prev) setSearchQuery('');
                  return !prev;
                });
              }} hitSlop={15}><Feather name="search" size={20} color={isSearchOpen ? theme.textMain : theme.textMain} /></TouchableOpacity>
              {/* Storage hidden in diary mode — diary entries don't get
                  archived to a separate place; archiving and deleting them
                  happen via long-press on each entry instead. Mixing the
                  storage button into a diary view also implies cross-mode
                  archiving that doesn't actually exist. */}
              {!diaryMode && (
                <TouchableOpacity onPress={() => storageSheetRef.current?.present()} hitSlop={15}><Feather name="archive" size={20} color={theme.textMain} /></TouchableOpacity>
              )}
              {/* Diary settings — only visible in diary mode. Sits BEFORE the
                  diary toggle so the toggle stays in the same position
                  (right before plus) regardless of mode — moving icons
                  around when modes change makes the header feel unstable. */}
              {diaryMode && (
                <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDiarySettingsVisible(true); }} hitSlop={15}>
                  <Feather name="settings" size={20} color={theme.textMain} />
                </TouchableOpacity>
              )}
              {/* Diary toggle — flip between the regular notes feed and the
                  chronological journal. Filled book icon when active so users
                  can see at a glance which mode they're in. Search stays
                  open across the toggle so a query carried over works in
                  both modes (DiaryView filters its own list by searchQuery).
                  Gated on DIARY (3 notes) — completely absent until then,
                  fades in on unlock. */}
              {diaryUnlocked ? (
              <Animated.View entering={FadeIn.duration(300)}>
              <TouchableOpacity onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                // Entering diary mode while a lock is active triggers a
                // biometric (or device-PIN fallback) prompt. Cached for the
                // session so toggling out and back doesn't re-prompt — the
                // ref resets when the user leaves the tab. Leaving diary
                // mode never requires auth.
                if (!diaryMode && diaryLocked && !diaryAuthedRef.current) {
                  try {
                    const hasHardware = await LocalAuthentication.hasHardwareAsync();
                    const enrolled = await LocalAuthentication.isEnrolledAsync();
                    if (hasHardware && enrolled) {
                      const result = await LocalAuthentication.authenticateAsync({
                        promptMessage: 'Unlock diary',
                        // Allow device-PIN as fallback so users without
                        // Face/Touch ID can still get in.
                        disableDeviceFallback: false,
                      });
                      if (!result.success) {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        return; // bail without flipping the toggle
                      }
                      diaryAuthedRef.current = true;
                    }
                    // No hardware/enrollment → silently skip the gate. We
                    // could pop a "set up Face ID first" warning here but
                    // that's friction for a first-time tap.
                  } catch {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    return;
                  }
                }
                setDiaryMode(prev => !prev);
              }} hitSlop={15}>
                <Feather name="book-open" size={20} color={diaryMode ? theme.textMain : theme.textSub} />
              </TouchableOpacity>
              </Animated.View>
              ) : null}
              <TouchableOpacity onPress={() => (diaryMode ? openMoodComposer(null) : openNoteSheet(undefined, false))} hitSlop={15}><Feather name="plus-circle" size={22} color={theme.textMain} /></TouchableOpacity>
            </View>
          </View>

          {isSearchOpen && (
            <View style={{ paddingHorizontal: 20, marginBottom: 15 }}>
              <View style={{ backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Feather name="search" size={16} color={theme.textSub} />
                <TextInput placeholder="Search thoughts..." placeholderTextColor={theme.textSub} style={[{ flex: 1, fontSize: 16, fontWeight: "600", color: theme.textMain }, persianSafeInputStyle, rtlInputStyle(searchQuery)]} value={searchQuery} onChangeText={setSearchQuery} autoFocus />
              </View>
            </View>
          )}

          {!diaryMode && (
          <View style={{ paddingHorizontal: 20, marginBottom: 15 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: "center" }}>
              {["$SYS_ALL", ...uniqueGroups].map((id) => {
                const isSelected = activeFilter === id;
                const isSystem = id.startsWith("$");
                return (
                  <TouchableOpacity key={id} onPress={() => handleFilterPress(id)} onLongPress={isSystem ? undefined : () => handleGroupLongPress(id)} delayLongPress={500} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: isSelected ? theme.textMain : theme.surface, borderWidth: 1, borderColor: theme.border }}>
                    <Text style={{ color: isSelected ? theme.bg : theme.textSub, fontWeight: "800", fontSize: 12, textTransform: isSystem ? "uppercase" : "capitalize" }}>{id === "$SYS_ALL" ? "All" : id}</Text>
                  </TouchableOpacity>
                );
              })}
              <View style={{ width: 1, height: 20, backgroundColor: theme.border, marginHorizontal: 2 }} />
              {[ { id: "$SYS_CAPSULES", label: "Capsules", icon: "clock" as const }, { id: "$SYS_LOCKED", label: "Locked", icon: "lock" as const } ].map(({ id, label, icon }) => {
                const isSelected = activeFilter === id;
                // Purple dot when a capsule has unlocked but isn't opened yet —
                // the user's only quiet signal that "a message from the past is
                // here" (we deliberately keep this off the crowded Timeline).
                const showReadyDot = id === "$SYS_CAPSULES" && readyCapsules.length > 0;
                return (
                  <TouchableOpacity key={id} onPress={() => handleFilterPress(id)} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: isSelected ? theme.textMain : theme.surface, borderWidth: 1, borderColor: theme.border, flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Feather name={icon} size={10} color={isSelected ? theme.bg : theme.textSub} />
                    <Text style={{ color: isSelected ? theme.bg : theme.textSub, fontWeight: "800", fontSize: 12, textTransform: "uppercase" }}>{label}</Text>
                    {showReadyDot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: artAccent, marginLeft: 1 }} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
          )}

          <View style={{ flex: 1 }}>
            {diaryMode ? (
              <DiaryView
                notes={diaryNotes}
                theme={theme}
                isDarkMode={isDarkMode}
                calSystem={calendarType}
                // Tap → the Mood-door composer in edit mode (warm page, mood +
                // text; photos/audio on the entry are preserved). Long-press →
                // Edit / Photos & voice (full editor) / Delete. New → the doorway.
                onOpen={(n) => openMoodComposer(n)}
                onLongPress={(n) => openDiaryActionsFor(n)}
                onCreate={() => openMoodComposer(null)}
                activeAudioUri={activeAudioUri}
                setActiveAudioUri={setActiveAudioUri}
                searchQuery={searchQuery}
              />
            ) : searchQuery.trim().toLowerCase() === "help" ? (
              <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 120 }}>
                <View style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 24, borderWidth: 1, borderColor: theme.border }}>
                  <Text style={{ color: theme.textMain, fontSize: 18, fontWeight: "900", marginBottom: 16, letterSpacing: -0.3 }}>You&apos;re not alone.</Text>
                  <View style={{ gap: 16 }}>
                    {[
                      { label: "Crisis Text Line", detail: "Text HOME to 741741", region: "US" },
                      { label: "National Suicide Prevention", detail: "988 (call or text)", region: "US" },
                      { label: "Samaritans", detail: "116 123", region: "UK" },
                      { label: "Befrienders Worldwide", detail: "befrienders.org", region: "Global" },
                      { label: "AASRA", detail: "9820466726", region: "India" },
                    ].map((r, i) => (
                      <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.textMain, fontSize: 15, fontWeight: "700" }}>{r.label}</Text>
                          <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: "600", marginTop: 2 }}>{r.detail}</Text>
                        </View>
                        <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: "800", opacity: 0.5 }}>{r.region}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </ScrollView>
            ) : feedData.length === 0 ? (
              <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 80 }}>
                <Feather name={activeFilter === "$SYS_CAPSULES" ? "clock" : activeFilter === "$SYS_LOCKED" ? "lock" : "file-text"} size={64} color={theme.textSub} style={{ opacity: 0.1, marginBottom: 20 }} />
                <Text style={{ color: theme.textSub, fontSize: 16, fontWeight: "700", marginBottom: 6 }}>
                  {activeFilter === "$SYS_CAPSULES" ? "No sealed capsules." : activeFilter === "$SYS_LOCKED" ? "No locked notes." : searchQuery ? "No results." : "Nothing here yet."}
                </Text>
                <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: "500", opacity: 0.6 }}>
                  {searchQuery ? "Try a different search." : "Tap + to start writing."}
                </Text>
              </View>
            ) : (
              <FlashList
                data={feedData}
                keyExtractor={(item) => item.note.id}
                renderItem={renderItem}
                // @ts-ignore
                estimatedItemSize={150}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
              />
            )}
          </View>

          <Modal visible={!!viewingImages} transparent={true} animationType="fade" onRequestClose={() => setViewingImages(null)}>
            {viewingImages && (
              <ImageViewer imageUrls={viewingImages.uris.map((uri) => ({ url: uri }))} index={viewingImages.index} enableSwipeDown={true} onSwipeDown={() => setViewingImages(null)}
                renderHeader={() => ( <TouchableOpacity style={{ position: "absolute", top: 50, right: 20, zIndex: 10, padding: 15, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 100 }} onPress={() => setViewingImages(null)}><Feather name="x" size={24} color="#FFF" /></TouchableOpacity> )}
              />
            )}
          </Modal>

          {/* FULL-SCREEN NOTE READER */}
          <Modal visible={!!readingNote} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setReadingNote(null)}>
            {readingNote && (() => {
              const rn = useAppStore.getState().notes.find(n => n.id === readingNote.id) || readingNote;
              const rnTitleIsRtl = isRtl(lineDirectionText(rn.title || ''));
              // For diary entries, the meaningful "when" is the user-chosen
              // entryDate (the day the entry is ABOUT) rather than createdAt
              // (when it was typed). Falls back to createdAt for legacy
              // entries written before backdating support landed.
              const rnIsDiary = rn.kind === 'diary';
              const rnAnchorMs = rnIsDiary ? (rn.entryDate ?? rn.createdAt) : rn.createdAt;
              const rnDateStr = formatDisplayDate(rnAnchorMs, calendarType);
              const rnTimeStr = new Date(rnAnchorMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              const rnEditedStr = rn.updatedAt ? formatDisplayDate(rn.updatedAt, calendarType) : null;
              const rnWords = rn.content.trim().split(/\s+/).filter(Boolean).length;

              return (
                <View style={{ flex: 1, backgroundColor: theme.bg }}>
                  <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
                    {/* Header */}
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                      <TouchableOpacity onPress={() => setReadingNote(null)} hitSlop={15} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Feather name="chevron-left" size={22} color={theme.textMain} />
                        <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: "700" }}>{rnIsDiary ? 'Diary' : 'Notes'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => { setEditorReturnToReader(true); openNoteSheet(rn); }} style={{ backgroundColor: theme.surface, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100, borderWidth: 1, borderColor: theme.border }}>
                        <Text style={{ color: theme.textMain, fontWeight: "800", fontSize: 13 }}>Edit</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Content */}
                    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingBottom: 120 }}>
                      {/* Meta */}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                        <Text style={{ fontSize: 11, fontWeight: "800", color: theme.textSub, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          {rnDateStr} • {rnTimeStr}
                        </Text>
                        {rnEditedStr && <Text style={{ fontSize: 11, fontWeight: "800", color: theme.textSub, opacity: 0.6 }}>• Edited {rnEditedStr}</Text>}
                        <Text style={{ fontSize: 11, fontWeight: "700", color: theme.textSub, opacity: 0.4 }}>{rnWords} words</Text>
                        {rn.group && <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: theme.border }}><Text style={{ fontSize: 10, fontWeight: "800", color: theme.textSub, textTransform: "capitalize" }}>{rn.group}</Text></View>}
                      </View>

                      {/* Title */}
                      {rn.title ? (
                        <Text style={{
                          color: theme.textMain,
                          fontSize: 32,
                          fontWeight: "900",
                          letterSpacing: -1,
                          lineHeight: 38,
                          marginBottom: 20,
                          textAlign: rnTitleIsRtl ? "right" : "left",
                          writingDirection: rnTitleIsRtl ? "rtl" : "ltr",
                        }}>{rn.title}</Text>
                      ) : null}

                      {/* Color accent bar */}
                      <View style={{ width: 32, height: 3, backgroundColor: rn.color, borderRadius: 2, marginBottom: 24 }} />

                      {/* Rich text content */}
                      <RichTextContent text={rn.content} color={rn.color} isExpanded={true} theme={theme} onToggleCheckbox={(lineIndex: number) => {
                        handleToggleCheckbox(rn.id, lineIndex);
                        // Refresh the reading note
                        setTimeout(() => {
                          const updated = useAppStore.getState().notes.find(n => n.id === rn.id);
                          if (updated) setReadingNote({ ...updated });
                        }, 50);
                      }} />

                      {/* Audio memos */}
                      {rn.audio && rn.audio.length > 0 && (
                        <View style={{ marginTop: 24, gap: 10 }}>
                          {rn.audio.map((memo: AudioMemo) => {
                            const memoIsRtl = isRtl(memo.name);
                            return (
                              <View key={memo.id} style={{ gap: 6, backgroundColor: theme.surface, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.border }}>
                                {memo.name && <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: "700", textAlign: memoIsRtl ? "right" : "left", marginBottom: 4 }}>{memo.name}</Text>}
                                <AudioPlayer uri={memo.uri} durationStr={memo.duration} theme={theme} activeAudioUri={activeAudioUri} setActiveAudioUri={setActiveAudioUri} />
                              </View>
                            );
                          })}
                        </View>
                      )}

                      {/* Images */}
                      {rn.imageUris && rn.imageUris.length > 0 && (
                        <View style={{ marginTop: 24 }}>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                            {rn.imageUris.map((uri: string, idx: number) => (
                              <TouchableOpacity key={idx} onPress={() => setViewingImages({ uris: rn.imageUris!, index: idx })} activeOpacity={0.8}>
                                <Image source={{ uri }} contentFit="cover" style={{ width: 160, height: 160, borderRadius: 14, backgroundColor: theme.border }} />
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      )}
                    </ScrollView>

                    {/* Bottom toolbar */}
                    <SafeAreaView edges={["bottom"]} style={{ backgroundColor: theme.bg }}>
                      <View style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingHorizontal: 24, paddingVertical: 14, flexDirection: "row", justifyContent: "space-around", alignItems: "center" }}>
                        <TouchableOpacity onPress={() => { Clipboard.setStringAsync(`${rn.title ? rn.title + "\n" : ""}${rn.content}`); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }} hitSlop={15}>
                          <Feather name="copy" size={20} color={theme.textSub} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleShareNote(rn)} hitSlop={15}>
                          <Feather name="share" size={20} color={theme.textSub} />
                        </TouchableOpacity>
                        {/* Version-history affordance — contextual, default-on
                            (not a store unlock). Surfaces only after the note
                            has been edited 3+ times (history caps at 3
                            snapshots, so length>=3 == "edited 3+ times"). Kept
                            as the clock icon to match this reader's icon row
                            rather than a standalone text line. */}
                        {rn.history && rn.history.length >= 3 && (
                          <TouchableOpacity onPress={() => handleShowHistory(rn)} hitSlop={15}>
                            <Feather name="clock" size={20} color={theme.textSub} />
                          </TouchableOpacity>
                        )}
                        {/* Per-entry lock is hidden for diary entries — the
                            entire diary mode is gated by its own biometric
                            setting, so a lock-inside-a-lock toggle here is
                            redundant and confusing. Pin is also dropped for
                            diary because diary already orders by entryDate;
                            "pinning" doesn't have meaning in a chronological
                            timeline. Notes-mode entries keep both. */}
                        {!rnIsDiary && (
                          <>
                            <TouchableOpacity onPress={() => { toggleNoteLock(rn.id); const updated = { ...rn, isLocked: !rn.isLocked }; setReadingNote(updated); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }} hitSlop={15}>
                              <Feather name={rn.isLocked ? "unlock" : "lock"} size={20} color={theme.textSub} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => { toggleNotePin(rn.id); const updated = { ...rn, isPinned: !rn.isPinned }; setReadingNote(updated); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} hitSlop={15}>
                              <Feather name="map-pin" size={20} color={rn.isPinned ? theme.textMain : theme.textSub} />
                            </TouchableOpacity>
                          </>
                        )}
                        <TouchableOpacity onPress={() => { setReadingNote(null); updateNoteStatus(rn.id, "trash"); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); }} hitSlop={15}>
                          <Feather name="trash-2" size={20} color={theme.textSub} />
                        </TouchableOpacity>
                      </View>
                    </SafeAreaView>
                  </SafeAreaView>
                </View>
              );
            })()}
          </Modal>

          {/* EDITOR MODAL */}
          <Modal visible={isEditorVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => closeEditor()}>
            {/* Modals are a separate window the root KeyboardProvider can't
                reach, so the editor needs its own. translucent flags match the
                app's edge-to-edge config so keyboard insets compute correctly. */}
            <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
            <View style={{ flex: 1, backgroundColor: theme.surface }}>
              <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
                {/* ── FIXED HEADER: action row + toolbar ── */}
                <View style={{ backgroundColor: theme.bg, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
                    <TouchableOpacity hitSlop={15} onPress={() => closeEditor()}>
                        <Text style={{ color: theme.textSub, fontWeight: "800", fontSize: 16 }}>Cancel</Text>
                    </TouchableOpacity>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        {noteText.trim().length > 0 && <Text style={{ fontSize: 11, fontWeight: "700", color: theme.textSub, opacity: 0.4, fontVariant: ["tabular-nums"] }}>{noteText.trim().split(/\s+/).filter(Boolean).length}w</Text>}
                        {/* Diary backdate chip — replaces the Seal slot for
                            diary entries. Tapping opens a calendar picker so
                            the user can write today about yesterday (or any
                            past day). Defaults to "today" for fresh entries. */}
                        {editingDiaryRef.current && editorEntryDate !== null && (
                          <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDatePickerVisible(true); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: hexToRgba(artAccent, 0.1), paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100 }}>
                            <Feather name="calendar" size={12} color={artAccent} />
                            <Text style={{ color: artAccent, fontWeight: "900", fontSize: 13 }}>
                              {(() => {
                                const d = new Date(editorEntryDate);
                                const today = new Date(); today.setHours(0,0,0,0);
                                const target = new Date(editorEntryDate); target.setHours(0,0,0,0);
                                const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);
                                if (diffDays === 0) return 'Today';
                                if (diffDays === 1) return 'Yesterday';
                                if (calendarType === 'shamsi') {
                                  const [, jm, jd] = g2j(d.getFullYear(), d.getMonth() + 1, d.getDate());
                                  return `${jd} ${SHAMSI_MONTHS[jm - 1].slice(0, 3)}`;
                                }
                                return `${d.getDate()} ${GREGORIAN_MONTHS[d.getMonth()]}`;
                              })()}
                            </Text>
                          </TouchableOpacity>
                        )}
                        {/* Mood chip — diary-only AND gated on MOOD_TAGGING
                            (unlocks on the first diary entry). Five vibe icons,
                            optional. Absent until unlocked; fades in after. */}
                        {editingDiaryRef.current && moodTaggingUnlocked && (
                          (() => {
                            const m = editorMood ? MOOD_BY_ID[editorMood] : null;
                            const chipColor = m?.color ?? artAccent;
                            return (
                              <Animated.View entering={FadeIn.duration(300)}>
                              <TouchableOpacity
                                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMoodPickerVisible(v => !v); }}
                                style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: hexToRgba(chipColor, 0.15), paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100 }}
                              >
                                <Feather name={(m?.icon ?? 'smile') as any} size={12} color={chipColor} />
                                <Text style={{ color: chipColor, fontWeight: "900", fontSize: 13 }}>
                                  {m?.label ?? 'Mood'}
                                </Text>
                              </TouchableOpacity>
                              </Animated.View>
                            );
                          })()
                        )}
                        {/* Seal pill — toggles into a lit state when a seal
                            date has been chosen for this session. Tapping the
                            lit pill re-opens the dial pre-filled with the
                            chosen date so the user can edit it or pick "Don't
                            seal." Hidden for diary entries (sealing a diary
                            memory would lock it away from the very view it
                            lives in). */}
                        {/* Gated on SEALING (10 days since install). Hidden for
                            diary entries either way. Before unlock we show a
                            SUBTLE tease in-place rather than hiding it: a small
                            timer + day count above a muted, non-interactive
                            "Seal" pill — the one feature we let the user
                            anticipate, sitting exactly where it'll live once
                            earned. At unlock the active pill fades in. */}
                        {!editingDiaryRef.current && (
                          sealingUnlocked ? (
                            <Animated.View entering={FadeIn.duration(300)}>
                            <TouchableOpacity
                              onPress={handleOpenSealModal}
                              style={pendingSealMs
                                ? { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: artAccent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100 }
                                : { backgroundColor: hexToRgba(artAccent, 0.1), paddingHorizontal: 14, paddingVertical: 6, borderRadius: 100 }}
                            >
                              {pendingSealMs ? (
                                <>
                                  <Feather name="lock" size={11} color="#FFF" />
                                  <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 13 }}>
                                    Sealing · {formatDisplayDate(pendingSealMs, calendarType).split(' ').slice(0, 2).join(' ')}
                                  </Text>
                                </>
                              ) : (
                                <Text style={{ color: artAccent, fontWeight: "900", fontSize: 13 }}>Seal</Text>
                              )}
                            </TouchableOpacity>
                            </Animated.View>
                          ) : (
                            <View style={{ alignItems: 'center', gap: 4 }}>
                              {/* Countdown to the reveal, in the feature's accent. */}
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <Feather name="clock" size={9} color={hexToRgba(artAccent, 0.9)} />
                                <Text style={{ color: hexToRgba(artAccent, 0.9), fontSize: 10, fontWeight: '900', letterSpacing: 0.3 }}>{sealingDaysLeft}d</Text>
                              </View>
                              {/* The locked capability itself reads as sealed: a lock
                                  glyph + accent-tinted, bordered pill (vs. the plain
                                  "Seal" text once it actually unlocks). */}
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: hexToRgba(artAccent, 0.12), borderWidth: 1, borderColor: hexToRgba(artAccent, 0.35), paddingHorizontal: 12, paddingVertical: 5, borderRadius: 100 }}>
                                <Feather name="lock" size={10} color={hexToRgba(artAccent, 0.85)} />
                                <Text style={{ color: hexToRgba(artAccent, 0.85), fontWeight: '900', fontSize: 12, letterSpacing: 0.2 }}>Seal</Text>
                              </View>
                            </View>
                          )
                        )}
                        <TouchableOpacity
                          onPress={async () => {
                            // Commit branches on whether the user queued a seal
                            // intent this session. With a pending date, we save
                            // as a sealed capsule AND schedule the unlock
                            // notification (same identifier scheme the focus
                            // reconciliation uses to re-anchor it across
                            // timezone changes). Without one, regular save.
                            const seal = pendingSealMs && pendingSealMs > Date.now();
                            const noteId = saveNote(!!seal, seal ? pendingSealMs! : 0);
                            if (seal && noteId) {
                              try {
                                await Notifications.scheduleNotificationAsync({
                                  identifier: `${CAPSULE_NOTIF_PREFIX}${noteId}`,
                                  content: { title: "A message from your past self is ready.", body: "A Time Capsule you sealed has been unlocked.", sound: true },
                                  trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(pendingSealMs!), channelId: CAPSULE_CHANNEL_ID },
                                });
                              } catch (e) { console.warn("Failed to schedule capsule notification:", e); }
                            }
                          }}
                          style={{ backgroundColor: theme.textMain, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 100 }}
                        >
                          <Text style={{ color: theme.bg, fontWeight: "900", fontSize: 13 }}>Commit</Text>
                        </TouchableOpacity>
                    </View>
                  </View>
                  <View style={{ paddingBottom: 10 }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: 20, paddingRight: 48, gap: 10, alignItems: "center" }}>
                      <TouchableOpacity onPress={() => pickImage(false)} style={s.toolBtn}><Feather name="image" size={18} color={theme.textMain} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => pickImage(true)} style={s.toolBtn}><Feather name="camera" size={18} color={theme.textMain} /></TouchableOpacity>
                      <TouchableOpacity onPress={toggleRecord} style={[s.toolBtn, isRecording && { backgroundColor: hexToRgba(theme.danger, 0.1) }]}><Feather name="mic" size={18} color={isRecording ? theme.danger : theme.textMain} />{isRecording && (<Text style={{ color: theme.danger, fontWeight: "800", fontSize: 12, marginLeft: 6 }}>{formatDuration(recordingTimer * 1000)}</Text>)}</TouchableOpacity>
                      <View style={s.divider} />
                      <TouchableOpacity onPress={() => insertMarkdown("- ")} style={s.toolBtn}><Feather name="list" size={18} color={theme.textMain} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => insertMarkdown("[ ] ")} style={s.toolBtn}><Feather name="check-square" size={18} color={theme.textMain} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => insertMarkdown("# ")} style={s.toolBtn}><Feather name="type" size={18} color={theme.textMain} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        const before = noteText.substring(0, selection.start);
                        const selected = noteText.substring(selection.start, selection.end);
                        const after = noteText.substring(selection.end);
                        if (selected) { setNoteText(before + "**" + selected + "**" + after); }
                        else { const ins = "**text**"; setNoteText(before + ins + after); }
                      }} style={s.toolBtn}><Text style={{ fontWeight: "900", fontSize: 16, color: theme.textMain }}>B</Text></TouchableOpacity>
                      {/* Highlight — opens a small palette of 6 highlighter
                          colors. Tapping a color wraps the current selection
                          (or inserts a placeholder) with =={color}...== so the
                          reader paints it with that translucent background.
                          Default-color highlights skip the {color} prefix to
                          keep notes that only use yellow looking clean. */}
                      {/* Highlight tool gated on HIGHLIGHT_COLORS (3 notes).
                          Absent before unlock; the rest of the markdown
                          toolbar stays. */}
                      {highlightColorsUnlocked ? (
                        <Animated.View entering={FadeIn.duration(300)}>
                          <TouchableOpacity onPress={toggleHighlightColors} style={s.toolBtn}>
                            <View style={{ paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, backgroundColor: hexToRgba(HIGHLIGHT_COLORS[DEFAULT_HIGHLIGHT_COLOR], HIGHLIGHT_ALPHA) }}>
                              <Text style={{ fontWeight: "900", fontSize: 14, color: theme.textMain, letterSpacing: 0.5 }}>H</Text>
                            </View>
                          </TouchableOpacity>
                        </Animated.View>
                      ) : null}
                      <View style={s.divider} />
                      <TouchableOpacity onPress={toggleColors} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(150,150,150,0.1)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 100 }}>
                        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: noteColor }} />
                        <Feather name={showColors ? "chevron-up" : "chevron-down"} size={14} color={theme.textSub} />
                      </TouchableOpacity>
                    </ScrollView>
                    {showColors && (
                      <ColorPicker horizontal maxSize={40} colors={PALETTE} value={noteColor} onChange={selectColor} ringColor={theme.textMain} borderColor={theme.border} style={{ marginTop: 12, paddingTop: 12, marginHorizontal: 24, borderTopWidth: 1, borderTopColor: theme.border }} />
                    )}
                    {showHighlightColors && (
                      <View style={{ flexDirection: "row", gap: 10, marginTop: 12, paddingTop: 12, marginHorizontal: 24, borderTopWidth: 1, borderTopColor: theme.border, alignItems: 'center' }}>
                        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '900', letterSpacing: 0.6, marginRight: 4 }}>HIGHLIGHT</Text>
                        {HIGHLIGHT_NAMES.map((name) => (
                          <TouchableOpacity
                            key={name}
                            onPress={() => applyHighlight(name)}
                            style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: hexToRgba(HIGHLIGHT_COLORS[name], HIGHLIGHT_ALPHA), borderWidth: 1, borderColor: HIGHLIGHT_COLORS[name], alignItems: 'center', justifyContent: 'center' }}
                          >
                            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: HIGHLIGHT_COLORS[name] }} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                </View>

                {/* ── SCROLLABLE: title, category, media, templates, body ── */}
                <KeyboardAwareScrollView
                  bottomOffset={48}
                  style={{ flex: 1 }} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
                  {/* Title + Category */}
                  <View style={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8 }}>
                    <TextInput style={[s.titleInput, { color: theme.textMain }, persianSafeInputStyle, rtlInputStyle(lineDirectionText(noteTitle))]} placeholder="Untitled Thought" placeholderTextColor={theme.textSub} value={noteTitle} onChangeText={setNoteTitle} onFocus={() => { if (editorImageUris.length > 0 || editorAudio.length > 0) setMediaCollapsed(true); }} />
                    <TextInput style={[s.catInput, { color: theme.textSub }, persianSafeInputStyle, rtlInputStyle(lineDirectionText(noteGroup))]} placeholder="Add to a category..." placeholderTextColor={theme.textSub} value={noteGroup} onChangeText={setNoteGroup} />
                  </View>

                  {/* Media section (collapsible) */}
                  {(editorImageUris.length > 0 || editorAudio.length > 0) && (
                    <View style={{ marginHorizontal: 24, marginBottom: 8, borderWidth: 1, borderColor: theme.border, borderRadius: 14, overflow: "hidden" }}>
                      <TouchableOpacity onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setMediaCollapsed(!mediaCollapsed); }} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, backgroundColor: theme.bg }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                          {editorAudio.length > 0 && <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Feather name="mic" size={14} color={theme.textSub} /><Text style={{ fontSize: 12, fontWeight: "800", color: theme.textSub }}>{editorAudio.length}</Text></View>}
                          {editorImageUris.length > 0 && <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Feather name="image" size={14} color={theme.textSub} /><Text style={{ fontSize: 12, fontWeight: "800", color: theme.textSub }}>{editorImageUris.length}</Text></View>}
                          <Text style={{ fontSize: 11, fontWeight: "700", color: theme.textSub, opacity: 0.5 }}>attached</Text>
                        </View>
                        <Feather name={mediaCollapsed ? "chevron-down" : "chevron-up"} size={16} color={theme.textSub} />
                      </TouchableOpacity>
                      {!mediaCollapsed && (
                        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                          {editorAudio.length > 0 && (
                            <View style={{ gap: 8, marginBottom: editorImageUris.length > 0 ? 12 : 0, marginTop: 8 }}>
                              {editorAudio.map((memo, idx) => {
                                const memoIsRtl = isRtl(memo.name);
                                return (
                                  <View key={memo.id} style={{ backgroundColor: theme.surface, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.border, gap: 10 }}>
                                    <TextInput value={memo.name} onChangeText={(txt) => { const newArr = [...editorAudio]; newArr[idx].name = txt; setEditorAudio(newArr); }} style={[{ color: theme.textMain, fontSize: 15, fontWeight: "700", textAlign: memoIsRtl ? "right" : "left", writingDirection: memoIsRtl ? "rtl" : "ltr", paddingVertical: 2 }, persianSafeInputStyle]} placeholder="Name this voice memo..." placeholderTextColor={theme.textSub} />
                                    <AudioPlayer uri={memo.uri} durationStr={memo.duration} theme={theme} activeAudioUri={activeAudioUri} setActiveAudioUri={setActiveAudioUri} />
                                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4, borderTopWidth: 1, borderTopColor: theme.border }}>
                                      <View style={{ flexDirection: "row", gap: 16 }}>
                                        <TouchableOpacity onPress={() => moveAudio(idx, "up")} disabled={idx === 0} style={{ opacity: idx === 0 ? 0.2 : 1 }} hitSlop={10}><Feather name="chevron-up" size={16} color={theme.textSub} /></TouchableOpacity>
                                        <TouchableOpacity onPress={() => moveAudio(idx, "down")} disabled={idx === editorAudio.length - 1} style={{ opacity: idx === editorAudio.length - 1 ? 0.2 : 1 }} hitSlop={10}><Feather name="chevron-down" size={16} color={theme.textSub} /></TouchableOpacity>
                                      </View>
                                      <TouchableOpacity onPress={() => {
                                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                                        setConfirmModal({ title: "Delete Voice Memo", message: `Permanently delete "${memo.name || "Voice Memo"}"? This cannot be undone.`, label: "Delete", onConfirm: () => { setEditorAudio((p) => p.filter((m) => m.id !== memo.id)); setConfirmModal(null); } });
                                      }} hitSlop={10}><Feather name="trash-2" size={16} color={theme.danger} /></TouchableOpacity>
                                    </View>
                                  </View>
                                );
                              })}
                            </View>
                          )}
                          {editorImageUris.length > 0 && (
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, marginTop: editorAudio.length > 0 ? 0 : 8 }}>
                              {editorImageUris.map((uri, idx) => (
                                <View key={`${uri}-${idx}`} style={{ alignItems: "center" }}>
                                  <TouchableOpacity activeOpacity={0.8} onPress={() => setViewingImages({ uris: editorImageUris, index: idx })}>
                                    <Image source={{ uri }} contentFit="cover" style={{ width: 80, height: 80, borderRadius: 12, backgroundColor: theme.border }} />
                                  </TouchableOpacity>
                                  {editorImageUris.length > 1 && (
                                    <View style={{ flexDirection: "row", justifyContent: "center", gap: 4, marginTop: 6 }}>
                                      <TouchableOpacity disabled={idx === 0} onPress={() => { const arr = [...editorImageUris]; [arr[idx], arr[idx - 1]] = [arr[idx - 1], arr[idx]]; setEditorImageUris(arr); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, justifyContent: "center", alignItems: "center", opacity: idx === 0 ? 0.2 : 1 }}><Feather name="chevron-left" size={12} color={theme.textSub} /></TouchableOpacity>
                                      <TouchableOpacity disabled={idx === editorImageUris.length - 1} onPress={() => { const arr = [...editorImageUris]; [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]; setEditorImageUris(arr); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, justifyContent: "center", alignItems: "center", opacity: idx === editorImageUris.length - 1 ? 0.2 : 1 }}><Feather name="chevron-right" size={12} color={theme.textSub} /></TouchableOpacity>
                                    </View>
                                  )}
                                  <TouchableOpacity onPress={() => {
                                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                                    setConfirmModal({ title: "Remove Image", message: "Remove this image from the note?", label: "Remove", onConfirm: () => { setEditorImageUris((p) => p.filter((_, i) => i !== idx)); setConfirmModal(null); } });
                                  }} style={{ position: "absolute", top: -6, right: -6, backgroundColor: theme.surface, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: theme.border }}><Feather name="x" size={12} color={theme.textMain} /></TouchableOpacity>
                                </View>
                              ))}
                            </ScrollView>
                          )}
                        </View>
                      )}
                    </View>
                  )}

                  {/* Template picker for new empty notes */}
                  {!editingId && !noteText.trim() && !noteTitle.trim() && (
                    <View style={{ paddingTop: 8, paddingBottom: 8 }}>
                      <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12, paddingHorizontal: 24 }}>Start with a template</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 8 }}>
                        {TEMPLATES.map((t) => (
                          <TouchableOpacity key={t.name} onPress={() => applyTemplate(t)} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.bg, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.border }}>
                            <Feather name={t.icon as any} size={14} color={theme.textSub} />
                            <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: "700" }}>{t.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* Body text. minHeight keeps the TextInput at a stable size
                      regardless of line count — without it, the input grows
                      line-by-line and the parent ScrollView's contentSize
                      shifts on every keystroke that wraps, which reads as
                      visible "jumping" of everything above. */}
                  <TextInput
                    // Deliberately NO writingDirection / textAlign on the body
                    // input. A single TextInput can only have one base direction
                    // at the OS level, so any direction we set (whether by
                    // first-line, dominant, or cursor-line) would make ALL
                    // paragraphs visually re-flow whenever the active state
                    // changes — which is exactly the "two flips to rtl when
                    // you type سه" jumping the user reported.
                    // Unicode BiDi still flows Persian characters right-to-left
                    // within each paragraph automatically; we only lose
                    // per-paragraph alignment (everything anchors to the
                    // input's edge). The reader/preview render per-paragraph
                    // alignment correctly, so the moment the user closes the
                    // editor the note shows up as expected.
                    style={[s.bodyInput, { color: theme.textMain, minHeight: 320 }, persianSafeInputStyle]}
                    multiline value={noteText} onChangeText={setNoteText}
                    placeholder="Start typing..." placeholderTextColor={theme.textSub}
                    onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
                    onFocus={() => { if (editorImageUris.length > 0 || editorAudio.length > 0) setMediaCollapsed(true); }}
                    scrollEnabled={false}
                  />
                  {/* Small bottom slack; KeyboardAwareScrollView itself lifts the
                      focused caret above the keyboard (bottomOffset above). */}
                  <View style={{ height: isKeyboardOpen ? 80 : 40 }} />
                </KeyboardAwareScrollView>
              </SafeAreaView>
            </View>
            </KeyboardProvider>
          </Modal>

          {/* DIARY ENTRY ACTIONS — long-press on a diary entry opens this
              compact sheet with Edit and Delete. We don't offer archive
              here because diary entries are private memory, not workflow
              items that benefit from a separate "set aside" state. */}
          <Modal visible={!!diaryActionTarget} transparent animationType="fade" onRequestClose={() => setDiaryActionTarget(null)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
              <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={() => setDiaryActionTarget(null)} />
              <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: Math.max(insets.bottom, 16) + 12 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 18 }} />
                <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '900', letterSpacing: 1.5, marginBottom: 12 }}>
                  DIARY ENTRY
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    const target = diaryActionTarget;
                    setDiaryActionTarget(null);
                    if (target) setTimeout(() => openMoodComposer(target), 50);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16, borderRadius: 14, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, marginBottom: 10 }}
                >
                  <Feather name="edit-3" size={18} color={theme.textMain} />
                  <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 15 }}>Edit</Text>
                </TouchableOpacity>
                {/* Full editor — the path to add/replace photos & voice memos, which
                    the Mood-door composer (text + feeling) intentionally leaves out. */}
                <TouchableOpacity
                  onPress={() => {
                    const target = diaryActionTarget;
                    setDiaryActionTarget(null);
                    if (target) setTimeout(() => openNoteSheet(target), 50);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16, borderRadius: 14, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, marginBottom: 10 }}
                >
                  <Feather name="image" size={18} color={theme.textMain} />
                  <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 15 }}>Photos &amp; voice</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    const target = diaryActionTarget;
                    setDiaryActionTarget(null);
                    if (target) {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                      setConfirmModal({
                        title: 'Delete this entry?',
                        message: 'The text, photos, and voice memos in this diary entry will be permanently removed.',
                        label: 'Delete',
                        onConfirm: () => {
                          // Clean up disk-backed media (same path deleteForever takes)
                          target.imageUris?.forEach(uri => deleteAsync(uri, { idempotent: true }).catch(() => {}));
                          target.audio?.forEach(memo => deleteAsync(memo.uri, { idempotent: true }).catch(() => {}));
                          deleteNote(target.id);
                          setConfirmModal(null);
                        },
                      });
                    }
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16, borderRadius: 14, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, marginBottom: 18 }}
                >
                  <Feather name="trash-2" size={18} color={theme.danger} />
                  <Text style={{ color: theme.danger, fontWeight: '800', fontSize: 15 }}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setDiaryActionTarget(null)}
                  style={{ paddingVertical: 14, alignItems: 'center', borderRadius: 14, backgroundColor: theme.textMain }}
                >
                  <Text style={{ color: theme.bg, fontWeight: '900', fontSize: 14 }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* MOOD-DOOR DIARY COMPOSER — the new-entry + edit surface for the diary. */}
          <MoodDiaryComposer
            visible={!!moodComposer}
            initial={composerInitial}
            isDark={isDarkMode}
            moods={MOOD_OPTIONS}
            recentMoods={recentDiaryMoods}
            dateLabel={formatDiaryDate(moodComposer?.initial?.entryDate ?? moodComposer?.initial?.createdAt ?? Date.now())}
            onClose={() => setMoodComposer(null)}
            onSubmit={persistDiaryEntry}
          />

          {/* DIARY BACKDATE PICKER — sets editorEntryDate from a calendar.
              Past dates are exactly the point (writing about a day after the
              fact); the future is blocked because diary entries are
              memories, not plans. */}
          {/* DIARY SETTINGS SHEET — diary-only preferences. Currently houses
              the biometric lock toggle. Anything else diary-specific (export,
              On-This-Day cadence, future stats) belongs here too so the
              diary doesn't pollute the app-wide settings surface. */}
          <Modal visible={diarySettingsVisible} animationType="fade" transparent onRequestClose={() => setDiarySettingsVisible(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
              <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={() => setDiarySettingsVisible(false)} />
              <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 32 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 18 }} />
                <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: '900', letterSpacing: -0.4, marginBottom: 4 }}>Diary settings</Text>
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginBottom: 20 }}>
                  Tied to this device. Defers all auth to your phone&apos;s lock system.
                </Text>
                <View style={{ backgroundColor: theme.bg, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name={diaryLocked ? 'lock' : 'unlock'} size={16} color={theme.textMain} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 14, marginBottom: 2 }}>Lock diary</Text>
                    <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600' }}>
                      Biometric or device PIN required to enter diary mode.
                    </Text>
                  </View>
                  <Switch
                    value={diaryLocked}
                    onValueChange={async (next) => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      // Turning lock ON: confirm hardware/enrollment so users
                      // don't enable a setting they can't satisfy. If their
                      // device has no biometrics enrolled, leave the toggle
                      // off and surface a one-line explanation.
                      if (next) {
                        try {
                          const hasHardware = await LocalAuthentication.hasHardwareAsync();
                          const enrolled = await LocalAuthentication.isEnrolledAsync();
                          if (!hasHardware || !enrolled) {
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                            setConfirmModal({
                              title: 'No biometric set up',
                              message: 'Set up Face ID, Touch ID, or a device PIN in your phone settings first, then come back to enable this.',
                              label: 'OK',
                              onConfirm: () => setConfirmModal(null),
                            });
                            return;
                          }
                        } catch { /* fall through and just enable */ }
                      } else {
                        // Turning lock OFF: clear the cached auth so a
                        // re-enable doesn't silently inherit the existing
                        // session's auth — make the user re-prove next time.
                        diaryAuthedRef.current = false;
                      }
                      setDiaryLocked(next);
                    }}
                    trackColor={{ true: theme.textMain }}
                    thumbColor="#FFF"
                  />
                </View>
                {/* Export diary — single markdown bundle with YAML
                    frontmatter per entry. Anti-lock-in trust feature. The
                    OS share sheet appears so the user can save to Files,
                    Drive, or send themselves. */}
                <TouchableOpacity
                  onPress={async () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    const all = useAppStore.getState().notes;
                    const res = await exportNotesAsMarkdown(all, 'diary');
                    if (!res.ok) {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                      setConfirmModal({
                        title: 'Export failed',
                        message: res.reason,
                        label: 'OK',
                        onConfirm: () => setConfirmModal(null),
                      });
                    }
                  }}
                  style={{ backgroundColor: theme.bg, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 }}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="download" size={16} color={theme.textMain} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 14, marginBottom: 2 }}>Export diary</Text>
                    <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600' }}>
                      ZIP with all entries + photos + voice memos.
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={theme.textSub} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setDiarySettingsVisible(false)} style={{ alignItems: 'center', paddingVertical: 14, marginTop: 12 }}>
                  <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '700' }}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* MOOD PICKER — five vibe icons in colored bubbles. Uses Feather
              icons (cohesive with the rest of the app — emojis felt like
              shipped Apple defaults, the icon set is ours). Each option
              has a label so the meaning is concrete; storage uses the
              icon name (heart/sun/cloud/cloud-rain/moon) so display is
              a one-liner: just render the icon. */}
          <Modal visible={moodPickerVisible} animationType="fade" transparent onRequestClose={() => setMoodPickerVisible(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
              <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={() => setMoodPickerVisible(false)} />
              <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 32 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 18 }} />
                <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: '900', letterSpacing: -0.4, marginBottom: 4 }}>How was today?</Text>
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginBottom: 24 }}>
                  Optional. A vibe to skim past entries by later.
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  {MOOD_OPTIONS.map(opt => {
                    const selected = editorMood === opt.id;
                    return (
                      <TouchableOpacity
                        key={opt.id}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          setEditorMood(opt.id);
                          setMoodPickerVisible(false);
                        }}
                        style={{ alignItems: 'center', flex: 1 }}
                      >
                        <View
                          style={{
                            width: 52,
                            height: 52,
                            borderRadius: 26,
                            backgroundColor: hexToRgba(opt.color, selected ? 0.25 : 0.12),
                            borderWidth: 2,
                            borderColor: selected ? opt.color : 'transparent',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: 6,
                          }}
                        >
                          <Feather name={opt.icon as any} size={22} color={opt.color} />
                        </View>
                        <Text style={{ color: selected ? theme.textMain : theme.textSub, fontSize: 11, fontWeight: '700', letterSpacing: 0.2 }}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {editorMood && (
                  <TouchableOpacity
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setEditorMood(null); setMoodPickerVisible(false); }}
                    style={{ alignItems: 'center', paddingVertical: 12 }}
                  >
                    <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '700' }}>Clear mood</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </Modal>

          <Modal visible={datePickerVisible} animationType="fade" transparent onRequestClose={() => setDatePickerVisible(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
              <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={() => setDatePickerVisible(false)} />
              {/* Extra bottom padding (insets.bottom + 24) lifts the sheet
                  away from the home indicator / nav bar so the calendar
                  doesn't feel cramped at the screen edge. */}
              <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 20, paddingBottom: Math.max(insets.bottom, 16) + 24 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 16 }} />
                <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: '900', letterSpacing: -0.4, marginBottom: 4 }}>
                  Date for this entry
                </Text>
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginBottom: 16 }}>
                  Backdate a memory to the day it actually happened.
                </Text>
                <CalendarPicker
                  value={(() => {
                    const d = new Date(editorEntryDate ?? Date.now());
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                  })()}
                  onChange={(next) => {
                    const [y, m, d] = next.split('-').map(Number);
                    // Local-midnight timestamp of the selected date — keeps the
                    // entry "about" date aligned with the user's calendar day
                    // regardless of when they actually committed the entry.
                    // Clamp to today's local-midnight as a final safety net in
                    // case CalendarPicker's maxDate gate is ever bypassed.
                    const picked = new Date(y, m - 1, d).getTime();
                    const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
                    const finalMs = Math.min(picked, todayMid.getTime());
                    setEditorEntryDate(finalMs);
                    // If the title is still the auto-generated date string
                    // (i.e. the user hasn't typed anything custom), update
                    // it to match the new date. We detect "auto" by checking
                    // if it parses as a recognised date label — anything
                    // else is the user's own writing and stays untouched.
                    const dt = new Date(finalMs);
                    const autoLabel = calendarType === 'shamsi'
                      ? (() => { const j = g2j(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); return `${j[2]} ${SHAMSI_MONTHS[j[1] - 1]}`; })()
                      : `${dt.getDate()} ${GREGORIAN_MONTHS[dt.getMonth()]}`;
                    const trimmed = noteTitle.trim();
                    const looksAuto =
                      trimmed === '' ||
                      // Heuristic: any "<num> <month-name>" pattern in either
                      // calendar — covers titles auto-generated from the date
                      // chip across calendar toggles within the session.
                      /^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Farvardin|Ordibehesht|Khordad|Tir|Mordad|Shahrivar|Mehr|Aban|Azar|Dey|Bahman|Esfand)$/.test(trimmed);
                    if (looksAuto) setNoteTitle(autoLabel);
                    setDatePickerVisible(false);
                  }}
                  theme={theme}
                  calSystem={calendarType}
                  allowPast
                  maxDate={(() => {
                    const t = new Date();
                    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
                  })()}
                />
              </View>
            </View>
          </Modal>

          {/* TIME CAPSULE SEAL MODAL WITH DUAL CALENDAR DIAL */}
          <Modal visible={isSealing} animationType="fade" transparent={true} onRequestClose={() => setIsSealing(false)}>
            {(() => {
              // Past-date safety lives entirely on the Lock-Capsule button via
              // `isPast` (computed in useMemo from dial → targetMs). The dial
              // itself navigates freely so users can spill day → month → year
              // in either direction without buttons mysteriously disabling.
              return (
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "flex-end" }}>
              <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, borderWidth: 1, borderColor: hexToRgba(artAccent, 0.3) }}>
                
                <View style={{ padding: 32, paddingBottom: 50, paddingTop: 40 }}>
                  <View style={{ alignItems: "center", marginBottom: 24 }}>
                    <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: hexToRgba(artAccent, 0.1), borderWidth: 1, borderColor: hexToRgba(artAccent, 0.25), justifyContent: "center", alignItems: "center", marginBottom: 20 }}>
                      <Feather name="clock" size={30} color={artAccent} />
                    </View>
                    <Text style={{ color: theme.textMain, fontSize: 26, fontWeight: "900", letterSpacing: -0.5, marginBottom: 8 }}>When shall we meet?</Text>
                    <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: "500", textAlign: "center", lineHeight: 22 }}>Select the specific date this note will resurface.</Text>
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 24 }}>
                    <View style={{ flexDirection: 'row', backgroundColor: theme.bg, borderRadius: 100, padding: 4, borderWidth: 1, borderColor: theme.border }}>
                      <TouchableOpacity onPress={toggleCalendarDial} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100, backgroundColor: calType === 'gregorian' ? theme.surface : 'transparent', shadowColor: calType === 'gregorian' ? '#000' : 'transparent', shadowOpacity: 0.1, shadowRadius: 4 }}>
                         <Text style={{ fontWeight: '800', fontSize: 13, color: calType === 'gregorian' ? theme.textMain : theme.textSub }}>Gregorian</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={toggleCalendarDial} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100, backgroundColor: calType === 'jalali' ? theme.surface : 'transparent', shadowColor: calType === 'jalali' ? '#000' : 'transparent', shadowOpacity: 0.1, shadowRadius: 4 }}>
                         <Text style={{ fontWeight: '800', fontSize: 13, color: calType === 'jalali' ? theme.textMain : theme.textSub }}>Shamsi</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={s.dialContainer}>
                    {/* Day / Month / Year all loop and spill into adjacent
                        units: day past month-end → day 1 of next month;
                        month past Dec → year + 1; and reverse for the down
                        chevrons. Past-date safety lives entirely on the
                        Lock-Capsule button (`disabled={isPast}`) so dial
                        navigation can be free in both directions without
                        hidden disables, and day stays clamped to the actual
                        days-in-month of the chosen calendar (no more Feb 31). */}
                    <View style={[s.dialColumn, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                      <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDial(d => {
                        const max = daysInMonth(d.y, d.m, calType);
                        if (d.d < max) return { ...d, d: d.d + 1 };
                        if (d.m < 11) return { ...d, d: 1, m: d.m + 1 };
                        return { d: 1, m: 0, y: d.y + 1 };
                      }); }} hitSlop={15}><Feather name="chevron-up" size={20} color={theme.textSub} /></TouchableOpacity>
                      <Text style={[s.dialValue, { color: theme.textMain }]} adjustsFontSizeToFit numberOfLines={1}>{dial.d}</Text>
                      <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDial(d => {
                        if (d.d > 1) return { ...d, d: d.d - 1 };
                        if (d.m > 0) return { ...d, m: d.m - 1, d: daysInMonth(d.y, d.m - 1, calType) };
                        return { y: d.y - 1, m: 11, d: daysInMonth(d.y - 1, 11, calType) };
                      }); }} hitSlop={15}><Feather name="chevron-down" size={20} color={theme.textSub} /></TouchableOpacity>
                      <Text style={s.dialLabel}>Day</Text>
                    </View>

                    <View style={[s.dialColumn, { backgroundColor: theme.bg, borderColor: theme.border, width: 110 }]}>
                      <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDial(d => {
                        const newY = d.m === 11 ? d.y + 1 : d.y;
                        const newM = d.m === 11 ? 0 : d.m + 1;
                        return { y: newY, m: newM, d: Math.min(d.d, daysInMonth(newY, newM, calType)) };
                      }); }} hitSlop={15}><Feather name="chevron-up" size={20} color={theme.textSub} /></TouchableOpacity>
                      <Text style={[s.dialValue, { color: theme.textMain }]} adjustsFontSizeToFit numberOfLines={1}>{calType === 'gregorian' ? GREGORIAN_MONTHS[dial.m] : SHAMSI_MONTHS[dial.m]}</Text>
                      <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDial(d => {
                        const newY = d.m === 0 ? d.y - 1 : d.y;
                        const newM = d.m === 0 ? 11 : d.m - 1;
                        return { y: newY, m: newM, d: Math.min(d.d, daysInMonth(newY, newM, calType)) };
                      }); }} hitSlop={15}><Feather name="chevron-down" size={20} color={theme.textSub} /></TouchableOpacity>
                      <Text style={s.dialLabel}>Month</Text>
                    </View>

                    <View style={[s.dialColumn, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                      <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDial(d => {
                        const newY = d.y + 1;
                        return { ...d, y: newY, d: Math.min(d.d, daysInMonth(newY, d.m, calType)) };
                      }); }} hitSlop={15}><Feather name="chevron-up" size={20} color={theme.textSub} /></TouchableOpacity>
                      <Text style={[s.dialValue, { color: theme.textMain }]} adjustsFontSizeToFit numberOfLines={1}>{dial.y}</Text>
                      <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDial(d => {
                        const newY = d.y - 1;
                        return { ...d, y: newY, d: Math.min(d.d, daysInMonth(newY, d.m, calType)) };
                      }); }} hitSlop={15}><Feather name="chevron-down" size={20} color={theme.textSub} /></TouchableOpacity>
                      <Text style={s.dialLabel}>Year</Text>
                    </View>
                  </View>

                  <View style={s.daysCounter}>
                    <Text style={[s.daysCounterValue, isPast && { color: theme.textSub, fontSize: 32 }]}>
                      {isPast ? 'Invalid Date' : daysLeft}
                    </Text>
                    <Text style={s.daysCounterLabel}>
                      {isPast ? 'Cannot seal a note in the past' : (daysLeft === 1 ? 'Day of patience' : 'Days of patience')}
                    </Text>
                  </View>

                  {/* The modal now SETS pending-seal state instead of saving
                      immediately. The actual sealing + notification scheduling
                      happen when the user taps Commit on the editor — see the
                      Commit handler below. "Don't seal" only renders when a
                      date was previously chosen this session, giving the user
                      a clean way to back out of the sealing intent without
                      having to close the editor. */}
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <TouchableOpacity onPress={() => setIsSealing(false)} style={{ flex: 1, paddingVertical: 16, borderRadius: 100, backgroundColor: theme.bg, alignItems: "center", borderWidth: 1, borderColor: theme.border }}>
                      <Text style={{ color: theme.textMain, fontWeight: "800", fontSize: 16 }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={isPast}
                      onPress={() => {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        setPendingSealMs(targetMs);
                        setIsSealing(false);
                      }}
                      style={{ flex: 2, paddingVertical: 16, borderRadius: 100, backgroundColor: isPast ? theme.border : artAccent, alignItems: "center" }}
                    >
                      <Text style={{ color: isPast ? theme.textSub : "#FFF", fontWeight: "900", fontSize: 16 }}>{pendingSealMs ? 'Update seal date' : 'Set seal date'}</Text>
                    </TouchableOpacity>
                  </View>
                  {pendingSealMs ? (
                    <TouchableOpacity
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPendingSealMs(null); setIsSealing(false); }}
                      style={{ marginTop: 12, paddingVertical: 12, alignItems: 'center' }}
                    >
                      <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '800' }}>Don&apos;t seal</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            </View>
              );
            })()}
          </Modal>

          {/* READER VIEW (When unsealed) */}
          <Modal visible={!!readingCapsule} animationType="fade" presentationStyle="fullScreen">
           <View style={{ flex: 1, backgroundColor: theme.surface }}>
              <SafeAreaView style={{ flex: 1 }}>
                <TouchableOpacity style={s.closeReader} onPress={() => setReadingCapsule(null)}>
                  <Feather name="x" size={24} color={theme.textMain} />
                </TouchableOpacity>
                <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
                  {readingCapsule && (
                    <View style={[s.readerBase, { backgroundColor: theme.surface, padding: 40 }]}>
                        <View style={{ marginBottom: 30 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                <View style={{ width: 12, height: 2, backgroundColor: artAccent }} />
                                <Text style={s.minimalMeta}>ARCHIVE ENTRY: {formatDisplayDate(readingCapsule.createdAt, calendarType)}</Text>
                            </View>
                            <Text style={[s.minimalTitle, { color: theme.textMain }]}>{readingCapsule.title}</Text>
                        </View>
                        
                        <View style={{ flexDirection: 'row', gap: 20 }}>
                            <View style={{ flex: 1 }}>
                                <RichTextContent text={readingCapsule.content} color={theme.textMain} isExpanded={true} theme={theme} />
                            </View>
                        </View>
                    </View>
                  )}
                </ScrollView>
              </SafeAreaView>
           </View>
          </Modal>

          {/* SNAPSHOT FULL READER */}
          <Modal visible={!!viewingSnapshot} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setViewingSnapshot(null)}>
            {viewingSnapshot && (
              <View style={{ flex: 1, backgroundColor: theme.bg }}>
                <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                    <TouchableOpacity onPress={() => setViewingSnapshot(null)} hitSlop={15} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Feather name="chevron-left" size={22} color={theme.textMain} />
                      <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: "700" }}>History</Text>
                    </TouchableOpacity>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Feather name="clock" size={14} color={theme.textSub} />
                      <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: "700" }}>
                        {formatDisplayDate(viewingSnapshot.savedAt, calendarType)} • {new Date(viewingSnapshot.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    </View>
                  </View>
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingBottom: 80 }}>
                    {viewingSnapshot.title ? (
                      <Text style={{ color: theme.textMain, fontSize: 32, fontWeight: "900", letterSpacing: -1, lineHeight: 38, marginBottom: 20 }}>{viewingSnapshot.title}</Text>
                    ) : null}
                    <View style={{ width: 32, height: 3, backgroundColor: artAccent, borderRadius: 2, marginBottom: 24, opacity: 0.5 }} />
                    <RichTextContent text={viewingSnapshot.content} color={artAccent} isExpanded={true} theme={theme} />
                  </ScrollView>
                  <SafeAreaView edges={["bottom"]} style={{ backgroundColor: theme.bg }}>
                    <View style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingHorizontal: 24, paddingVertical: 14, alignItems: "center" }}>
                      <TouchableOpacity onPress={() => {
                        setViewingSnapshot(null);
                        setConfirmModal({
                          title: "Restore Version", message: "Replace current content with this version? Your current content will be saved in history.",
                          label: "Restore", isSuccess: true,
                          onConfirm: () => { if (historyNote) handleRestoreSnapshot(historyNote.id, viewingSnapshot); setConfirmModal(null); },
                        });
                      }} style={{ backgroundColor: artAccent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 100 }}>
                        <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 14 }}>Restore this version</Text>
                      </TouchableOpacity>
                    </View>
                  </SafeAreaView>
                </SafeAreaView>
              </View>
            )}
          </Modal>

          {/* GROUP MANAGEMENT MODAL */}
          <Modal visible={!!groupModal} transparent animationType="fade" onRequestClose={() => setGroupModal(null)}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 }}>
              <View style={{ backgroundColor: theme.surface, width: "100%", maxWidth: 340, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.border }}>
                <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: "900", marginBottom: 4 }}>Manage Group</Text>
                <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: "600", marginBottom: 20 }}>&quot;{groupModal?.group}&quot;</Text>
                <TextInput
                  value={renameText}
                  onChangeText={setRenameText}
                  placeholder="New name..."
                  placeholderTextColor={theme.textSub}
                  style={[{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, fontWeight: "700", color: theme.textMain, marginBottom: 16 }, persianSafeInputStyle, rtlInputStyle(renameText)]}
                  autoFocus
                />
                <View style={{ gap: 8 }}>
                  <TouchableOpacity onPress={handleRenameGroup} style={{ paddingVertical: 14, borderRadius: 12, alignItems: "center", backgroundColor: theme.textMain }}>
                    <Text style={{ color: theme.bg, fontWeight: "900", fontSize: 14 }}>Rename</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleDeleteGroup} style={{ paddingVertical: 14, borderRadius: 12, alignItems: "center", backgroundColor: hexToRgba(theme.danger, 0.1) }}>
                    <Text style={{ color: theme.danger, fontWeight: "800", fontSize: 14 }}>Remove Group (keep notes)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setGroupModal(null)} style={{ paddingVertical: 14, borderRadius: 12, alignItems: "center" }}>
                    <Text style={{ color: theme.textSub, fontWeight: "800", fontSize: 14 }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* NARRATOR TOAST */}
          {narratorToast && (
            <Animated.View entering={FadeInDown.duration(600).springify()} style={{ position: "absolute", bottom: 100, left: 24, right: 24, zIndex: 999, backgroundColor: theme.surface, borderRadius: 16, paddingHorizontal: 20, paddingVertical: 16, borderWidth: 1, borderColor: hexToRgba(artAccent, 0.3), shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 16, elevation: 8 }}>
              <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: "600", fontStyle: "italic", textAlign: "center", lineHeight: 22 }}>{narratorToast}</Text>
            </Animated.View>
          )}

          {/* VERSION HISTORY MODAL */}
          <Modal visible={!!historyNote} animationType="fade" transparent onRequestClose={() => setHistoryNote(null)}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "flex-end" }}>
              <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, maxHeight: "80%", borderWidth: 1, borderColor: theme.border }}>
                <View style={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.border }}>
                  <View>
                    <Text style={{ fontSize: 22, fontWeight: "900", color: theme.textMain, letterSpacing: -0.5 }}>History</Text>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: theme.textSub, marginTop: 2 }}>{historyNote?.history?.length || 0} previous version{(historyNote?.history?.length || 0) !== 1 ? "s" : ""}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setHistoryNote(null)} hitSlop={15}><Feather name="x" size={22} color={theme.textMain} /></TouchableOpacity>
                </View>
                <ScrollView contentContainerStyle={{ padding: 24, gap: 16, paddingBottom: 50 }}>
                  {historyNote?.history?.map((snap: NoteSnapshot, idx: number) => {
                    const snapDate = new Date(snap.savedAt);
                    const label = `${formatDisplayDate(snap.savedAt, calendarType)} • ${snapDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
                    return (
                      <TouchableOpacity key={idx} activeOpacity={0.7} onPress={() => setViewingSnapshot(snap)} style={{ backgroundColor: theme.bg, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: theme.border }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <Text style={{ fontSize: 10, fontWeight: "800", color: theme.textSub, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
                          <TouchableOpacity onPress={() => {
                            setConfirmModal({
                              title: "Restore Version", message: "Replace current content with this version? Your current content will be saved in history.",
                              label: "Restore", isSuccess: true,
                              onConfirm: () => { handleRestoreSnapshot(historyNote!.id, snap); setConfirmModal(null); },
                            });
                          }} style={{ backgroundColor: hexToRgba(artAccent, 0.1), paddingHorizontal: 14, paddingVertical: 6, borderRadius: 100 }}>
                            <Text style={{ color: artAccent, fontWeight: "800", fontSize: 12 }}>Restore</Text>
                          </TouchableOpacity>
                        </View>
                        {snap.title ? <Text style={{ color: theme.textMain, fontSize: 16, fontWeight: "900", marginBottom: 8, letterSpacing: -0.3 }} numberOfLines={1}>{snap.title}</Text> : null}
                        <Text style={{ color: theme.textSub, fontSize: 14, lineHeight: 22, fontWeight: "500" }} numberOfLines={8}>{snap.content}</Text>
                        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: "700", marginTop: 10, opacity: 0.5 }}>Tap to read full version</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {(!historyNote?.history || historyNote.history.length === 0) && (
                    <View style={{ alignItems: "center", marginTop: 40 }}>
                      <Feather name="clock" size={48} color={theme.textSub} style={{ opacity: 0.15, marginBottom: 16 }} />
                      <Text style={{ color: theme.textSub, fontSize: 15, fontWeight: "700" }}>No history yet.</Text>
                    </View>
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>

          {confirmModal && (
            <CustomConfirmModal
              visible={true} title={confirmModal.title} message={confirmModal.message}
              destructiveLabel={confirmModal.label} isSuccess={confirmModal.isSuccess} theme={theme}
              onCancel={() => setConfirmModal(null)} onConfirm={confirmModal.onConfirm}
            />
          )}

          <BottomSheetModal ref={storageSheetRef} snapPoints={["100%"]} enableDynamicSizing={false} index={0} topInset={insets.top} onChange={setSheetIndex} backdropComponent={renderBackdrop} backgroundStyle={{ backgroundColor: theme.bg, borderRadius: 32 }} handleIndicatorStyle={{ backgroundColor: theme.border, width: 40, height: 5 }}>
            <View style={{ paddingHorizontal: 24, paddingTop: 10, paddingBottom: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 28, fontWeight: "900", color: theme.textMain, letterSpacing: -1 }}>Storage.</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
                {storageTab === "trash" && trashNotes.length > 0 && (<TouchableOpacity onPress={emptyTrash} hitSlop={10}><Text style={{ color: theme.danger, fontWeight: "800", fontSize: 14 }}>Purge all</Text></TouchableOpacity>)}
                <TouchableOpacity onPress={() => storageSheetRef.current?.dismiss()} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="x" size={24} color={theme.textMain} /></TouchableOpacity>
              </View>
            </View>
            <View style={{ paddingHorizontal: 24, marginBottom: 20 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {(["archived", "trash", "capsules"] as const).map((t) => (
                  <TouchableOpacity key={t} onPress={() => setStorageTab(t)} style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, backgroundColor: storageTab === t ? theme.textMain : theme.surface, borderWidth: 1, borderColor: theme.border }}>
                    <Text style={{ color: storageTab === t ? theme.bg : theme.textSub, fontWeight: "800", fontSize: 13, textTransform: "capitalize" }}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
              {storageTab === "trash" && trashNotes.length === 0 ? (
                <View style={{ alignItems: "center", marginTop: 80 }}><Feather name="trash" size={64} color={theme.textSub} style={{ opacity: 0.15, marginBottom: 20 }} /><Text style={{ color: theme.textSub, fontSize: 15, fontWeight: "700" }}>Trash is empty.</Text></View>
              ) : null}
              {storageTab === "archived" && archivedNotes.length === 0 ? (
                <View style={{ alignItems: "center", marginTop: 80 }}><Feather name="archive" size={64} color={theme.textSub} style={{ opacity: 0.15, marginBottom: 20 }} /><Text style={{ color: theme.textSub, fontSize: 15, fontWeight: "700" }}>Archive is empty.</Text></View>
              ) : null}
              {storageTab === "capsules" && storageCapsules.length === 0 ? (
                <View style={{ alignItems: "center", marginTop: 80 }}><Feather name="book-open" size={64} color={theme.textSub} style={{ opacity: 0.15, marginBottom: 20 }} /><Text style={{ color: theme.textSub, fontSize: 15, fontWeight: "700" }}>No consumed memories yet.</Text></View>
              ) : null}

              {/* Render Standard Archived/Trash Notes (Protecting Sealed Items) */}
              {(storageTab === "trash" ? trashNotes : storageTab === "archived" ? archivedNotes : []).map((n: Note) => {
                if (n.isSealed) {
                    return (
                      <View key={n.id} style={{ backgroundColor: theme.bg, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: hexToRgba(artAccent, 0.4), flexDirection: "row", alignItems: "center" }}>
                        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: hexToRgba(artAccent, 0.15), justifyContent: 'center', alignItems: 'center', marginRight: 16 }}>
                          <Feather name="lock" size={18} color={artAccent} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.textMain, fontSize: 16, fontWeight: "900", letterSpacing: -0.5 }}>Sealed Object</Text>
                          <Text style={{ color: artAccent, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginTop: 4 }}>ENCRYPTED</Text>
                        </View>
                        <View style={{ flexDirection: "row", gap: 12 }}>
                          <TouchableOpacity onPress={() => updateNoteStatus(n.id, "active")} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} style={{ padding: 8, backgroundColor: theme.surface, borderRadius: 8 }}><Feather name="refresh-ccw" size={16} color={theme.success} /></TouchableOpacity>
                          <TouchableOpacity onPress={() => deleteForever(n.id)} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} style={{ padding: 8, backgroundColor: theme.surface, borderRadius: 8 }}><Feather name="x" size={16} color={theme.danger} /></TouchableOpacity>
                        </View>
                      </View>
                    );
                }

                return (
                  <View key={n.id} style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: theme.border, borderLeftWidth: 4, borderLeftColor: n.color, flexDirection: "row", alignItems: "center" }}>
                    <View style={{ flex: 1, paddingRight: 16 }}>
                      <Text style={{ color: theme.textMain, fontSize: 16, fontWeight: "800" }} numberOfLines={1}>{n.title || "Untitled Thought"}</Text>
                      <Text style={{ color: theme.textSub, fontSize: 12, marginTop: 4 }} numberOfLines={1}>{n.content}</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <TouchableOpacity onPress={() => updateNoteStatus(n.id, "active")} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} style={{ padding: 8, backgroundColor: theme.bg, borderRadius: 8 }}><Feather name="refresh-ccw" size={16} color={theme.success} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteForever(n.id)} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} style={{ padding: 8, backgroundColor: theme.bg, borderRadius: 8 }}><Feather name="x" size={16} color={theme.danger} /></TouchableOpacity>
                    </View>
                  </View>
                );
              })}

              {/* Render Consumed Capsules with Invisible Long-Press Delete */}
              {storageTab === "capsules" && storageCapsules.map((n: Note) => (
                <TouchableOpacity 
                  key={n.id} 
                  onPress={() => setReadingCapsule(n)} 
                  onLongPress={() => {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                      setConfirmModal({ 
                          title: "Obliterate Memory", 
                          message: "Permanently delete this consumed Time Capsule? This action cannot be undone.", 
                          label: "Obliterate", 
                          onConfirm: () => { deleteNote(n.id); setConfirmModal(null); } 
                      });
                  }}
                  delayLongPress={2000}
                  style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: theme.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                >
                   <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>ARCHIVED MEMORY</Text>
                      <Text style={{ color: theme.textMain, fontSize: 18, fontWeight: "900", letterSpacing: -0.5 }} numberOfLines={1}>{n.title}</Text>
                   </View>
                   <Feather name="book-open" size={20} color={theme.textSub} />
                </TouchableOpacity>
              ))}
            </BottomSheetScrollView>
          </BottomSheetModal>
        </SafeAreaView>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  toolBtn: { padding: 10, backgroundColor: "rgba(150,150,150,0.1)", borderRadius: 10, flexDirection: "row", alignItems: "center" },
  divider: { width: 1, height: 16, backgroundColor: "#333", marginHorizontal: 4 },
  titleInput: { fontSize: 34, fontWeight: "900", marginBottom: 4 },
  catInput: { fontSize: 16, fontWeight: "700" },
  bodyInput: { paddingHorizontal: 24, paddingTop: 24, fontSize: 18, fontWeight: "500", lineHeight: 30, textAlignVertical: "top" as const },

  // Custom Dial 
  dialContainer: { flexDirection: 'row', gap: 20, justifyContent: 'center', width: '100%' },
  dialColumn: { alignItems: 'center', width: 85, paddingVertical: 15, borderRadius: 20, borderWidth: 1 },
  dialValue: { fontSize: 18, fontWeight: '800', marginVertical: 10 },
  dialLabel: { fontSize: 10, fontWeight: '700', color: '#BBB', textTransform: 'uppercase' },
  daysCounter: { marginVertical: 30, alignItems: 'center' },
  daysCounterValue: { fontSize: 56, fontWeight: '900', color: artAccent, letterSpacing: -2 },
  daysCounterLabel: { fontSize: 14, color: '#888', fontWeight: '700' },

  // Reader Modal Styles
  readerBase: { flex: 1, minHeight: 800 },
  closeReader: { position: 'absolute', top: 20, right: 20, zIndex: 10, padding: 15, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 30 },
  
  minimalMeta: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5, color: '#6B7280' },
  minimalTitle: { fontSize: 38, fontWeight: '900', letterSpacing: -1.5, lineHeight: 42 },
});