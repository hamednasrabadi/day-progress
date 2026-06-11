/**
 * DepthMap — a depth map of what the app contains.
 *
 * Discovery, not tutorial: it shows WHAT exists, never HOW to unlock it.
 * Appears in Settings only after 30 calendar days from install (the gate
 * lives in SettingsModal; this component just renders the map).
 *
 * Two sections: Discovered (unlocked features, with a one-line description)
 * and Not Yet (locked features, name barely visible, no description, no
 * hints). If everything is unlocked, the lists collapse to a single line:
 * "You found everything."
 *
 * Design note: the prompt specified a light palette (#FFFFFF / gray-900 /
 * gray-500). This app is theme-driven and defaults to dark mode, so a forced
 * white screen would clash with every other surface. We map the prompt's
 * intent onto the app's theme tokens instead — same structure, same hierarchy
 * (full-opacity discovered, barely-there locked), rendered in whatever theme
 * the user is in. Locked names use the dim-text option the prompt allows
 * ("or text-gray-300") rather than a real blur, which RN can't do on inline
 * text cheaply.
 */

import React from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAppStore } from '../store/useAppStore';
import { DEPTH_MAP_ORDER, FEATURE_META } from '../lib/unlocks';
import type { Theme } from '../lib/timelineTheme';

export function DepthMap({
  visible, onClose, theme, isDarkMode,
}: {
  visible: boolean;
  onClose: () => void;
  theme: Theme;
  isDarkMode: boolean;
}) {
  const insets = useSafeAreaInsets();
  const unlockedFeatures = useAppStore(s => s.unlockedFeatures || {});
  const allFeaturesUnlocked = useAppStore(s => s.allFeaturesUnlocked);

  const isUnlk = (id: string) => allFeaturesUnlocked || !!unlockedFeatures[id];
  const discovered = DEPTH_MAP_ORDER.filter(isUnlk);
  const notYet = DEPTH_MAP_ORDER.filter(id => !isUnlk(id));
  const allFound = notYet.length === 0;

  const sectionHeader = (label: string) => (
    <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12, marginTop: 8 }}>
      {label}
    </Text>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 }}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text style={{ color: theme.textMain, fontSize: 24, fontWeight: '900', letterSpacing: -0.5 }}>The app grows with you.</Text>
            <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: '500', marginTop: 6, lineHeight: 20 }}>Some things appear when you&apos;re ready.</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} style={{ paddingTop: 4 }}>
            <Feather name="x" size={24} color={theme.textSub} />
          </TouchableOpacity>
        </View>

        {allFound ? (
          // Everything unlocked — no lists, just the quiet acknowledgement.
          <View style={{ flex: 1, alignItems: 'center', paddingTop: 80 }}>
            <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: '500' }}>You found everything.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 24) + 24 }} showsVerticalScrollIndicator={false}>
            {/* DISCOVERED — full opacity, name + one-line description. */}
            {discovered.length > 0 ? (
              <>
                {sectionHeader('Discovered')}
                {discovered.map(id => {
                  const meta = FEATURE_META[id];
                  if (!meta) return null;
                  return (
                    <View key={id} style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 8 }}>
                      <Text style={{ color: theme.textMain, fontSize: 14, fontWeight: '700' }}>{meta.name}</Text>
                      <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '500', marginTop: 3, lineHeight: 16 }}>{meta.description}</Text>
                    </View>
                  );
                })}
              </>
            ) : null}

            {/* NOT YET — barely-there names, no description, no hints. */}
            {notYet.length > 0 ? (
              <View style={{ marginTop: discovered.length > 0 ? 20 : 0 }}>
                {sectionHeader('Not Yet')}
                {notYet.map(id => {
                  const meta = FEATURE_META[id];
                  if (!meta) return null;
                  return (
                    <View key={id} style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 8 }}>
                      {/* Present but barely there — the dim-text option the
                          prompt allows in place of a blur. */}
                      <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: '700', opacity: 0.22 }}>{meta.name}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
