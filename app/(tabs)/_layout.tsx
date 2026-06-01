/**
 * Tab bar layout.
 *
 * The footer is a custom animated bar (components/AnimatedTabBar) — art-tab
 * variant 5 "None": no pill; the active tab lights up (accent icon + label +
 * scale-lift), Soft spring motion, Light haptic on change. The Challenges tab
 * gating (absent days 0–1 · nameless teaser day 2 · normal day 3+) lives inside
 * the bar, which reads the unlock state directly.
 *
 * What does NOT belong here:
 *   - Alarm handling  →  root _layout.tsx
 *   - Notification setup  →  root _layout.tsx
 *   - Any business logic  →  individual screen files / the tab bar
 */

import { Tabs } from 'expo-router';
import AnimatedTabBar from '../../components/AnimatedTabBar';
import { useAppStore } from '../../store/useAppStore';
import { getTheme } from '../../lib/timelineTheme';

// Habits is the calm entry and the anchor route — the app lands here on cold
// start / back-to-root. (The Timeline `index` route was removed in the calm-pivot.)
export const unstable_settings = {
  initialRouteName: 'habits',
};

export default function TabLayout() {
  const theme = getTheme(useAppStore(s => s.themeMode));
  return (
    <Tabs
      tabBar={(props) => <AnimatedTabBar {...props} />}
      // sceneStyle (RN-nav v7) paints the scene container behind each screen with
      // the active theme bg, so switching tabs never flashes a mismatched color
      // while the next screen paints — worst on the slow-mounting Challenges screen.
      // freezeOnBlur suspends off-screen tab trees (all share one store) so a tab
      // switch doesn't re-render every other heavy screen — the switch-lag fix.
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.bg }, freezeOnBlur: true }}
    >
      {/* Hidden index redirect (app/(tabs)/index.tsx) keeps "/" and "/(tabs)" matched. */}
      <Tabs.Screen name="index" options={{ href: null }} />

      {/* Order: Habits (hero/anchor) → Tasks → Challenges → Notes (right end) */}
      <Tabs.Screen name="habits" options={{ title: 'Habits' }} />
      <Tabs.Screen name="todo" options={{ title: 'Tasks' }} />
      <Tabs.Screen name="challenges" options={{ title: 'Challenges' }} />
      <Tabs.Screen name="notes" options={{ title: 'Notes' }} />
    </Tabs>
  );
}
