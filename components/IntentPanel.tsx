/**
 * IntentPanel — "what is today for?", the intent surface.
 *
 * Rehomed from the Timeline (app/(tabs)/index.tsx) to the top of Habits home
 * in the calm-pivot: Habits is the calm entry, and the day's intent is the
 * first thing it should ask. Moved, not rewritten — same display, same
 * add / toggle / push / pull / rethink / edit / drop flow, same copy. Only the
 * host changed.
 *
 * Self-contained: reads intents (+ tasks/habits/challenges for the picker) and
 * its mutators straight from the store, and owns its own modal state, so the
 * host just renders <IntentPanel selectedDateStr=… todayStr=… />. (Same
 * read-the-store-directly pattern as SettingsModal — avoids prop-drilling a
 * dozen actions through Habits.)
 *
 * Today + tomorrow are editable; past days render a read-only mirror — the past
 * is a record. Linked intents still auto-tick when their source (task / habit /
 * challenge) is completed from its own tab, even retroactively.
 *
 * One deliberate deviation from the Timeline original: the drop confirmation is
 * a small inline modal here rather than index.tsx's local `CustomConfirmModal`
 * (which isn't exported). Same "Drop this intent?" copy + behavior.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import type { Theme } from '../lib/timelineTheme';
import { hexToRgba } from '../lib/timelineTheme';
import { rtlInputStyle, rtlTextStyle, persianSafeInputStyle } from '../lib/rtl';
import { useAppStore } from '../store/useAppStore';
import { IntentAddModal } from './timeline/IntentAddModal';

// Matches the Timeline original — intent labels stay short and directive.
const INTENT_LABEL_MAX = 200;

// Add N days to a YYYY-MM-DD string (local calendar), returning YYYY-MM-DD.
// Used to derive "real tomorrow" from today so the editable window is keyed to
// the actual next day, not a selection artifact.
function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function IntentPanel({
  theme, isDarkMode, selectedDateStr, todayStr, insetsBottom,
}: {
  theme: Theme;
  isDarkMode: boolean;
  selectedDateStr: string;
  todayStr: string;
  insetsBottom: number;
}) {
  // ── Store (read directly — same pattern as SettingsModal) ──
  const intents               = useAppStore(s => s.intents);
  const tasks                 = useAppStore(s => s.tasks);
  const habits                = useAppStore(s => s.habits);
  const challenges            = useAppStore(s => s.challenges);
  const addIntent             = useAppStore(s => s.addIntent);
  const toggleIntent          = useAppStore(s => s.toggleIntent);
  const deleteIntent          = useAppStore(s => s.deleteIntent);
  const pushIntentToTomorrow  = useAppStore(s => s.pushIntentToTomorrow);
  const shipIntentBackToToday = useAppStore(s => s.shipIntentBackToToday);
  const updateIntentLabel     = useAppStore(s => s.updateIntentLabel);
  const resetIntentPushCount  = useAppStore(s => s.resetIntentPushCount);

  // ── Local modal state (encapsulated so Habits never sees it) ──
  const [intentModalVisible, setIntentModalVisible] = useState(false);
  // `intentTargetDate` is the YYYY-MM-DD the new intent is pinned to.
  const [intentTargetDate, setIntentTargetDate] = useState<string>('');
  // `intentRethink` holds the id whose 3rd-push rethink prompt is open.
  const [intentRethink, setIntentRethink] = useState<string | null>(null);
  // `intentDetailId` holds the id whose detail sheet is open (cancel/edit/delete).
  const [intentDetailId, setIntentDetailId] = useState<string | null>(null);
  const [intentEditId, setIntentEditId] = useState<string | null>(null);
  const [intentEditDraft, setIntentEditDraft] = useState('');
  // Inline drop confirmation (replaces the Timeline's CustomConfirmModal dep).
  const [confirmDrop, setConfirmDrop] = useState<{ id: string; label: string } | null>(null);

  // Keyboard-aware sheet padding — mirrors index.tsx's sheetBottomPadStyle so
  // the edit sheet rides the keyboard curve instead of jumping.
  const kbAnim = useReanimatedKeyboardAnimation();
  const sheetBottomPadStyle = useAnimatedStyle(() => ({
    paddingBottom: (Math.max(insetsBottom, 16) + 16) * (1 - kbAnim.progress.value),
  }));

  // ── Selected-day derived values ──
  // Intent mode fires on today + tomorrow; past days get the read-only mirror.
  const tomorrowDateStr = useMemo(() => addDaysStr(todayStr, 1), [todayStr]);
  const isTodaySelected = selectedDateStr === todayStr;
  const isTomorrowSelected = selectedDateStr === tomorrowDateStr;
  const showIntentSection = isTodaySelected || isTomorrowSelected;
  const isPastSelected = selectedDateStr < todayStr;

  // Intent items pinned to the SELECTED day. Sorted incomplete-first, then
  // completed; within each group, oldest-first.
  const selectedDayIntents = useMemo(() => {
    if (!showIntentSection) return [];
    const mine = intents.filter(i => i.date === selectedDateStr);
    return [...mine].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return a.createdAt - b.createdAt;
    });
  }, [intents, selectedDateStr, showIntentSection]);
  const selectedDayIntentsDoneCount = useMemo(() => selectedDayIntents.filter(i => i.completed).length, [selectedDayIntents]);

  // Past-day intents — read-only mirror of what the user intended that day.
  const pastDayIntents = useMemo(() => {
    if (!isPastSelected) return [];
    const mine = intents.filter(i => i.date === selectedDateStr);
    return [...mine].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return a.createdAt - b.createdAt;
    });
  }, [intents, selectedDateStr, isPastSelected]);

  // ── Handlers ──
  const openIntentModal = useCallback((date: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIntentTargetDate(date);
    setIntentModalVisible(true);
  }, []);

  // Push wraps the store action with the rethink-prompt check. set() is
  // synchronous in Zustand, so reading back gives the just-pushed value.
  const handlePushIntent = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pushIntentToTomorrow(id);
    const updated = useAppStore.getState().intents.find(i => i.id === id);
    if (updated && updated.pushCount >= 3) setIntentRethink(id);
  }, [pushIntentToTomorrow]);

  const requestDrop = useCallback((id: string) => {
    const item = useAppStore.getState().intents.find(i => i.id === id);
    if (!item) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setConfirmDrop({ id, label: item.label });
  }, []);

  return (
    <>
      {/* ── INTENT (today + tomorrow) ── the calm entry's first question.
           Each row is a checkbox + label + (optional) source-type icon.
           Long-press → detail/drop. Push moves un-checked items to tomorrow;
           3rd push fires the rethink prompt. Only today/tomorrow are editable. */}
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
                  {/* Carried-over chip — only when this item has been pushed at least once. */}
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
                  {/* Push / pull — icon-only (the today/tomorrow context is in the
                      header). Today's un-done items: arrow-right pushes to tomorrow.
                      Tomorrow's un-done items: arrow-left pulls back to today (no
                      counter increment — pulling forward is a correction). */}
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

      {/* ── PAST INTENTS (read-only) ── mirror what the user intended that day.
           Visible only — no toggle, no push, no edit, no delete. The past is a
           record. Linked intents can still be retroactively ticked by completing
           the underlying source from its own tab. */}
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

      {/* ── INTENT ADD MODAL ── Four tabs: Custom / From Tasks / From Habits /
          From Goals. Tapping a source row creates the linked intent and closes;
          Custom requires typing + Add. Already-linked items are filtered out. */}
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
        insetsBottom={insetsBottom}
        sheetBottomPadStyle={sheetBottomPadStyle}
      />

      {/* ── INTENT DETAIL SHEET ── long-press a row. Cancel / Edit / Delete. */}
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
                      // Defer the confirm so the detail sheet's dismiss animation
                      // doesn't race with the new modal.
                      setTimeout(() => requestDrop(id), 50);
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

      {/* ── INTENT EDIT MODAL ── label-only edit launched from the detail sheet.
          Source link is preserved (only the label changes). */}
      {intentEditId && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setIntentEditId(null)}>
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setIntentEditId(null)} />
            <Animated.View style={[{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 16, paddingBottom: Math.max(insetsBottom, 12) + 16, paddingHorizontal: 24 }, sheetBottomPadStyle]}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 18 }} />
              <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 }}>Edit intent.</Text>
              <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', marginBottom: 18 }}>
                Keep it short and directive.
              </Text>
              {/* Input + overlay counter — counter floats over the input's
                  bottom-right so the keyboard can't hide it. maxHeight caps
                  growth so the input scrolls internally instead of pushing the
                  buttons under the keyboard. */}
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

      {/* ── INTENT RETHINK PROMPT ── fires after the 3rd consecutive push. Three
          days running deferred — the moment to ask whether the answer is still
          "tomorrow." */}
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
                  &quot;{item.label}&quot; keeps slipping. Sometimes the answer isn&apos;t tomorrow — drop it, change it, or do it now.
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => {
                      deleteIntent(item.id);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setIntentRethink(null);
                    }}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: hexToRgba('#F43F5E', 0.4), alignItems: 'center' }}
                  >
                    <Text style={{ color: '#F43F5E', fontSize: 12, fontWeight: '900' }}>Drop</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      // Acknowledged the slip — reset the chronic-deferral counter
                      // so the prompt only re-fires if the chain hits 3 again.
                      resetIntentPushCount(item.id);
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

      {/* ── DROP CONFIRM ── inline equivalent of the Timeline's CustomConfirmModal. */}
      {confirmDrop && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setConfirmDrop(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
            <View style={{ backgroundColor: theme.surface, borderRadius: 18, padding: 22, borderWidth: 1, borderColor: theme.border }}>
              <Text style={{ color: theme.textMain, fontSize: 18, fontWeight: '900', letterSpacing: -0.4, marginBottom: 10 }}>
                Drop this intent?
              </Text>
              <Text style={[{ color: theme.textSub, fontSize: 13, fontWeight: '600', lineHeight: 19, marginBottom: 18 }, rtlTextStyle(confirmDrop.label)]}>
                {confirmDrop.label.length > 60 ? confirmDrop.label.slice(0, 60) + '…' : confirmDrop.label}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setConfirmDrop(null)}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                >
                  <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '900' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    deleteIntent(confirmDrop.id);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setConfirmDrop(null);
                  }}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: hexToRgba('#F43F5E', 0.4), alignItems: 'center' }}
                >
                  <Text style={{ color: '#F43F5E', fontSize: 12, fontWeight: '900' }}>Drop</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}
