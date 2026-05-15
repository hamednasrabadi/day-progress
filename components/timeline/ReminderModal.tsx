/**
 * ReminderModal — quick "remind me" capture sheet.
 *
 * Tapped from the bell icon in Timeline's header. Layout, top to bottom:
 *   1. Pending list — every reminder still in the future, with a tap-to-cancel
 *      [×]. The list is the only place a user can review and back out of a
 *      reminder, so cancel has to be a single tap.
 *   2. Text input — "Remind me to…". Multiline, capped at 200 chars.
 *   3. WHEN — two ways to pick the fire time:
 *        a. Quick chips (5m, 15m, 30m, 1h, 2h, 4h) for "in a bit" cases.
 *        b. A 24-hour HH:MM clock input for "at exactly 8pm" cases. Times in
 *           the past auto-roll to tomorrow.
 *      The two pickers are mutually exclusive — picking one un-selects the
 *      other. A live preview line under the picker reflects whichever mode is
 *      currently active ("Pings at 20:00 — in 2h 35m.").
 *   4. Sticky-bottom Cancel / Set buttons. KeyboardAvoidingView pins them
 *      flush above the keyboard top, matching IntentAddModal.
 *
 * The fire moment is hard-capped at 24 hours out: anything longer is a
 * planning horizon and Timeline blocks already cover that.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import type { Reminder } from '../../store/useAppStore';
import type { Theme } from '../../lib/timelineTheme';
import { hexToRgba } from '../../lib/timelineTheme';
import { rtlInputStyle, rtlTextStyle, persianSafeInputStyle } from '../../lib/rtl';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const PRESETS: { label: string; minutes: number }[] = [
  { label: '5m',  minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h',  minutes: 60 },
  { label: '2h',  minutes: 120 },
  { label: '4h',  minutes: 240 },
];

const MAX_MINUTES = 24 * 60;   // 24h hard cap.
const MIN_MINUTES = 1;
const MAX_TEXT_LEN = 200;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// Mask a string to a valid HH:MM (24h) — same algorithm BlockEditModal uses for
// start/end time fields. Auto-inserts the colon after two digits, caps HH at 23
// and MM at 59, and lets the user backspace through the colon cleanly.
function sanitizeTimeInput(raw: string, prev: string): string {
  const digits = raw.replace(/[^0-9]/g, '').slice(0, 4);
  if (digits.length === 0) return '';
  if (digits.length === 1) return digits;
  let hh = digits.slice(0, 2);
  if (parseInt(hh, 10) > 23) hh = '23';
  if (digits.length === 2) {
    if (raw.length < prev.length && !raw.includes(':')) return hh;
    return `${hh}:`;
  }
  let mm = digits.slice(2, 4);
  if (parseInt(mm, 10) > 59) mm = '59';
  return `${hh}:${mm}`;
}

// Parse a fully-typed HH:MM into [hours, minutes], or null if not valid yet.
function parseHHMM(s: string): [number, number] | null {
  const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(s);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return [h, min];
}

// Format a duration in minutes as a short relative string ("45m", "1h 5m").
function formatDuration(totalMinutes: number): string {
  if (totalMinutes < 1) return '<1m';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Format an absolute fire-moment relative to now ("in 5m", "in 1h 20m", "in 2d").
// Used in the pending list. Reminders past their fire time briefly say "fired"
// before the prune pass removes them.
function formatRelative(fireAt: number): string {
  const ms = fireAt - Date.now();
  if (ms < -2_000) return 'fired';
  if (ms < 60_000) return 'in <1m';
  return `in ${formatDuration(Math.round(ms / 60_000))}`;
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

type WhenMode = 'quick' | 'time';

export function ReminderModal({
  visible, onClose, theme, isDarkMode, insetsBottom, reminders, onAdd, onRemove,
  sheetBottomPadStyle,
}: {
  visible: boolean;
  onClose: () => void;
  theme: Theme;
  isDarkMode: boolean;
  insetsBottom: number;
  reminders: Reminder[];
  onAdd: (text: string, minutes: number) => void;
  onRemove: (id: string) => void;
  sheetBottomPadStyle?: any;
}) {
  const [text, setText] = useState('');
  // Mode tracks which picker the user last touched. The live preview + Set
  // button always read from the active mode; the inactive picker stays as the
  // user left it so they can switch back without re-entering values.
  const [mode, setMode] = useState<WhenMode>('quick');
  const [quickMinutes, setQuickMinutes] = useState<number>(15);
  const [timeStr, setTimeStr] = useState('');

  // Reset on every open. Pending list is read live from the store regardless.
  useEffect(() => {
    if (visible) {
      setText('');
      setMode('quick');
      setQuickMinutes(15);
      setTimeStr('');
    }
  }, [visible]);

  const sortedReminders = useMemo(
    () => [...reminders].sort((a, b) => a.fireAt - b.fireAt),
    [reminders]
  );

  // Compute the fire moment from current picker state. Recomputed on every
  // render so the preview and validity update as the clock advances (and as
  // the user types).
  const fireMoment = useMemo<{ fireAt: number; minutesAhead: number; rolledToTomorrow: boolean } | null>(() => {
    if (mode === 'quick') {
      const fa = Date.now() + quickMinutes * 60_000;
      return { fireAt: fa, minutesAhead: quickMinutes, rolledToTomorrow: false };
    }
    const parsed = parseHHMM(timeStr);
    if (!parsed) return null;
    const [h, m] = parsed;
    const target = new Date();
    target.setHours(h, m, 0, 0);
    let rolled = false;
    // Roll to tomorrow if the time is already in the past (or within 30s of
    // now — picking the current time should land on tomorrow, otherwise the
    // reminder fires in 0s and feels broken).
    if (target.getTime() <= Date.now() + 30_000) {
      target.setDate(target.getDate() + 1);
      rolled = true;
    }
    const fa = target.getTime();
    return { fireAt: fa, minutesAhead: Math.round((fa - Date.now()) / 60_000), rolledToTomorrow: rolled };
  }, [mode, quickMinutes, timeStr]);

  const fireValid = !!fireMoment && fireMoment.minutesAhead >= MIN_MINUTES && fireMoment.minutesAhead <= MAX_MINUTES;
  const overCap = !!fireMoment && fireMoment.minutesAhead > MAX_MINUTES;

  // Picker handlers — flipping mode also keeps the inactive picker's state.
  const pickQuick = (m: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setQuickMinutes(m);
    setMode('quick');
  };

  const onTimeChange = (next: string) => {
    setTimeStr((prev) => sanitizeTimeInput(next, prev));
    setMode('time');
  };

  // Submit. Re-derives fireAt from current state at click time so the actual
  // scheduled value isn't off by however many ms the user spent admiring the
  // sheet before tapping.
  const handleSave = () => {
    if (!text.trim()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (!fireMoment || !fireValid) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onAdd(text.trim(), Math.max(MIN_MINUTES, fireMoment.minutesAhead));
    onClose();
  };

  // ─── PREVIEW LINE ──
  // What the user will see for "this is what's about to happen". One source
  // of truth — the live `fireMoment`. We render either a placeholder (when
  // text is empty), an out-of-range warning, or a confirmation.
  const previewLine = useMemo(() => {
    if (!text.trim()) return { text: 'Type what you want to be reminded of.', tone: 'muted' as const };
    if (mode === 'time' && !fireMoment) return { text: 'Enter a time as HH:MM (24h).', tone: 'muted' as const };
    if (overCap) return { text: 'Cap is 24 hours — set a Timeline block for that.', tone: 'warn' as const };
    if (!fireValid || !fireMoment) return { text: 'Pick at least 1 minute ahead.', tone: 'warn' as const };
    if (mode === 'quick') {
      return { text: `Pings in ${formatDuration(fireMoment.minutesAhead)}.`, tone: 'ok' as const };
    }
    const d = new Date(fireMoment.fireAt);
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const dayWord = fireMoment.rolledToTomorrow ? 'tomorrow' : 'today';
    return { text: `Pings ${dayWord} at ${hh}:${mm} — in ${formatDuration(fireMoment.minutesAhead)}.`, tone: 'ok' as const };
  }, [text, mode, fireMoment, fireValid, overCap]);

  const previewColor =
    previewLine.tone === 'warn' ? '#E5484D' :
    previewLine.tone === 'ok'   ? theme.textMain :
    theme.textSub;

  // Animated wrapper if parent passed in keyboard padding style.
  const Sheet: any = sheetBottomPadStyle ? Animated.View : View;
  const sheetExtra = sheetBottomPadStyle ?? null;

  // Time-input visual states
  const timeFocused = mode === 'time';
  const timeBorderColor =
    timeFocused
      ? (fireValid ? theme.textMain : (timeStr.length > 0 ? '#E5484D' : theme.textMain))
      : theme.border;

  const setDisabled = !text.trim() || !fireValid;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Sheet
          style={[
            { backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 16, paddingBottom: Math.max(insetsBottom, 12) + 12, maxHeight: '90%' },
            sheetExtra,
          ]}
        >
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 16 }} />

          <View style={{ paddingHorizontal: 22, marginBottom: 16 }}>
            <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 }}>Remind me.</Text>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* PENDING — only shown when something's actually pending. Header
                count makes it scannable; tap × to cancel. */}
            {sortedReminders.length > 0 && (
              <View style={{ marginBottom: 22 }}>
                <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 8 }}>
                  PENDING ({sortedReminders.length})
                </Text>
                <View style={{ backgroundColor: isDarkMode ? '#111' : theme.bg, borderRadius: 14, overflow: 'hidden' }}>
                  {sortedReminders.map((r, i) => (
                    <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: i === sortedReminders.length - 1 ? 0 : 1, borderBottomColor: theme.border }}>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={[{ color: theme.textMain, fontSize: 14, fontWeight: '700' }, rtlTextStyle(r.text)]} numberOfLines={2}>
                          {r.text}
                        </Text>
                        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '600', marginTop: 2 }}>
                          {formatRelative(r.fireAt)}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRemove(r.id); }}
                        hitSlop={10}
                        style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, justifyContent: 'center', alignItems: 'center' }}
                      >
                        <Feather name="x" size={14} color={theme.textSub} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* TEXT INPUT — what to remind. Counter overlays the bottom-right
                so it doesn't take up its own row. */}
            <View style={{ position: 'relative', marginBottom: 20 }}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Remind me to…"
                placeholderTextColor={theme.border}
                style={[{
                  backgroundColor: isDarkMode ? '#111' : theme.bg,
                  color: theme.textMain,
                  paddingHorizontal: 14,
                  paddingTop: 12,
                  paddingBottom: 12,
                  paddingRight: 50,
                  borderRadius: 12,
                  minHeight: 52,
                  maxHeight: 120,
                  fontSize: 15,
                  fontWeight: '500',
                  lineHeight: 20,
                  borderWidth: 1,
                  borderColor: theme.border,
                }, persianSafeInputStyle, rtlInputStyle(text)]}
                multiline
                maxLength={MAX_TEXT_LEN}
                returnKeyType="done"
                blurOnSubmit
              />
              {text.length > 0 && (
                <View
                  pointerEvents="none"
                  style={{ position: 'absolute', bottom: 6, right: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: hexToRgba(theme.surface, 0.92) }}
                >
                  <Text style={{ color: MAX_TEXT_LEN - text.length <= 20 ? '#F43F5E' : theme.textSub, fontSize: 10, fontWeight: '800' }}>
                    {MAX_TEXT_LEN - text.length}
                  </Text>
                </View>
              )}
            </View>

            {/* WHEN — two pickers. Quick chips for "in a bit"; HH:MM input for
                "at exactly 8pm". Whichever one was last touched is the active
                mode and drives the preview line + the actual scheduled time. */}
            <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }}>WHEN</Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {PRESETS.map(p => {
                const active = mode === 'quick' && quickMinutes === p.minutes;
                return (
                  <TouchableOpacity
                    key={p.minutes}
                    onPress={() => pickQuick(p.minutes)}
                    style={{
                      flexGrow: 1, flexBasis: '30%',
                      paddingVertical: 12, borderRadius: 10,
                      backgroundColor: active ? theme.textMain : (isDarkMode ? '#111' : theme.bg),
                      alignItems: 'center',
                      borderWidth: 1, borderColor: active ? theme.textMain : theme.border,
                    }}
                  >
                    <Text style={{ color: active ? theme.bg : theme.textSub, fontWeight: '800', fontSize: 13 }}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* OR AT TIME — small label + HH:MM input. Tapping the input
                flips mode='time' even if the field is empty, so users see
                the preview update to "Enter a time as HH:MM" guidance. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.border, opacity: 0.6 }} />
              <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }}>OR AT</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.border, opacity: 0.6 }} />
            </View>

            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setMode('time')}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                backgroundColor: isDarkMode ? '#111' : theme.bg,
                borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
                borderWidth: 1, borderColor: timeBorderColor,
                marginBottom: 12,
              }}
            >
              <Feather name="clock" size={16} color={mode === 'time' ? theme.textMain : theme.textSub} />
              <TextInput
                value={timeStr}
                onChangeText={onTimeChange}
                onFocus={() => setMode('time')}
                placeholder="HH:MM (24h, e.g. 20:00)"
                placeholderTextColor={hexToRgba(theme.textSub, 0.6)}
                keyboardType="number-pad"
                returnKeyType="done"
                maxLength={5}
                style={{ flex: 1, color: theme.textMain, fontSize: 18, fontWeight: '800', padding: 0, letterSpacing: 1 }}
              />
              {timeStr.length > 0 && (
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTimeStr(''); }}
                  hitSlop={8}
                >
                  <Feather name="x-circle" size={16} color={theme.textSub} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </ScrollView>

          {/* STICKY-BOTTOM: live preview + actions. Lives outside the
              ScrollView so KeyboardAvoidingView pins it flush above the
              keyboard. The preview always reflects the active mode. */}
          <View style={{ paddingHorizontal: 22, paddingTop: 10 }}>
            <Text style={{ color: previewColor, fontSize: 12, fontWeight: '700', marginBottom: 12, marginLeft: 2 }} numberOfLines={2}>
              {previewLine.text}
            </Text>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={onClose}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: isDarkMode ? '#111' : theme.bg, borderWidth: 1, borderColor: theme.border }}
              >
                <Text style={{ color: theme.textMain, fontWeight: '800', fontSize: 14 }}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={setDisabled}
                style={{ flex: 2, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: setDisabled ? theme.border : theme.textMain }}
              >
                <Text style={{ color: setDisabled ? theme.textSub : theme.bg, fontWeight: '900', fontSize: 14 }}>
                  Set reminder
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Sheet>
      </KeyboardAvoidingView>
    </Modal>
  );
}
