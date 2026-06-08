/**
 * SettingsSheet — the app's global settings, rehomed onto Habits home.
 *
 * The calm-pivot cuts the Timeline, which is where Settings used to live
 * (components/timeline/SettingsModal.tsx). This is the surface that survives:
 * it carries only the GLOBAL settings — Appearance, End of Week, Weekly
 * Reflection, Backup, and the day-30 Feature Hunt — and deliberately drops the
 * Timeline-only rows (block alerts, now-playing, pre-alert offset) that die
 * with that tab.
 *
 * It also gives a home to two things the plan parked here: the Weekly Reflection
 * ritual (low-priority, on-demand — no auto-prompt), and the Phase-0-deferred
 * one-tap Export / Import (the per-tab backup picker is gone — Export writes a
 * full backup, Import restores a full backup after a confirm).
 *
 * Reads settings + actions straight from the store (same pattern as the old
 * SettingsModal) so a toggle doesn't bubble a re-render up through Habits.
 */

import React, { useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import type { Theme } from '../lib/timelineTheme';
import { useAppStore } from '../store/useAppStore';
import { useDaysSinceInstall } from '../lib/unlocks';
import { FeatureHunt } from './FeatureHunt';
import { exportBackup, pickAndReadBackup, applyBackup, ALL_KEYS } from '../lib/backup';

export function SettingsSheet({
  visible, onClose, theme, insetsBottom,
}: {
  visible: boolean;
  onClose: () => void;
  theme: Theme;
  insetsBottom: number;
}) {
  // Settings flags + setters — read directly so a toggle re-renders just this
  // sheet, not the whole Habits screen. (Weekly Review moved OUT of Settings —
  // it now surfaces in the Habits tab content during its end-of-week window.)
  const themeMode         = useAppStore(s => s.themeMode);
  const setThemeMode      = useAppStore(s => s.setThemeMode);
  const sovereignAwakened = useAppStore(s => s.sovereignAwakened);
  const endOfWeekDay      = useAppStore(s => s.endOfWeekDay);
  const setEndOfWeekDay   = useAppStore(s => s.setEndOfWeekDay);

  const daysSinceInstall = useDaysSinceInstall();

  const [featureHuntOpen, setFeatureHuntOpen] = useState(false);
  // Transient backup status line + a restore confirmation holding the parsed
  // payload until the user okays the overwrite.
  const [backupNote, setBackupNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{ payload: any; exportedAt?: string } | null>(null);

  // ── Backup ──
  const handleExport = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBackupNote(null);
    const res = await exportBackup(); // no keys = full backup (the one-tap path)
    if (!res.ok) setBackupNote({ kind: 'err', text: res.reason });
  };

  const handleImport = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBackupNote(null);
    const res = await pickAndReadBackup();
    if (!res.ok) {
      if (!res.cancelled) setBackupNote({ kind: 'err', text: res.reason });
      return;
    }
    // Hold the payload behind a confirm — restoring overwrites current data.
    setPendingRestore({ payload: res.payload, exportedAt: res.envelope?.exportedAt });
  };

  const confirmRestore = () => {
    if (!pendingRestore) return;
    // One-tap full restore: every current slice. (Meta — unlock state, counters
    // — always rides along inside applyBackup regardless of the key list.)
    applyBackup(pendingRestore.payload, [...ALL_KEYS]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPendingRestore(null);
    setBackupNote({ kind: 'ok', text: 'Backup restored.' });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: Math.max(insetsBottom, 16) + 12, maxHeight: '92%' }}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 20 }} />
          <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: '900', marginBottom: 24 }}>Settings</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* APPEARANCE — three themes: Light, Dark (graphite), Navy (deep
                blue). Segmented like End of Week; active = inverted fill. */}
            <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }}>APPEARANCE</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 22 }}>
              {([
                { key: 'light', label: 'Light', icon: 'sun' },
                { key: 'dark',  label: 'Dark',  icon: 'moon' },
                { key: 'blue',  label: 'Navy',  icon: 'droplet' },
                { key: 'sovereign', label: 'Sovereign', icon: 'hexagon' },
              ] as const).filter(opt => opt.key !== 'sovereign' || sovereignAwakened).map(opt => {
                const active = themeMode === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setThemeMode(opt.key); }}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: active ? theme.textMain : theme.bg, alignItems: 'center', gap: 5, borderWidth: 1, borderColor: active ? theme.textMain : theme.border }}
                  >
                    <Feather name={opt.icon as any} size={15} color={active ? theme.bg : theme.textSub} />
                    <Text style={{ color: active ? theme.bg : theme.textSub, fontWeight: '800', fontSize: 12 }}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* END OF WEEK — Friday/Sunday. Anchors the weekly progress bar + the
                reflection ritual. Two options on purpose: a weekend bookend
                (Friday for Iranian users, Sunday everywhere else). */}
            <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }}>END OF WEEK</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 22 }}>
              {(['friday', 'sunday'] as const).map(d => (
                <TouchableOpacity
                  key={d}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setEndOfWeekDay(d); }}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: endOfWeekDay === d ? theme.textMain : theme.bg, alignItems: 'center', borderWidth: 1, borderColor: endOfWeekDay === d ? theme.textMain : theme.border }}
                >
                  <Text style={{ color: endOfWeekDay === d ? theme.bg : theme.textSub, fontWeight: '800', fontSize: 12, textTransform: 'capitalize' }}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* BACKUP — one-tap full export / import (the per-tab picker is gone). */}
            <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 8 }}>BACKUP</Text>
            <View style={{ backgroundColor: theme.bg, borderRadius: 14, marginBottom: backupNote ? 8 : 24 }}>
              <TouchableOpacity
                onPress={handleExport}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.border }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <Feather name="download" size={16} color={theme.textMain} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.textMain, fontWeight: '700', fontSize: 14 }}>Export everything</Text>
                    <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '500', marginTop: 2 }}>Save a JSON backup of all your data and settings.</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={theme.textSub} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleImport}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <Feather name="upload" size={16} color={theme.textMain} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.textMain, fontWeight: '700', fontSize: 14 }}>Import from file</Text>
                    <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '500', marginTop: 2 }}>Restore everything from a backup JSON.</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={theme.textSub} />
                </View>
              </TouchableOpacity>
            </View>
            {backupNote && (
              <Text style={{ color: backupNote.kind === 'ok' ? theme.success : theme.danger, fontSize: 12, fontWeight: '700', marginBottom: 22, paddingHorizontal: 4 }}>
                {backupNote.text}
              </Text>
            )}

            {/* Feature Hunt — the depth map. Appears silently at day 30. */}
            {daysSinceInstall >= 30 ? (
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFeatureHuntOpen(true); }}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.bg, borderRadius: 14, padding: 16, marginTop: 4, marginBottom: 8 }}
              >
                <Text style={{ color: theme.textMain, fontWeight: '700', fontSize: 14 }}>The app grows with you.</Text>
                <Feather name="chevron-right" size={16} color={theme.textSub} />
              </TouchableOpacity>
            ) : null}
          </ScrollView>

          <TouchableOpacity onPress={onClose} style={{ backgroundColor: theme.textMain, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 }}>
            <Text style={{ color: theme.bg, fontWeight: '900', fontSize: 15 }}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Feature Hunt depth map — full-screen, opened from the day-30 row. */}
        <FeatureHunt visible={featureHuntOpen} onClose={() => setFeatureHuntOpen(false)} theme={theme} isDarkMode={theme.isDark} />

        {/* ── RESTORE CONFIRM ── restoring overwrites current data, so gate it. */}
        {pendingRestore && (
          <Modal visible transparent animationType="fade" onRequestClose={() => setPendingRestore(null)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
              <View style={{ backgroundColor: theme.surface, borderRadius: 18, padding: 22, borderWidth: 1, borderColor: theme.border }}>
                <Text style={{ color: theme.textMain, fontSize: 18, fontWeight: '900', letterSpacing: -0.4, marginBottom: 10 }}>
                  Restore this backup?
                </Text>
                <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', lineHeight: 19, marginBottom: 18 }}>
                  This replaces your current data with everything in the file. Your unlock progress comes along too.
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => setPendingRestore(null)}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                  >
                    <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '900' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={confirmRestore}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: theme.textMain, alignItems: 'center' }}
                  >
                    <Text style={{ color: theme.bg, fontSize: 12, fontWeight: '900' }}>Restore</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}
