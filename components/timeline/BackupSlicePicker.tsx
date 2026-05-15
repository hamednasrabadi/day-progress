/**
 * BackupSlicePicker — shared selection UI for export AND import.
 *
 * Five tabs (Timeline / Tasks / Habits / Goals / Notes), each with sub-items.
 * Power users tap individual rows; casual users hit the per-tab Select-all
 * toggle. Tab labels show "selected/total" so coverage is glanceable without
 * opening every tab.
 *
 * Caller-controlled selection (controlled component pattern):
 *   - `selected` + `onToggle`: standard.
 *   - `onTabSetAll`: caller adds/removes the whole tab's available keys.
 *   - `getValue(key)`: caller supplies whatever value drives the count display
 *     (export: live store state; import: payload from the file).
 *   - `isAvailable(key)`: caller decides whether a key is actionable. Unavail
 *     rows are dropped; tabs whose keys are entirely unavailable dim out.
 */

import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import {
  TAB_GROUPS, KEY_LABELS, describeCount,
  type BackupKey,
} from '../../lib/backup';
import type { Theme } from '../../lib/timelineTheme';
import { hexToRgba } from '../../lib/timelineTheme';

export function BackupSlicePicker({
  theme, isDarkMode,
  selected, onToggle, onTabSetAll,
  getValue, isAvailable,
}: {
  theme: Theme;
  isDarkMode: boolean;
  selected: Set<BackupKey>;
  onToggle: (key: BackupKey) => void;
  onTabSetAll: (keys: BackupKey[], turnOn: boolean) => void;
  getValue: (key: BackupKey) => any;
  isAvailable: (key: BackupKey) => boolean;
}) {
  const [activeTab, setActiveTab] = useState<string>(TAB_GROUPS[0].id);
  const tab = TAB_GROUPS.find(t => t.id === activeTab) ?? TAB_GROUPS[0];

  // Per-tab selection counts — computed for ALL tabs so the strip can show
  // "TIMELINE · 4/6" without re-opening each tab. Keys that aren't available
  // (e.g. absent from an import payload) don't count toward the total —
  // otherwise tabs would look "incomplete" because their data wasn't in the
  // file.
  const tabCounts = TAB_GROUPS.map(t => {
    const avail = t.keys.filter(isAvailable);
    const sel = avail.filter(k => selected.has(k));
    return { id: t.id, total: avail.length, sel: sel.length };
  });

  const availableKeys = tab.keys.filter(isAvailable);
  const allTabSelected = availableKeys.length > 0 && availableKeys.every(k => selected.has(k));

  return (
    <>
      {/* Tab strip */}
      <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 16, marginBottom: 12 }}>
        {TAB_GROUPS.map(t => {
          const c = tabCounts.find(x => x.id === t.id)!;
          const isActive = t.id === activeTab;
          const empty = c.total === 0;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveTab(t.id); }}
              disabled={empty}
              style={{
                flex: 1, paddingVertical: 8, borderRadius: 8,
                backgroundColor: isActive ? theme.textMain : (isDarkMode ? '#111' : theme.bg),
                alignItems: 'center',
                opacity: empty ? 0.35 : 1,
              }}
            >
              <Text style={{
                color: isActive ? theme.bg : theme.textSub,
                fontSize: 9, fontWeight: '900', letterSpacing: 0.5,
              }}>{t.label.toUpperCase()}</Text>
              <Text style={{
                color: isActive ? theme.bg : theme.textSub,
                fontSize: 9, fontWeight: '700', marginTop: 1, opacity: 0.85,
              }}>{c.sel}/{c.total}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Per-tab Select-all toggle (only when there's something to select) */}
      {availableKeys.length > 0 && (
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onTabSetAll(availableKeys, !allTabSelected); }}
          activeOpacity={0.7}
          style={{
            marginHorizontal: 16, marginBottom: 8,
            paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10,
            backgroundColor: allTabSelected ? hexToRgba(theme.textMain, isDarkMode ? 0.14 : 0.08) : 'transparent',
            borderWidth: 1, borderColor: theme.border,
            flexDirection: 'row', alignItems: 'center', gap: 10,
          }}
        >
          <View style={{
            width: 16, height: 16, borderRadius: 4,
            borderWidth: 1.5, borderColor: allTabSelected ? theme.textMain : theme.border,
            backgroundColor: allTabSelected ? theme.textMain : 'transparent',
            alignItems: 'center', justifyContent: 'center',
          }}>
            {allTabSelected && <Feather name="check" size={10} color={theme.bg} />}
          </View>
          <Text style={{ flex: 1, color: theme.textMain, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>
            {allTabSelected ? `EVERYTHING IN ${tab.label.toUpperCase()}` : `SELECT ALL IN ${tab.label.toUpperCase()}`}
          </Text>
        </TouchableOpacity>
      )}

      {/* Sub-items */}
      <ScrollView style={{ flex: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        {availableKeys.length === 0 ? (
          <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '500', fontStyle: 'italic', opacity: 0.7, paddingHorizontal: 8, paddingVertical: 12 }}>
            Nothing to show in this section.
          </Text>
        ) : availableKeys.map((key, idx) => {
          const checked = selected.has(key);
          return (
            <TouchableOpacity
              key={key}
              activeOpacity={0.7}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onToggle(key); }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                paddingVertical: 11, paddingHorizontal: 8,
                borderBottomWidth: idx < availableKeys.length - 1 ? 1 : 0,
                borderBottomColor: theme.border,
              }}
            >
              <View style={{
                width: 18, height: 18, borderRadius: 5,
                borderWidth: 1.5, borderColor: checked ? theme.textMain : theme.border,
                backgroundColor: checked ? theme.textMain : 'transparent',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {checked && <Feather name="check" size={11} color={theme.bg} />}
              </View>
              <Text style={{ flex: 1, color: theme.textMain, fontSize: 13, fontWeight: '700' }}>
                {KEY_LABELS[key]}
              </Text>
              <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700' }}>
                {describeCount(key, getValue(key))}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </>
  );
}
