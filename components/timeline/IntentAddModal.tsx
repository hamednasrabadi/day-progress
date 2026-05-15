/**
 * IntentAddModal — four-tab picker for creating an intent on a given date.
 *   - Custom: free-form label input + Add button (sticky-bottom, keyboard-pinned).
 *   - Tasks / Habits / Goals: tap a row to commit instantly. Label is copied
 *     from the source item; sourceType + sourceId are linked so the intent
 *     auto-ticks when the source completes/progresses.
 *
 * Items already linked as an intent on this date are filtered from the source
 * lists so we don't allow duplicates. Empty source lists show a quiet hint.
 *
 * Top-level component (not nested in TimelineScreen) so it doesn't re-render
 * every time the parent's state changes — only when its own props move.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import type { Theme } from '../../lib/timelineTheme';
import { hexToRgba } from '../../lib/timelineTheme';
import { rtlInputStyle, rtlTextStyle, persianSafeInputStyle } from '../../lib/rtl';
import type { Task, Habit, Challenge, Intent, IntentSourceType } from '../../store/useAppStore';

export type IntentAddPayload =
  | { label: string; sourceType?: undefined; sourceId?: undefined }
  | { label: string; sourceType: IntentSourceType; sourceId: string };

export function IntentAddModal({
  visible, theme, isDarkMode, targetDate, todayStr, tasks, habits, challenges,
  existingIntents, onClose, onAdd, insetsBottom, sheetBottomPadStyle, maxLabelLen,
}: {
  visible: boolean;
  theme: Theme;
  isDarkMode: boolean;
  targetDate: string;
  todayStr: string;
  tasks: Task[];
  habits: Habit[];
  challenges: Challenge[];
  existingIntents: Intent[];
  onClose: () => void;
  onAdd: (payload: IntentAddPayload) => void;
  insetsBottom: number;
  sheetBottomPadStyle: any;
  maxLabelLen: number;
}) {
  const [tab, setTab] = useState<'custom' | 'task' | 'habit' | 'challenge'>('custom');
  const [draft, setDraft] = useState('');

  // Reset to fresh state every time the modal opens.
  useEffect(() => {
    if (visible) { setTab('custom'); setDraft(''); }
  }, [visible]);

  // Pre-compute the set of (sourceType, sourceId) pairs already taken on this
  // date. Cheap O(n) scan; the intent list is small.
  const takenKey = useMemo(() => {
    const s = new Set<string>();
    for (const i of existingIntents) {
      if (i.date !== targetDate || !i.sourceType || !i.sourceId) continue;
      s.add(`${i.sourceType}:${i.sourceId}`);
    }
    return s;
  }, [existingIntents, targetDate]);

  // Available items per tab — filter out trash/archived/dead and already-linked.
  const availableTasks = useMemo(
    () => tasks.filter(t =>
      (t.status === 'active' || !t.status) && !takenKey.has(`task:${t.id}`)
    ),
    [tasks, takenKey]
  );
  const availableHabits = useMemo(
    () => habits.filter(h => h.status === 'active' && !takenKey.has(`habit:${h.id}`)),
    [habits, takenKey]
  );
  const availableChallenges = useMemo(
    () => challenges.filter(c => c.deadState === 'active' && !takenKey.has(`challenge:${c.id}`)),
    [challenges, takenKey]
  );

  const dateLabel = targetDate === todayStr ? 'today' : 'tomorrow';

  const TABS: { key: typeof tab; label: string }[] = [
    { key: 'custom',    label: 'Custom' },
    { key: 'task',      label: 'Task' },
    { key: 'habit',     label: 'Habit' },
    { key: 'challenge', label: 'Goal' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 16, paddingBottom: Math.max(insetsBottom, 12) + 12, maxHeight: '82%' }, sheetBottomPadStyle]}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 18 }} />
          <View style={{ paddingHorizontal: 22, marginBottom: 14 }}>
            <Text style={{ color: theme.textMain, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 }}>
              Add intent for {dateLabel}.
            </Text>
            <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600' }}>
              Pick from what you already have, or write something new.
            </Text>
          </View>

          {/* Tab strip */}
          <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 22, marginBottom: 14 }}>
            {TABS.map(t => (
              <TouchableOpacity
                key={t.key}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTab(t.key); }}
                style={{
                  flex: 1, paddingVertical: 8, borderRadius: 8,
                  backgroundColor: tab === t.key ? theme.textMain : (isDarkMode ? '#111' : theme.bg),
                  borderWidth: 1, borderColor: tab === t.key ? theme.textMain : theme.border,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: tab === t.key ? theme.bg : theme.textSub, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Body — Custom tab gets its input + Add button rendered OUTSIDE this
              ScrollView (see sticky footer below) so the input pins to the keyboard
              top instead of floating in the scroll area. Source-pick tabs render
              their lists here. */}
          {tab !== 'custom' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
            {tab === 'task' ? (
              availableTasks.length === 0 ? (
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '500', fontStyle: 'italic', opacity: 0.7, marginTop: 8 }}>
                  No active tasks to pick from. Add one in the Tasks tab first, or use Custom.
                </Text>
              ) : availableTasks.map(t => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => onAdd({ label: t.text, sourceType: 'task', sourceId: t.id })}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.border }}
                >
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.color }} />
                  <Text style={[{ flex: 1, color: theme.textMain, fontSize: 13, fontWeight: '600' }, rtlTextStyle(t.text)]} numberOfLines={2}>{t.text}</Text>
                  <Feather name="plus" size={13} color={theme.textSub} />
                </TouchableOpacity>
              ))
            ) : tab === 'habit' ? (
              availableHabits.length === 0 ? (
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '500', fontStyle: 'italic', opacity: 0.7, marginTop: 8 }}>
                  No active habits.
                </Text>
              ) : availableHabits.map(h => (
                <TouchableOpacity
                  key={h.id}
                  onPress={() => onAdd({ label: h.title, sourceType: 'habit', sourceId: h.id })}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.border }}
                >
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: h.color }} />
                  <Text style={[{ flex: 1, color: theme.textMain, fontSize: 13, fontWeight: '600' }, rtlTextStyle(h.title)]} numberOfLines={2}>{h.title}</Text>
                  <Feather name="plus" size={13} color={theme.textSub} />
                </TouchableOpacity>
              ))
            ) : (
              availableChallenges.length === 0 ? (
                <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '500', fontStyle: 'italic', opacity: 0.7, marginTop: 8 }}>
                  No active goals.
                </Text>
              ) : availableChallenges.map(c => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => onAdd({ label: c.title, sourceType: 'challenge', sourceId: c.id })}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.border }}
                >
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.color }} />
                  <Text style={[{ flex: 1, color: theme.textMain, fontSize: 13, fontWeight: '600' }, rtlTextStyle(c.title)]} numberOfLines={2}>{c.title}</Text>
                  <Feather name="plus" size={13} color={theme.textSub} />
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
          )}

          {/* Custom tab footer — input + counter + Add button as direct children
              of the modal sheet so when the keyboard rises, KeyboardAvoidingView
              pushes them up to sit flush above the keyboard top (same pattern as
              the quick-add bar in todo.tsx). */}
          {tab === 'custom' && (
            <View style={{ paddingHorizontal: 22, paddingBottom: 4 }}>
              <View style={{ position: 'relative', marginBottom: 10 }}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={`What does ${dateLabel} want to be?`}
                  placeholderTextColor={theme.border}
                  autoFocus
                  maxLength={maxLabelLen}
                  style={[{
                    backgroundColor: isDarkMode ? '#111' : theme.bg,
                    color: theme.textMain, padding: 14, paddingRight: 50, borderRadius: 12,
                    minHeight: 56, maxHeight: 140, fontSize: 15, fontWeight: '500', lineHeight: 20,
                    borderWidth: 1, borderColor: theme.border,
                  }, persianSafeInputStyle, rtlInputStyle(draft)]}
                  multiline
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
                    color: maxLabelLen - draft.length <= 20 ? '#F43F5E' : theme.textSub,
                    fontSize: 10, fontWeight: '800',
                  }}>
                    {maxLabelLen - draft.length}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => { if (draft.trim()) onAdd({ label: draft.trim() }); }}
                disabled={!draft.trim()}
                style={{
                  paddingVertical: 14, borderRadius: 12,
                  backgroundColor: theme.textMain,
                  alignItems: 'center',
                  opacity: draft.trim() ? 1 : 0.4,
                }}
              >
                <Text style={{ color: theme.bg, fontSize: 13, fontWeight: '900', letterSpacing: 0.3 }}>Add</Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
