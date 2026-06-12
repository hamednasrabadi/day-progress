/**
 * ADHD Mode — the focus / relief view: one thing at a time, in a calm black void.
 *
 * Replaces the old "flash-bang" celebration. Each completion is a physical drop —
 * the task card falls under gravity and lands as a colored bar on a growing pile,
 * the session made visible. A soft wood knock (the app's own sfx) climbs in pitch
 * as the pile grows. Leaving — an early EXIT or a full clear — lands on a send-off
 * that names what you cleared, never what's left (quitting after 2 of 9 is a win).
 *
 * Fed by the caller's pool (top tasks + today's unfinished habits). `onComplete`
 * does the real store mutation; this component owns all the motion, sound, haptics,
 * and the session pile. It defensively filters the pool by what it has cleared, so
 * advancement never depends on the parent re-deriving the pool in time.
 */
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing, FadeIn, FadeInUp, FadeInDown } from 'react-native-reanimated';
import { playSfx } from '../lib/sounds';

export type AdhdItem = { kind: 'task' | 'habit'; id: string; title: string; color: string };

const VOID = { flex: 1, backgroundColor: '#000' } as const;
const CENTER = { flex: 1, justifyContent: 'center', alignItems: 'center' } as const;
const keyOf = (it: { kind: string; id: string }) => `${it.kind}:${it.id}`;

export function AdhdMode({ visible, pool, onComplete, onClose }: {
  visible: boolean;
  pool: AdhdItem[];
  onComplete: (kind: 'task' | 'habit', id: string, title: string) => void;
  onClose: () => void;
}) {
  const [cleared, setCleared] = useState<AdhdItem[]>([]);
  const [clearedKeys, setClearedKeys] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<AdhdItem | null>(null);
  const [leaving, setLeaving] = useState(false);
  const y = useSharedValue(0), s = useSharedValue(1), f = useSharedValue(1), rot = useSharedValue(0);
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }, { scale: s.value }, { rotate: `${rot.value}deg` }], opacity: f.value }));

  // Fresh session each time the modal opens.
  useEffect(() => {
    if (visible) {
      setCleared([]); setClearedKeys(new Set()); setDone(null); setLeaving(false);
      y.value = 0; s.value = 1; f.value = 1; rot.value = 0;
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const livePool = pool.filter(p => !clearedKeys.has(keyOf(p)));
  const current = livePool[0] ?? null;
  const remaining = livePool.length;

  const onDone = () => {
    if (!current) return;
    const item = current;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); // pick it up
    setDone(item);
    y.value = 0; s.value = 1; f.value = 1; rot.value = 0;
    y.value = withTiming(340, { duration: 440, easing: Easing.in(Easing.cubic) }); // gravity
    s.value = withTiming(0.3, { duration: 440 });
    rot.value = withTiming(-6, { duration: 440 });
    f.value = withTiming(0, { duration: 440, easing: Easing.in(Easing.quad) });
    setTimeout(() => {
      // It lands: soft haptic + the wood knock, pitched up as the pile grows.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      playSfx('check', 1 + Math.min(cleared.length, 6) * 0.045);
      onComplete(item.kind, item.id, item.title); // the real mutation
      setCleared(c => [...c, item]);
      setClearedKeys(k => new Set(k).add(keyOf(item)));
      setDone(null);
    }, 430);
  };

  const handleExit = () => { if (cleared.length > 0) setLeaving(true); else onClose(); };

  // Send-off when leaving with ≥1 cleared — an early EXIT (partial) or a full clear.
  const showSendoff = (leaving || (!current && !done)) && cleared.length > 0;
  const nothingToDo = !current && !done && cleared.length === 0;

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={handleExit} statusBarTranslucent>
      {showSendoff ? (
        <AdhdSendoff items={cleared} full={!current && !leaving} onClose={onClose} />
      ) : nothingToDo ? (
        <View style={[VOID, CENTER, { gap: 14, padding: 48 }]}>
          <Text style={{ color: '#FFF', fontSize: 32, fontWeight: '900', letterSpacing: -1 }}>Nothing here.</Text>
          <Text style={{ color: '#888', fontSize: 15, fontWeight: '600' }}>You&apos;re clear. Take a breath.</Text>
          <TouchableOpacity onPress={onClose} style={{ marginTop: 24, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 14, borderWidth: 1, borderColor: '#333' }}>
            <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '900', letterSpacing: 1.5 }}>EXIT</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={VOID}><SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 32, paddingTop: 24, marginBottom: 24 }}>
            <TouchableOpacity onPress={handleExit} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
              <Text style={{ color: '#555', fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>EXIT</Text>
            </TouchableOpacity>
            <Text style={{ color: '#555', fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>{remaining > 0 ? `${remaining} LEFT` : 'CLEAR'}</Text>
          </View>

          <View style={CENTER}>
            {current && !done ? (
              <Animated.View key={keyOf(current)} entering={FadeInUp.duration(380)} style={{ alignItems: 'center', gap: 18, width: '100%', paddingHorizontal: 28 }}>
                <View style={{ width: '100%', borderRadius: 22, borderWidth: 1, borderColor: '#1C1C1C', backgroundColor: '#0C0C0C', paddingVertical: 30, paddingHorizontal: 22, alignItems: 'center', gap: 14, borderLeftWidth: 4, borderLeftColor: current.color }}>
                  <Text style={{ color: '#666', fontSize: 11, fontWeight: '900', letterSpacing: 3 }}>{current.kind === 'task' ? 'TASK' : 'HABIT'}</Text>
                  <Text style={{ color: '#FFF', fontSize: 26, fontWeight: '900', letterSpacing: -0.5, textAlign: 'center', lineHeight: 32, alignSelf: 'stretch' }} numberOfLines={4}>{current.title}</Text>
                </View>
                <TouchableOpacity onPress={onDone} activeOpacity={0.85} style={{ marginTop: 4, paddingVertical: 22, paddingHorizontal: 50, borderRadius: 26, backgroundColor: current.color, minWidth: 200, alignItems: 'center' }}>
                  <Text style={{ color: '#FFF', fontSize: 17, fontWeight: '900', letterSpacing: 2 }}>DONE</Text>
                </TouchableOpacity>
              </Animated.View>
            ) : null}
            {done ? (
              <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: '84%', borderRadius: 22, backgroundColor: '#0C0C0C', borderWidth: 1, borderColor: '#1C1C1C', borderLeftWidth: 4, borderLeftColor: done.color, paddingVertical: 30, paddingHorizontal: 22 }, cardStyle]}>
                <Text style={{ color: '#FFF', fontSize: 26, fontWeight: '900', letterSpacing: -0.5, textAlign: 'center' }} numberOfLines={2}>{done.title}</Text>
              </Animated.View>
            ) : null}
          </View>

          {/* The pile — thin bars, newest brightest, fading in calmly as the card lands. */}
          <View style={{ paddingHorizontal: 40, paddingBottom: 22, gap: 4 }}>
            {cleared.map((it, i) => (
              <Animated.View key={keyOf(it)} entering={FadeIn.duration(220)} style={{ height: 7, borderRadius: 4, backgroundColor: it.color, opacity: 0.45 + Math.min(0.55, i * 0.09) }} />
            ))}
            {cleared.length > 0 ? (
              <Text style={{ color: '#777', fontSize: 11, fontWeight: '900', letterSpacing: 2, marginTop: 8 }}>{cleared.length} CLEARED</Text>
            ) : null}
          </View>
        </SafeAreaView></View>
      )}
    </Modal>
  );
}

// The send-off — the pile becomes a named receipt of the run. Shows ONLY what was
// cleared (never what's left); the rare full clear gets the calmer headline.
function AdhdSendoff({ items, full, onClose }: { items: AdhdItem[]; full: boolean; onClose: () => void }) {
  const n = items.length;
  useEffect(() => { playSfx('complete'); }, []);
  return (
    <View style={VOID}><SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 36, paddingVertical: 48 }}>
        <Animated.Text entering={FadeIn.duration(500)} style={{ color: '#FFF', fontSize: 40, fontWeight: '900', letterSpacing: -1.5, textAlign: 'center' }}>
          {full ? 'All clear.' : `${n} cleared.`}
        </Animated.Text>
        <Animated.Text entering={FadeIn.duration(500).delay(140)} style={{ color: '#888', fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 10 }}>
          {full ? 'Nothing left. Take a breath.' : `That's ${n} you won't carry into tomorrow.`}
        </Animated.Text>
        <View style={{ marginTop: 36, gap: 12 }}>
          {items.map((it, i) => (
            <Animated.View key={keyOf(it)} entering={FadeInDown.duration(360).delay(240 + i * 70)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: it.color }} />
              <Text style={{ color: '#DDD', fontSize: 16, fontWeight: '700', flex: 1 }} numberOfLines={1}>{it.title}</Text>
              <Feather name="check" size={16} color={it.color} />
            </Animated.View>
          ))}
        </View>
        <TouchableOpacity onPress={onClose} activeOpacity={0.85} style={{ marginTop: 44, alignSelf: 'center', paddingVertical: 16, paddingHorizontal: 48, borderRadius: 16, backgroundColor: '#FFF' }}>
          <Text style={{ color: '#000', fontSize: 14, fontWeight: '900', letterSpacing: 1.5 }}>DONE</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView></View>
  );
}
