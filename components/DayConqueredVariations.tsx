/**
 * Day Conquered — the sunset "eclipse".
 *
 * A single full-screen overlay, shown once when every scheduled habit for today
 * is complete: the sun sinks to the horizon and "the sun has set on this one."
 *
 * Expects:
 *   - theme: { bg, textMain, textSub }
 *   - onDone: () => void    // called when the animation finishes
 */

import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, withDelay,
  Easing, runOnJS, cancelAnimation,
} from 'react-native-reanimated';

type Theme = { bg: string; textMain: string; textSub: string };
type Props = { theme: Theme; onDone?: () => void };

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
