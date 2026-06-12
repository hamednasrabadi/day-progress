/**
 * UI sound effects — central manager. Everything plays through playSfx(name);
 * the event→file map lives in FILES below, so swapping a sound is a one-line
 * change — or just drop a new .wav into assets/sfx with the same name (zero
 * code change).
 *
 * Why fresh-create-per-play (not a preloaded shared instance): a shared Sound
 * goes cold across tab switches — the OS releases idle native players, so the
 * first tap after navigating was swallowed (it only revived the player) and
 * only the second tap was heard. Creating a fresh, already-loaded player and
 * starting it with shouldPlay:true plays immediately, every time. The clips are
 * tiny (~20–30 KB) so the create cost is negligible, and each unloads on finish.
 *
 * Behaviour:
 *   - Gated by the persisted `soundEnabled` flag (Settings → Sounds).
 *   - Respects the iOS silent switch (playsInSilentModeIOS:false). Haptics still
 *     fire when muted, so feedback never disappears.
 *   - Ambient/mixing session so sounds mix with the user's music and the session
 *     stays warm between plays.
 *
 * Current files = the "wood" family (tactile knock) — picked in the Sound Lab.
 * To swap any sound, drop a new .wav into assets/sfx with the same name.
 */
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import { useAppStore } from '../store/useAppStore';

export type SfxName = 'tap' | 'check' | 'complete' | 'success' | 'undo';

// The single source of truth for which file plays for which moment.
const FILES: Record<SfxName, number> = {
  tap: require('../assets/sfx/tap.wav'),
  check: require('../assets/sfx/check.wav'),
  complete: require('../assets/sfx/complete.wav'),
  success: require('../assets/sfx/success.wav'),
  undo: require('../assets/sfx/undo.wav'),
};

let configured = false;

// Set the audio session once at app start (called from app/_layout.tsx).
export async function preloadSounds(): Promise<void> {
  if (configured) return;
  configured = true;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: false,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      shouldDuckAndroid: false,
    });
  } catch {}
}

export function playSfx(name: SfxName, rate = 1): void {
  if (!useAppStore.getState().soundEnabled) return;
  const mod = FILES[name];
  if (mod == null) return;
  // rate !== 1 pitch-shifts (shouldCorrectPitch:false) — ADHD Mode climbs the wood
  // knock as the cleared pile grows. Default rate 1 leaves every other sfx unchanged.
  Audio.Sound.createAsync(mod, { shouldPlay: true, rate, shouldCorrectPitch: false })
    .then(({ sound }) => {
      sound.setOnPlaybackStatusUpdate((st: any) => {
        if (st.isLoaded && st.didJustFinish) sound.unloadAsync().catch(() => {});
      });
    })
    .catch(() => {});
}
