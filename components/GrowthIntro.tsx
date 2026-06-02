/**
 * GrowthIntro — first-launch expectation-setter for the progressive-unlock
 * model.
 *
 * Shown exactly once, on the very first open (gated on `introSeen` in the
 * store, after hydration so a restored/returning user never sees it). Its
 * whole job is to convert "I can't find feature X → this app is broken →
 * uninstall" into "ah, it reveals itself → let me keep going." One sentence
 * of framing does most of that work.
 *
 * One path: Begin → the gentle unfold. Just dismisses; the progressive-unlock
 * triggers take it from there. (An up-front "unlock everything" fork used to
 * live here; removed — the app is meant to reveal itself, with no bypass.)
 *
 * Theme-aware (dark default), matched to the app's voice: terse, a little
 * poetic, no exclamation marks.
 */

import React from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import type { Theme } from '../lib/timelineTheme';

export function GrowthIntro({
  visible, onBegin, theme,
}: {
  visible: boolean;
  onBegin: () => void;
  theme: Theme;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 24) }}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 32 }}>
          <Feather name="feather" size={28} color={theme.textMain} style={{ marginBottom: 28, opacity: 0.9 }} />
          <Text style={{ color: theme.textMain, fontSize: 30, fontWeight: '900', letterSpacing: -0.8, lineHeight: 36, marginBottom: 16 }}>
            This app grows{'\n'}with you.
          </Text>
          <Text style={{ color: theme.textSub, fontSize: 16, fontWeight: '500', lineHeight: 24, maxWidth: 330 }}>
            It starts simple on purpose. New tools surface as you use what&apos;s already here — nothing to dig for, nothing to set up.
          </Text>
        </View>

        <View style={{ paddingHorizontal: 32 }}>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onBegin(); }}
            activeOpacity={0.85}
            style={{ backgroundColor: theme.textMain, borderRadius: 16, paddingVertical: 18, alignItems: 'center' }}
          >
            <Text style={{ color: theme.bg, fontSize: 16, fontWeight: '900', letterSpacing: 0.3 }}>Begin</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
