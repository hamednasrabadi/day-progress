/**
 * Unlock toast — top-anchored announcement for newly unlocked features.
 *
 * Replaces the old bottom "whisper" bar, which had three problems: it sat at the
 * bottom (under the keyboard), it was hardcoded white (not theme-aware), and it
 * only showed a vague sentence — you couldn't tell WHAT had unlocked.
 *
 * This reads the same store whisperQueue (head), but resolves the feature's NAME
 * + one-line description from FEATURE_META (lib/unlocks) and an icon from
 * FEATURE_ICON, so it says exactly what you got. It drops from the TOP (clear of
 * the keyboard), is fully themed, AUTO-DISMISSES after a few seconds, and a tap
 * (or its ×) advances the queue — so stacked unlocks just flow by without a tap
 * each. The store still collapses 3+ pending into one "Several new things" toast,
 * which falls back to the plain message. Mounted once, globally, in app/_layout.
 */
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppStore } from '../store/useAppStore';
import { FEATURE_META } from '../lib/unlocks';
import { getTheme } from '../lib/timelineTheme';

const ACCENT = '#0A84FF';

// Per-feature badge icon. Anything unmapped falls back to a generic glyph.
const FEATURE_ICON: Record<string, keyof typeof Feather.glyphMap> = {
  SUBTASKS: 'check-square', PROMISE: 'shield', DEEP_WORK: 'crosshair', RECURRING: 'repeat',
  PROJECTS: 'folder', ADHD_MODE: 'eye', NOW_PLAYING: 'radio', SMART_SUGGESTIONS: 'zap',
  DIARY: 'book-open', MOOD_TAGGING: 'smile', HIGHLIGHT_COLORS: 'edit-3', SEALING: 'lock',
  CHALLENGES_TAB: 'flag', MILESTONES: 'flag', LINKED_HABITS: 'link', CAPSULE_LOCK: 'lock',
  PACT: 'anchor', COMPLETION_NOTES: 'edit-3', STRENGTH_SCORE: 'trending-up', WEEKLY_REVIEW: 'calendar',
};

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function Whisper() {
  const insets = useSafeAreaInsets();
  const queue = useAppStore(s => s.whisperQueue || []);
  const dismiss = useAppStore(s => s.dismissCurrentWhisper);
  const themeMode = useAppStore(s => s.themeMode);
  const theme = getTheme(themeMode);
  const head = queue[0] || null;
  const headKey = head ? head.featureIds.join(',') + '|' + head.message : '';

  // Auto-dismiss so stacked unlocks flow by without a tap each. Re-armed per head.
  useEffect(() => {
    if (!headKey) return;
    const t = setTimeout(() => dismiss(), 4800);
    return () => clearTimeout(t);
  }, [headKey, dismiss]);

  if (!head) return null;

  const ids = head.featureIds || [];
  const named = ids.filter(id => FEATURE_META[id]); // ids we have a name for
  const icon: keyof typeof Feather.glyphMap = named.length === 1 ? (FEATURE_ICON[named[0]] || 'unlock') : 'gift';
  // 1 named → name + its description. 2 named → join both, message as body.
  // 3+ (collapsed) or unnamed → just the plain message as the title.
  let title: string; let body: string | null;
  if (named.length === 1) {
    title = FEATURE_META[named[0]].name; body = FEATURE_META[named[0]].description;
  } else if (named.length === 2) {
    title = `${FEATURE_META[named[0]].name} & ${FEATURE_META[named[1]].name}`; body = head.message || null;
  } else {
    title = head.message || 'New things unlocked'; body = null;
  }

  return (
    <Animated.View
      key={headKey}
      entering={FadeInDown.duration(320)}
      exiting={FadeOutUp.duration(220)}
      style={[styles.wrap, { top: insets.top + 8 }]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); dismiss(); }}
        style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
      >
        <View style={[styles.badge, { backgroundColor: hexA(ACCENT, theme.isDark ? 0.18 : 0.12) }]}>
          <Feather name={icon} size={19} color={ACCENT} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: ACCENT }]}>UNLOCKED</Text>
          <Text style={[styles.title, { color: theme.textMain }]} numberOfLines={1}>{title}</Text>
          {body ? <Text style={[styles.body, { color: theme.textSub }]} numberOfLines={2}>{body}</Text> : null}
        </View>
        <Feather name="x" size={16} color={theme.textSub} style={{ opacity: 0.55, marginTop: 1 }} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 50 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, paddingVertical: 13, paddingHorizontal: 14 },
  badge: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  title: { fontSize: 15, fontWeight: '800', marginTop: 1 },
  body: { fontSize: 12, fontWeight: '500', lineHeight: 16, marginTop: 2 },
});
