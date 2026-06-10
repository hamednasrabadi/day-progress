/**
 * Update check — the offline-first "a new version is out" nudge.
 *
 * The app stays fully local; this is the one outward ping. On launch we
 * best-effort fetch a tiny JSON manifest hosted on GitHub (a static file — no
 * server), compare its `latest` to this build's version, and surface a banner
 * if we're behind. Offline / blocked / 404 / malformed all resolve to null and
 * we stay silent — never an error in the user's face.
 *
 * Shipping a new-version notice = editing the manifest (bump `latest`, commit,
 * push). `min` lets a critical release force the update (blocks below it).
 */
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

// PUBLIC raw URL of the manifest — must be fetchable without auth, so the file
// has to live in a PUBLIC repo (or a public gist / GitHub Pages). To move it
// (e.g. to an in-region mirror), change ONLY this line. Shape below.
const MANIFEST_URL = 'https://raw.githubusercontent.com/hamednasrabadi/day-progress/master/version.json';

const DISMISS_KEY = 'dawn.updateDismissedVersion';
const TIMEOUT_MS = 6000;

export const CURRENT_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

export type UpdateManifest = { latest: string; min?: string; notes?: string; url?: string };
export type UpdateStatus = { current: string; latest: string; mandatory: boolean; notes?: string; url?: string };

// Numeric dotted-version compare: 1 if a is newer than b, -1 if older, 0 equal.
function compare(a: string, b: string): number {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function isNewer(latest: string, current: string): boolean {
  return compare(latest, current) > 0;
}

// Best-effort. Returns the update status when a newer version exists, else null.
// Never throws — offline, timeout, 404 (e.g. a private repo), or bad JSON → null.
export async function checkForUpdate(): Promise<UpdateStatus | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(MANIFEST_URL, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return null;
    const m = (await res.json()) as UpdateManifest;
    if (!m || typeof m.latest !== 'string') return null;
    if (!isNewer(m.latest, CURRENT_VERSION)) return null;
    const mandatory = typeof m.min === 'string' && compare(CURRENT_VERSION, m.min) < 0;
    return { current: CURRENT_VERSION, latest: m.latest, mandatory, notes: m.notes, url: m.url };
  } catch {
    return null;
  }
}

// Per-version "Later" memory, so a soft nudge shows once and doesn't nag every
// launch (a forced update ignores this).
export async function getDismissedVersion(): Promise<string | null> {
  try { return await AsyncStorage.getItem(DISMISS_KEY); } catch { return null; }
}

export async function setDismissedVersion(v: string): Promise<void> {
  try { await AsyncStorage.setItem(DISMISS_KEY, v); } catch { /* ignore */ }
}
