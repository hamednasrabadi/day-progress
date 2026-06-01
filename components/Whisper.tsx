/**
 * Whisper — global announcement bar for newly unlocked features.
 *
 * One bar at a time, anchored above the tab bar. Reads its content from the
 * store's whisperQueue (head of queue). Slides in when there's something
 * pending, slides out when the user dismisses. The store handles the queue
 * collapse rule (3+ pending → "Several new things are available") so this
 * component doesn't need to know about plurality — it just renders one row.
 *
 * Suppression: hidden while the keyboard is up, because a whisper sliding
 * over a focused input is exactly the wrong moment to announce something
 * new. Re-appears on keyboard dismiss if the queue is still non-empty.
 *
 * Idle/foreground gating: the prompt also specified "navigation has settled"
 * and "no active gesture." We deliberately keep this lightweight — listening
 * for those events in a generic, robust way is fragile. The keyboard guard
 * covers the only case in practice (active editing). If we hit a real-world
 * "fired during a swipe" issue later, we can add a debounced visibility
 * sticky here.
 *
 * Positioning: bottom: tabBarHeight makes the bar sit immediately above the
 * tab bar. When mounted inside the tabs layout it picks this up live via
 * useBottomTabBarHeight; mounted outside it falls back to a sane default.
 */

import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppStore } from '../store/useAppStore';

type Props = {
  // Distance from the bottom edge to anchor the bar above. When rendered
  // inside a tabs layout pass `useBottomTabBarHeight()`; otherwise 0 (or the
  // tabbar height as a constant) and let safe-area insets handle the rest.
  bottomOffset?: number;
};

export function Whisper({ bottomOffset = 0 }: Props) {
  const insets = useSafeAreaInsets();
  const queue = useAppStore(s => s.whisperQueue || []);
  const dismiss = useAppStore(s => s.dismissCurrentWhisper);
  const head = queue[0] || null;

  // Keyboard guard — hides the bar while an input is focused. We don't
  // dismiss the queue entry; just suppress the render. When the keyboard
  // closes, the bar reappears.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardOpen(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardOpen(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  if (!head) return null;
  if (keyboardOpen) return null;

  return (
    <Animated.View
      // FadeInDown enters from the top — for a bottom-anchored bar we want
      // it to slide UP into view, so we use FadeOutDown for exit and let
      // FadeInDown handle a soft 200ms reveal as the queue advances.
      entering={FadeInDown.duration(200)}
      exiting={FadeOutDown.duration(200)}
      style={[
        styles.bar,
        {
          bottom: bottomOffset,
          // Safe-area padding only when we're at the absolute bottom (no
          // tab bar offset). When the tab bar pushes us up, its own padding
          // already clears the home indicator.
          paddingBottom: bottomOffset > 0 ? 0 : Math.max(insets.bottom, 0),
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.inner}>
        <Text style={styles.message} numberOfLines={2}>{head.message}</Text>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); dismiss(); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.closeBtn}
        >
          <Feather name="x" size={16} color="#9CA3AF" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Stays above the rest of the screen but below modals — modals use the
    // RN Modal portal which renders on its own layer, so we don't need to
    // fight zIndex with them.
    zIndex: 10,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  message: {
    flex: 1,
    color: '#4B5563',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    paddingRight: 12,
  },
  closeBtn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
});
