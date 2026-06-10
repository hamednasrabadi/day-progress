/**
 * IntentComposer — the add surface at the top of the intent block. Collapsed,
 * it's a slim "Add an intent" button (keeps the block compact); tapping expands
 * an inline composer: pick a category (Custom / Task / Habit / Goal), then type
 * or tap a source. It STAYS OPEN after each add so you can add several in a row
 * — the header chevron collapses it, and it auto-collapses when the selected day
 * changes. Promoted from the Lab "Expand-in-place" study (bake-off winner).
 *
 * Reads the store directly (same pattern as IntentPanel). The "Goal" category is
 * gated behind the Challenges full-unlock, exactly as IntentAddModal was: shown
 * only when allFeaturesUnlocked || challengesUnlocked. Already-linked sources are
 * filtered out per date so one source can't become two intents on the same day.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import type { Theme } from '../lib/timelineTheme';
import { hexToRgba } from '../lib/timelineTheme';
import { rtlInputStyle, rtlTextStyle, persianSafeInputStyle } from '../lib/rtl';
import { useAppStore } from '../store/useAppStore';
import { useFocusEffect } from 'expo-router';

type Category = 'custom' | 'task' | 'habit' | 'challenge';

export function IntentComposer({
  theme, isDarkMode, targetDate, maxLabelLen,
}: {
  theme: Theme;
  isDarkMode: boolean;
  targetDate: string;
  maxLabelLen: number;
}) {
  const tasks               = useAppStore(s => s.tasks);
  const habits              = useAppStore(s => s.habits);
  const challenges          = useAppStore(s => s.challenges);
  const intents             = useAppStore(s => s.intents);
  const addIntent           = useAppStore(s => s.addIntent);
  const challengesUnlocked  = useAppStore(s => s.challengesUnlocked);
  const allFeaturesUnlocked = useAppStore(s => s.allFeaturesUnlocked);
  const goalUnlocked = allFeaturesUnlocked || challengesUnlocked;

  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<Category>('custom');
  const [draft, setDraft] = useState('');

  // Collapse + reset whenever the selected day changes ("close on day switch").
  useEffect(() => { setOpen(false); setCat('custom'); setDraft(''); }, [targetDate]);
  // Also collapse when the Habits tab loses focus (switching nav tabs), so it's
  // never still expanded when you come back.
  useFocusEffect(useCallback(() => {
    return () => { setOpen(false); setCat('custom'); setDraft(''); };
  }, []));

  // (sourceType:sourceId) pairs already linked on this date — excluded from the
  // pickers so the same source can't become two intents on one day.
  const takenKey = useMemo(() => {
    const set = new Set<string>();
    for (const i of intents) {
      if (i.date !== targetDate || !i.sourceType || !i.sourceId) continue;
      set.add(`${i.sourceType}:${i.sourceId}`);
    }
    return set;
  }, [intents, targetDate]);

  const availableTasks = useMemo(() => tasks.filter(t => (t.status === 'active' || !t.status) && !takenKey.has(`task:${t.id}`)), [tasks, takenKey]);
  const availableHabits = useMemo(() => habits.filter(h => h.status === 'active' && !takenKey.has(`habit:${h.id}`)), [habits, takenKey]);
  const availableChallenges = useMemo(() => challenges.filter(c => c.deadState === 'active' && !takenKey.has(`challenge:${c.id}`)), [challenges, takenKey]);

  // Persistent: adding clears the field but leaves the panel open so you can add
  // several in a row.
  const commit = (label: string, sourceType?: 'task' | 'habit' | 'challenge', sourceId?: string) => {
    const text = label.trim();
    if (!text) return;
    const now = Date.now();
    addIntent({
      id: `int_${now}_${Math.random().toString(36).slice(2, 6)}`,
      date: targetDate,
      label: text,
      completed: false,
      sourceType,
      sourceId,
      pushCount: 0,
      createdAt: now,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDraft('');
  };

  const collapse = () => { Keyboard.dismiss(); setOpen(false); setCat('custom'); setDraft(''); };

  const CATS: { key: Category; label: string }[] = [
    { key: 'custom', label: 'Custom' },
    { key: 'task', label: 'Task' },
    { key: 'habit', label: 'Habit' },
  ];
  if (goalUnlocked) CATS.push({ key: 'challenge', label: 'Goal' });

  const sourceItems =
    cat === 'task' ? availableTasks.map(t => ({ id: t.id, label: t.text, color: t.color, type: 'task' as const }))
    : cat === 'habit' ? availableHabits.map(h => ({ id: h.id, label: h.title, color: h.color, type: 'habit' as const }))
    : cat === 'challenge' ? availableChallenges.map(c => ({ id: c.id, label: c.title, color: c.color, type: 'challenge' as const }))
    : [];

  const emptyHint = cat === 'task' ? 'No active tasks. Add one in Tasks, or use Custom.'
    : cat === 'habit' ? 'No active habits.'
    : 'No active goals.';

  // ── Collapsed: a slim "Add an intent" button — keeps the block compact. ──
  if (!open) {
    return (
      <TouchableOpacity
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setOpen(true); }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: theme.border }}
      >
        <Feather name="plus" size={16} color={theme.textMain} />
        <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '700' }}>Add an intent</Text>
      </TouchableOpacity>
    );
  }

  // ── Expanded: category tabs + composer, persistent across adds. ──
  return (
    <View style={{ gap: 12 }}>
      <TouchableOpacity onPress={collapse} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Feather name="chevron-down" size={17} color={theme.textMain} />
        <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '800' }}>What&apos;s today for?</Text>
      </TouchableOpacity>

      {/* Category selector — Custom / Task / Habit / Goal (Goal gated). */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {CATS.map(c => {
          const active = cat === c.key;
          return (
            <TouchableOpacity
              key={c.key}
              onPress={() => { if (c.key === cat) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCat(c.key); setDraft(''); if (c.key !== 'custom') Keyboard.dismiss(); }}
              style={{ flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center', backgroundColor: active ? theme.textMain : (isDarkMode ? '#111' : theme.bg), borderWidth: 1, borderColor: active ? theme.textMain : theme.border }}
            >
              <Text style={{ color: active ? theme.bg : theme.textSub, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {cat === 'custom' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="What's today for?"
            placeholderTextColor={theme.textSub}
            maxLength={maxLabelLen}
            autoFocus
            onSubmitEditing={() => commit(draft)}
            returnKeyType="done"
            style={[{
              flex: 1, backgroundColor: isDarkMode ? '#111' : theme.bg,
              color: theme.textMain, paddingVertical: 10, paddingHorizontal: 14,
              borderRadius: 11, fontSize: 14.5, fontWeight: '500',
              borderWidth: 1, borderColor: theme.border,
            }, persianSafeInputStyle, rtlInputStyle(draft)]}
          />
          <TouchableOpacity
            onPress={() => commit(draft)}
            disabled={!draft.trim()}
            style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: theme.textMain, alignItems: 'center', justifyContent: 'center', opacity: draft.trim() ? 1 : 0.35 }}
          >
            <Feather name="arrow-up" size={19} color={theme.bg} />
          </TouchableOpacity>
        </View>
      ) : sourceItems.length === 0 ? (
        <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '500', fontStyle: 'italic', opacity: 0.7, paddingVertical: 4 }}>{emptyHint}</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
          {sourceItems.map(s => (
            <TouchableOpacity
              key={s.id}
              onPress={() => commit(s.label, s.type, s.id)}
              activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: theme.border, backgroundColor: hexToRgba(s.color, 0.10) }}
            >
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: s.color }} />
              <Text style={[{ color: theme.textMain, fontSize: 13, fontWeight: '700', maxWidth: 170 }, rtlTextStyle(s.label)]} numberOfLines={1}>{s.label}</Text>
              <Feather name="plus" size={12} color={theme.textSub} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
