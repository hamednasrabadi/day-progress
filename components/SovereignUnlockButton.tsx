/**
 * Sovereign "UNLOCK" button — replaces the calm EarnedButton once all four Challenge
 * conditions are OVERREACHED. An amethyst-gradient pill wrapped in crackling purple
 * electricity over a pulsing glow halo. Matches EarnedButton's shape exactly
 * (paddingVertical 17, borderRadius 14, full-width). Pressing it is the deliberate "rise":
 * the caller awakens Sovereign + hands off to the unlock ceremony.
 *
 * Electricity = SVG jagged bolts hugging the button, regenerated on a 90ms timer (the
 * crackle) with randomized per-bolt opacity (the flicker). Only mounts in the rare
 * overreach state, and the timer is cleaned up on unmount.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Text, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

const AMETHYST = '#A855F7';
const AMETHYST_BRIGHT = '#E9D5FF';
const GRADIENT = ['#B47CFF', '#A855F7', '#7C3AED'] as const;
const PAD = 12; // SVG margin so arcs can spill just past the button edges

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** One jagged bolt from (x0,y0)→(x1,y1) with perpendicular jitter on the inner points. */
function boltPath(x0: number, y0: number, x1: number, y1: number, segs: number, amp: number): string {
  const pts: string[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    let x = x0 + (x1 - x0) * t;
    let y = y0 + (y1 - y0) * t;
    if (i !== 0 && i !== segs) { x += rand(-amp * 0.4, amp * 0.4); y += rand(-amp, amp); }
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${pts.join('L')}`;
}

/** A fresh set of intense bolts hugging the button rect (all 4 edges + arcs across). */
function makeBolts(W: number, H: number, pad: number): { d: string; o: number }[] {
  const bolts: { d: string; o: number }[] = [];
  const top = pad, bot = H - pad, left = pad, right = W - pad;
  const horiz = (y: number) => { if (Math.random() < 0.9) bolts.push({ d: boltPath(left, y, right, y, 11, 6), o: rand(0.5, 1) }); };
  horiz(top); horiz(bot);
  const vert = (x: number) => { if (Math.random() < 0.7) bolts.push({ d: boltPath(x, top, x, bot, 6, 5), o: rand(0.4, 0.9) }); };
  vert(left); vert(right);
  for (let k = 0; k < 3; k++) {
    if (Math.random() < 0.6) { const x = rand(left + 12, right - 12); bolts.push({ d: boltPath(x, top, x + rand(-18, 18), bot, 7, 5), o: rand(0.3, 0.7) }); }
  }
  return bolts;
}

export function SovereignUnlockButton({ onPress }: { onPress: () => void }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tick, setTick] = useState(0);
  const glow = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 100000), 90);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [glow]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bolts = useMemo(() => (size.w ? makeBolts(size.w + PAD * 2, size.h + PAD * 2, PAD) : []), [tick, size]);

  return (
    <Animated.View style={{ alignSelf: 'stretch', transform: [{ scale }] }}>
      <Animated.View pointerEvents="none" style={{
        position: 'absolute', left: -PAD, right: -PAD, top: -PAD, bottom: -PAD, borderRadius: 24,
        backgroundColor: AMETHYST,
        opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.26] }),
        transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.05] }) }],
      }} />
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onPress(); }}
        onPressIn={() => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, friction: 6, tension: 220 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 220 }).start()}
        onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (width !== size.w || height !== size.h) setSize({ w: width, h: height }); }}
        style={{ borderRadius: 14 }}
      >
        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 17, borderRadius: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '900', letterSpacing: 3, color: '#FFFFFF', textShadowColor: AMETHYST_BRIGHT, textShadowRadius: 8 }}>UNLOCK</Text>
        </LinearGradient>
        {size.w > 0 && (
          <Svg pointerEvents="none" width={size.w + PAD * 2} height={size.h + PAD * 2} style={{ position: 'absolute', left: -PAD, top: -PAD }}>
            {bolts.map((b, idx) => (
              <React.Fragment key={idx}>
                <Path d={b.d} stroke={AMETHYST} strokeWidth={5} strokeOpacity={b.o * 0.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <Path d={b.d} stroke={AMETHYST_BRIGHT} strokeWidth={1.5} strokeOpacity={b.o} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </React.Fragment>
            ))}
          </Svg>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}
