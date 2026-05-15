/**
 * Backup / Restore.
 *
 * Two ops:
 *   exportBackup() — packages every persisted slice into a versioned JSON
 *     envelope, writes to a temp file, opens the share sheet so the user can
 *     save to Files / iCloud / Drive / wherever.
 *
 *   importBackup() — opens document picker, parses the file, runs migrations
 *     if the file is from an older version, validates the version, and returns
 *     the parsed payload. The CALLER (Settings UI) decides which slices to
 *     actually apply — the user can selectively restore.
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
import { Platform } from 'react-native';
import { useAppStore } from '../store/useAppStore';

// Bump this whenever the schema shape changes in a way that needs migration.
//   v1: original — single `notes` array, included diaryEntries + preferences.
//   v2: notes split into Regular / Capsules / Private; diaryEntries dropped
//       (incomplete feature, returns with Notes-tab rework); all preferences
//       dropped (user re-configures on a fresh device).
export const CURRENT_VERSION = 2;

// What goes in a backup file. Data only — no preferences or app-internal
// state. Notes are split by category so the picker can offer "Capsules" vs
// "Private notes" as distinct rows; the underlying store keeps a single
// `notes` array, so applyBackup merges sub-categories back together by id.
export type BackupPayload = {
  // Timeline-ish data
  activities?: any[];
  intents?: any[];
  dayNotes?: any[];
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
};

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
  // Timeline
  'activities', 'intents', 'dayNotes', 'dayLog', 'weeklyReflections',
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
  activities:        'Timeline blocks',
  intents:           'Intents',
  dayNotes:          'Day notes',
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
    keys: ['activities', 'intents', 'dayNotes', 'dayLog', 'weeklyReflections'],
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
    const envelope: BackupEnvelope = {
      version: CURRENT_VERSION,
      exportedAt: new Date().toISOString(),
      app: 'day-progress',
      payload,
    };
    // Filename: dayprogress-backup-YYYY-MM-DD-HHmm.json
    const d = new Date();
    const stamp =
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` +
      `-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const filename = `dayprogress-backup-${stamp}.json`;
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) return { ok: false, reason: 'Could not access cache directory.' };
    const path = `${cacheDir}${filename}`;
    await FileSystem.writeAsStringAsync(path, JSON.stringify(envelope, null, 2), {
      encoding: FileSystem.EncodingType.UTF8,
    });
    // Share sheet — user picks Files / iCloud / Drive / Email / etc. On platforms
    // without sharing (rare), surface the file path so the user knows where it is.
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, {
        mimeType: 'application/json',
        dialogTitle: 'Save backup',
        UTI: 'public.json',
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
  | { ok: true; payload: BackupPayload; envelope: BackupEnvelope }
  | { ok: false; reason: string; cancelled?: boolean }
> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'public.json', '*/*'],
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

    // Read the file. legacy FileSystem.readAsStringAsync handles file:// URIs
    // (which is what copyToCacheDirectory: true gives us). On platforms where
    // it returns a content:// or other scheme it might fail; fall back to
    // fetch() which handles those natively.
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

    // Strip a UTF-8 BOM if the file picker / save flow added one — common on
    // Windows-saved files that round-trip through cloud storage.
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

    let parsed: any;
    try { parsed = JSON.parse(raw); }
    catch (parseErr: any) {
      return { ok: false, reason: `File is not valid JSON: ${parseErr?.message || 'parse error'}` };
    }

    // Validate STRUCTURE rather than strict app marker. A real Day Progress
    // backup has { version: number, payload: object, ... } — that's enough to
    // be confident. The `app` marker is checked when present (warns the user
    // if it's missing or different) but no longer hard-rejects, because we
    // were seeing false negatives on round-tripped files. Any structurally
    // valid envelope passes.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'File is not a backup envelope (expected an object).' };
    }
    if (typeof parsed.version !== 'number') {
      return { ok: false, reason: `Missing or invalid "version" field (got ${typeof parsed.version}). Is this a Day Progress backup?` };
    }
    if (!parsed.payload || typeof parsed.payload !== 'object' || Array.isArray(parsed.payload)) {
      return { ok: false, reason: 'Missing or invalid "payload" object — file does not look like a backup.' };
    }
    if (parsed.version > CURRENT_VERSION) {
      return {
        ok: false,
        reason: `This backup is from a newer app version (v${parsed.version}). Update the app first, then try again.`,
      };
    }
    // Soft check: if app marker is present and wrong, refuse. If absent, allow.
    if (typeof parsed.app === 'string' && parsed.app !== 'day-progress') {
      return { ok: false, reason: `File belongs to a different app ("${parsed.app}"). Expected "day-progress".` };
    }

    // Migrate forward through any version gaps. Each step is keyed by the
    // FROM version — i.e., MIGRATIONS[1] takes a v1 payload to v2 shape.
    let payload: BackupPayload = parsed.payload;
    for (let v = parsed.version; v < CURRENT_VERSION; v++) {
      const step = MIGRATIONS[v];
      if (step) payload = step(payload);
    }

    return { ok: true, payload, envelope: parsed as BackupEnvelope };
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
    const incomingIds = new Set(incoming.map((n: any) => n?.id).filter(Boolean));
    const currentNotes = ((useAppStore.getState() as any).notes ?? []) as any[];
    const retained = currentNotes.filter(n => !incomingIds.has(n.id));
    slice.notes = [...retained, ...incoming];
  }

  // Regular keys: straight overwrite.
  for (const key of selectedKeys) {
    if (NOTE_SUB_KEYS.includes(key)) continue;
    if ((payload as any)[key] !== undefined) {
      slice[key] = (payload as any)[key];
    }
  }

  if (Object.keys(slice).length === 0) return;
  // useAppStore.setState merges shallow — exactly what we want.
  (useAppStore as any).setState(slice);
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
    delete out.endOfWeekDay;
    // Also strip any internal counters that may have leaked into older files
    // before they were excluded — defensive cleanup.
    delete out.navRevealCount;
    delete out.lastWeeklyReviewDismissed;
    delete out.whispersSeen;
    delete out.lastEclipseVariation;
    return out;
  },
};
