import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { createMMKV } from 'react-native-mmkv';
import { Feather } from '@expo/vector-icons';
// Imported for unlockAll's "mark every dot/whisper seen" loop. Circular —
// lib/unlocks.ts imports useAppStore — but resolved safely: lib/unlocks only
// USES useAppStore inside function bodies, never at top-level eval, so the
// live-binding completes by the time these closures run.
import { ALL_FEATURE_IDS } from '../lib/unlocks';
// Runtime-only edge (habitScore imports just the Habit *type* from here, which
// is erased at compile time — no circular dependency at runtime).
import { isDayConquered } from '../lib/habitScore';
import { sanitizeStateSlice } from '../lib/sanitize';

// ─── STORAGE ───
export const storage = createMMKV({ id: 'titan-storage' });

// The persisted zustand store key.
//
// ⚠️  RELEASE SAFETY — do NOT bump this suffix (or the MMKV `id` above) in any
// build shipped to real users. Bumping it starts a FRESH store: every user opens
// to a blank app (their data is orphaned under the old key, and the cleanup just
// below then deletes it). It was bumped freely during development to reset state
// — that era is over now that real data exists. To change the data SHAPE between
// releases, bump the persist `version` + add a `migrate` step (which upgrades
// existing data in place); to add a brand-new field, do nothing (the default
// merge backfills it). Older dev bumps left orphaned blobs, cleaned up below.
const STORAGE_NAME = 'titan-app-storage-v28';

// One rolling snapshot of the pre-migration blob, written by `migrate` below
// right before it transforms data — a safety net so a buggy future migration is
// always recoverable with zero manual export. Deliberately NOT matched by the
// stale-blob cleanup regex, so it survives.
const PREMIGRATE_BACKUP_KEY = 'titan-app-storage__premigrate_backup';

// One-time housekeeping on cold start: drop the orphaned blobs left by older
// STORAGE_NAME versions (titan-app-storage-v1..v27) that no current code reads,
// then trim() so MMKV actually reclaims the freed disk + memory (it does not
// shrink the file on its own after deletes). Best-effort + idempotent — a no-op
// once nothing stale remains.
try {
  const stale = storage.getAllKeys().filter((k) => /^titan-app-storage-v\d+$/.test(k) && k !== STORAGE_NAME);
  if (stale.length) {
    for (const k of stale) storage.remove(k);
    storage.trim();
  }
} catch {}

// ── Unlock whisper queue item ─────────────────────────────────────────────
// One whisper in the global announcement queue. featureIds are the unlock
// IDs this whisper represents; dismissing it marks each one as seen. The
// 3+-collapse case produces a single whisper with the union of all queued
// IDs and a generic message.
export type UnlockWhisper = { featureIds: string[]; message: string };

const zustandStorage: StateStorage = {
  setItem: (name, value) => storage.set(name, value),
  getItem: (name) => storage.getString(name) ?? null,
  removeItem: (name) => storage.remove(name),
};

// Local calendar date as YYYY-MM-DD (mirrors getFormatDateStr in the habits
// tab — minute-offset trick so the user's local day is what gets stored).
const localDateStr = (d: Date = new Date()): string => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
};

// ─── HABIT TYPES ───
export type HabitStatus = 'active' | 'archived' | 'retired';
export type TimeBlock = 'morning' | 'afternoon' | 'evening' | 'anytime';

export type Habit = {
  id: string; title: string; color: string; icon: keyof typeof Feather.glyphMap;
  description?: string; // optional "why" / context, shown in the detail view
  history: string[]; restDays: string[]; skippedDays: string[]; createdAt: number;
  targetCount: number; unit: string;
  scheduleType: 'days' | 'interval'; frequency: string[];
  intervalDays?: number; startDate?: string;
  hasReminder?: boolean; reminderTime?: string;
  timeBlock: TimeBlock; status: HabitStatus;
  completionNotes?: Record<string, string>;
  // Set when status === 'retired'. retiredAt (YYYY-MM-DD) freezes the strength
  // score at the moment of retirement (no penalties accrue afterward). vanished
  // hides the trophy from the Retired screen — but the frozen score is STILL
  // counted in the grade (we respect past effort either way).
  retiredAt?: string;
  vanished?: boolean;
  // Long-pause (archive) windows. Each [from, to) range is a stretch the habit
  // sat archived; scoring SKIPS those days (no penalty), so a pause freezes the
  // score instead of tanking it. An open range (no `to`) = currently archived.
  pausedRanges?: { from: string; to?: string }[];
};

// ─── TASK TYPES ───
export type Priority = 'Low' | 'Medium' | 'High';
export type CalendarSystem = 'gregorian' | 'shamsi';
export type RecurType = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';
export type UrgencyLevel = 'none' | 'low' | 'medium' | 'high' | 'critical' | 'overdue';
export type TaskStatus = 'active' | 'archived' | 'trash' | 'resting';
export type ProjectStatus = 'active' | 'archived';

export type SubTask = { id: string; text: string; completed: boolean; };

export type Project = {
  id: string; name: string; color: string;
  createdAt: number; lastTouchedAt?: number; status?: ProjectStatus;
};

export type Task = {
  id: string; text: string; notes: string; completed: boolean; status?: TaskStatus;
  completedAt?: number; createdAt: number;
  startDate?: string; deadlineDate: string; deadlineTime: string;
  hasReminder: boolean; reminderTime?: string; reminderOffsetDays?: number; notificationId?: string;
  priority: Priority; color: string;
  subTasks: SubTask[]; hasProgress: boolean; progress: number;
  projectId?: string; recurType: RecurType; recurDays?: string[]; recurDayOfMonth?: number;
  nextWakeDate?: string; lastTouchedAt?: number;
  // Energy level — used by Timeline's gap-filling suggestion engine
  energy?: 'Low' | 'Medium' | 'High';
  // ── Promise — opt-in commitment ritual ──────────────────────────────────
  // `promised` is the live toggle. When true, the task carries a colored
  // accent stripe and counts toward the monthly Kept/Broken tally.
  // `promiseBrokenAt` is set ONCE — when the deadline passes uncompleted —
  // and is permanent: completing or archiving the task afterwards does NOT
  // clear it. The "scar" is intentional. A null/undefined value means the
  // promise is either still active or was kept.
  promised?: boolean;
  promiseBrokenAt?: number | null;
  // Stamp set when a promised task is completed before its deadline.
  // Mirrors `completedAt` but only fires once and only when the promise
  // was kept — so the monthly aggregate doesn't double-count uncompletes/
  // re-completes, and re-promising a completed-then-reopened task can't
  // accidentally inflate the Kept counter.
  promiseKeptAt?: number;
};

// ─── PROMISE STATS ───
// Counters for the Promise feature. `monthlyMade/Kept/Broken` reset at the
// start of each calendar month (via syncPromiseMonth on focus). The
// lifetime totals never reset — they're the source of truth for the
// future "wrapped" recap. monthKey tracks the last month we synced
// (YYYY-MM); a mismatch with current month triggers the reset.
export type PromiseStats = {
  madeTotal: number;
  keptTotal: number;
  brokenTotal: number;
  monthKey: string;          // YYYY-MM
  monthlyMade: number;
  monthlyKept: number;
  monthlyBroken: number;
};

// ─── NOTE TYPES ───
export type NoteStatus = 'active' | 'archived' | 'trash';

export type AudioMemo = {
  id: string;
  uri: string;
  duration: string;
  name: string;
};

export interface NoteSnapshot {
  content: string;
  title?: string;
  savedAt: number;
}

export interface Note {
  id: string;
  title?: string;
  group?: string;
  content: string;
  color: string;
  createdAt: number;
  updatedAt?: number;
  isPinned: boolean;
  isLocked: boolean;
  order: number;
  status: NoteStatus;
  imageUris?: string[];
  audio?: AudioMemo[];
  isSealed?: boolean;
  unlockDate?: number;
  // Authoritative calendar-date for the capsule (YYYY-MM-DD), separate from
  // unlockDate so the unlock moment can be re-derived in the user's CURRENT
  // local timezone rather than frozen at the timezone the seal was performed
  // in. unlockDate is kept in sync (= local midnight of unlockDateStr) by a
  // reconciliation pass on tab focus. Older capsules without this field fall
  // back to legacy unlockDate-only behavior.
  unlockDateStr?: string;
  // When set, this note is a "capsule-locked finish" tied to a challenge — it
  // unlocks when that challenge transitions to 'achieved' (regardless of date).
  // Acts in lieu of unlockDate for that note.
  unlockOnChallengeId?: string;
  deletedAt?: number;
  history?: NoteSnapshot[];
  // Marks the note as a diary entry — surfaces it in the chronological diary
  // view (Notes tab → book icon) instead of the standard card grid. Diary
  // entries share the Note structure so capsules, locks, audio, and images
  // all work the same; they just render differently. Regular notes have
  // `kind` undefined.
  kind?: 'diary';
  // Optional emoji or short mood tag attached to a diary entry (e.g. "🌧️",
  // "tired"). Renders as a small chip next to the date header in DiaryView.
  // Free-form so users aren't forced into a fixed mood scale.
  mood?: string;
  // For diary entries: the date the entry is ABOUT (vs createdAt = when it
  // was written). Defaults to createdAt for new entries; the editor exposes
  // a date picker for backdating. DiaryView sorts and groups by this field
  // when present, falling back to createdAt for legacy entries that
  // predate the field.
  entryDate?: number;
}

// ─── DAY RATING ───
// The per-day "how did today go?" rating (strong / ok / rough). Lives on the
// Habits home now (the end-of-day check-in); MMKV-backed in the Zustand store.
export type DayRating = 'strong' | 'ok' | 'rough';
export type DayLog = Record<string, DayRating>; // key = YYYY-MM-DD

// ─── CHALLENGE TYPES ───
export type UrgencyStyle = 'auto' | 'haemorrhage' | 'static';
export type ChallengeUrgency = 'none' | 'haemorrhage' | 'static';
export type DeadState = 'active' | 'dead' | 'resurrected' | 'buried' | 'achieved' | 'trash';
export type NarratorTone = 'cold' | 'existential' | 'clinical';

export type Milestone = { id: string; text: string; completed: boolean; };

// A single dated entry on a challenge — replaces the older free-text
// `note` field on Challenge. Each entry stamps the moment it was added
// so the edit sheet can render them as a journal log instead of one
// monolithic textarea. The legacy `note` field is kept on Challenge
// for back-compat; on first open of an existing challenge, a non-empty
// `note` is migrated into a single entry.
export type NoteEntry = { id: string; text: string; createdAt: number; };

// How a challenge is meant to be worked, which changes what "on pace" and
// "the chain" mean:
//   daily      — one unit per day (meditate 30 days). A chain that can break.
//   cumulative — a total reached at any rate (read 12 books). No daily chain.
//   oneshot    — do the thing once (ship one thing). Target is 1, no pace.
export type ChallengeCadence = 'daily' | 'cumulative' | 'oneshot';

// A habit→challenge link. Completing the habit (to its own target for the day)
// can auto-advance the challenge by `increment`, but only when `autoAdvance`
// is on — the user decides per link.
export type ChallengeLink = { habitId: string; autoAdvance: boolean; increment: number; lastAdvancedDate?: string };

// One progress event in a challenge's history. `source` records where the
// log came from so the ledger can read "Logged +2" vs "Habit · +1".
export type LedgerSource = 'manual' | 'habit' | 'deepwork' | 'bulk';
export type LedgerEntry = { id: string; ts: number; delta: number; source: LedgerSource };

// One ledger entry, stamped now. Shared by every progress path (manual taps,
// bulk log, habit auto-advance, deep-work) so the history reads consistently.
export function makeLedgerEntry(delta: number, source: LedgerSource): LedgerEntry {
  return { id: `lg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, ts: Date.now(), delta, source };
}

// ── The Ledger ──────────────────────────────────────────────────────────────
// A stake the user holds: a reward to claim or a punishment to pay. Auto-added
// from a won challenge (its reward) or a buried one (its punishment), or by
// hand. `sourceId` is the challenge it came from, used to dedup auto-adds.
export type StakeKind = 'reward' | 'punishment';
export interface Stake { id: string; kind: StakeKind; text: string; done: boolean; createdAt: number; doneAt?: number; sourceId?: string }
export function makeStake(kind: StakeKind, text: string, sourceId?: string): Stake {
  return { id: `stk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, kind, text: text.trim(), done: false, createdAt: Date.now(), sourceId };
}

// Best-effort cadence guess for migrations and for new challenges until the
// editor exposes an explicit picker. Day-unit challenges read as daily;
// single-target ones as one-shot; everything else accrues cumulatively.
export function inferChallengeCadence(target?: number, unit?: string): ChallengeCadence {
  if ((unit || '').toLowerCase().includes('day')) return 'daily';
  if (target === 1) return 'oneshot';
  return 'cumulative';
}

export type Challenge = {
  id: string; title: string; icon: any;
  color: string; current: number; target: number; unit: string;
  // How much finishing a linked-goal INTENT advances this challenge. Default 1
  // (undefined === 1); set to 0 to turn it off so intents don't move it. Separate
  // from `links` (per-habit auto-advance). Configurable in the challenge edit sheet.
  intentIncrement?: number;
  deadlineTs?: number; reward?: string; punishment?: string;
  urgencyStyle?: UrgencyStyle;
  cadence?: ChallengeCadence;
  createdAt: number; milestones?: Milestone[];
  // `links` is the live model (per-habit auto-advance + increment).
  // `linkedHabitIds` is the legacy flat list, kept only so the v2→v3
  // migration and any un-migrated import can be read; new code writes `links`.
  links?: ChallengeLink[];
  linkedHabitIds?: string[]; deadState: DeadState;
  reviewedAt?: number; buriedAt?: number; achievedAt?: number;
  deletedAt?: number; wasResurrected?: boolean;
  // Set true the first time a dead challenge is resurrected, and never cleared —
  // so its "one more attempt" can't be reused, even after it's buried and later
  // re-opened from the graveyard. Resurrection is once per challenge, for good.
  resurrectedBefore?: boolean;
  // Static "what is this challenge about" copy — set once when the
  // challenge is created and rarely edited. Distinct from noteEntries,
  // which is a journal log that grows over time.
  description?: string;
  // `note` is the legacy single-string field. Once a challenge has any
  // entries in `noteEntries`, the legacy field is cleared on save.
  note?: string;
  noteEntries?: NoteEntry[];
  lastLoggedAt?: number;
  // YYYY-MM-DD strings of each progress log — powers the momentum strip
  logDates?: string[];
  // Timestamped progress history — every +N / -N event with its source.
  // Renders as the detail view's ledger ("Logged +2 · Wed 3:47 PM"). Backfilled
  // from logDates on migration; written live by the progress paths (Phase 4).
  ledger?: LedgerEntry[];
  // Capsule-locked finish: ID of a sealed Note that unlocks when this challenge
  // transitions to 'achieved'. The note carries the matching unlockOnChallengeId.
  linkedCapsuleNoteId?: string;
  // ID of the preset (lib/challengePresets.ts) this challenge was spawned
  // from. Used by the preset picker to thin its catalogue: presets with
  // an active or 'achieved' challenge of the same id are hidden so the
  // user doesn't double-add. Buried/trashed → still visible (they can
  // try again). Custom (non-preset) challenges leave this undefined.
  presetId?: string;
};

export type AchievementId =
  | 'first_blood' | 'risen' | 'centurion' | 'last_second' | 'early_finish'
  | 'initiation' | 'second_chance' | 'recidivist' | 'graveyard_grows' | 'clean_record'
  | 'insomniac' | 'midnight_owl' | 'obsessive' | 'witness' | 'narrator_noticed'
  | 'you_were_watched' | 'cleared' | 'archaeologist' | 'architect' | 'momentum'
  | 'the_long_game' | 'ghost';

export type Achievement = {
  id: AchievementId; sym: string; name: string; unlockedAt?: number;
};

// ─── DEEP WORK TYPES ───
// A completed focus session. Cancelled-early sessions are not saved here. The
// reflection step at session end can choose to skip persistence ("skip this one")
// — those also don't land in the array. Only sessions the user explicitly keeps.
//
// Used to:
//   1. Unlock the Challenges tab once the user has at least one kept session.
//   2. Power future "deep work history" / streak features.
//   3. Surface aggregate minutes-focused on the user's own time.
export type DeepWorkIntent = 'task' | 'habit' | 'challenge' | 'free';

export type DeepWorkSession = {
  id: string;
  startedAt: number;            // ms timestamp when Begin was tapped
  endedAt: number;              // ms timestamp when timer reached 0
  durationMs: number;           // intended (and, for kept sessions, actual) duration
  intent: DeepWorkIntent;
  intentTargetId?: string;      // id of the task/habit/challenge (undefined for 'free')
  intentTargetTitle?: string;   // snapshot — titles can change after the fact
  reflection?: string;          // optional one-line "how was it"
  rating?: DayRating;           // optional self-rating, reuses 'strong'|'ok'|'rough'
};

// The CURRENTLY-RUNNING Deep Work session. Persisted (unlike the old per-screen
// useState it replaces) so a focus session survives the JS thread being
// suspended in the background OR the process being killed outright — on relaunch
// we recompute remaining time from `startedAt` against the wall clock and either
// resume the timer or route straight to reflection. Cleared on complete/discard.
export type ActiveDeepWork = {
  startedAt: number;            // ms timestamp when Begin was tapped
  durationMs: number;           // planned length (0 / ignored for open count-up)
  intent: DeepWorkIntent;
  targetId?: string;
  targetTitle: string;
  open: boolean;                // open-ended count-up — no scheduled end alarm
};

// ─── DIARY TYPES ───
// Lightweight Timeline-attached reflections. Each entry is a single piece of text
// pinned to a specific YYYY-MM-DD. Foundation for the future Canvas rollup, which
// will compose a month's entries (text + sketches + photos) into a visual scroll.
// Kept separate from Notes — these are quick, ephemeral, day-bound; Notes are heavier.
export type DiaryEntry = {
  id: string;
  date: string;       // YYYY-MM-DD
  text: string;       // free-form
  createdAt: number;  // ms timestamp — used for ordering within a day
};

// ─── INTENT ───────────────────────────────────────────────────────────────
// A single "this is what today (or tomorrow) is for" item. Lives at the top
// of Timeline. Each item has an optional source link (task / habit / challenge)
// so when the source advances, the intent auto-checks itself — no double
// bookkeeping. Custom items (no link) are checked manually.
//
// Push semantics: if today ends and the intent isn't done, the user can push
// it to tomorrow. pushCount tracks the consecutive-pushes streak; at 3 we
// surface a "rethink this" prompt because chronic deferral usually means the
// item itself needs to change, not be deferred again. pushedFromDate keeps
// the original date so the history is recoverable.
export type IntentSourceType = 'task' | 'habit' | 'challenge';
export type Intent = {
  id: string;
  date: string;             // YYYY-MM-DD — which day this intent belongs to
  label: string;            // free-form text, or copy of source title at creation
  completed: boolean;       // manual or auto (when source completes)
  sourceType?: IntentSourceType;
  sourceId?: string;        // task id / habit id / challenge id when linked
  pushedFromDate?: string;  // earliest date in the chain (set on first push)
  pushCount: number;        // consecutive push count; resets on completion or rethink
  createdAt: number;        // ms timestamp
};

// ─── DAY NOTE ─────────────────────────────────────────────────────────────
// A free-form text marker attached to a specific calendar date — the date-bound
// counterpart to Intent. Where Intent is "what today/tomorrow is FOR" (action),
// DayNote is "what's true ABOUT this date" (memory): "John's birthday,"
// "anniversary," "concert tickets go on sale." Surfaced when the user navigates
// to any day that isn't today or tomorrow. Multiple notes per day are allowed
// — each one is a separate row. No completion state; notes are just there.
//
// ─── WEEKLY REFLECTION ────────────────────────────────────────────────────
// One reflection per ISO week, captured on the user's chosen end-of-week
// day (Friday or Sunday — Friday for Iranian users, Sunday everywhere else).
// The card prompt shows the rating breakdown for the week ("5 Strong, 1
// Steady, 1 Off") and asks for a single free-text reflection. If 3+ Off days
// landed, a warm-words note appears AFTER the user submits — the app responds
// to what they said, not pre-judges it.
export type EndOfWeekDay = 'friday' | 'sunday';

export type WeeklyReflection = {
  id: string;             // ISO week key (YYYY-Www) — e.g. 2026-W18
  weekKey: string;        // same as id; mirrored for clarity
  endedOn: string;        // YYYY-MM-DD of the day the reflection was logged
  text: string;           // free-form
  createdAt: number;
};

// ─── DEFAULT DATA ───

// ── Seed/example content removed (2026-05-29) ──────────────────────────────
// The app ships EMPTY now. Pre-filled demo habits/tasks/projects/timeline
// blocks/notes used to onboard the user by example, but they contradict the
// progressive-unlock model — they'd showcase features (and explain gestures)
// the user hasn't unlocked yet, and the seed capsule pre-empted the Sealed
// Messages reveal. Kept as named empty arrays so a future onboarding pass can
// reintroduce curated content from a single place if desired.
const DEFAULT_HABITS: Habit[] = [];
const DEFAULT_PROJECTS: Project[] = [];
const DEFAULT_TASKS: Task[] = [];

// Net change in completed-task count across a task-array mutation. Counts ONLY
// tasks present in BOTH snapshots: completing flips false→true (+1), un-checking
// flips true→false (−1). A task that LEAVES the array (deleted, swept, or removed
// as an inbox "done" task) is ignored — completing a task is an event that must
// not be undone by later deleting it. This is the whole reason the count is a
// stored counter instead of `tasks.filter(t => t.completed).length`, which
// silently reverted unlock progress whenever a done task was trashed/swept.
function completedTaskDelta(prev: Task[], next: Task[]): number {
  if (prev === next || !Array.isArray(prev) || !Array.isArray(next)) return 0;
  const prevDone = new Map<string, boolean>();
  for (const t of prev) prevDone.set(t.id, !!t.completed);
  let delta = 0;
  for (const t of next) {
    if (!prevDone.has(t.id)) continue;        // newly added → not a completion event
    const was = prevDone.get(t.id)!;
    const now = !!t.completed;
    if (now && !was) delta++;
    else if (!now && was) delta--;
  }
  return delta;
}
export const DEFAULT_NOTES: Note[] = [];

// ─── APP STATE INTERFACE ───

interface AppState {
  // ── Settings ──
  isDarkMode: boolean;
  // Three-way theme: 'light' | 'dark' (graphite) | 'blue' (deep navy). isDarkMode
  // is kept as a mirror (true for dark + blue) so legacy readers keep working.
  themeMode: 'light' | 'dark' | 'blue';
  calendarType: CalendarSystem;
  toggleTheme: () => void;
  setThemeMode: (m: 'light' | 'dark' | 'blue') => void;
  toggleCalendar: () => void;

  // ── Habits ──
  habits: Habit[];
  addOrUpdateHabit: (habit: Habit) => void;
  deleteHabit: (id: string) => void;
  // Retire a habit: it leaves the active list but its earned score stays in the
  // grade, frozen at retiredAt. keep=false ("vanish") hides it from the Retired
  // screen but still counts. retiredAt is a YYYY-MM-DD local date from the caller.
  retireHabit: (id: string, keep: boolean, retiredAt: string) => void;
  // Bring a retired habit back to active. The retired stretch is recorded as a
  // pause window so it doesn't retroactively penalize the score (resumes from
  // the frozen value); retiredAt/vanished are cleared.
  unretireHabit: (id: string, todayStr: string) => void;
  updateHabitStatus: (id: string, status: HabitStatus) => void;
  toggleHabitAction: (
    id: string,
    action: 'done' | 'pending' | 'rest' | 'skipped',
    dateStr: string,
  ) => void;

  // ── Habit unlock counters (monotonic) ──
  // totalHabitsCreated → PACT (>=3). (Vault/archive is ungated, ships on.)
  // maxSingleHabitCompletions: highest lifetime completion total of any one
  //   habit → COMPLETION_NOTES (>=5). Maintained inside toggleHabitAction.
  // dayConqueredEver: latches true on the first fully-conquered day (every
  //   scheduled habit done on a day with 3+ habits) → STRENGTH_SCORE.
  //   Maintained inside toggleHabitAction (see isDayConquered).
  totalHabitsCreated: number;
  incrementTotalHabitsCreated: () => void;
  maxSingleHabitCompletions: number;
  dayConqueredEver: boolean;

  // ── Tasks & Projects ──
  tasks: Task[];
  projects: Project[];
  setTasks: (tasks: Task[]) => void;
  // Sticky net count of completed tasks (see completedTaskDelta + v8→v9 migrate).
  // Moves only on complete/un-check — never on delete/sweep of a done task.
  tasksCompletedCount: number;
  setProjects: (projects: Project[]) => void;
  addOrUpdateProject: (project: Project) => void;
  deleteProject: (id: string) => void;

  // Monotonic counter — increments once at every user-initiated task creation
  // (quick-add, save-from-sheet new path, void easter egg). Never decrements:
  // deleting / archiving / completing doesn't roll it back. Powers the
  // totalTasksCreated unlock trigger so "progress toward the next gate" isn't
  // lost when the user clears their list.
  totalTasksCreated: number;
  incrementTotalTasksCreated: () => void;

  // ── Promise stats ── lifetime + monthly counters for Kept/Broken/Made.
  // The UI calls these from three places:
  //   - editor save: recordPromiseMade when toggle flips false→true
  //   - completion: recordPromiseKept when a promised task is completed
  //                 before its deadline (and not already broken)
  //   - sweep:      recordPromiseBroken when deadline passes uncompleted
  // Each action calls syncPromiseMonth first so monthly counters reset
  // at month boundaries without a separate scheduler.
  promiseStats: PromiseStats;
  recordPromiseMade: () => void;
  recordPromiseKept: () => void;
  recordPromiseBroken: () => void;
  syncPromiseMonth: () => void;

  // ── Notes ──
  notes: Note[];
  setNotes: (notes: Note[]) => void;
  addOrUpdateNote: (note: Note) => void;
  deleteNote: (id: string) => void;
  updateNoteStatus: (id: string, status: NoteStatus) => void;
  toggleNoteLock: (id: string) => void;
  toggleNotePin: (id: string) => void;
  updateNoteContent: (id: string, newContent: string) => void;

  // ── Notes unlock counters (monotonic, never decrement) ──
  // totalNotesCreated: one tick per new note → DIARY + HIGHLIGHT_COLORS (>=3).
  // diaryEntriesCreated: one tick per new diary entry → MOOD_TAGGING (>=1).
  totalNotesCreated: number;
  incrementTotalNotesCreated: () => void;
  diaryEntriesCreated: number;
  incrementDiaryEntriesCreated: () => void;

  dayLog: DayLog;
  setDayLog: (log: DayLog) => void;
  logDayRating: (dateStr: string, rating: DayRating) => void;

  // ── Timeline unlock counters (monotonic, never decrement) ──
  // totalBlocksCreated: one tick per NEW block committed in the add-block
  //   modal (a recurring block that fans out to several weekday records still
  //   counts once — it's one user action). Drives SMART_SUGGESTIONS +
  //   FOCUS_BLOCK_RUNNER (>= 3).
  // dayRatingsCount: one tick per day-rating submission. Drives DAILY_REVIEW
  //   (>= 3).
  // activeDaysWithBlock: distinct calendar days on which the schedule had at
  //   least one block. lastActiveDayCounted guards against double-counting a
  //   day — markActiveDayWithBlock(today) is a no-op if today was already
  //   counted. Drives NOW_PLAYING (>= 5).
  totalBlocksCreated: number;
  incrementTotalBlocksCreated: () => void;
  dayRatingsCount: number;
  incrementDayRatingsCount: () => void;
  activeDaysWithBlock: number;
  lastActiveDayCounted: string | null;
  markActiveDayWithBlock: (dateStr: string) => void;

  globalNotifsEnabled: boolean;
  preNotifOffset: number;
  setGlobalNotifsEnabled: (v: boolean) => void;
  setPreNotifOffset: (v: number) => void;
  // Pinned "Now Playing" ongoing notification showing the currently-active Timeline block.
  // Default on — visible proof the app knows what the user is doing right now.
  ongoingBlockEnabled: boolean;
  setOngoingBlockEnabled: (v: boolean) => void;
  // How many times the user has revealed the week-nav chrome (pull-to-reveal OR horizontal swipe).
  // Once it crosses a threshold, the hint handle above the slider stops rendering — they clearly
  // know about the gesture, no need to occupy space with a permanent affordance.
  navRevealCount: number;
  incrementNavRevealCount: () => void;

  // ── Progressive feature unlocks ──────────────────────────────────────
  // unlockedFeatures: feature ID → has its trigger fired. Once true, stays
  //   true. No lock() exists anywhere in the codebase — rule.
  // dotsSeen: feature ID → user has interacted with the newly-unlocked
  //   element (or unlockAll silenced it). Drives the small blue "new" dot.
  // allFeaturesUnlocked: returning-user override. Short-circuits isUnlocked
  //   to true for everything. Set by the "Restore your experience" button.
  // installDate / lastKnownDate: ISO calendar dates (YYYY-MM-DD). installDate
  //   stamps on first launch and never moves. lastKnownDate advances
  //   monotonically on each foreground event so backward clock manipulation
  //   can't roll the day counter back.
  // whisperQueue: pending whisper announcements. Component reads head, user
  //   dismisses to advance. Queue collapses at length >= 3 into one combined
  //   whisper to avoid spam.
  // whispersSeen: Record<string, boolean> — replaces the legacy string[]
  //   shape. Lookup is now O(1) and aligned with dotsSeen.
  unlockedFeatures: Record<string, boolean>;
  dotsSeen: Record<string, boolean>;
  allFeaturesUnlocked: boolean;
  installDate: string | null;
  lastKnownDate: string | null;
  whisperQueue: UnlockWhisper[];
  // First-launch growth intro. Shown once on the very first open; sets the
  // expectation that the app reveals itself over time (so a power user who
  // can't find a feature day-one understands why rather than churning). The
  // intro also offers the "show me everything" fork → unlockAll(). Travels
  // in the backup meta so a restoring user isn't shown it again.
  introSeen: boolean;
  setIntroSeen: (v: boolean) => void;
  unlock: (featureId: string) => void;
  unlockAll: () => void;
  markDotSeen: (featureId: string) => void;
  setInstallDate: (date: string) => void;
  setLastKnownDate: (date: string) => void;
  enqueueWhisper: (featureIds: string[], message: string) => void;
  dismissCurrentWhisper: () => void;

  // ── Habits extras ──
  setHabitCompletionNote: (habitId: string, dateStr: string, note: string) => void;

  // ── Whispers — each key fires exactly once, ever ──
  // Record<string, boolean> shape so lookup is O(1) and matches dotsSeen.
  // Legacy string[] callers were converted to `!!whispersSeen[key]`.
  whispersSeen?: Record<string, boolean>;
  markWhisperSeen: (key: string) => void;

  // Day Conquered celebration — the calendar date (YYYY-MM-DD) the eclipse
  // last played. Persisted so the celebration fires once per day and never
  // replays just because the Habits tab remounted (its in-memory ref guard
  // resets on remount, which made the eclipse re-show every time you opened
  // the tab on an already-conquered day).
  lastDayConqueredCelebrated?: string;
  setLastDayConqueredCelebrated: (dateStr: string) => void;

  // "Go for more" — secret early-finish easter egg (EXPERIMENTAL, ships OFF via
  // GO_FOR_MORE_ENABLED in habits.tsx). goForMoreIgnores counts how many times
  // the moment was let to pass; at 3 it retires permanently (goForMoreRetired).
  // goForMoreLastShown gates it to once per calendar day. These persist so the
  // "goes dark forever" promise survives restarts.
  goForMoreIgnores?: number;
  goForMoreRetired?: boolean;
  goForMoreLastShown?: string;
  recordGoForMoreShown: (dateStr: string) => void;
  recordGoForMoreIgnored: () => void;

  // ── The Pact ──
  pact?: {
    level: number;
    habits: { id: string; tier: number }[]; // tier: 1=easy, 2=medium, 3=hard
    deadline: string; // YYYY-MM-DD
    startedAt: string; // YYYY-MM-DD
    history?: {
      level: number;
      habits: { id: string; title: string; tier: number; completed: number; required: number }[];
      outcome: 'completed' | 'failed';
      startedAt: string;
      endedAt: string;
    }[];
  };
  setPact: (pact: AppState['pact']) => void;

  // ── Challenges & Achievements ──
  challenges: Challenge[];
  setChallenges: (challenges: Challenge[]) => void;
  achievements: Achievement[];
  setAchievements: (achievements: Achievement[]) => void;
  // Monotonic — one tick per challenge created → MILESTONES (>=1). Active
  // count (for LINKED_HABITS >=2) is derived in the root snapshot, not stored.
  totalChallengesCreated: number;
  incrementTotalChallengesCreated: () => void;
  // The Challenges tab is gated behind a multi-criteria unlock — see
  // LockScreen in challenges.tsx. Once flipped true, it stays true (no
  // automatic re-locking on metric drop). Persisting via the main store
  // means the unlock survives app restarts; the previous in-component
  // useState made the flag effectively meaningless.
  challengesUnlocked: boolean;
  setChallengesUnlocked: (v: boolean) => void;
  // First-appearance timestamp for the day-2 Challenges teaser — drives the
  // literal 24h countdown to the conditions reveal (null until the tab appears).
  challengesTeaserSeenAt: number | null;
  setChallengesTeaserSeenAt: (ts: number) => void;
  // True once the default seed challenges have been inserted (or skipped
  // because the user already had data). Without this, the seed effect
  // re-runs on every "challenges array empty" — meaning a user who
  // deletes all their challenges gets the demo trio respawned forever.
  // Set once, never cleared.
  challengesSeeded: boolean;
  setChallengesSeeded: (v: boolean) => void;

  // ── The Ledger — stakes you hold: rewards to claim, punishments to pay. ──
  // A won challenge auto-adds its reward; a buried (failed, finalized) one its
  // punishment. Checked off when settled. addStake dedups auto-adds by sourceId.
  stakes: Stake[];
  addStake: (kind: StakeKind, text: string, sourceId?: string) => void;
  toggleStake: (id: string) => void;
  removeStake: (id: string) => void;
  // Set true the first time any challenge ends (won or dead). The Ledger entry
  // then stays available for good — you get it once you actually need it, and
  // can keep adding stakes by hand thereafter.
  ledgerUnlocked: boolean;
  setLedgerUnlocked: (v: boolean) => void;

  // ── Deep Work ──
  deepWorkSessions: DeepWorkSession[];
  addDeepWorkSession: (session: DeepWorkSession) => void;
  deleteDeepWorkSession: (id: string) => void;
  // The active (running) session — persisted so it survives backgrounding/kill.
  activeDeepWork: ActiveDeepWork | null;
  setActiveDeepWork: (s: ActiveDeepWork | null) => void;

  // ── Diary ──
  diaryEntries: DiaryEntry[];
  addDiaryEntry: (entry: DiaryEntry) => void;
  updateDiaryEntry: (id: string, text: string) => void;
  deleteDiaryEntry: (id: string) => void;

  // ── Intent ──
  intents: Intent[];
  addIntent: (intent: Intent) => void;
  toggleIntent: (id: string) => void;
  updateIntentLabel: (id: string, label: string) => void;
  deleteIntent: (id: string) => void;
  pushIntentToTomorrow: (id: string) => void;
  shipIntentBackToToday: (id: string) => void;
  resetIntentPushCount: (id: string) => void;
  // Auto-completion helpers — called by the existing complete-task / complete-habit /
  // increment-challenge flows so intents linked to those sources tick themselves.
  // dateStr filters to the relevant day (mostly today). Habit/challenge passes today's
  // date because both are day-scoped completion semantics; task completion is global.
  autoCheckIntentsForTask: (taskId: string) => void;
  autoCheckIntentsForHabit: (habitId: string, dateStr: string) => void;
  autoCheckIntentsForChallenge: (challengeId: string, dateStr: string) => void;

  // Habit → challenge advancement. Called from the habits tab the moment
  // a habit transitions to "fully complete" for the day. Walks every
  // active challenge linked to the habit and bumps its counter by one
  // — but only if the date isn't already in the challenge's logDates,
  // so completing a multi-target habit several times in a day still
  // advances the challenge exactly once. Transitions to 'achieved' if
  // the bump pushes current ≥ target.
  advanceLinkedChallengesForHabit: (habitId: string, dateStr: string) => void;

  // ── Weekly reflection ──
  weeklyReflections: Record<string, WeeklyReflection>;  // keyed by ISO week
  addWeeklyReflection: (r: WeeklyReflection) => void;
  endOfWeekDay: EndOfWeekDay;
  setEndOfWeekDay: (d: EndOfWeekDay) => void;

  // Biometric lock for diary mode. When true, entering the diary view from
  // the notes tab requires the device's biometric (or device-PIN fallback)
  // authentication. We deliberately don't build a passcode system —
  // OS-level auth defers password recovery to Apple/Google so we never end
  // up with "user forgot diary password" data-loss scenarios.
  diaryLocked: boolean;
  setDiaryLocked: (v: boolean) => void;

  // One-time migration flag: cancels orphaned yearly birthday notifications
  // after the Birthdays feature was cut (calm-pivot). Driven from app/_layout.tsx.
  birthdayNotifsPurged: boolean;
  markBirthdayNotifsPurged: () => void;

  // ── Reflection acknowledgement ──
  // Set of `${YYYY-MM-DD}_${activityId}` keys for committed blocks the user
  // has either reflected on or dismissed. Used purely for bookkeeping — the
  // actual reflection content is NOT persisted (the post-block prompt is
  // advisory and ephemeral). Capped at 100 most-recent entries to avoid
  // unbounded growth across years of use.
  reflectedKeys: string[];
  markReflected: (key: string) => void;

  // ── Reset user data ──
  // Wipes all user-generated content (tasks, notes, habits, challenges,
  // history, etc.) back to seed defaults while preserving settings, the
  // unlock slice, and persist metadata. Used by the returning-user
  // "Start fresh" path so a long-time tester can land on a clean app
  // without losing their unlock state.
  resetUserData: () => void;
}

// ─── CREATE STORE ───

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // ── Settings ──
      isDarkMode: false,
      themeMode: 'light',
      calendarType: 'shamsi',
      // toggleTheme flips light↔dark and keeps themeMode/isDarkMode in sync; the
      // 3-way picker in Settings uses setThemeMode for the blue (navy) option.
      toggleTheme: () => set((s) => { const next = s.themeMode === 'light' ? 'dark' : 'light'; return { themeMode: next, isDarkMode: next !== 'light' }; }),
      setThemeMode: (m) => set({ themeMode: m, isDarkMode: m !== 'light' }),
      toggleCalendar: () => set((s) => ({
        calendarType: s.calendarType === 'shamsi' ? 'gregorian' : 'shamsi',
      })),

      // ── Habits ──
      habits: DEFAULT_HABITS,
      addOrUpdateHabit: (habit) => set((s) => {
        const exists = s.habits.find(h => h.id === habit.id);
        return {
          habits: exists
            ? s.habits.map(h => h.id === habit.id ? habit : h)
            : [...s.habits, habit],
        };
      }),
      deleteHabit: (id) => set((s) => ({ habits: s.habits.filter(h => h.id !== id) })),
      retireHabit: (id, keep, retiredAt) => set((s) => ({
        habits: s.habits.map(h => h.id === id ? { ...h, status: 'retired' as HabitStatus, retiredAt, vanished: !keep } : h),
      })),
      unretireHabit: (id, todayStr) => set((s) => ({
        habits: s.habits.map(h => {
          if (h.id !== id) return h;
          const pausedRanges = [...(h.pausedRanges || [])];
          // Treat the time spent retired as a pause so scoring skips it (no
          // penalty) and the score resumes from where it froze.
          if (h.retiredAt && h.retiredAt < todayStr) pausedRanges.push({ from: h.retiredAt, to: todayStr });
          return { ...h, status: 'active' as HabitStatus, retiredAt: undefined, vanished: undefined, pausedRanges };
        }),
      })),
      updateHabitStatus: (id, status) => set((s) => {
        const today = localDateStr();
        return {
          habits: s.habits.map(h => {
            if (h.id !== id) return h;
            let pausedRanges = h.pausedRanges ? [...h.pausedRanges] : [];
            if (status === 'archived' && h.status !== 'archived') {
              // Entering a long-pause — open a range from today.
              pausedRanges.push({ from: today });
            } else if (status === 'active' && h.status === 'archived') {
              // Returning — close the most recent open range. Scoring skips the
              // [from, today) gap, so the score resumes from its frozen value
              // and the streak (which can't bridge the gap) starts fresh.
              for (let i = pausedRanges.length - 1; i >= 0; i--) {
                if (!pausedRanges[i].to) { pausedRanges[i] = { ...pausedRanges[i], to: today }; break; }
              }
            }
            return { ...h, status, pausedRanges };
          }),
        };
      }),
      toggleHabitAction: (id, action, dateStr) => set((s) => {
        const habits = s.habits.map(h => {
          if (h.id !== id) return h;
          let newHistory = [...h.history];
          let newRest = [...(h.restDays || [])].filter(d => d !== dateStr);
          let newSkipped = [...(h.skippedDays || [])].filter(d => d !== dateStr);
          if (action === 'pending') {
            newHistory = newHistory.filter(d => d !== dateStr);
          } else if (action === 'rest') {
            newHistory = newHistory.filter(d => d !== dateStr);
            newRest.push(dateStr);
          } else if (action === 'skipped') {
            newHistory = newHistory.filter(d => d !== dateStr);
            newSkipped.push(dateStr);
          } else if (action === 'done') {
            // reduce avoids intermediate array allocation vs filter().length
            if (newHistory.reduce((acc, d) => acc + (d === dateStr ? 1 : 0), 0) < h.targetCount) {
              newHistory.push(dateStr);
            }
          }
          return { ...h, history: newHistory, restDays: newRest, skippedDays: newSkipped };
        });

        // ── Habit unlock counters (monotonic) ──
        // maxSingleHabitCompletions: highest lifetime completion total across
        // habits → COMPLETION_NOTES (>=5). Only grows; undoing a completion or
        // deleting a habit can't lower it.
        let maxSingle = s.maxSingleHabitCompletions ?? 0;
        for (const h of habits) {
          if (h.history.length > maxSingle) maxSingle = h.history.length;
        }
        // dayConqueredEver: latches true the first time a day is fully
        // "conquered" — every scheduled active habit done/skipped/rested on a
        // day with 3+ habits (see isDayConquered) → STRENGTH_SCORE. Checked
        // only on a 'done' action (the completion that could close the day).
        let dayConqueredEver = s.dayConqueredEver ?? false;
        if (!dayConqueredEver && action === 'done' && isDayConquered(habits, dateStr)) {
          dayConqueredEver = true;
        }

        return { habits, maxSingleHabitCompletions: maxSingle, dayConqueredEver };
      }),

      // ── Habit unlock counters ──
      totalHabitsCreated: 0,
      incrementTotalHabitsCreated: () => set((s) => ({ totalHabitsCreated: (s.totalHabitsCreated ?? 0) + 1 })),
      maxSingleHabitCompletions: 0,
      dayConqueredEver: false,
      // ── Challenge unlock counter ──
      totalChallengesCreated: 0,
      incrementTotalChallengesCreated: () => set((s) => ({ totalChallengesCreated: (s.totalChallengesCreated ?? 0) + 1 })),

      // ── Tasks & Projects ──
      tasks: DEFAULT_TASKS,
      projects: DEFAULT_PROJECTS,
      // setTasks also keeps the sticky completed-task counter in step: it diffs
      // the completed flag per surviving task id, so completing/un-completing moves
      // the count while deleting/sweeping a done task (it leaves the array) never
      // does. The other completion funnel is toggleIntent's task branch.
      setTasks: (tasks) => set((s) => ({
        tasks,
        tasksCompletedCount: Math.max(0, (s.tasksCompletedCount ?? 0) + completedTaskDelta(s.tasks, tasks)),
      })),
      tasksCompletedCount: 0,
      setProjects: (projects) => set({ projects }),

      // Monotonic creation counter for the SUBTASKS / RECURRING / PROJECTS
      // total-based triggers. Callers in todo.tsx wrap their task-creation
      // logic with this; it never decrements.
      totalTasksCreated: 0,
      incrementTotalTasksCreated: () => set((s) => ({ totalTasksCreated: (s.totalTasksCreated ?? 0) + 1 })),

      addOrUpdateProject: (project) => set((s) => {
        const exists = s.projects.find(p => p.id === project.id);
        return {
          projects: exists
            ? s.projects.map(p => p.id === project.id ? project : p)
            : [...s.projects, project],
        };
      }),
      deleteProject: (id) => set((s) => ({
        projects: s.projects.filter(p => p.id !== id),
      })),

      // ── Promise stats ──
      promiseStats: {
        madeTotal: 0, keptTotal: 0, brokenTotal: 0,
        monthKey: '', monthlyMade: 0, monthlyKept: 0, monthlyBroken: 0,
      },
      // Reset monthly counters when we cross into a new YYYY-MM. Lifetime
      // totals untouched. Idempotent — calling it multiple times in the
      // same month is a no-op. Called by the three record-* actions
      // before they increment, and also by the sweep on focus, so the
      // monthly view never lags behind reality.
      syncPromiseMonth: () => set((s) => {
        const d = new Date();
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (s.promiseStats.monthKey === key) return {};
        return {
          promiseStats: {
            ...s.promiseStats,
            monthKey: key,
            monthlyMade: 0,
            monthlyKept: 0,
            monthlyBroken: 0,
          },
        };
      }),
      recordPromiseMade: () => set((s) => {
        const d = new Date();
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const base = s.promiseStats.monthKey === key
          ? s.promiseStats
          : { ...s.promiseStats, monthKey: key, monthlyMade: 0, monthlyKept: 0, monthlyBroken: 0 };
        return {
          promiseStats: {
            ...base,
            madeTotal: base.madeTotal + 1,
            monthlyMade: base.monthlyMade + 1,
          },
        };
      }),
      recordPromiseKept: () => set((s) => {
        const d = new Date();
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const base = s.promiseStats.monthKey === key
          ? s.promiseStats
          : { ...s.promiseStats, monthKey: key, monthlyMade: 0, monthlyKept: 0, monthlyBroken: 0 };
        return {
          promiseStats: {
            ...base,
            keptTotal: base.keptTotal + 1,
            monthlyKept: base.monthlyKept + 1,
          },
        };
      }),
      recordPromiseBroken: () => set((s) => {
        const d = new Date();
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const base = s.promiseStats.monthKey === key
          ? s.promiseStats
          : { ...s.promiseStats, monthKey: key, monthlyMade: 0, monthlyKept: 0, monthlyBroken: 0 };
        return {
          promiseStats: {
            ...base,
            brokenTotal: base.brokenTotal + 1,
            monthlyBroken: base.monthlyBroken + 1,
          },
        };
      }),

      // ── Notes ──
      notes: DEFAULT_NOTES,
      setNotes: (notes) => set({ notes }),
      totalNotesCreated: 0,
      incrementTotalNotesCreated: () => set((s) => ({ totalNotesCreated: (s.totalNotesCreated ?? 0) + 1 })),
      diaryEntriesCreated: 0,
      incrementDiaryEntriesCreated: () => set((s) => ({ diaryEntriesCreated: (s.diaryEntriesCreated ?? 0) + 1 })),
      addOrUpdateNote: (note) => set((s) => {
        const exists = s.notes.find(n => n.id === note.id);
        if (exists) {
          // Push history snapshot if content or title changed
          let history = note.history || exists.history || [];
          const contentChanged = exists.content !== note.content || exists.title !== note.title;
          if (contentChanged && (exists.content || exists.title)) {
            const snapshot: NoteSnapshot = { content: exists.content, title: exists.title, savedAt: Date.now() };
            history = [snapshot, ...history].slice(0, 3);
          }
          return {
            notes: s.notes.map(n => n.id === note.id ? { ...note, updatedAt: Date.now(), history } : n),
          };
        }
        return { notes: [note, ...s.notes] };
      }),
      deleteNote: (id) => set((s) => ({ notes: s.notes.filter(n => n.id !== id) })),
      updateNoteStatus: (id, status) => set((s) => ({
        notes: s.notes.map(n => n.id === id ? {
          ...n,
          status,
          isPinned: status === 'active' ? n.isPinned : false,
          deletedAt: status === 'trash' ? Date.now() : undefined,
        } : n),
      })),
      toggleNoteLock: (id) => set((s) => ({
        notes: s.notes.map(n => n.id === id ? { ...n, isLocked: !n.isLocked } : n),
      })),
      toggleNotePin: (id) => set((s) => ({
        notes: s.notes.map(n => n.id === id
          ? { ...n, isPinned: !n.isPinned, order: -Date.now() }
          : n),
      })),
      updateNoteContent: (id, newContent) => set((s) => ({
        notes: s.notes.map(n => {
          if (n.id !== id) return n;
          // Push history snapshot for inline edits (checkbox toggles etc.)
          let history = n.history || [];
          if (n.content !== newContent) {
            const snapshot: NoteSnapshot = { content: n.content, title: n.title, savedAt: Date.now() };
            history = [snapshot, ...history].slice(0, 3);
          }
          return { ...n, content: newContent, updatedAt: Date.now(), history };
        }),
      })),

      dayLog: {},
      setDayLog: (log) => set({ dayLog: log }),
      logDayRating: (dateStr, rating) => set((s) => {
        // dayRatingsCount gates Weekly Review at >= 3 and must mean "distinct
        // days rated", monotonic. Derive it as the high-water mark of distinct
        // days in dayLog — NOT a per-call +1.
        //
        // Why this isn't a simple increment: the "change today's rating" UI
        // clears today's entry first (DayRatingCheckIn -> setDayLog with the key
        // deleted) and then re-adds it. The old `!dayLog[date]` check saw that
        // freshly-deleted day as brand-new and ticked again, so editing today 3x
        // pushed the count to 3 and wrongly unlocked Weekly Review. Taking
        // max(prev, distinctDays) makes re-rating the same day a no-op, still
        // ticks up on genuinely new days, and never decreases when one is cleared.
        const nextLog = { ...s.dayLog, [dateStr]: rating };
        return {
          dayLog: nextLog,
          dayRatingsCount: Math.max(s.dayRatingsCount ?? 0, Object.keys(nextLog).length),
        };
      }),

      // ── Timeline unlock counters ──
      totalBlocksCreated: 0,
      incrementTotalBlocksCreated: () => set((s) => ({ totalBlocksCreated: (s.totalBlocksCreated ?? 0) + 1 })),
      dayRatingsCount: 0,
      // Standalone incrementer kept to satisfy the interface; the canonical
      // tick lives inside logDayRating so the counter can't drift from the
      // actual ratings. Unused at call sites by design.
      incrementDayRatingsCount: () => set((s) => ({ dayRatingsCount: (s.dayRatingsCount ?? 0) + 1 })),
      activeDaysWithBlock: 0,
      lastActiveDayCounted: null,
      markActiveDayWithBlock: (dateStr) => set((s) => {
        // Idempotent per calendar day — only the first call for a given date
        // advances the counter.
        if (s.lastActiveDayCounted === dateStr) return {};
        return {
          activeDaysWithBlock: (s.activeDaysWithBlock ?? 0) + 1,
          lastActiveDayCounted: dateStr,
        };
      }),

      globalNotifsEnabled: true,
      preNotifOffset: 5,
      ongoingBlockEnabled: true,
      navRevealCount: 0,
      setGlobalNotifsEnabled: (v) => set({ globalNotifsEnabled: v }),
      setPreNotifOffset: (v) => set({ preNotifOffset: v }),
      setOngoingBlockEnabled: (v) => set({ ongoingBlockEnabled: v }),
      incrementNavRevealCount: () => set((s) => ({ navRevealCount: (s.navRevealCount ?? 0) + 1 })),

      // ── Progressive unlocks ──
      unlockedFeatures: {},
      dotsSeen: {},
      allFeaturesUnlocked: false,
      installDate: null,
      lastKnownDate: null,
      whisperQueue: [],
      introSeen: false,
      setIntroSeen: (v) => set({ introSeen: v }),
      unlock: (featureId) => set((s) => {
        // Idempotent — already-unlocked features are no-ops, no spurious
        // state change, no React re-render.
        if (s.unlockedFeatures?.[featureId]) return {};
        return {
          unlockedFeatures: { ...(s.unlockedFeatures || {}), [featureId]: true },
        };
      }),
      // Returning-user override. Flips the global switch AND fills in every
      // tracked feature ID + marks every dot/whisper as seen, so the
      // existing user lands on a fully-functional app with zero "new"
      // indicators. Per spec: "returning user — nothing is new."
      unlockAll: () => set((s) => {
        const allUnlocked: Record<string, boolean> = { ...(s.unlockedFeatures || {}) };
        const allDotsSeen: Record<string, boolean> = { ...(s.dotsSeen || {}) };
        const allWhispersSeen: Record<string, boolean> = { ...(s.whispersSeen || {}) };
        for (const id of ALL_FEATURE_IDS) {
          allUnlocked[id] = true;
          allDotsSeen[id] = true;
          allWhispersSeen[id] = true;
        }
        return {
          allFeaturesUnlocked: true,
          unlockedFeatures: allUnlocked,
          dotsSeen: allDotsSeen,
          whispersSeen: allWhispersSeen,
          // Clear any pending announcements — they'd contradict "nothing is new."
          whisperQueue: [],
        };
      }),
      markDotSeen: (featureId) => set((s) => {
        if (s.dotsSeen?.[featureId]) return {};
        return { dotsSeen: { ...(s.dotsSeen || {}), [featureId]: true } };
      }),
      setInstallDate: (date) => set((s) => {
        // First-launch stamp. Once set it's immutable — the only path that
        // overwrites is a backup restore (handled in lib/backup.ts).
        if (s.installDate) return {};
        return { installDate: date };
      }),
      // Monotonic advance only — `setLastKnownDate('2024-01-01')` after we've
      // already seen '2024-06-15' is a no-op. Backward clock manipulation
      // therefore can't lower the day counter.
      setLastKnownDate: (date) => set((s) => {
        if (s.lastKnownDate && date <= s.lastKnownDate) return {};
        return { lastKnownDate: date };
      }),
      enqueueWhisper: (featureIds, message) => set((s) => {
        // Filter featureIds the user has already seen. If every targeted ID
        // is already seen, the whisper is suppressed entirely — the user
        // doesn't need to be told twice.
        const seen = s.whispersSeen || {};
        const unseen = featureIds.filter(id => !seen[id]);
        if (featureIds.length > 0 && unseen.length === 0) return {};
        const next = [...(s.whisperQueue || []), { featureIds: unseen, message }];
        // Collapse at 3+ pending. The combined whisper carries every original
        // featureId so dismissal marks all of them seen at once.
        if (next.length >= 3) {
          const allIds = Array.from(new Set(next.flatMap(w => w.featureIds)));
          return {
            whisperQueue: [{ featureIds: allIds, message: 'Several new things are available.' }],
          };
        }
        return { whisperQueue: next };
      }),
      // Pops the head whisper and marks every featureId on it as seen so the
      // queue stays self-pruning without a separate ack step.
      dismissCurrentWhisper: () => set((s) => {
        const q = s.whisperQueue || [];
        if (q.length === 0) return {};
        const [head, ...rest] = q;
        const seen = { ...(s.whispersSeen || {}) };
        for (const id of head.featureIds) seen[id] = true;
        return { whisperQueue: rest, whispersSeen: seen };
      }),

      // ── Habits extras ──
      markWhisperSeen: (key) => set((s) => {
        const seen = s.whispersSeen || {};
        if (seen[key]) return {};
        return { whispersSeen: { ...seen, [key]: true } };
      }),
      setLastDayConqueredCelebrated: (dateStr) => set({ lastDayConqueredCelebrated: dateStr }),
      recordGoForMoreShown: (dateStr) => set({ goForMoreLastShown: dateStr }),
      recordGoForMoreIgnored: () => set((s) => {
        const n = (s.goForMoreIgnores ?? 0) + 1;
        return { goForMoreIgnores: n, goForMoreRetired: n >= 3 };
      }),
      setPact: (pact) => set({ pact }),
      setHabitCompletionNote: (habitId, dateStr, note) => set((s) => ({
        habits: s.habits.map(h => {
          if (h.id !== habitId) return h;
          const notes = { ...(h.completionNotes || {}) };
          if (note.trim()) notes[dateStr] = note.trim();
          else delete notes[dateStr];
          return { ...h, completionNotes: notes };
        }),
      })),

      // ── Challenges & Achievements ──
      challenges: [],
      setChallenges: (challenges) => set({ challenges }),
      achievements: [],
      setAchievements: (achievements) => set({ achievements }),
      challengesUnlocked: false,
      setChallengesUnlocked: (v) => set({ challengesUnlocked: v }),
      challengesTeaserSeenAt: null,
      setChallengesTeaserSeenAt: (ts) => set({ challengesTeaserSeenAt: ts }),
      challengesSeeded: false,
      setChallengesSeeded: (v) => set({ challengesSeeded: v }),
      stakes: [],
      addStake: (kind, text, sourceId) => set((s) => {
        if (!text.trim()) return {};
        // Auto-adds carry a sourceId (the challenge); dedup so a win/burial
        // contributes at most one reward / one punishment.
        if (sourceId && (s.stakes || []).some(x => x.sourceId === sourceId && x.kind === kind)) return {};
        return { stakes: [makeStake(kind, text, sourceId), ...(s.stakes || [])] };
      }),
      toggleStake: (id) => set((s) => ({ stakes: (s.stakes || []).map(x => x.id === id ? { ...x, done: !x.done, doneAt: !x.done ? Date.now() : undefined } : x) })),
      removeStake: (id) => set((s) => ({ stakes: (s.stakes || []).filter(x => x.id !== id) })),
      ledgerUnlocked: false,
      setLedgerUnlocked: (v) => set({ ledgerUnlocked: v }),

      // ── Deep Work ──
      deepWorkSessions: [],
      addDeepWorkSession: (session) => set((s) => ({ deepWorkSessions: [...s.deepWorkSessions, session] })),
      deleteDeepWorkSession: (id) => set((s) => ({ deepWorkSessions: s.deepWorkSessions.filter(x => x.id !== id) })),
      activeDeepWork: null,
      setActiveDeepWork: (s) => set({ activeDeepWork: s }),

      // ── Diary ──
      diaryEntries: [],
      addDiaryEntry: (entry) => set((s) => ({ diaryEntries: [...s.diaryEntries, entry] })),
      updateDiaryEntry: (id, text) => set((s) => ({
        diaryEntries: s.diaryEntries.map(e => e.id === id ? { ...e, text } : e),
      })),
      deleteDiaryEntry: (id) => set((s) => ({ diaryEntries: s.diaryEntries.filter(x => x.id !== id) })),

      // ── Intent ──
      // CRUD is straightforward; the only non-obvious bit is push: the date jumps
      // forward one day, pushCount increments, and pushedFromDate is preserved
      // (set on first push, never overwritten). Toggling a completed intent OFF
      // resets pushCount back to 0 — re-opening an item is treated as a fresh
      // start, so the rethink prompt doesn't fire on items that genuinely come
      // back into rotation. Auto-check helpers tick every intent linked to the
      // given source on or before today (today's, plus any past pushed-forward
      // ones that landed on a day < today and got missed).
      intents: [],
      addIntent: (intent) => set((s) => ({ intents: [...s.intents, intent] })),
      toggleIntent: (id) => set((s) => {
        // Flip the intent, then mirror the change onto a linked source (two-way):
        // checking a linked intent completes its source; un-checking reverses it.
        //   • habit     → marked fully done for the day (history filled to
        //                 targetCount), or cleared back to pending on un-check
        //   • task      → `completed` flag (+ completedAt) toggled
        //   • challenge → `current` advanced by intentIncrement (default 1; 0 = off),
        //                 reversed on un-check, clamped to [0, target]
        // pushCount is preserved across check/uncheck (only the rethink prompt's
        // Keep action resets it). Unlinked intents just flip.
        const intent = s.intents.find(i => i.id === id);
        if (!intent) return {};
        const done = !intent.completed;
        const intents = s.intents.map(i => i.id === id ? { ...i, completed: done } : i);
        if (!intent.sourceType || !intent.sourceId) return { intents };
        const { sourceType, sourceId, date } = intent;

        if (sourceType === 'habit') {
          const habits = s.habits.map(h => {
            if (h.id !== sourceId) return h;
            const history = h.history.filter(d => d !== date);
            if (done) for (let k = 0; k < (h.targetCount ?? 1); k++) history.push(date);
            return {
              ...h,
              history,
              restDays: done ? (h.restDays || []).filter(d => d !== date) : h.restDays,
              skippedDays: done ? (h.skippedDays || []).filter(d => d !== date) : h.skippedDays,
            };
          });
          // Keep the unlock counters in step with toggleHabitAction (monotonic).
          let maxSingle = s.maxSingleHabitCompletions ?? 0;
          for (const h of habits) if (h.history.length > maxSingle) maxSingle = h.history.length;
          const dayConqueredEver = (s.dayConqueredEver ?? false) || (done && isDayConquered(habits, date));
          return { intents, habits, maxSingleHabitCompletions: maxSingle, dayConqueredEver };
        }

        if (sourceType === 'task') {
          const now = Date.now();
          const tasks = s.tasks.map(t => t.id === sourceId
            ? { ...t, completed: done, completedAt: done ? now : undefined }
            : t);
          // Same sticky-counter bookkeeping as setTasks — completing/un-completing
          // a task via its linked intent must move the count too.
          return { intents, tasks, tasksCompletedCount: Math.max(0, (s.tasksCompletedCount ?? 0) + completedTaskDelta(s.tasks, tasks)) };
        }

        if (sourceType === 'challenge') {
          const challenges = s.challenges.map(c => {
            if (c.id !== sourceId) return c;
            const inc = c.intentIncrement ?? 1;
            if (inc === 0) return c;
            const next = Math.max(0, Math.min(c.target, c.current + (done ? inc : -inc)));
            return { ...c, current: next };
          });
          return { intents, challenges };
        }

        return { intents };
      }),
      updateIntentLabel: (id, label) => set((s) => ({
        intents: s.intents.map(i => i.id === id ? { ...i, label } : i),
      })),
      deleteIntent: (id) => set((s) => ({ intents: s.intents.filter(i => i.id !== id) })),
      // Ship an intent BACK from tomorrow to today — mirror of push-to-tomorrow.
      // DECREMENTS pushCount (clamped at 0) because pulling forward undoes a push:
      // the chronic-deferral signal should rewind alongside the date change.
      // E.g. an item pushed twice (count=2) and then ship-back'd lands on today
      // with count=1, properly reflecting "this slipped once, recovered once."
      shipIntentBackToToday: (id) => set((s) => {
        const today = (() => {
          const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        })();
        return {
          intents: s.intents.map(i => i.id === id ? {
            ...i,
            date: today,
            pushCount: Math.max(0, (i.pushCount ?? 0) - 1),
          } : i),
        };
      }),
      // Explicit zero on the chronic-deferral counter. Called from the rethink
      // prompt's Keep action — "I've acknowledged the slipping, give me a clean
      // slate to try again."
      resetIntentPushCount: (id) => set((s) => ({
        intents: s.intents.map(i => i.id === id ? { ...i, pushCount: 0 } : i),
      })),
      pushIntentToTomorrow: (id) => set((s) => ({
        intents: s.intents.map(i => {
          if (i.id !== id) return i;
          // Compute "tomorrow" relative to the intent's CURRENT date, not today's
          // wall-clock — pushing a yesterday-leftover-item forward shouldn't skip
          // dates. If the intent's date is in the past, push to today; otherwise
          // push one day forward.
          const today = (() => {
            const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          })();
          let next: string;
          if (i.date < today) {
            next = today;
          } else {
            const [yy, mm, dd] = i.date.split('-').map(Number);
            const d = new Date(yy, mm - 1, dd + 1);
            next = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          }
          return {
            ...i,
            date: next,
            pushCount: (i.pushCount ?? 0) + 1,
            pushedFromDate: i.pushedFromDate ?? i.date,
          };
        }),
      })),
      autoCheckIntentsForTask: (taskId) => set((s) => ({
        intents: s.intents.map(i =>
          i.sourceType === 'task' && i.sourceId === taskId && !i.completed
            ? { ...i, completed: true } : i
        ),
      })),
      autoCheckIntentsForHabit: (habitId, dateStr) => set((s) => ({
        intents: s.intents.map(i =>
          i.sourceType === 'habit' && i.sourceId === habitId && i.date === dateStr && !i.completed
            ? { ...i, completed: true } : i
        ),
      })),
      autoCheckIntentsForChallenge: (challengeId, dateStr) => set((s) => ({
        intents: s.intents.map(i =>
          i.sourceType === 'challenge' && i.sourceId === challengeId && i.date === dateStr && !i.completed
            ? { ...i, completed: true } : i
        ),
      })),
      advanceLinkedChallengesForHabit: (habitId, dateStr) => set((s) => {
        // Only advance once the habit hits its targetCount for the day —
        // a "drink 3 glasses" habit shouldn't bump the linked challenge
        // on the first glass. Idempotency lives on logDates so the
        // challenge's counter only moves the first time today qualifies.
        const habit = s.habits.find(h => h.id === habitId);
        if (!habit) return {};
        const completionsToday = habit.history.reduce(
          (acc, d) => acc + (d === dateStr ? 1 : 0),
          0
        );
        if (completionsToday < habit.targetCount) return {};

        let touched = false;
        const updatedChallenges = s.challenges.map(c => {
          // Resolve this habit's link config. Prefer the new `links` model;
          // fall back to a legacy linkedHabitIds entry (treated as the old
          // hardcoded auto-advance +1) so un-migrated data still advances.
          const persistedLink = c.links?.find(l => l.habitId === habitId);
          const link = persistedLink
            ?? (c.linkedHabitIds?.includes(habitId) ? { habitId, autoAdvance: true, increment: 1 } : undefined);
          if (!link || !link.autoAdvance) return c;
          if (c.deadState !== 'active' && c.deadState !== 'resurrected') return c;
          if (c.current >= c.target) return c;
          // Idempotency is PER-(habit, challenge, day): each linked habit may
          // advance this challenge once per day. This used to key off logDates
          // (per-challenge), so the FIRST linked habit to complete each day
          // locked out every OTHER linked habit — completing a second one did
          // nothing ("worked once, never again"). We now stamp the date on the
          // LINK itself, so different habits each contribute their increment,
          // while re-completing the SAME habit the same day doesn't double-count.
          // Legacy links (no persisted entry) keep the old per-day logDates guard.
          const alreadyAdvanced = persistedLink
            ? persistedLink.lastAdvancedDate === dateStr
            : (c.logDates || []).includes(dateStr);
          if (alreadyAdvanced) return c;

          touched = true;
          const inc = Math.max(1, Math.round(link.increment || 1));
          const newCurrent = Math.min(c.target, c.current + inc);
          const appliedDelta = newCurrent - c.current;
          const isAchieved = newCurrent >= c.target && c.deadState === 'active';
          const existingLogs = c.logDates || [];
          return {
            ...c,
            current: newCurrent,
            lastLoggedAt: Date.now(),
            // logDates stays a de-duped, date-only record (drives the activity
            // ring); the per-habit idempotency now lives on the link.
            logDates: existingLogs.includes(dateStr) ? existingLogs : [...existingLogs, dateStr],
            links: persistedLink
              ? (c.links || []).map(l => l.habitId === habitId ? { ...l, lastAdvancedDate: dateStr } : l)
              : c.links,
            ledger: [...(c.ledger || []), makeLedgerEntry(appliedDelta, 'habit')],
            ...(isAchieved ? { deadState: 'achieved' as DeadState, achievedAt: Date.now() } : {}),
          };
        });

        return touched ? { challenges: updatedChallenges } : {};
      }),

      // ── Weekly reflection ──
      weeklyReflections: {},
      addWeeklyReflection: (r) => set((s) => ({
        weeklyReflections: { ...s.weeklyReflections, [r.weekKey]: r },
      })),
      // Default end-of-week is Sunday — the common close-of-week worldwide;
      // Iranian users can flip it to Friday from Settings. We deliberately
      // don't auto-detect from locale because the user's preference here is
      // more about ritual than calendar.
      endOfWeekDay: 'sunday',
      setEndOfWeekDay: (d) => set({ endOfWeekDay: d }),

      diaryLocked: false,
      setDiaryLocked: (v) => set({ diaryLocked: v }),

      birthdayNotifsPurged: false,
      markBirthdayNotifsPurged: () => set({ birthdayNotifsPurged: true }),

      // ── Reflection acknowledgement ──
      // Append-only with a hard cap. Newest at the end; on overflow we drop
      // the oldest. Order preserved for predictable cap behavior.
      reflectedKeys: [],
      markReflected: (key) => set((s) => {
        if (s.reflectedKeys.includes(key)) return {};
        const next = [...s.reflectedKeys, key];
        if (next.length > 100) next.splice(0, next.length - 100);
        return { reflectedKeys: next };
      }),

      // ── Reset user data ── for the "Start fresh" branch of the returning-
      // user flow. Wipes user-generated content back to seed defaults but
      // preserves: settings (theme, calendar, notif prefs, endOfWeekDay),
      // the unlock slice (installDate, unlockedFeatures, etc.), and persist
      // metadata. The returning-user flow calls unlockAll() AFTER this so
      // the user lands on a fully-unlocked, empty app.
      resetUserData: () => set({
        habits: DEFAULT_HABITS,
        totalHabitsCreated: 0,
        maxSingleHabitCompletions: 0,
        dayConqueredEver: false,
        tasks: DEFAULT_TASKS,
        projects: DEFAULT_PROJECTS,
        totalTasksCreated: 0,
        tasksCompletedCount: 0,
        promiseStats: {
          madeTotal: 0, keptTotal: 0, brokenTotal: 0,
          monthKey: '', monthlyMade: 0, monthlyKept: 0, monthlyBroken: 0,
        },
        notes: DEFAULT_NOTES,
        totalNotesCreated: 0,
        diaryEntriesCreated: 0,
        dayLog: {},
        totalBlocksCreated: 0,
        dayRatingsCount: 0,
        activeDaysWithBlock: 0,
        lastActiveDayCounted: null,
        challenges: [],
        totalChallengesCreated: 0,
        achievements: [],
        challengesSeeded: false,
        deepWorkSessions: [],
        activeDeepWork: null,
        diaryEntries: [],
        intents: [],
        weeklyReflections: {},
        reflectedKeys: [],
        whispersSeen: {},
        lastDayConqueredCelebrated: undefined,
        goForMoreIgnores: undefined,
        goForMoreRetired: undefined,
        goForMoreLastShown: undefined,
        pact: undefined,
      }),
    }),
    {
      // Persistence config. TWO independent version levers — don't conflate them:
      //   • STORAGE_NAME suffix (above) = the physical key. Changing it = a fresh
      //     store = DATA WIPE. Frozen for shipped builds.
      //   • `version` + `migrate` (below) = the schema migrator: bump `version`
      //     and add a step to upgrade existing data IN PLACE across an update.
      // (The v0→v1 step below is the historical unlocks-slice reshape:
      //  whispersSeen array→record, unlocks→unlockedFeatures, etc.)
      name: STORAGE_NAME,
      storage: createJSONStorage(() => zustandStorage),
      version: 9,
      migrate: (persistedState: any, version: number) => {
        // SAFETY 1 — automatic pre-migration backup. migrate runs ONLY when an
        // update changes the schema version: the one moment a bug could corrupt
        // real data. Snapshot the incoming blob first, so the user's pre-update
        // data is always recoverable with zero manual export.
        try {
          if (persistedState && typeof persistedState === 'object') {
            storage.set(PREMIGRATE_BACKUP_KEY, JSON.stringify({ fromVersion: version, savedAt: Date.now(), state: persistedState }));
          }
        } catch {}
        // SAFETY 2 — never let a migration bug nuke the store. If any step throws,
        // fall back to the original persisted data unchanged (the default merge
        // then backfills new fields). A shape mismatch beats a blank app.
        try {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        let next: any = persistedState;
        // v0 → v1: legacy unlock-key renames (dev installs predating the
        // consolidated unlock store).
        if (version < 1) {
          next = { ...next };
          // whispersSeen array → record
          if (Array.isArray(next.whispersSeen)) {
            const rec: Record<string, boolean> = {};
            for (const k of next.whispersSeen) if (typeof k === 'string') rec[k] = true;
            next.whispersSeen = rec;
          }
          // unlocks → unlockedFeatures (preserve any existing values)
          if (next.unlocks && !next.unlockedFeatures) {
            next.unlockedFeatures = next.unlocks;
          }
          delete next.unlocks;
          // unlocksAcknowledged → dotsSeen
          if (next.unlocksAcknowledged && !next.dotsSeen) {
            next.dotsSeen = next.unlocksAcknowledged;
          }
          delete next.unlocksAcknowledged;
          // unlocksMigrated has no analog in the new design
          delete next.unlocksMigrated;
        }
        // v1 → v2: end-of-week 'saturday' option was removed in favor of
        // 'sunday'. Anyone who had picked Saturday inherits Sunday.
        if (version < 2) {
          next = { ...next };
          if (next.endOfWeekDay === 'saturday') next.endOfWeekDay = 'sunday';
        }
        // v2 → v3: Challenges redesign data model. Each challenge gains a
        // cadence, a richer `links` array (replacing the flat linkedHabitIds),
        // and a timestamped `ledger`. All additive — existing current/target
        // counting is untouched; we only backfill the new fields so old
        // challenges behave as before.
        if (version < 3) {
          next = { ...next };
          if (Array.isArray(next.challenges)) {
            next.challenges = next.challenges.map((c: any) => {
              const out = { ...c };
              if (!out.cadence) out.cadence = inferChallengeCadence(out.target, out.unit);
              // linkedHabitIds → links (preserve today's hardcoded +1/auto behavior)
              if (!Array.isArray(out.links)) {
                out.links = Array.isArray(out.linkedHabitIds)
                  ? out.linkedHabitIds.map((id: string) => ({ habitId: id, autoAdvance: true, increment: 1 }))
                  : [];
              }
              // Backfill the ledger from logDates so old challenges aren't blank.
              // Each known log day becomes a best-effort +1 at local noon (noon
              // dodges DST/timezone edge cases on the date boundary).
              if (!Array.isArray(out.ledger)) {
                const dates: string[] = Array.isArray(out.logDates) ? out.logDates : [];
                out.ledger = dates.map((d) => {
                  const [y, m, day] = String(d).split('-').map(Number);
                  const ts = new Date(y || 1970, (m || 1) - 1, day || 1, 12, 0, 0).getTime();
                  return { id: `bk_${d}`, ts, delta: 1, source: 'manual' as LedgerSource };
                });
              }
              return out;
            });
          }
        }
        // v3 → v4: formerly seeded ~1 year of fake challenges/achievements for
        // dev evaluation. Removed for ship — challenges follow the real unlock
        // arc and start empty. Slot kept as a no-op so the chain numbering stays
        // stable for already-persisted stores.
        // v4 → v5: the calm-pivot cut. Timeline and its satellite slices are
        // being removed (Habits becomes home). Strip the cut slices out of the
        // persisted blob so they don't linger as dead keys once their store
        // fields + readers are deleted in Phase 2 — a returning user's old
        // MMKV data won't carry an orphaned activities/dayNotes/birthdays.
        // The KEEPERS being rehomed into Habits (intents, dayLog,
        // weeklyReflections, endOfWeekDay) are deliberately left untouched so
        // they survive the cut. Pure + idempotent: re-running just re-deletes
        // already-absent keys. NOTE: birthday-notification cancellation rides
        // with the Phase 2 Birthdays cut, not here — migrate stays
        // side-effect-free. (Verified by scripts/verify-persist-migration.mjs.)
        if (version < 5) {
          next = { ...next };
          delete next.activities;
          delete next.dayNotes;
          delete next.birthdays;
        }
        // v5 → v6: the Reminders feature was folded into per-habit reminders;
        // its standalone slice is gone. Strip the now-dead `reminders` key so it
        // doesn't linger in the persisted blob. (activities/dayNotes/birthdays
        // were already stripped in v5.) Pure + idempotent.
        if (version < 6) {
          next = { ...next };
          delete next.reminders;
        }
        // v6 → v7: theme went from a boolean (isDarkMode) to a 3-way themeMode
        // ('light' | 'dark' | 'blue'). Derive themeMode from the old boolean so
        // existing users keep their choice; keep isDarkMode mirrored (legacy
        // readers treat 'blue' as dark). Pure + idempotent.
        if (version < 7) {
          next = { ...next };
          if (next.themeMode !== 'light' && next.themeMode !== 'dark' && next.themeMode !== 'blue') {
            next.themeMode = next.isDarkMode ? 'dark' : 'light';
          }
          next.isDarkMode = next.themeMode !== 'light';
        }
        // v7 → v8: defensive shape-normalization (no schema change). Coerces
        // every crash-prone field — habit.history/frequency, note.content/status,
        // and the top-level data slices — back to a safe shape so an old or
        // partially-written blob can never throw inside a renderer. Idempotent.
        if (version < 8) {
          next = sanitizeStateSlice(next);
        }
        // v8 → v9: completed-task progress became a sticky counter
        // (tasksCompletedCount) instead of being re-derived from the live task
        // list — so deleting/sweeping a done task no longer reverts Challenges
        // unlock progress. Seed it from the current completed count so existing
        // users keep their standing; from here it only moves on complete/un-check.
        if (version < 9) {
          next = { ...next };
          if (typeof next.tasksCompletedCount !== 'number') {
            const ts = Array.isArray(next.tasks) ? next.tasks : [];
            next.tasksCompletedCount = ts.filter((t: any) => t && t.completed && t.status !== 'trash').length;
          }
        }
        return next;
        } catch (e) {
          console.warn('Store migration failed — kept pre-migration data as-is', e);
          return persistedState;
        }
      },
    }
  )
);

// DEV usage-seed block removed for ship: challenges follow the real unlock arc
// and start empty (no forced content-gate open, no fake seed data).