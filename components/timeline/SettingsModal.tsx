/**
 * SettingsModal — Timeline settings sheet.
 *
 * Three sections of preferences (Appearance / Notifications / End of Week /
 * Display) plus a Backup section with three actions (Export everything /
 * Selective export / Import). Most settings are written directly to the store
 * by the rows themselves; backup actions are passed in as callbacks because
 * they coordinate with picker modals that live in TimelineScreen.
 *
 * Settings flags are read directly from the store (not via props) — this
 * avoids prop-drilling 8+ values from the parent and lets the modal re-render
 * independently of TimelineScreen on a setting change.
 */

import React from 'react';
import { Modal, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useAppStore } from '../../store/useAppStore';
import type { Theme } from '../../lib/timelineTheme';
import { requestTimelinePermissions } from '../../lib/timelineNotifications';

export function SettingsModal({
  visible, onClose, theme, isDarkMode, insetsBottom,
  onExportEverything, onSelectiveExport, onImport,
}: {
  visible: boolean;
  onClose: () => void;
  theme: Theme;
  isDarkMode: boolean;
  insetsBottom: number;
  onExportEverything: () => void;
  onSelectiveExport: () => void;
  onImport: () => void;
}) {
  // Settings flags + setters — pulled from store directly so a flag toggle
  // doesn't bubble a re-render up to TimelineScreen.
  const toggleThemeGlobal      = useAppStore(s => s.toggleTheme);
  const globalNotifsEnabled    = useAppStore(s => s.globalNotifsEnabled);
  const setGlobalNotifsEnabled = useAppStore(s => s.setGlobalNotifsEnabled);
  const ongoingBlockEnabled    = useAppStore(s => s.ongoingBlockEnabled) ?? true;
  const setOngoingBlockEnabled = useAppStore(s => s.setOngoingBlockEnabled);
  const preNotifOffset         = useAppStore(s => s.preNotifOffset);
  const setPreNotifOffset      = useAppStore(s => s.setPreNotifOffset);
  const endOfWeekDay           = useAppStore(s => s.endOfWeekDay);
  const setEndOfWeekDay        = useAppStore(s => s.setEndOfWeekDay);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: Math.max(insetsBottom, 16) + 12, maxHeight: '92%' }}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 20 }} />
          <Text style={{ color: theme.textMain, fontSize: 20, fontWeight: '900', marginBottom: 24 }}>Settings</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* APPEARANCE */}
            <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 8 }}>APPEARANCE</Text>
            <View style={{ backgroundColor: isDarkMode ? '#111' : theme.bg, borderRadius: 14, marginBottom: 22 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Feather name={isDarkMode ? 'moon' : 'sun'} size={16} color={theme.textMain} />
                  <Text style={{ color: theme.textMain, fontWeight: '700', fontSize: 14 }}>Dark Mode</Text>
                </View>
                <Switch value={isDarkMode} onValueChange={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleThemeGlobal(); }} trackColor={{ true: theme.textMain }} thumbColor="#FFF" />
              </View>
            </View>

            {/* NOTIFICATIONS */}
            <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 8 }}>NOTIFICATIONS</Text>
            <View style={{ backgroundColor: isDarkMode ? '#111' : theme.bg, borderRadius: 14, marginBottom: 12 }}>
              {/* Block Alerts — pre-start + start pings. */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Feather name="bell" size={16} color={theme.textMain} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.textMain, fontWeight: '700', fontSize: 14 }}>Block Alerts</Text>
                    <Text style={{ color: theme.textSub, fontSize: 11, marginTop: 2 }}>Pre-start ping + start ping</Text>
                  </View>
                </View>
                <Switch value={globalNotifsEnabled} onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setGlobalNotifsEnabled(v); if (v) requestTimelinePermissions(); }} trackColor={{ true: theme.textMain }} thumbColor="#FFF" />
              </View>
              {/* Now Playing — pinned ongoing notification. */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Feather name="radio" size={16} color={theme.textMain} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.textMain, fontWeight: '700', fontSize: 14 }}>Now Playing</Text>
                    <Text style={{ color: theme.textSub, fontSize: 11, marginTop: 2 }}>Pinned notification for the active block</Text>
                  </View>
                </View>
                <Switch value={ongoingBlockEnabled} onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setOngoingBlockEnabled(v); if (v) requestTimelinePermissions(); }} trackColor={{ true: theme.textMain }} thumbColor="#FFF" />
              </View>
            </View>

            {/* PRE-ALERT OFFSET — indented under Notifications, dimmed when Block Alerts off. */}
            <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10, opacity: globalNotifsEnabled ? 1 : 0.35 }}>PRE-ALERT OFFSET</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 22, opacity: globalNotifsEnabled ? 1 : 0.35 }} pointerEvents={globalNotifsEnabled ? 'auto' : 'none'}>
              {[5, 10, 15, 20, 30].map(m => (
                <TouchableOpacity key={m} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPreNotifOffset(m); }}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: preNotifOffset === m ? theme.textMain : (isDarkMode ? '#111' : theme.bg), alignItems: 'center', borderWidth: 1, borderColor: preNotifOffset === m ? theme.textMain : theme.border }}>
                  <Text style={{ color: preNotifOffset === m ? theme.bg : theme.textSub, fontWeight: '800', fontSize: 12 }}>{m}m</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* WEEKLY REFLECTION — Friday/Saturday end-of-week selection.
                Only two options on purpose — the reflection ritual is a "weekend
                bookend" and Wednesdays-as-end-of-week is more flexibility than
                the feature actually wants. */}
            <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10 }}>END OF WEEK</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 22 }}>
              {(['friday', 'saturday'] as const).map(d => (
                <TouchableOpacity
                  key={d}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setEndOfWeekDay(d); }}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: endOfWeekDay === d ? theme.textMain : (isDarkMode ? '#111' : theme.bg), alignItems: 'center', borderWidth: 1, borderColor: endOfWeekDay === d ? theme.textMain : theme.border }}
                >
                  <Text style={{ color: endOfWeekDay === d ? theme.bg : theme.textSub, fontWeight: '800', fontSize: 12, textTransform: 'capitalize' }}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* BACKUP — actions delegated to TimelineScreen because they open
                their own picker modals that live there. */}
            <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 8 }}>BACKUP</Text>
            <View style={{ backgroundColor: isDarkMode ? '#111' : theme.bg, borderRadius: 14, marginBottom: 24 }}>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onExportEverything(); }}
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
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectiveExport(); }}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.border }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <Feather name="filter" size={16} color={theme.textMain} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.textMain, fontWeight: '700', fontSize: 14 }}>Selective export</Text>
                    <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '500', marginTop: 2 }}>Pick which sections to include in the backup file.</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={theme.textSub} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onImport(); }}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <Feather name="upload" size={16} color={theme.textMain} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.textMain, fontWeight: '700', fontSize: 14 }}>Import from file</Text>
                    <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '500', marginTop: 2 }}>Pick a backup JSON. You'll choose what to restore on the next screen.</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={theme.textSub} />
                </View>
              </TouchableOpacity>
            </View>
          </ScrollView>

          <TouchableOpacity onPress={onClose} style={{ backgroundColor: theme.textMain, borderRadius: 14, padding: 16, alignItems: 'center' }}>
            <Text style={{ color: theme.bg, fontWeight: '900', fontSize: 15 }}>Done</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
