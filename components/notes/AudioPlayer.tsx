/**
 * AudioPlayer — pill-shaped voice-memo player used by the editor and by the
 * diary timeline view. Single-active enforcement is via the activeAudioUri
 * prop: whoever's mounted listens for changes, and pauses itself when the
 * URI no longer matches its own. Lift the state to whichever screen contains
 * the players you want to coordinate.
 */

import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';

type Theme = {
  bg: string;
  border: string;
  textMain: string;
};

export function AudioPlayer({
  uri, durationStr, theme, activeAudioUri, setActiveAudioUri,
}: {
  uri: string;
  durationStr: string;
  theme: Theme;
  activeAudioUri: string | null;
  setActiveAudioUri: (uri: string | null) => void;
}) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // Pause this player whenever a different URI becomes the active one — keeps
  // audio playback to a single track at a time across mounted instances.
  useEffect(() => {
    if (activeAudioUri !== uri && isPlaying && sound) {
      sound.pauseAsync().catch(() => {});
      setIsPlaying(false);
    }
  }, [activeAudioUri, uri, isPlaying, sound]);

  // Free the native sound resource on unmount.
  useEffect(() => {
    return sound ? () => { sound.unloadAsync().catch(() => {}); } : undefined;
  }, [sound]);

  const togglePlayback = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (sound) {
        if (isPlaying) {
          await sound.pauseAsync();
          setIsPlaying(false);
        } else {
          setActiveAudioUri(uri);
          if (progress >= 0.99) await sound.setPositionAsync(0);
          await sound.playAsync();
          setIsPlaying(true);
        }
      } else {
        setActiveAudioUri(uri);
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true, progressUpdateIntervalMillis: 50 },
          (status) => {
            if (status.isLoaded) {
              if (status.durationMillis) setProgress(status.positionMillis / status.durationMillis);
              if (status.didJustFinish) {
                setIsPlaying(false);
                newSound.pauseAsync();
                setProgress(1);
              }
            }
          }
        );
        setSound(newSound);
        setIsPlaying(true);
      }
    } catch (e) {
      console.warn('Playback failed', e);
    }
  };

  return (
    <TouchableOpacity
      onPress={togglePlayback}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.bg, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 100, alignSelf: 'flex-start', borderWidth: 1, borderColor: theme.border, minWidth: 160 }}
    >
      <Feather name={isPlaying ? 'pause' : 'play'} size={16} color={theme.textMain} />
      <View style={{ flex: 1, height: 4, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${progress * 100}%` as any, backgroundColor: theme.textMain }} />
      </View>
      <Text style={{ color: theme.textMain, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
        {durationStr}
      </Text>
    </TouchableOpacity>
  );
}
