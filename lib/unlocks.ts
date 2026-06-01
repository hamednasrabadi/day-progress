/**
 * Progressive unlock infrastructure — feature IDs, default-unlocked whitelist,
 * helper functions, and reactive hooks.
 *
 * Two-list model (per the foundation spec):
 *   • FEATURE_IDS — every gated feature. Until its trigger fires, isUnlocked
 *     returns false. Use these constants at every call site so a rename
 *     anywhere is a single grep.
 *   • DEFAULT_UNLOCKED — explicit whitelist of core features that are always
 *     on with no trigger required. Mostly for documentation; only consulted
 *     by isUnlocked when an ID is neither in FEATURE_IDS nor in
 *     unlockedFeatures.
 *
 * isUnlocked is intentionally strict about unknown IDs: anything not in
 * unlockedFeatures and not in DEFAULT_UNLOCKED returns false. A typoed ID
 * hides the UI rather than accidentally exposing a gated feature.
 *
 * The store sits in useAppStore — single persistence root keeps backup,
 * MMKV, and tab integration consistent. Helpers here read it lazily via
 * getState(); reactive hooks subscribe via useAppStore selectors.
 */

import { useAppStore } from '../store/useAppStore';

// ── Feature IDs ──────────────────────────────────────────────────────────
// Every feature gated by a progressive unlock. SCREAMING_SNAKE constants so
// imports read clearly at call sites; the value is just a string the store
// uses as a key in unlockedFeatures. If you add a new one, drop the trigger
// condition into useUnlockTriggers (lib/unlockTriggers.ts).

export const FEATURE_IDS = {
  // Tasks
  SUBTASKS: 'SUBTASKS',
  PROMISE: 'PROMISE',
  DEEP_WORK: 'DEEP_WORK',
  RECURRING: 'RECURRING',
  PROJECTS: 'PROJECTS',
  ADHD_MODE: 'ADHD_MODE',
  // Timeline
  SMART_SUGGESTIONS: 'SMART_SUGGESTIONS',
  FOCUS_BLOCK_RUNNER: 'FOCUS_BLOCK_RUNNER',
  DAILY_REVIEW: 'DAILY_REVIEW',
  NOW_PLAYING: 'NOW_PLAYING',
  // Notes
  DIARY: 'DIARY',
  MOOD_TAGGING: 'MOOD_TAGGING',
  HIGHLIGHT_COLORS: 'HIGHLIGHT_COLORS',
  SEALING: 'SEALING',
  // Challenges
  CHALLENGES_TAB: 'CHALLENGES_TAB',
  MILESTONES: 'MILESTONES',
  LINKED_HABITS: 'LINKED_HABITS',
  CAPSULE_LOCK: 'CAPSULE_LOCK',
  // Habits
  PACT: 'PACT',
  COMPLETION_NOTES: 'COMPLETION_NOTES',
  STRENGTH_SCORE: 'STRENGTH_SCORE',
  WEEKLY_REVIEW: 'WEEKLY_REVIEW',
} as const;

export type FeatureId = typeof FEATURE_IDS[keyof typeof FEATURE_IDS];

// Convenience array for iteration (unlockAll, debug, etc).
export const ALL_FEATURE_IDS: string[] = Object.values(FEATURE_IDS);

// ── Feature display metadata ───────────────────────────────────────────────
// Single source of truth for human-facing names + one-line descriptions.
// Drives the Feature Hunt depth map (components/FeatureHunt.tsx). `group` is
// the tab the feature belongs to — used only for ordering the map. Display
// names follow the prompt's exact wording (note ADHD_MODE shows as "Focus
// Mode"). Descriptions are one plain sentence, no unlock instructions — the
// Hunt shows WHAT exists, never HOW to get it.
export type FeatureGroup = 'Tasks' | 'Notes' | 'Challenges' | 'Habits';
export type FeatureMeta = { name: string; description: string; group: FeatureGroup };

export const FEATURE_META: Record<string, FeatureMeta> = {
  [FEATURE_IDS.SUBTASKS]:           { name: 'Sub-tasks',          description: 'Break a task into smaller checkable steps.',         group: 'Tasks' },
  [FEATURE_IDS.PROMISE]:            { name: 'Promise',            description: 'Mark a task as a commitment — kept or broken, on the record.', group: 'Tasks' },
  [FEATURE_IDS.DEEP_WORK]:          { name: 'Deep Work',          description: 'Run a focused, timed session toward one thing.',     group: 'Tasks' },
  [FEATURE_IDS.RECURRING]:          { name: 'Recurring',          description: 'Tasks that come back on a schedule.',                group: 'Tasks' },
  [FEATURE_IDS.PROJECTS]:           { name: 'Projects',           description: 'Group related tasks into folders.',                  group: 'Tasks' },
  [FEATURE_IDS.ADHD_MODE]:          { name: 'Focus Mode',         description: 'See one task at a time when the list feels like too much.', group: 'Tasks' },

  [FEATURE_IDS.DIARY]:              { name: 'Diary',              description: 'A private, chronological journal.',                  group: 'Notes' },
  [FEATURE_IDS.MOOD_TAGGING]:       { name: 'Mood Tagging',       description: 'Tag how a diary entry felt.',                        group: 'Notes' },
  [FEATURE_IDS.HIGHLIGHT_COLORS]:   { name: 'Highlight Colors',   description: 'Highlight passages inside your notes.',              group: 'Notes' },
  [FEATURE_IDS.SEALING]:            { name: 'Sealing',            description: 'Lock a note until a future date.',                   group: 'Notes' },

  [FEATURE_IDS.CHALLENGES_TAB]:     { name: 'Challenges',         description: 'Long-run goals with a deadline and a target.',       group: 'Challenges' },
  [FEATURE_IDS.MILESTONES]:         { name: 'Milestones',         description: 'Break a challenge into marked checkpoints.',          group: 'Challenges' },
  [FEATURE_IDS.LINKED_HABITS]:      { name: 'Linked Habits',      description: 'Let a habit feed a challenge\'s progress.',          group: 'Challenges' },
  [FEATURE_IDS.CAPSULE_LOCK]:       { name: 'Capsule Finish',     description: 'Seal a message that opens when you finish.',          group: 'Challenges' },

  [FEATURE_IDS.PACT]:               { name: 'Pact',               description: 'A tiered commitment across several habits.',          group: 'Habits' },
  [FEATURE_IDS.COMPLETION_NOTES]:   { name: 'Completion Notes',   description: 'Jot a note each time you complete a habit.',          group: 'Habits' },
  [FEATURE_IDS.STRENGTH_SCORE]:     { name: 'Strength Score',     description: 'A rolling measure of how consistent you are.',        group: 'Habits' },
  [FEATURE_IDS.WEEKLY_REVIEW]:      { name: 'Weekly Review',      description: 'Close out each week with a written reflection, saved to Notes.', group: 'Habits' },
};

// Display order for the Feature Hunt — grouped by tab, matching the prompt.
export const FEATURE_HUNT_ORDER: string[] = [
  FEATURE_IDS.SUBTASKS, FEATURE_IDS.PROMISE, FEATURE_IDS.DEEP_WORK, FEATURE_IDS.RECURRING, FEATURE_IDS.PROJECTS, FEATURE_IDS.ADHD_MODE,
  FEATURE_IDS.DIARY, FEATURE_IDS.MOOD_TAGGING, FEATURE_IDS.HIGHLIGHT_COLORS, FEATURE_IDS.SEALING,
  FEATURE_IDS.CHALLENGES_TAB, FEATURE_IDS.MILESTONES, FEATURE_IDS.LINKED_HABITS, FEATURE_IDS.CAPSULE_LOCK,
  FEATURE_IDS.PACT, FEATURE_IDS.COMPLETION_NOTES, FEATURE_IDS.STRENGTH_SCORE, FEATURE_IDS.WEEKLY_REVIEW,
];

// ── Default-unlocked features ────────────────────────────────────────────
// Things that ship "on" from day zero — no trigger required. Listed here so
// isUnlocked has a positive answer when called with one of these IDs.
// Anything NOT in FEATURE_IDS and NOT in this set returns false (typo safety).
export const DEFAULT_UNLOCKED = new Set<string>([
  // Tasks — core
  'CORE_TASK_CREATE',
  'CORE_TASK_EDIT',
  'CORE_TASK_ARCHIVE',
  'CORE_TASK_TRASH',
  'CORE_TASK_ENERGY',
  'CORE_TASK_DEADLINE',
  'CORE_TASK_PRIORITY',
  'CORE_TASK_REMINDER',
  // Notes — core
  'CORE_NOTE_CREATE',
  'CORE_NOTE_EDIT',
  'CORE_NOTE_TAGS',
  'CORE_NOTE_COLORS',
  'CORE_NOTE_PIN',
  'CORE_NOTE_AUDIO',
  'CORE_NOTE_IMAGES',
  'CORE_NOTE_BIOMETRIC_LOCK',
  'CORE_NOTE_GROUPS',
  // Timeline — core
  'CORE_TIMELINE_INTENT',
  'CORE_TIMELINE_DAY_NOTE',
  'CORE_TIMELINE_DAY_RATING',
  'CORE_TIMELINE_REMINDERS',
  'CORE_TIMELINE_WEEKLY_SCHEDULE',
  // Habits — core
  'CORE_HABIT_CREATE',
  'CORE_HABIT_SWIPE',
  'CORE_HABIT_STREAK',
  'CORE_HABIT_CALENDAR_HISTORY',
  // Challenges — core
  'CORE_CHALLENGE_NARRATOR',
  // Settings — core
  'CORE_SETTINGS_BACKUP',
]);

// ── Internal: which IDs are gated vs free ────────────────────────────────
// Used by isUnlocked to decide what an unknown ID means. Membership in
// LOCKED_SET means "this gates on a trigger"; absence (combined with
// absence from DEFAULT_UNLOCKED) means "we don't know what this is."
const LOCKED_SET = new Set<string>(ALL_FEATURE_IDS);

// ── Helpers (non-reactive — read state at call time) ────────────────────

export function isUnlocked(id: string): boolean {
  const s = useAppStore.getState();
  if (s.allFeaturesUnlocked) return true;
  if (s.unlockedFeatures && s.unlockedFeatures[id]) return true;
  if (DEFAULT_UNLOCKED.has(id)) return true;
  return false;
}

export function isNew(id: string): boolean {
  if (!isUnlocked(id)) return false;
  const s = useAppStore.getState();
  return !(s.dotsSeen && s.dotsSeen[id]);
}

// Returns calendar days between installDate and "today" using lastKnownDate
// to defeat backward clock manipulation. If today < lastKnownDate (the user
// rolled their device clock back), we report days as of lastKnownDate — the
// counter never regresses. Forward manipulation isn't blocked client-side
// (no server time to anchor against); honest timezone travel still works.
export function getDaysSinceInstall(): number {
  const s = useAppStore.getState();
  if (!s.installDate) return 0;
  const today = todayStr();
  const lastKnown = s.lastKnownDate || today;
  // Effective "today" = whichever is later — clamps backward manipulation.
  const effective = today < lastKnown ? lastKnown : today;
  const installMs = parseDateOnly(s.installDate);
  const effectiveMs = parseDateOnly(effective);
  if (installMs == null || effectiveMs == null) return 0;
  const diff = Math.floor((effectiveMs - installMs) / 86400000);
  return Math.max(0, diff);
}

// ── Reactive hooks ──────────────────────────────────────────────────────
// Use these inside components so re-renders fire when the answer changes.

export function useIsUnlocked(id: string): boolean {
  return useAppStore(s =>
    s.allFeaturesUnlocked
      ? true
      : !!(s.unlockedFeatures && s.unlockedFeatures[id]) || DEFAULT_UNLOCKED.has(id)
  );
}

export function useIsNew(id: string): boolean {
  return useAppStore(s => {
    const unlocked = s.allFeaturesUnlocked
      || !!(s.unlockedFeatures && s.unlockedFeatures[id])
      || DEFAULT_UNLOCKED.has(id);
    if (!unlocked) return false;
    return !(s.dotsSeen && s.dotsSeen[id]);
  });
}

export function useDaysSinceInstall(): number {
  // Subscribes to install + lastKnown — recomputes only when those move,
  // not on every store change.
  return useAppStore(s => {
    if (!s.installDate) return 0;
    const today = todayStr();
    const lastKnown = s.lastKnownDate || today;
    const effective = today < lastKnown ? lastKnown : today;
    const installMs = parseDateOnly(s.installDate);
    const effectiveMs = parseDateOnly(effective);
    if (installMs == null || effectiveMs == null) return 0;
    return Math.max(0, Math.floor((effectiveMs - installMs) / 86400000));
  });
}

// ── Date helpers ────────────────────────────────────────────────────────

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Parses a YYYY-MM-DD string into a UTC-midnight ms timestamp. Returns null
// on malformed input. Treating both endpoints as UTC midnight makes the
// floor((b - a) / DAY_MS) calculation work cleanly across DST boundaries.
function parseDateOnly(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (isNaN(y) || isNaN(mo) || isNaN(d)) return null;
  return Date.UTC(y, mo - 1, d);
}

// ── Trigger input shape ─────────────────────────────────────────────────
// useUnlockTriggers takes this snapshot; the root layout assembles it from
// the existing store. Fields are typed loosely (per-tab implementations may
// extend) but every trigger condition in lib/unlockTriggers.ts reads only
// from this object so the contract is one-directional.

export type AppStateForUnlocks = {
  totalTasksCreated: number;
  activeTaskCount: number;
  totalBlocksCreated: number;
  dayRatingsCount: number;
  activeDaysWithBlock: number;        // distinct calendar days a block existed
  totalNotesCreated: number;
  diaryEntriesCreated: number;
  totalHabitsCreated: number;
  habitCompletions: Record<string, number>;  // per-habit total completions
  maxSingleHabitCompletions: number;
  dayConqueredEver: boolean;
  totalChallengesCreated: number;
  activeChallengesCount: number;
  anyChallengeFailed: boolean;
  daysSinceInstall: number;
  sealingUnlocked: boolean;
};

// Stable empty snapshot — useful as a default while stores are still
// hydrating on first launch.
export const EMPTY_APP_STATE_FOR_UNLOCKS: AppStateForUnlocks = {
  totalTasksCreated: 0,
  activeTaskCount: 0,
  totalBlocksCreated: 0,
  dayRatingsCount: 0,
  activeDaysWithBlock: 0,
  totalNotesCreated: 0,
  diaryEntriesCreated: 0,
  totalHabitsCreated: 0,
  habitCompletions: {},
  maxSingleHabitCompletions: 0,
  dayConqueredEver: false,
  totalChallengesCreated: 0,
  activeChallengesCount: 0,
  anyChallengeFailed: false,
  daysSinceInstall: 0,
  sealingUnlocked: false,
};
