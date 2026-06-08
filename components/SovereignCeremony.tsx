/**
 * Sovereign awakening ceremony — the full-screen reward sequence played when the user
 * taps the electric UNLOCK after overreaching all four conditions. Paced slow so the
 * moment lands, and focused on the actual reward (the theme), not a gamified rank:
 *   blackout → the System speaks (two lines) → a beat of darkness → power burst →
 *   the unlocked THEME is revealed (palette preview, held) → dissolve.
 *
 * Self-contained colors (obsidian + amethyst = the actual Sovereign palette, so the whole
 * ceremony already wears the reward). Single native-driven timeline; tap anywhere to skip.
 * Copy + timing live at the top of this file.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View, Modal, StatusBar } from 'react-native';
import { Feather } from '@expo/vector-icons';

const OBSIDIAN = '#0A0712';
const AMETHYST = '#A855F7';
const AMETHYST_BRIGHT = '#E9D5FF';

// The Sovereign palette (mirrors getTheme 'sovereign') — shown in the theme reveal.
const S_BG = '#120A22';
const S_SURFACE = '#1E1538';
const S_BORDER = '#342856';
const S_TEXT = '#EAE5F5';
const S_SUB = '#988BBC';

// edit freely
const DURATION = 9000;
const LINE_1 = 'You did not stop.';
const LINE_2 = 'The System acknowledges its Sovereign.';
const THEME_LABEL = 'SOVEREIGN THEME UNLOCKED';
const THEME_HINT = 'Equip it in Settings → Appearance';

const fillCenter = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center' as const, justifyContent: 'center' as const };
const lineStyle = { color: AMETHYST_BRIGHT, fontSize: 16, fontWeight: '600' as const, letterSpacing: 1, textAlign: 'center' as const, paddingHorizontal: 44 };

export function SovereignCeremony({ onDone }: { onDone: () => void }) {
  const t = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const done = useRef(false);
  const finish = () => { if (!done.current) { done.current = true; onDone(); } };

  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: DURATION, easing: Easing.linear, useNativeDriver: true }).start(({ finished }) => { if (finished) finish(); });
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Slow, deliberate beats. Lines hold ~2s each; a dark pause; then the burst breaks into the
  // theme reveal, which holds ~2.8s — the reward is the moment, not a flash.
  // Fade in to obsidian, then stay opaque to the end — so when onDone unmounts the modal it
  // cuts straight into the now-unlocked tab (no flash of the lock screen behind a fade-out).
  const bg = t.interpolate({ inputRange: [0, 0.06], outputRange: [0, 1], extrapolate: 'clamp' });
  const l1 = t.interpolate({ inputRange: [0.06, 0.12, 0.22, 0.28], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' });
  const l2 = t.interpolate({ inputRange: [0.31, 0.37, 0.48, 0.54], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' });
  const burstO = t.interpolate({ inputRange: [0.58, 0.65, 0.80], outputRange: [0, 0.5, 0], extrapolate: 'clamp' });
  const burstS = t.interpolate({ inputRange: [0.58, 0.82], outputRange: [0.3, 3], extrapolate: 'clamp' });
  const themeO = t.interpolate({ inputRange: [0.64, 0.73, 0.93, 0.99], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' });
  const themeS = t.interpolate({ inputRange: [0.64, 0.76], outputRange: [0.9, 1], extrapolate: 'clamp' });
  const glowO = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.14, 0.30] });

  const swatches = [S_BG, S_SURFACE, S_BORDER, AMETHYST];

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={() => {}}>
      <StatusBar hidden animated />
      <Animated.View style={{ flex: 1, backgroundColor: OBSIDIAN, opacity: bg }}>
      {/* power burst */}
      <Animated.View pointerEvents="none" style={[fillCenter, { opacity: burstO }]}>
        <Animated.View style={{ width: 220, height: 220, borderRadius: 110, backgroundColor: AMETHYST, transform: [{ scale: burstS }] }} />
      </Animated.View>
      {/* ambient glow behind the reveal (appears with it, pulses slowly) */}
      <Animated.View pointerEvents="none" style={[fillCenter, { opacity: Animated.multiply(themeO, glowO) }]}>
        <View style={{ width: 340, height: 340, borderRadius: 170, backgroundColor: AMETHYST }} />
      </Animated.View>
      {/* System lines */}
      <Animated.View pointerEvents="none" style={[fillCenter, { opacity: l1 }]}><Text style={lineStyle}>{LINE_1}</Text></Animated.View>
      <Animated.View pointerEvents="none" style={[fillCenter, { opacity: l2 }]}><Text style={lineStyle}>{LINE_2}</Text></Animated.View>
      {/* theme reveal — the reward: show off the actual unlocked palette */}
      <Animated.View pointerEvents="none" style={[fillCenter, { opacity: themeO, transform: [{ scale: themeS }] }]}>
        <Text style={{ color: AMETHYST, fontSize: 12, fontWeight: '900', letterSpacing: 3, marginBottom: 18 }}>{THEME_LABEL}</Text>
        {/* a mock app surface wearing the Sovereign theme */}
        <View style={{ width: 250, backgroundColor: S_BG, borderColor: S_BORDER, borderWidth: 1, borderRadius: 16, padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: S_SURFACE, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="hexagon" size={14} color={AMETHYST} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ height: 8, width: '62%', borderRadius: 4, backgroundColor: S_TEXT }} />
              <View style={{ height: 6, width: '40%', borderRadius: 3, backgroundColor: S_SUB, marginTop: 7 }} />
            </View>
          </View>
          <View style={{ height: 2, backgroundColor: AMETHYST, borderRadius: 1, marginTop: 16 }} />
        </View>
        {/* palette swatches */}
        <View style={{ flexDirection: 'row', gap: 9, marginTop: 18 }}>
          {swatches.map((c, i) => (
            <View key={i} style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: c, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }} />
          ))}
        </View>
        <Text style={{ color: S_SUB, fontSize: 11, marginTop: 18 }}>{THEME_HINT}</Text>
      </Animated.View>
    </Animated.View>
    </Modal>
  );
}
