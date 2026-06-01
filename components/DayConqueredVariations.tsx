/**
 * Day Conquered — 3 variations (Brutal, Horizon, NightSky).
 * Used by the habits tab (production) and the art tab (testing).
 *
 * Each component is a full-screen overlay. Expects:
 *   - theme: { bg, textMain, textSub }
 *   - onDone: () => void    // called when the animation finishes
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, withDelay,
  Easing, FadeIn, runOnJS, cancelAnimation,
} from 'react-native-reanimated';

type Theme = { bg: string; textMain: string; textSub: string };
type Props = { theme: Theme; onDone?: () => void };

export type EclipseVariationKey = 'brutal' | 'horizon' | 'nightsky';

// ─── SIMPLE ──────────────────────────────────────────────────────

export function Eclipse_Brutal({ theme, onDone }: Props) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    const finish = () => { onDone && onDone(); };
    opacity.value = withSequence(
      withTiming(1, { duration: 600 }),
      withDelay(2200, withTiming(0, { duration: 700 }, (f) => { 'worklet'; if (f) runOnJS(finish)(); })),
    );
    return () => { cancelAnimation(opacity); };
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg }, style]}>
      <Text style={{ color: theme.textMain, fontSize: 72, fontWeight: '900', letterSpacing: -4, textAlign: 'center' }}>done.</Text>
    </Animated.View>
  );
}

// ─── SPECIAL ─────────────────────────────────────────────────────

export function Eclipse_Horizon({ theme, onDone }: Props) {
  const sunY = useSharedValue(-50);
  const outerOpacity = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const isDark = theme.bg === '#000000';

  useEffect(() => {
    const finish = () => { onDone && onDone(); };
    outerOpacity.value = withSequence(
      withTiming(1, { duration: 400 }),
      withDelay(4600, withTiming(0, { duration: 800 }, (f) => { 'worklet'; if (f) runOnJS(finish)(); })),
    );
    sunY.value = withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.cubic) });
    textOpacity.value = withDelay(1500, withTiming(1, { duration: 700 }));
    return () => { cancelAnimation(outerOpacity); cancelAnimation(sunY); cancelAnimation(textOpacity); };
  }, []);

  const outerStyle = useAnimatedStyle(() => ({ opacity: outerOpacity.value }));
  const sunStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sunY.value }] }));
  const textStyle = useAnimatedStyle(() => ({ opacity: textOpacity.value }));

  const skyColor = isDark ? '#0A0A0E' : '#F4F4F7';
  const groundColor = isDark ? '#000' : '#111';
  const sunColor = isDark ? '#FFF' : '#111';

  return (
    <Animated.View style={[{ flex: 1 }, outerStyle]}>
      <View style={{ flex: 1, backgroundColor: skyColor, justifyContent: 'flex-end', alignItems: 'center' }}>
        <Animated.View style={[{ width: 120, height: 120, borderRadius: 60, backgroundColor: sunColor, marginBottom: -60, shadowColor: sunColor, shadowOpacity: 0.4, shadowRadius: 40 }, sunStyle]} />
      </View>
      <View style={{ flex: 1, backgroundColor: groundColor, alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 }}>
        <Animated.View style={textStyle}>
          <Text style={{ color: '#FFF', fontSize: 32, fontWeight: '900', letterSpacing: -1, textAlign: 'center' }}>Day Conquered.</Text>
          <Text style={{ color: isDark ? '#888' : '#999', fontSize: 13, fontWeight: '500', textAlign: 'center', marginTop: 12, fontStyle: 'italic' }}>the sun has set on this one.</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function StarPoint({ top, left, size, delay }: { top: number; left: number; size: number; delay: number }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(0.85, { duration: 500 }));
    return () => { cancelAnimation(opacity); };
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[{ position: 'absolute', top: `${top}%`, left: `${left}%`, width: size, height: size, borderRadius: size / 2, backgroundColor: '#FFF' }, style]} />
  );
}

export function Eclipse_NightSky({ theme, onDone }: Props) {
  const outer = useSharedValue(0);
  const textOp = useSharedValue(0);

  const stars = useMemo(() => Array.from({ length: 24 }).map(() => ({
    top: Math.random() * 100,
    left: Math.random() * 100,
    size: 1.5 + Math.random() * 2.5,
    delay: Math.random() * 1400,
  })), []);

  useEffect(() => {
    const finish = () => { onDone && onDone(); };
    outer.value = withSequence(
      withTiming(1, { duration: 500 }),
      withDelay(4300, withTiming(0, { duration: 800 }, (f) => { 'worklet'; if (f) runOnJS(finish)(); })),
    );
    textOp.value = withDelay(1800, withTiming(1, { duration: 800 }));
    return () => { cancelAnimation(outer); cancelAnimation(textOp); };
  }, []);

  const outerStyle = useAnimatedStyle(() => ({ opacity: outer.value }));
  const textStyle = useAnimatedStyle(() => ({ opacity: textOp.value }));

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: '#0A0A14' }, outerStyle]}>
      {stars.map((s, i) => (
        <StarPoint key={i} top={s.top} left={s.left} size={s.size} delay={s.delay} />
      ))}
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
        <Animated.View style={textStyle}>
          <Text style={{ color: '#FFF', fontSize: 30, fontWeight: '900', letterSpacing: -1, textAlign: 'center' }}>Day Conquered.</Text>
          <Text style={{ color: '#888', fontSize: 13, fontWeight: '500', textAlign: 'center', marginTop: 14, fontStyle: 'italic' }}>the day settles.</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

// ─── SELECTION LOGIC ─────────────────────────────────────────────

export interface EclipseContext {
  hour: number;                    // current hour of day (0-23)
  dayOfWeek: number;               // 0 = Sunday, 6 = Saturday
  consecutiveConqueredDays: number; // including today
  incompleteDaysLast7: number;     // days in last 7 where user didn't complete all scheduled
  yesterdayWasRestOrSkip: boolean; // yesterday had only rest/skipped actions
  completesPactToday: boolean;
}

export function pickEclipseVariation(ctx: EclipseContext): EclipseVariationKey {
  // Night Sky — rare cosmic moments, any time of day
  if (ctx.completesPactToday) return 'nightsky';
  if (ctx.consecutiveConqueredDays >= 5) return 'nightsky';

  // Horizon — evening-only (5pm+), plus one of several "earned" conditions
  const isEvening = ctx.hour >= 17;
  if (isEvening) {
    if (ctx.incompleteDaysLast7 >= 3) return 'horizon';  // rough week, closure earned
    if (ctx.dayOfWeek === 0) return 'horizon';           // Sunday = week's end
    if (ctx.yesterdayWasRestOrSkip) return 'horizon';    // returning to action
  }

  // Default: Brutal. Everyday voice, consistent, no rotation.
  return 'brutal';
}
