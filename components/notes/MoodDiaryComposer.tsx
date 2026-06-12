/**
 * MoodDiaryComposer — the Diary's "Mood door" entry experience.
 *
 * Feeling first, words second. A NEW entry opens on "How are you, right now?" —
 * five moods + a quiet "or just write" escape + a strip of your recent moods.
 * Picking one washes its color into a warm page with a prompt shaped to that
 * feeling. EDITING an existing entry skips straight to the page (mood pill is
 * tap-to-change). Saving lands on a brief "Kept." before it closes.
 *
 * Self-contained (no lab deps). It persists nothing itself — it calls
 * onSubmit({ mood, content }); the Notes tab builds/saves the Note (preserving
 * any photos/audio on edits) and ticks the unlock counters. Close also saves
 * quietly when there's text, so a diary entry is never lost to a stray tap.
 *
 * Built against ui-ux-pro-max rules: one primary action, progressive disclosure,
 * 44pt targets, vector icons, ease-out motion, success feedback, safe areas, and
 * 4.5:1 contrast on the warm surface (light + dark variants).
 */
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) as string;

type Mood = { id: string; label: string; icon: string; color: string };
export type MoodComposerSubmit = { mood: string | null; content: string };

// 2–3 prompts per mood — rotated (tap the prompt / "ask me something else") so the
// daily ritual never goes stale. `_none` covers the "just write" path.
const PROMPTS: Record<string, string[]> = {
  sun:          ['A bright day. What made it good?', 'What lifted you today?', 'What do you want to remember about this one?'],
  heart:        ['Loved. Who or what brought that?', 'What felt warm today?', 'Who are you grateful for tonight?'],
  cloud:        ['Calm. What settled you today?', 'What gave you a moment of quiet?', 'What felt steady today?'],
  'cloud-rain': ['A rough one. What happened?', 'What weighed on today?', 'What do you want to set down?'],
  moon:         ['Heavy. What’s sitting on you tonight?', 'What’s taking up space?', 'What might help, even a little?'],
  _none:        ['What’s on your mind?', 'How was today?', 'Anything you want to keep from today?'],
};

export function MoodDiaryComposer({
  visible, initial, isDark, moods, recentMoods, dateLabel, onClose, onSubmit,
}: {
  visible: boolean;
  initial: { id: string; mood?: string; content: string } | null; // null = new entry
  isDark: boolean;
  moods: Mood[];
  recentMoods: string[];   // mood ids, most-recent first — the "lately" strip
  dateLabel: string;       // the entry's date, already formatted by the Notes tab
  onClose: () => void;
  onSubmit: (payload: MoodComposerSubmit) => void;
}) {
  const [phase, setPhase] = useState<'pick' | 'write'>('pick');
  const [mood, setMood] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  const [promptBump, setPromptBump] = useState(0);

  // Re-seed each time the sheet opens: new → doorway; edit → straight to the page.
  useEffect(() => {
    if (!visible) return;
    if (initial) { setPhase('write'); setMood(initial.mood ?? null); setText(initial.content); }
    else { setPhase('pick'); setMood(null); setText(''); }
    setSaved(false); setPromptBump(0);
  }, [visible, initial]);

  // Warm "Paper" skin — cream by day, candle-lit by night.
  const C = isDark
    ? { bg: '#17130E', raised: '#221B13', ink: '#EAE1D2', sub: '#9A8E7B', faint: '#6E6453', line: '#2E2619' }
    : { bg: '#F4EEE1', raised: '#FBF7EE', ink: '#2A2420', sub: '#6F6555', faint: '#A89D8B', line: '#E4DBC9' };
  const moodObj = mood ? moods.find(m => m.id === mood) : null;
  const accent = moodObj ? moodObj.color : (isDark ? '#D9913F' : '#A6552B');
  const promptList = PROMPTS[mood ?? '_none'] ?? PROMPTS._none;
  const prompt = promptList[promptBump % promptList.length];

  // Done celebrates with "Kept."; Close exits quietly. Both keep the words.
  const commit = (celebrate: boolean) => {
    const body = text.trim();
    if (!body) { onClose(); return; }
    onSubmit({ mood, content: body });
    if (celebrate) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSaved(true);
      setTimeout(onClose, 780);
    } else {
      onClose();
    }
  };

  const pickMood = (id: string) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMood(id); setPromptBump(0); setPhase('write'); };
  const justWrite = () => { setMood(null); setPromptBump(0); setPhase('write'); };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => commit(false)} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {phase === 'write' && moodObj ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 220, backgroundColor: moodObj.color, opacity: isDark ? 0.14 : 0.1 }} />
        ) : null}
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          {phase === 'pick' ? (
            /* ── THE DOORWAY ── feeling first */
            <View style={{ flex: 1, paddingHorizontal: 26 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 8, minHeight: 44 }}>
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
                  <Text style={{ color: C.sub, fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>CLOSE</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1, justifyContent: 'center', paddingBottom: 24 }}>
                <Text style={{ fontFamily: SERIF, color: C.ink, fontSize: 27, lineHeight: 34 }}>How are you,</Text>
                <Text style={{ fontFamily: SERIF, color: C.ink, fontSize: 27, lineHeight: 34, marginBottom: 22 }}>right now?</Text>
                {moods.map((m, i) => (
                  <Animated.View key={m.id} entering={FadeInUp.delay(i * 45).duration(300)}>
                    <TouchableOpacity onPress={() => pickMood(m.id)} activeOpacity={0.85}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingHorizontal: 16, marginBottom: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.raised }}>
                      <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: m.color + '24' }}>
                        <Feather name={m.icon as any} size={17} color={m.color} />
                      </View>
                      <Text style={{ fontFamily: SERIF, color: C.ink, fontSize: 19 }}>{m.label}</Text>
                    </TouchableOpacity>
                  </Animated.View>
                ))}
                {/* escape hatch — never force a label */}
                <TouchableOpacity onPress={justWrite} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ alignSelf: 'flex-start', marginTop: 6, paddingVertical: 8 }}>
                  <Text style={{ color: C.sub, fontSize: 15, fontWeight: '600' }}>or just write  →</Text>
                </TouchableOpacity>
                {/* mood pays off — your recent weather */}
                {recentMoods.length > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 26 }}>
                    <Text style={{ color: C.faint, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginRight: 4 }}>Lately</Text>
                    {recentMoods.slice(0, 12).map((id, i) => {
                      const mm = moods.find(x => x.id === id);
                      return <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: mm ? mm.color : C.line }} />;
                    })}
                  </View>
                ) : null}
              </View>
            </View>
          ) : (
            /* ── THE PAGE ── words second */
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingTop: 12, minHeight: 44 }}>
                <TouchableOpacity onPress={() => commit(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <Text style={{ color: C.sub, fontSize: 14, fontWeight: '600' }}>Close</Text>
                </TouchableOpacity>
                {saved
                  ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Feather name="check" size={16} color={accent} /><Text style={{ color: accent, fontSize: 15, fontWeight: '800' }}>Kept</Text></View>
                  : <TouchableOpacity onPress={() => commit(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><Text style={{ color: accent, fontSize: 15, fontWeight: '800' }}>Done</Text></TouchableOpacity>}
              </View>
              <Animated.View key={mood ?? 'none'} entering={FadeIn.duration(300)} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={{ paddingHorizontal: 30, paddingTop: 18, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    {moodObj ? (
                      <TouchableOpacity onPress={() => setPhase('pick')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 100, backgroundColor: moodObj.color + '22' }}>
                        <Feather name={moodObj.icon as any} size={13} color={moodObj.color} />
                        <Text style={{ color: C.sub, fontSize: 12, fontWeight: '700' }}>{moodObj.label}</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity onPress={() => setPhase('pick')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={{ color: C.faint, fontSize: 12, fontWeight: '700' }}>add a feeling</Text></TouchableOpacity>
                    )}
                    <Text style={{ color: C.faint, fontSize: 12, fontWeight: '600' }}>{dateLabel}</Text>
                  </View>
                  <TouchableOpacity activeOpacity={0.7} onPress={() => setPromptBump(b => b + 1)}>
                    <Text style={{ fontFamily: SERIF, color: C.ink, fontSize: 23, lineHeight: 31, marginBottom: 18 }}>{prompt}</Text>
                  </TouchableOpacity>
                  <TextInput value={text} onChangeText={setText} placeholder="Start where you are…" placeholderTextColor={C.faint}
                    multiline autoFocus selectionColor={accent}
                    style={{ fontFamily: SERIF, color: C.ink, fontSize: 19, lineHeight: 31, minHeight: 240, textAlignVertical: 'top' }} />
                  <TouchableOpacity onPress={() => setPromptBump(b => b + 1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ alignSelf: 'flex-start', marginTop: 10 }}>
                    <Text style={{ color: C.sub, fontSize: 13, fontWeight: '600' }}>ask me something else</Text>
                  </TouchableOpacity>
                </ScrollView>
              </Animated.View>
              {saved ? (
                <Animated.View entering={FadeIn.duration(220)} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="check" size={26} color={accent} />
                  <Text style={{ fontFamily: SERIF, color: C.ink, fontSize: 24, marginTop: 12 }}>Kept.</Text>
                  <Text style={{ color: C.sub, fontSize: 14, marginTop: 6 }}>That’s today.</Text>
                </Animated.View>
              ) : null}
            </KeyboardAvoidingView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}
