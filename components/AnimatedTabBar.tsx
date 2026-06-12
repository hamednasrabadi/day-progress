/**
 * Custom animated tab bar — the "calm-pivot" footer (art-tab variant 5: "None").
 *
 * No pill/background: the active tab LIGHTS UP — icon crossfades grey→accent, scales
 * up + lifts, label reveals. Inactive = icon-only. Soft spring; Light haptic on change.
 *
 * SMOOTHNESS: the highlight is driven by an OPTIMISTIC shared value (`active`) that we
 * set synchronously in onPress — so the footer animates on the UI thread the instant
 * you tap, instead of waiting for React Navigation's `state.index` to commit (that
 * round-trip is what made the footer trail the screen, worst on the heavy Challenges
 * screen). We re-sync `active` to `state.index` for external nav (back gesture, deep
 * links). The spring runs in a worklet, so a busy JS thread can't stall it.
 *
 * Challenges gating (single source of truth — the screen also guards deep links):
 *   • days 0–1            → absent from the bar
 *   • day 2 (24h teaser)  → icon only, NO label (even when focused)
 *   • day 3+ (CHALLENGES_TAB unlocked, time-based) → normal, with label
 * A small "new" dot sits on the Challenges icon until first opened (isNew).
 *
 * To switch the active colour to white, change ACCENT below.
 */

import React, { useEffect } from 'react';
import { View, Pressable, Platform, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useDerivedValue, useAnimatedStyle, withSpring, interpolate, type SharedValue } from 'react-native-reanimated';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { FEATURE_IDS, useIsUnlocked, useIsNew, useDaysSinceInstall } from '../lib/unlocks';
import { useAppStore } from '../store/useAppStore';
import { useTabBarMetrics } from '../lib/tabBarMetrics';
import { getTheme } from '../lib/timelineTheme';

const ACCENT = '#3B82F6';     // active icon + label — a blue that reads on every theme
const SOFT = { damping: 20, stiffness: 150, mass: 1 };
// bg / border / inactive now come from the active theme (light / graphite / navy),
// computed per-render in AnimatedTabBar and passed down so the footer matches.

type FeatherName = React.ComponentProps<typeof Feather>['name'];
const META: Record<string, { icon: FeatherName; label: string }> = {
  habits: { icon: 'repeat', label: 'Habits' },
  todo: { icon: 'check-square', label: 'Tasks' },
  notes: { icon: 'file-text', label: 'Notes' },
  challenges: { icon: 'award', label: 'Challenges' },
};

const TabButton = React.memo(function TabButton({ index, active, name, showLabel, isNew, focused, onPress, inactive, bg, accent }: { index: number; active: SharedValue<number>; name: string; showLabel: boolean; isNew: boolean; focused: boolean; onPress: () => void; inactive: string; bg: string; accent: string }) {
  const meta = META[name];
  // Driven off `active` (optimistic), NOT a `focused` prop — so it starts on tap.
  const progress = useDerivedValue(() => withSpring(active.value === index ? 1 : 0, SOFT));
  const iconWrap = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(progress.value, [0, 1], [1, 1.1]) }, { translateY: interpolate(progress.value, [0, 1], [0, -2]) }] }));
  const grey = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const on = useAnimatedStyle(() => ({ opacity: progress.value }));
  const labelS = useAnimatedStyle(() => ({ opacity: showLabel ? progress.value : 0 }));
  const press = ({ pressed }: { pressed: boolean }): ViewStyle => ({ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2, transform: [{ scale: pressed ? 0.92 : 1 }] });
  return (
    <Pressable onPress={onPress} style={press} accessibilityRole="button" accessibilityState={{ selected: focused }} accessibilityLabel={meta.label}>
      <Animated.View style={[{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }, iconWrap]}>
        <Animated.View style={[{ position: 'absolute' }, grey]}><Feather name={meta.icon} size={24} color={inactive} /></Animated.View>
        <Animated.View style={[{ position: 'absolute' }, on]}><Feather name={meta.icon} size={24} color={accent} /></Animated.View>
        {isNew ? <View style={{ position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: accent, borderWidth: 1.5, borderColor: bg }} /> : null}
      </Animated.View>
      <Animated.Text numberOfLines={1} style={[{ fontSize: 11, fontWeight: '800', color: accent, marginTop: 3, height: 14 }, labelS]}>{meta.label}</Animated.Text>
    </Pressable>
  );
});

export default function AnimatedTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const themeMode = useAppStore(s => s.themeMode);
  const theme = getTheme(themeMode);
  // Amethyst accent for the Sovereign easter-egg theme; the usual blue otherwise.
  const accent = themeMode === 'sovereign' ? '#A855F7' : ACCENT;
  const challengesUnlocked = useIsUnlocked(FEATURE_IDS.CHALLENGES_TAB);
  const challengesIsNew = useIsNew(FEATURE_IDS.CHALLENGES_TAB);
  const days = useDaysSinceInstall();

  // The highlight's source of truth. Set instantly on tap; re-synced to the real
  // navigation index for external changes (back gesture, deep links).
  const active = useSharedValue(state.index);
  useEffect(() => { active.value = state.index; }, [state.index]);

  // Publish the bar's REAL rendered height so keyboard-anchored bars (Tasks
  // quick-add) can sit flush on the keyboard. See lib/tabBarMetrics.
  const setTabBarHeight = useTabBarMetrics(s => s.setHeight);

  return (
    <View
      onLayout={e => setTabBarHeight(e.nativeEvent.layout.height)}
      style={{ flexDirection: 'row', backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10) + 6 }}
    >
      {state.routes.map((route, index) => {
        if (route.name === 'index') return null;            // hidden redirect
        if (!META[route.name]) return null;                 // unknown route guard

        let showLabel = true;
        let isNew = false;
        if (route.name === 'challenges') {
          if (!challengesUnlocked && days < 2) return null; // phase 1: absent days 0–1
          showLabel = challengesUnlocked;                   // phase 2: nameless teaser
          isNew = challengesIsNew;
        }

        const focused = state.index === index;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (focused || event.defaultPrevented) return;
          active.value = index;                                                 // ← optimistic: footer moves NOW
          if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          navigation.navigate(route.name);
        };

        return <TabButton key={route.key} index={index} active={active} name={route.name} showLabel={showLabel} isNew={isNew} focused={focused} onPress={onPress} inactive={theme.textSub} bg={theme.bg} accent={accent} />;
      })}
    </View>
  );
}
