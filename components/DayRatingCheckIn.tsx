/**
 * DayRatingCheckIn — the end-of-day "how did today go?" check-in.
 *
 * Rehomed from the Timeline (app/(tabs)/index.tsx) to Habits home: a cheap,
 * on-brand daily growth signal. Three buttons map onto the store's 3-state
 * DayRating (rough / ok / strong) with word labels (Off / Steady / Strong).
 * Once today is rated it collapses to a compact pill with tap-to-change.
 * Reads dayLog + its mutators straight from the store; the host gates it to
 * "today is selected" and mounts it as the day's closing bookend.
 *
 * Moved, not rewritten — same UI + copy as the Timeline original. The one thing
 * not carried over: index.tsx repositioned this element high after 9 PM, which
 * was a Timeline-hero-layout concern; here it simply lives where it's mounted.
 */

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { Theme } from '../lib/timelineTheme';
import { hexToRgba } from '../lib/timelineTheme';
import { useAppStore, type DayRating } from '../store/useAppStore';

export function DayRatingCheckIn({ theme, isDarkMode, todayStr }: {
  theme: Theme;
  isDarkMode: boolean;
  todayStr: string;
}) {
  const dayLog = useAppStore(s => s.dayLog);
  const logDayRating = useAppStore(s => s.logDayRating);
  const setDayLog = useAppStore(s => s.setDayLog);

  const currentRating = dayLog[todayStr];
  // Word-label vocabulary mapped onto the existing 3-state DayRating schema.
  const RATINGS: { r: DayRating; label: string; color: string }[] = [
    { r: 'rough',  label: 'Off',    color: '#F43F5E' },
    { r: 'ok',     label: 'Steady', color: '#F59E0B' },
    { r: 'strong', label: 'Strong', color: '#10B981' },
  ];

  // Compact pill — once today's rated, collapse to a single line with a
  // tap-to-change affordance (tapping clears the rating).
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
            onPress={() => {
              logDayRating(todayStr, r);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }}
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
}
