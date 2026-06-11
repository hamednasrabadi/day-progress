/**
 * Backup / Restore.
 *
 * Two ops:
 *   exportBackup() — packages every persisted slice into a versioned envelope,
 *     bundles it with the referenced media files (images + voice memos) into a
 *     .zip, and opens the share sheet (Files / iCloud / Drive / wherever).
 *
 *   pickAndReadBackup() — opens the document picker and reads the file. A .zip
 *     (current format) extracts its media into documentDirectory and remaps the
 *     note URIs; a .json (legacy) imports text only. Both validate + migrate.
 *     The CALLER (Settings UI) decides which slices to apply on restore.
 *
 * Forward-compat strategy:
 *   - Each export carries `version` (integer, monotonically increasing).
 *   - Older versions: a chain of pure migration functions runs to bring the
 *     payload up to the current schema. Add a new migration when the schema
 *     changes; the chain runs in order.
 *   - Newer versions (file > current): refuse with a clear message. We don't
 *     know how to safely down-migrate.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import JSZip from 'jszip';
import { Platform } from 'react-native';
import { useAppStore } from '../store/useAppStore';
import { sanitizeStateSlice } from './sanitize';

// Bump this whenever the schema shape changes in a way that needs migration.
//   v1: original — single `notes` array, included diaryEntries + preferences.
//   v2: notes split into Regular / Capsules / Private; diaryEntries dropped
//       (incomplete feature, returns with Notes-tab rework); all preferences
//       dropped (user re-configures on a fresh device).
//   v3: progressive-unlock meta added (unlock state, counters, promiseStats) —
//       always-included, never user-selectable. v2 files lack these keys; the
//       v2→v3 migration is a no-op since applyBackup skips undefined meta.
export const CURRENT_VERSION = 3;

// What goes in a backup file. Data only — no preferences or app-internal
// state. Notes are split by category so the picker can offer "Capsules" vs
// "Private notes" as distinct rows; the underlying store keeps a single
// `notes` array, so applyBackup merges sub-categories back together by id.
export type BackupPayload = {
  // Timeline-ish data — the kept slices (rehomed into Habits in Phase 1).
  intents?: any[];
  dayLog?: Record<string, any>;
  weeklyReflections?: Record<string, any>;
  // Tasks
  tasks?: any[];
  projects?: any[];
  // Habits + pact (Habits tab owns the pact mechanic)
  habits?: any[];
  pact?: any;
  // Goals (challenges) + their adjacent history
  challenges?: any[];
  achievements?: any[];
  deepWorkSessions?: any[];
  // Notes — split by category. Each is a Note[]; on apply they merge by id
  // into the single store-level `notes` array.
  notesRegular?: any[];   // status='active', !isSealed, !isLocked
  notesCapsules?: any[];  // isSealed
  notesPrivate?: any[];   // isLocked && !isSealed

  // ── Meta (always included, never user-selectable) ──
  // Progressive-unlock state + counters + lifetime stats. These ride along
  // with EVERY backup and restore unconditionally — the user never sees them
  // in the picker and never chooses to include/exclude them. Without this, a
  // restored backup would lose the user's unlock standing (re-locking earned
  // features, re-showing dots/whispers, resetting the day counter).
  unlockedFeatures?: Record<string, boolean>;
  dotsSeen?: Record<string, boolean>;
  allFeaturesUnlocked?: boolean;
  installDate?: string | null;
  lastKnownDate?: string | null;
  whispersSeen?: Record<string, boolean>;
  totalTasksCreated?: number;
  totalNotesCreated?: number;
  diaryEntriesCreated?: number;
  totalBlocksCreated?: number;
  dayRatingsCount?: number;
  activeDaysWithBlock?: number;
  lastActiveDayCounted?: string | null;
  totalHabitsCreated?: number;
  maxSingleHabitCompletions?: number;
  dayConqueredEver?: boolean;
  totalChallengesCreated?: number;
  promiseStats?: any;
  introSeen?: boolean;
};

// Meta slices that ALWAYS travel with a backup and ALWAYS restore, regardless
// of which content the user selected. Kept out of ALL_KEYS so they never
// appear in the picker. installDate is preserved from the file on restore
// (never reset) — that's the unlock spec's requirement.
const META_KEYS = [
  'unlockedFeatures', 'dotsSeen', 'allFeaturesUnlocked',
  'installDate', 'lastKnownDate', 'whispersSeen',
  'totalTasksCreated', 'totalNotesCreated', 'diaryEntriesCreated',
  'totalBlocksCreated', 'dayRatingsCount', 'activeDaysWithBlock', 'lastActiveDayCounted',
  'totalHabitsCreated', 'maxSingleHabitCompletions', 'dayConqueredEver',
  'totalChallengesCreated', 'promiseStats', 'introSeen',
] as const;

export type BackupEnvelope = {
  // Schema version this file was written against
  version: number;
  // ISO timestamp the backup was created
  exportedAt: string;
  // App identity — guards against accidentally importing a file from a
  // different app that happens to be JSON-shaped
  app: 'day-progress';
  // The actual data
  payload: BackupPayload;
};

// ─── KEY LISTS ───────────────────────────────────────────────────────────
// Backup keys = data only. Preferences (theme, notif toggles, etc.) are NOT
// backed up — the user re-configures those on a fresh device, and removing
// them keeps the picker focused on actual data.
export const ALL_KEYS = [
  // Timeline keepers — rehomed into Habits in Phase 1. (activities / dayNotes /
  // birthdays were cut in the calm pivot; the v5 persist migration strips them.)
  'intents', 'dayLog', 'weeklyReflections',
  // Tasks
  'tasks', 'projects',
  // Habits
  'habits', 'pact',
  // Goals
  'challenges', 'achievements', 'deepWorkSessions',
  // Notes (split by category — see NOTE_SUB_KEYS below)
  'notesRegular', 'notesCapsules', 'notesPrivate', 'notesDiary',
] as const;
export type BackupKey = typeof ALL_KEYS[number];

// The note sub-keys are virtual — they don't exist as standalone slices in
// the store; on export we filter the live `notes` array, on import we merge
// them back into a single `notes` slice by id. This lets the picker offer
// "Capsules" and "Private notes" as separate rows without a schema change
// in the runtime store.
export const NOTE_SUB_KEYS: BackupKey[] = ['notesRegular', 'notesCapsules', 'notesPrivate', 'notesDiary'];

// Predicate for each note sub-category. Mutually exclusive by intent — an
// isSealed note ALWAYS counts as a capsule even if it's also locked, and a
// `kind: 'diary'` note ALWAYS counts as diary even if it's locked or grouped.
// "Private" and "Regular" both exclude diary so the picker counts don't
// double up.
export function noteMatchesKey(note: any, key: BackupKey): boolean {
  if (!note) return false;
  const isDiary = note.kind === 'diary';
  switch (key) {
    case 'notesDiary':
      return isDiary;
    case 'notesCapsules':
      return note.isSealed === true && !isDiary;
    case 'notesPrivate':
      return note.isLocked === true && !note.isSealed && !isDiary;
    case 'notesRegular':
      return note.status === 'active' && !note.isSealed && !note.isLocked && !isDiary;
    default:
      return false;
  }
}

// Human-readable labels for each slice — used by the import UI's checklist.
// Keep this aligned with ALL_KEYS; the picker iterates these in order.
export const KEY_LABELS: Record<BackupKey, string> = {
  intents:           'Intents',
  dayLog:            'Day ratings',
  weeklyReflections: 'Weekly reflections',
  tasks:             'Tasks',
  projects:          'Projects',
  habits:            'Habits',
  pact:              'Pact',
  challenges:        'Goals',
  achievements:      'Achievements',
  deepWorkSessions:  'Deep work history',
  notesRegular:      'Notes',
  notesCapsules:     'Capsules',
  notesPrivate:      'Private notes',
  notesDiary:        'Diary',
};

// Counts for each slice — shown in the import picker so the user knows what's
// in the file before they restore. Returns "—" for non-array primitive slices,
// and a numeric count for arrays / object maps.
export function describeCount(key: BackupKey, value: any): string {
  if (value == null) return '—';
  if (Array.isArray(value)) return `${value.length}`;
  if (typeof value === 'object') return `${Object.keys(value).length}`;
  return String(value);
}

// ─── TAB GROUPS ─────────────────────────────────────────────────────────
// Slices grouped into 5 tabs that mirror the app's mental model. Backup
// pickers (import + export) render these as tabs with a Select-all toggle
// per tab, plus per-row checkboxes inside each tab. Power users can micro-
// select; casual users hit the tab toggle and move on.
//
// "Other" is the catch-all for cross-cutting state — Notes (Notes-tab data
// that doesn't fit anywhere else), Diary entries (orphaned awaiting their
// move into Notes), and every preference flag. Keeping prefs separate from
// data is intentional — restoring "data only" is a common case (you've
// already configured your settings, just want yesterday's tasks back).
export type BackupTab = {
  id: string;
  label: string;
  keys: BackupKey[];
};

export const TAB_GROUPS: BackupTab[] = [
  {
    id: 'timeline',
    label: 'Timeline',
    // activities / dayNotes / birthdays were cut in the calm pivot (Phase 0).
    // The remaining three are rehomed into Habits in Phase 1, where this
    // group's label moves with them.
    keys: ['intents', 'dayLog', 'weeklyReflections'],
  },
  {
    id: 'tasks',
    label: 'Tasks',
    keys: ['tasks', 'projects'],
  },
  {
    id: 'habits',
    label: 'Habits',
    // Pact lives here — it's owned by the Habits tab in the UI; the only
    // Timeline touch is the deadline hairline on the week strip.
    keys: ['habits', 'pact'],
  },
  {
    id: 'goals',
    label: 'Goals',
    keys: ['challenges', 'achievements', 'deepWorkSessions'],
  },
  {
    id: 'notes',
    label: 'Notes',
    // Split by category so users can selectively restore. Note serialization
    // preserves all capsule fields (isSealed, unlockDate, unlockOnChallengeId,
    // history, audio + image refs) — sealed capsules round-trip with their
    // unlock state intact.
    keys: ['notesRegular', 'notesCapsules', 'notesPrivate', 'notesDiary'],
  },
];

// ─── EXPORT ─────────────────────────────────────────────────────────────
// Pulls persisted slices from the store, wraps in the envelope, writes to a
// timestamped file in the app's cache, opens the share sheet. Caller gets a
// result object so it can show success/failure UI.
//
// keys: optional subset of ALL_KEYS — if provided, only those slices are
// included in the file. Used by the "Selective export" path. Default
// behavior (no keys arg) exports everything.
// ─── MEDIA BUNDLING ─────────────────────────────────────────────────────
// Notes reference image + voice-memo FILES (in documentDirectory) by URI. A
// .json backup carries only those refs, so media breaks on restore to a new
// device. The .zip backup bundles the actual files under media/<filename>, and
// the import remaps each note's URIs to the freshly-extracted local copies.
const NOTE_KEYS_WITH_MEDIA = ['notesRegular', 'notesCapsules', 'notesPrivate', 'notesDiary'] as const;
const baseName = (uri: string) => uri.split('/').pop() || uri;

function collectMediaUris(payload: BackupPayload): string[] {
  const set = new Set<string>();
  for (const k of NOTE_KEYS_WITH_MEDIA) {
    const arr = (payload as any)[k];
    if (!Array.isArray(arr)) continue;
    for (const n of arr) {
      if (Array.isArray(n?.imageUris)) for (const u of n.imageUris) { if (typeof u === 'string') set.add(u); }
      if (Array.isArray(n?.audio)) for (const m of n.audio) { if (typeof m?.uri === 'string') set.add(m.uri); }
    }
  }
  return Array.from(set);
}

// Rewrite note media URIs to the freshly-extracted local files (map: basename →
// new uri). URIs we couldn't extract are left untouched.
function remapNoteMedia(payload: BackupPayload, map: Record<string, string>): void {
  for (const k of NOTE_KEYS_WITH_MEDIA) {
    const arr = (payload as any)[k];
    if (!Array.isArray(arr)) continue;
    for (const n of arr) {
      if (Array.isArray(n?.imageUris)) n.imageUris = n.imageUris.map((u: string) => map[baseName(u)] || u);
      if (Array.isArray(n?.audio)) n.audio = n.audio.map((m: any) => (m?.uri && map[baseName(m.uri)] ? { ...m, uri: map[baseName(m.uri)] } : m));
    }
  }
}

export async function exportBackup(opts?: { keys?: BackupKey[] }): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  try {
    const state = useAppStore.getState() as any;
    const keys = opts?.keys && opts.keys.length > 0 ? opts.keys : (ALL_KEYS as readonly BackupKey[]);
    const payload: BackupPayload = {};
    const allNotes = Array.isArray(state.notes) ? state.notes : [];
    for (const key of keys) {
      if (NOTE_SUB_KEYS.includes(key)) {
        // Note sub-keys are virtual — filter the live notes array by category.
        // Empty buckets are dropped (consistent with how regular keys handle
        // undefined values; keeps the file lean).
        const filtered = allNotes.filter((n: any) => noteMatchesKey(n, key));
        if (filtered.length > 0) (payload as any)[key] = filtered;
      } else if (state[key] !== undefined) {
        // Real slice — copy as-is. (Some keys may be undefined on a first-
        // launch user; dropping them keeps the file lean.)
        (payload as any)[key] = state[key];
      }
    }
    // Meta always rides along, regardless of selected keys — the user never
    // chooses these. Even a "Tasks only" selective export carries the full
    // unlock state so a restore can't strand the user mid-progression.
    for (const mk of META_KEYS) {
      if (state[mk] !== undefined) (payload as any)[mk] = state[mk];
    }
    const envelope: BackupEnvelope = {
      version: CURRENT_VERSION,
      exportedAt: new Date().toISOString(),
      app: 'day-progress',
      payload,
    };
    // Bundle the JSON envelope + every referenced media file into a .zip so
    // images and voice memos survive a restore on a new device. A stale/missing
    // ref is skipped rather than failing the whole export.
    const zip = new JSZip();
    zip.file('backup.json', JSON.stringify(envelope, null, 2));
    const mediaFolder = zip.folder('media');
    for (const uri of collectMediaUris(payload)) {
      try {
        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        mediaFolder?.file(baseName(uri), b64, { base64: true });
      } catch { /* skip unreadable/missing media */ }
    }
    const zipBase64 = await zip.generateAsync({ type: 'base64' });

    // Filename: dayprogress-backup-YYYY-MM-DD-HHmm.zip
    const d = new Date();
    const stamp =
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` +
      `-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const filename = `dayprogress-backup-${stamp}.zip`;
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) return { ok: false, reason: 'Could not access cache directory.' };
    const path = `${cacheDir}${filename}`;
    await FileSystem.writeAsStringAsync(path, zipBase64, { encoding: FileSystem.EncodingType.Base64 });

    // Android: let the user pick a folder and write the .zip straight there — no
    // share sheet. Falls back to the share sheet if they dismiss the folder picker.
    if (Platform.OS === 'android') {
      try {
        const saf = FileSystem.StorageAccessFramework;
        const perm = await saf.requestDirectoryPermissionsAsync();
        if (perm.granted) {
          const destUri = await saf.createFileAsync(perm.directoryUri, filename.replace(/\.zip$/, ''), 'application/zip');
          await FileSystem.writeAsStringAsync(destUri, zipBase64, { encoding: FileSystem.EncodingType.Base64 });
          return { ok: true, path: destUri };
        }
      } catch { /* fall through to the share sheet */ }
    }

    // iOS (and the Android fallback): the OS share sheet — "Save to Files" lives here.
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, {
        mimeType: 'application/zip',
        dialogTitle: 'Save backup',
        UTI: 'public.zip-archive',
      });
    }
    return { ok: true, path };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'Export failed.' };
  }
}

// ─── IMPORT ─────────────────────────────────────────────────────────────
// Opens document picker, reads + parses the file, validates the envelope shape
// + version, runs migrations if needed, returns the migrated payload. Caller
// (the Settings UI) decides which slices to actually write back.
export async function pickAndReadBackup(): Promise<
  | { ok: true; payload: BackupPayload; envelope: BackupEnvelope; finalizeMedia?: (onProgress?: (done: number, total: number) => void) => Promise<void> }
  | { ok: false; reason: string; cancelled?: boolean }
> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/zip', 'public.zip-archive', 'application/json', 'public.json', '*/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    // Newer DocumentPicker returns { canceled, assets: [...] }; older returns a
    // single object with .uri / .type. Handle both.
    if ((result as any).canceled || (result as any).type === 'cancel') {
      return { ok: false, reason: 'Cancelled.', cancelled: true };
    }
    const asset = (result as any).assets ? (result as any).assets[0] : (result as any);
    const uri: string | undefined = asset?.uri;
    if (!uri) return { ok: false, reason: 'No file selected.' };
    const name: string = (asset?.name as string) || '';

    // Read the bytes as base64 — binary-safe, works for both .zip and .json.
    let b64: string;
    try {
      b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    } catch (readErr: any) {
      return { ok: false, reason: `Couldn't read the file: ${readErr?.message || 'unknown error'}` };
    }

    // ZIP backup (current format) — detected by the "PK" magic (base64 begins
    // "UEsD") or a .zip name. Extracts bundled media + remaps note URIs.
    if (b64.startsWith('UEsD') || /\.zip$/i.test(name)) {
      return await readZipBackup(b64);
    }

    // JSON backup (legacy) — text only, no media. Re-read as UTF-8 and parse.
    // (Older builds, and any backup made before the zip format, land here.)
    let raw: string;
    try {
      raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
    } catch (readErr: any) {
      try {
        const resp = await fetch(uri);
        raw = await resp.text();
      } catch (fetchErr: any) {
        return { ok: false, reason: `Couldn't read the file: ${readErr?.message || fetchErr?.message || 'unknown error'}` };
      }
    }
    // Strip a UTF-8 BOM if a Windows/cloud round-trip added one.
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    let parsed: any;
    try { parsed = JSON.parse(raw); }
    catch (parseErr: any) {
      return { ok: false, reason: `File is not valid JSON: ${parseErr?.message || 'parse error'}` };
    }
    const res = validateAndMigrate(parsed);
    if (!res.ok) return res;
    return { ok: true, payload: res.payload, envelope: res.envelope };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'Import failed.' };
  }
}

// Apply a (possibly partial) payload to the store, restricted to the user's
// selected keys.
//   - Regular slice keys: overwrite the store's slice with the file's value.
//   - Note sub-keys (notesRegular / notesCapsules / notesPrivate): combine
//     each selected sub-key's notes array, then MERGE BY ID into the current
//     `notes` slice (incoming wins on id conflict; uninvolved current notes
//     are retained). This lets the user import "Capsules only" without wiping
//     their regular notes — and vice versa.
// Non-selected keys retain whatever is currently in the store.
export function applyBackup(payload: BackupPayload, selectedKeys: BackupKey[]): void {
  const slice: any = {};

  // Handle note sub-keys: union the selected categories' notes, merge by id
  // into the current store's notes array.
  const selectedNoteKeys = selectedKeys.filter(k => NOTE_SUB_KEYS.includes(k));
  if (selectedNoteKeys.length > 0) {
    const incoming: any[] = [];
    for (const k of selectedNoteKeys) {
      const arr = (payload as any)[k];
      if (Array.isArray(arr)) incoming.push(...arr);
    }
    // Overwrite, don't merge: drop every current note that belongs to a restored
    // category and keep only notes OUTSIDE those categories (e.g. trashed). A full
    // restore (all four note categories) therefore replaces the notes wholesale.
    const currentNotes = ((useAppStore.getState() as any).notes ?? []) as any[];
    const retained = currentNotes.filter(n => !selectedNoteKeys.some(k => noteMatchesKey(n, k)));
    slice.notes = [...retained, ...incoming];
  }

  // Regular keys: straight overwrite.
  for (const key of selectedKeys) {
    if (NOTE_SUB_KEYS.includes(key)) continue;
    if ((payload as any)[key] !== undefined) {
      slice[key] = (payload as any)[key];
    }
  }

  // Meta always restores, regardless of what content the user selected — the
  // unlock state must stay coherent with the data. Absent from older files
  // (pre-v3); the undefined check skips those cleanly.
  for (const mk of META_KEYS) {
    if ((payload as any)[mk] !== undefined) {
      slice[mk] = (payload as any)[mk];
    }
  }

  if (Object.keys(slice).length === 0) return;
  // Normalize every imported slice to a safe shape before it reaches the live
  // store — an old or foreign backup may carry habits/notes/slices missing the
  // array fields current renderers assume, and setState writes them verbatim.
  // useAppStore.setState merges shallow — exactly what we want.
  (useAppStore as any).setState(sanitizeStateSlice(slice));
}

// ─── MIGRATIONS ─────────────────────────────────────────────────────────
// Each function takes the payload at its source version and returns the
// payload at version+1. They must be PURE (no side effects, no store reads)
// and should never throw on well-formed input.
//
// v1 → v2 splits the single `notes` array into category sub-keys and drops
// fields that are no longer in the v2 schema (preferences, diaryEntries).
const MIGRATIONS: Record<number, (p: any) => any> = {
  1: (p) => {
    const out: any = { ...p };
    // Split `notes` → category sub-keys. Same predicates as the live export
    // path so old + new files are categorized identically.
    if (Array.isArray(p.notes)) {
      out.notesRegular = p.notes.filter((n: any) => noteMatchesKey(n, 'notesRegular'));
      out.notesCapsules = p.notes.filter((n: any) => noteMatchesKey(n, 'notesCapsules'));
      out.notesPrivate = p.notes.filter((n: any) => noteMatchesKey(n, 'notesPrivate'));
    }
    // Drop fields no longer in v2 schema. The apply path would ignore them
    // anyway (they're never in selectedKeys since the picker doesn't show
    // them), but cleaning the payload makes the migration's intent explicit.
    delete out.notes;
    delete out.diaryEntries;
    delete out.pactAutoNote;
    delete out.isDarkMode;
    delete out.calendarType;
    delete out.globalNotifsEnabled;
    delete out.preNotifOffset;
    delete out.ongoingBlockEnabled;
    delete out.streakRemindersEnabled;
    delete out.endOfWeekDay;
    // Also strip any internal counters that may have leaked into older files
    // before they were excluded — defensive cleanup.
    delete out.navRevealCount;
    delete out.lastWeeklyReviewDismissed;
    delete out.whispersSeen;
    delete out.lastEclipseVariation;
    return out;
  },
  // v2 → v3: no shape changes. v3 only ADDED optional meta keys (unlock state,
  // counters, promiseStats). A v2 file simply lacks them; applyBackup's
  // undefined-check leaves the fresh-install defaults in place. Pure no-op.
  2: (p) => p,
};

// Validate the envelope shape + forward-migrate to CURRENT_VERSION. Shared by
// both the .json and the .zip import paths.
function validateAndMigrate(parsed: any): { ok: true; payload: BackupPayload; envelope: BackupEnvelope } | { ok: false; reason: string } {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'File is not a backup envelope (expected an object).' };
  if (typeof parsed.version !== 'number') return { ok: false, reason: `Missing or invalid "version" field (got ${typeof parsed.version}). Is this a Day Progress backup?` };
  if (!parsed.payload || typeof parsed.payload !== 'object' || Array.isArray(parsed.payload)) return { ok: false, reason: 'Missing or invalid "payload" object — file does not look like a backup.' };
  if (parsed.version > CURRENT_VERSION) return { ok: false, reason: `This backup is from a newer app version (v${parsed.version}). Update the app first, then try again.` };
  if (typeof parsed.app === 'string' && parsed.app !== 'day-progress') return { ok: false, reason: `File belongs to a different app ("${parsed.app}"). Expected "day-progress".` };
  let payload: BackupPayload = parsed.payload;
  for (let v = parsed.version; v < CURRENT_VERSION; v++) { const step = MIGRATIONS[v]; if (step) payload = step(payload); }
  return { ok: true, payload, envelope: parsed as BackupEnvelope };
}

// Open a .zip backup: read backup.json, validate/migrate, extract bundled media
// into documentDirectory, and remap note URIs to the new local paths. Media
// from a cancelled restore is harmless (orphan files the next restore reuses).
async function readZipBackup(zipBase64: string): Promise<{ ok: true; payload: BackupPayload; envelope: BackupEnvelope; finalizeMedia: (onProgress?: (done: number, total: number) => void) => Promise<void> } | { ok: false; reason: string }> {
  try {
    const zip = await JSZip.loadAsync(zipBase64, { base64: true });
    const jsonEntry = zip.file('backup.json');
    if (!jsonEntry) return { ok: false, reason: 'Backup archive is missing backup.json.' };
    let parsed: any;
    try { parsed = JSON.parse(await jsonEntry.async('string')); }
    catch (e: any) { return { ok: false, reason: `backup.json is not valid JSON: ${e?.message || 'parse error'}` }; }
    const res = validateAndMigrate(parsed);
    if (!res.ok) return res;

    // Defer media extraction to restore-confirm time. Decompressing every image +
    // voice memo and writing it to disk takes seconds on a media-heavy backup; doing
    // it during the read blocked the confirm dialog for seconds. The caller runs
    // finalizeMedia() ONLY after the user confirms, so a cancelled restore writes nothing.
    const finalizeMedia = async (onProgress?: (done: number, total: number) => void) => {
      const dir = FileSystem.documentDirectory;
      if (!dir) return;
      const entries = Object.values(zip.files).filter(e => !e.dir && e.name.startsWith('media/'));
      const total = entries.length;
      onProgress?.(0, total);
      const map: Record<string, string> = {};
      let done = 0;
      for (const entry of entries) {
        const fname = entry.name.slice('media/'.length);
        if (fname) {
          try {
            const fb64 = await entry.async('base64');
            const dest = `${dir}${fname}`;
            await FileSystem.writeAsStringAsync(dest, fb64, { encoding: FileSystem.EncodingType.Base64 });
            map[fname] = dest;
          } catch { /* skip a bad media entry */ }
        }
        onProgress?.(++done, total);
      }
      remapNoteMedia(res.payload, map);
    };
    return { ok: true, payload: res.payload, envelope: res.envelope, finalizeMedia };
  } catch (e: any) {
    return { ok: false, reason: `Couldn't open the backup archive: ${e?.message || 'invalid zip'}` };
  }
}
