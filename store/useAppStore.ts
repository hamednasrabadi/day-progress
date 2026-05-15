import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { createMMKV } from 'react-native-mmkv';
import { Feather } from '@expo/vector-icons';

// ─── STORAGE ───
export const storage = createMMKV({ id: 'titan-storage' });

const zustandStorage: StateStorage = {
  setItem: (name, value) => storage.set(name, value),
  getItem: (name) => storage.getString(name) ?? null,
  removeItem: (name) => storage.remove(name),
};

// ─── HABIT TYPES ───
export type HabitStatus = 'active' | 'archived';
export type TimeBlock = 'morning' | 'afternoon' | 'evening' | 'anytime';

export type Habit = {
  id: string; title: string; color: string; icon: keyof typeof Feather.glyphMap;
  history: string[]; restDays: string[]; skippedDays: string[]; createdAt: number;
  targetCount: number; unit: string;
  scheduleType: 'days' | 'interval'; frequency: string[];
  intervalDays?: number; startDate?: string;
  hasReminder?: boolean; reminderTime?: string;
  timeBlock: TimeBlock; status: HabitStatus;
  completionNotes?: Record<string, string>;
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

// ─── TIMELINE TYPES ───
// Previously stored in AsyncStorage under '@timeline_activities_v6' and
// '@command_day_log_v1'. Now lives in the Zustand store (MMKV-backed) so:
//   1. All tabs can read timeline data without AsyncStorage calls.
//   2. Activities are included in the future app-wide export system.
//   3. Notification preferences no longer need separate AsyncStorage keys.

export type Activity = {
  id: string;
  groupId?: string;
  day: string;        // 'Monday', 'Tuesday', etc. — week-day name (used when scheduledDate is absent)
  startHour: number;  // decimal hours, e.g. 9.5 = 09:30
  endHour: number;    // decimal hours; endHour < startHour = block bleeds past midnight
  color: string;
  label: string;
  hasReminder?: boolean;
  isHype?: boolean;   // deep-work / high-intensity marker
  // Anchored — this block is fixed in time and won't be auto-shifted when other blocks
  // run over or end early. Used by the (still-being-designed) plan-vs-reality reflow logic
  // to decide which blocks the algorithm is allowed to move. Default false.
  isLocked?: boolean;
  // When set (YYYY-MM-DD), the block happens only on that specific date, overriding weekly `day` recurrence.
  scheduledDate?: string;
  // ── Effective-date versioning (past-immutability) ──────────────────────────────
  // `effectiveFrom`: first YYYY-MM-DD this version is visible. Created today → today's date.
  //                  Legacy activities (migrated) get '2000-01-01' so they render everywhere.
  // `effectiveUntil`: first YYYY-MM-DD this version is NO LONGER visible (exclusive). Set when the
  //                   activity is edited or deleted — the old version is retained with this field
  //                   set so past-date renders keep showing what was truly scheduled.
  // Render filter: `effectiveFrom <= renderDate AND (!effectiveUntil || effectiveUntil > renderDate)`
  effectiveFrom?: string;
  effectiveUntil?: string;
};

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

export type Challenge = {
  id: string; title: string; icon: any;
  color: string; current: number; target: number; unit: string;
  deadlineTs?: number; reward?: string; punishment?: string;
  urgencyStyle?: UrgencyStyle;
  createdAt: number; milestones?: Milestone[];
  linkedHabitIds?: string[]; deadState: DeadState;
  reviewedAt?: number; buriedAt?: number; achievedAt?: number;
  deletedAt?: number; wasResurrected?: boolean;
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
// Distinct from DiaryEntry: DiaryEntry was reflection-text bound to a *past*
// date (a thought you logged that day). DayNote is forward-or-backward looking
// reference text bound to *any* date.
export type DayNote = {
  id: string;
  date: string;       // YYYY-MM-DD
  text: string;       // free-form
  createdAt: number;
};

// ─── WEEKLY REFLECTION ────────────────────────────────────────────────────
// One reflection per ISO week, captured on the user's chosen end-of-week
// day (Friday or Saturday). The card prompt shows the rating breakdown for
// the week ("5 Strong, 1 Steady, 1 Off") and asks for a single free-text
// reflection. If 3+ Off days landed, a warm-words note appears AFTER the
// user submits — the app responds to what they said, not pre-judges it.
export type EndOfWeekDay = 'friday' | 'saturday';

// Quick reminder — captured from the Timeline bell icon. No project, no
// urgency, no recurrence: just text + a moment. Notification is scheduled at
// add-time; entry is swept after fireAt + grace period passes.
export type Reminder = {
  id: string;
  text: string;
  fireAt: number;     // absolute timestamp ms
  createdAt: number;
};
export type WeeklyReflection = {
  id: string;             // ISO week key (YYYY-Www) — e.g. 2026-W18
  weekKey: string;        // same as id; mirrored for clarity
  endedOn: string;        // YYYY-MM-DD of the day the reflection was logged
  text: string;           // free-form
  createdAt: number;
};

// ─── DEFAULT DATA ───
const NOW = Date.now();
const DAY_MS = 86400000;

// Default habits — seed a new user's first week.
// Picked to show: all 4 time blocks, both schedule types, targetCount > 1,
// and a mix of universal habits that don't assume anything about the user.
const DEFAULT_HABITS: Habit[] = [
  // Morning — daily, simple, evocative
  {
    id: 'h_sunrise', title: 'Sunrise ritual', timeBlock: 'morning', color: '#F59E0B', icon: 'sunrise',
    history: [], restDays: [], skippedDays: [], createdAt: NOW, targetCount: 1, unit: 'moment',
    scheduleType: 'days', frequency: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], status: 'active'
  },
  // Anytime — demonstrates multi-count badge (3 glasses / day)
  {
    id: 'h_water', title: 'Drink water', timeBlock: 'anytime', color: '#06B6D4', icon: 'droplet',
    history: [], restDays: [], skippedDays: [], createdAt: NOW, targetCount: 3, unit: 'glasses',
    scheduleType: 'days', frequency: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], status: 'active'
  },
  // Afternoon — demonstrates partial-week schedule
  {
    id: 'h_move', title: 'Move', timeBlock: 'afternoon', color: '#10B981', icon: 'activity',
    history: [], restDays: [], skippedDays: [], createdAt: NOW, targetCount: 1, unit: 'session',
    scheduleType: 'days', frequency: ['Mon', 'Wed', 'Fri', 'Sat'], status: 'active'
  },
  // Evening — daily, closes the day
  {
    id: 'h_read', title: 'Read', timeBlock: 'evening', color: '#8B5CF6', icon: 'book-open',
    history: [], restDays: [], skippedDays: [], createdAt: NOW, targetCount: 1, unit: 'block',
    scheduleType: 'days', frequency: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], status: 'active'
  },
];

const DEFAULT_PROJECTS: Project[] = [
  { id: 'p_core', name: 'Core Operations', color: '#64748B', createdAt: NOW },
  { id: 'p_beta', name: 'Beta Launch', color: '#F59E0B', createdAt: NOW }
];

const DEFAULT_TASKS: Task[] = [
  { 
    id: 't_guide', 
    text: 'Calibrate your system.', 
    notes: 'Welcome to your Command Center.\n\n- Tap a card to edit it.\n- Swipe left to archive.\n- The Pulse tab tracks your relentless execution.', 
    completed: false, createdAt: NOW, deadlineDate: '', deadlineTime: '', hasReminder: false, 
    priority: 'High', color: '#F59E0B', subTasks: [], hasProgress: false, progress: 0, 
    recurType: 'none', lastTouchedAt: NOW 
  },
  { 
    id: 't_beta', 
    text: 'Finalize beta tester invites.', 
    notes: 'Draft the email and send out the TestFlight/APK links to the core group.', 
    completed: false, createdAt: NOW, deadlineDate: '', deadlineTime: '', hasReminder: false, 
    priority: 'High', color: '#8B5CF6', subTasks: [], hasProgress: false, progress: 0, 
    projectId: 'p_beta', recurType: 'none', lastTouchedAt: NOW 
  },
  { 
    id: 't_review', 
    text: 'Weekly System Review', 
    notes: 'Clear the mental cache before Monday.', 
    completed: false, createdAt: NOW, deadlineDate: '', deadlineTime: '', hasReminder: false, 
    priority: 'Medium', color: '#3B82F6', 
    subTasks: [
      { id: 's1', text: 'Inbox to zero', completed: false },
      { id: 's2', text: 'Review calendar for next week', completed: false },
      { id: 's3', text: 'Update metrics', completed: false }
    ], 
    hasProgress: true, progress: 0, projectId: 'p_core', recurType: 'weekly', recurDays: ['Sun'], 
    lastTouchedAt: NOW 
  },
];


const ALL_WEEK_DAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Mirrors the previous AsyncStorage seed from index.tsx exactly.
// New installs get this. Existing installs that had AsyncStorage data
// should run a one-time migration on first open (see timeline.tsx).
export const DEFAULT_ACTIVITIES: Activity[] = ALL_WEEK_DAYS.flatMap((day, i) => [
  { id: `def-1-${i}`, groupId: 'g-1', day, startHour: 9,    endHour: 11,   color: '#8B5CF6', label: 'Deep Focus Block',        isHype: true, hasReminder: true },
  { id: `def-2-${i}`, groupId: 'g-2', day, startHour: 11.5, endHour: 12.5, color: '#F59E0B', label: 'Communications & Sync' },
  { id: `def-3-${i}`, groupId: 'g-3', day, startHour: 14,   endHour: 17,   color: '#3B82F6', label: 'Project Execution' },
  { id: `def-4-${i}`, groupId: 'g-4', day, startHour: 18,   endHour: 19,   color: '#10B981', label: 'Movement / Disconnect' },
  { id: `def-5-${i}`, groupId: 'g-5', day, startHour: 21,   endHour: 22,   color: '#64748B', label: 'Reading & Reflection' },
]);

export const DEFAULT_NOTES: Note[] = [
  {
    id: "guide_welcome", title: "Start here.", group: undefined,
    isPinned: true, isLocked: false, color: "#8B5CF6",
    order: 0, status: "active", createdAt: NOW,
    content: `Your workspace. No cloud. No account. Everything stays on this device.

# Gestures
- Tap to expand. Tap again to collapse.
- Swipe left → archive
- Swipe right → trash
- Long-press a group chip → rename or remove it

# Writing tools
[ ] Checkboxes toggle on tap
[x] Like this
- Bullets format automatically
# Headings structure long notes

The toolbar gives you images, voice memos, and markdown shortcuts. Templates appear when you start a blank note.`,
  },
  {
    id: "guide_log", title: "Daily Log — Example", group: "work",
    isPinned: false, isLocked: false, color: "#10B981",
    order: 1, status: "active", createdAt: NOW - DAY_MS,
    content: `# Morning
- Cleared inbox, 3 urgent threads
- Backend blocked on auth — escalated
[ ] Follow up on API keys
[ ] Review PR before EOD

# Afternoon
[x] Shipped the onboarding redesign
[x] Roadmap shift: performance before features

# Evening
[ ] Write meeting notes
[ ] Update project board`,
  },
  {
    id: "guide_locked", title: "This is private.", group: undefined,
    isPinned: false, isLocked: true, color: "#F43F5E",
    order: 2, status: "active", createdAt: NOW - 3 * DAY_MS,
    content: `Locked with biometrics. Nobody reads this but you.

Tap the lock icon in the card footer to lock or unlock any note. Locked notes live behind the Locked filter — separated from everything else.

Journals. Passwords. Unsent messages. Whatever you need hidden.`,
  },
  {
    id: "guide_capsule", title: "A note to my future self", group: "capsules",
    isPinned: false, isLocked: false, isSealed: true,
    unlockDate: NOW + DAY_MS * 180, color: "#8B5CF6",
    order: 3, status: "active", createdAt: NOW,
    content: `Six months from now you'll read this.

What did you build? Did the thing you were anxious about even matter? Are you still showing up?

I sealed this because I wanted proof that time passes and things change. Even when it doesn't feel like it.`,
  },
  {
    id: "guide_ideas", title: "Ideas dump", group: "ideas",
    isPinned: false, isLocked: false, color: "#2DD4BF",
    order: 4, status: "active", createdAt: NOW - 2 * DAY_MS,
    content: `# Capture everything. Filter later.

- Offline-first sync engine using CRDTs
- Widget showing today's habit streak
- App that tracks what you lend to people
- Receipt scanner with auto-categorization

[ ] Sketch the best idea this weekend
[ ] Kill the rest or commit`,
  },
];

// ─── APP STATE INTERFACE ───

interface AppState {
  // ── Settings ──
  isDarkMode: boolean;
  calendarType: CalendarSystem;
  toggleTheme: () => void;
  toggleCalendar: () => void;

  // ── Habits ──
  habits: Habit[];
  addOrUpdateHabit: (habit: Habit) => void;
  deleteHabit: (id: string) => void;
  updateHabitStatus: (id: string, status: HabitStatus) => void;
  toggleHabitAction: (
    id: string,
    action: 'done' | 'pending' | 'rest' | 'skipped',
    dateStr: string,
  ) => void;

  // ── Tasks & Projects ──
  tasks: Task[];
  projects: Project[];
  setTasks: (tasks: Task[]) => void;
  setProjects: (projects: Project[]) => void;
  addOrUpdateProject: (project: Project) => void;
  deleteProject: (id: string) => void;

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

  // ── Timeline ──
  activities: Activity[];
  setActivities: (activities: Activity[]) => void;
  addOrUpdateActivity: (activity: Activity) => void;
  deleteActivity: (id: string) => void;
  deleteActivityGroup: (groupId: string) => void;

  dayLog: DayLog;
  setDayLog: (log: DayLog) => void;
  logDayRating: (dateStr: string, rating: DayRating) => void;

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

  // ── Habits extras ──
  lastWeeklyReviewDismissed?: string;
  setLastWeeklyReviewDismissed: (dateStr: string) => void;
  setHabitCompletionNote: (habitId: string, dateStr: string, note: string) => void;

  // ── Whispers — each key fires exactly once, ever ──
  whispersSeen?: string[];
  markWhisperSeen: (key: string) => void;

  // ── Day Conquered (eclipse overlay) — track last variation to avoid repeats ──
  lastEclipseVariation?: string;
  setLastEclipseVariation: (key: string) => void;

  // ── Pact preferences ──
  pactAutoNote?: boolean; // default true — auto-create a failure note in Notes
  setPactAutoNote: (v: boolean) => void;

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
  // The Challenges tab is gated behind a multi-criteria unlock — see
  // LockScreen in challenges.tsx. Once flipped true, it stays true (no
  // automatic re-locking on metric drop). Persisting via the main store
  // means the unlock survives app restarts; the previous in-component
  // useState made the flag effectively meaningless.
  challengesUnlocked: boolean;
  setChallengesUnlocked: (v: boolean) => void;
  // True once the default seed challenges have been inserted (or skipped
  // because the user already had data). Without this, the seed effect
  // re-runs on every "challenges array empty" — meaning a user who
  // deletes all their challenges gets the demo trio respawned forever.
  // Set once, never cleared.
  challengesSeeded: boolean;
  setChallengesSeeded: (v: boolean) => void;

  // ── Deep Work ──
  deepWorkSessions: DeepWorkSession[];
  addDeepWorkSession: (session: DeepWorkSession) => void;
  deleteDeepWorkSession: (id: string) => void;

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

  // ── Quick reminders ──
  // Lightweight one-shot reminders. The notification *is* the reminder — no
  // task/intent/activity record. Once `fireAt` passes, the entry is auto-swept
  // by Timeline's focus pass (see lib/reminderNotifications.ts), so the list
  // stays self-pruning and users don't accumulate dead reminders.
  reminders: Reminder[];
  addReminder: (r: Reminder) => void;
  removeReminder: (id: string) => void;
  pruneFiredReminders: () => void;

  // ── Day notes ── date-bound reference text (e.g. "John's birthday")
  dayNotes: DayNote[];
  addDayNote: (note: DayNote) => void;
  updateDayNote: (id: string, text: string) => void;
  deleteDayNote: (id: string) => void;

  // ── Reflection acknowledgement ──
  // Set of `${YYYY-MM-DD}_${activityId}` keys for committed blocks the user
  // has either reflected on or dismissed. Used purely for bookkeeping — the
  // actual reflection content is NOT persisted (the post-block prompt is
  // advisory and ephemeral). Capped at 100 most-recent entries to avoid
  // unbounded growth across years of use.
  reflectedKeys: string[];
  markReflected: (key: string) => void;
}

// ─── CREATE STORE ───

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // ── Settings ──
      isDarkMode: false,
      calendarType: 'shamsi',
      toggleTheme: () => set((s) => ({ isDarkMode: !s.isDarkMode })),
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
      updateHabitStatus: (id, status) => set((s) => ({
        habits: s.habits.map(h => h.id === id ? { ...h, status } : h),
      })),
      toggleHabitAction: (id, action, dateStr) => set((s) => ({
        habits: s.habits.map(h => {
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
        }),
      })),

      // ── Tasks & Projects ──
      tasks: DEFAULT_TASKS,
      projects: DEFAULT_PROJECTS,
      setTasks: (tasks) => set({ tasks }),
      setProjects: (projects) => set({ projects }),
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

      // ── Timeline ──
      activities: DEFAULT_ACTIVITIES,
      setActivities: (activities) => set({ activities }),
      addOrUpdateActivity: (activity) => set((s) => {
        const exists = s.activities.find(a => a.id === activity.id);
        return {
          activities: exists
            ? s.activities.map(a => a.id === activity.id ? activity : a)
            : [...s.activities, activity],
        };
      }),
      deleteActivity: (id) => set((s) => ({
        activities: s.activities.filter(a => a.id !== id),
      })),
      deleteActivityGroup: (groupId) => set((s) => ({
        activities: s.activities.filter(a => a.groupId !== groupId),
      })),

      dayLog: {},
      setDayLog: (log) => set({ dayLog: log }),
      logDayRating: (dateStr, rating) => set((s) => ({
        dayLog: { ...s.dayLog, [dateStr]: rating },
      })),

      globalNotifsEnabled: true,
      preNotifOffset: 5,
      ongoingBlockEnabled: true,
      navRevealCount: 0,
      setGlobalNotifsEnabled: (v) => set({ globalNotifsEnabled: v }),
      setPreNotifOffset: (v) => set({ preNotifOffset: v }),
      setOngoingBlockEnabled: (v) => set({ ongoingBlockEnabled: v }),
      incrementNavRevealCount: () => set((s) => ({ navRevealCount: (s.navRevealCount ?? 0) + 1 })),

      // ── Habits extras ──
      setLastWeeklyReviewDismissed: (dateStr) => set({ lastWeeklyReviewDismissed: dateStr }),
      markWhisperSeen: (key) => set((s) => {
        const seen = s.whispersSeen || [];
        if (seen.includes(key)) return {};
        return { whispersSeen: [...seen, key] };
      }),
      setLastEclipseVariation: (key) => set({ lastEclipseVariation: key }),
      pactAutoNote: true,
      setPactAutoNote: (v) => set({ pactAutoNote: v }),
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
      challengesSeeded: false,
      setChallengesSeeded: (v) => set({ challengesSeeded: v }),

      // ── Deep Work ──
      deepWorkSessions: [],
      addDeepWorkSession: (session) => set((s) => ({ deepWorkSessions: [...s.deepWorkSessions, session] })),
      deleteDeepWorkSession: (id) => set((s) => ({ deepWorkSessions: s.deepWorkSessions.filter(x => x.id !== id) })),

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
      toggleIntent: (id) => set((s) => ({
        // Pure toggle — pushCount is preserved across check/uncheck. Earlier we
        // reset the counter when an item came back to incomplete, theory being
        // "re-opening = fresh chain." But the user pointed out that an accidental
        // tap shouldn't wipe real chronic-deferral signal. Counter now only
        // resets when explicitly acknowledged via the rethink prompt's Keep
        // action (so the prompt has a clean slate post-acknowledgement).
        intents: s.intents.map(i => i.id === id ? { ...i, completed: !i.completed } : i),
      })),
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
          if (!c.linkedHabitIds?.includes(habitId)) return c;
          if (c.deadState !== 'active' && c.deadState !== 'resurrected') return c;
          if (c.current >= c.target) return c;
          const existingLogs = c.logDates || [];
          if (existingLogs.includes(dateStr)) return c;

          touched = true;
          const newCurrent = Math.min(c.target, c.current + 1);
          const isAchieved = newCurrent >= c.target && c.deadState === 'active';
          return {
            ...c,
            current: newCurrent,
            lastLoggedAt: Date.now(),
            logDates: [...existingLogs, dateStr],
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
      // Default end-of-week is Saturday — covers most Western users; Friday users
      // can flip it from Settings. We deliberately don't auto-detect from locale
      // because the user's preference here is more about ritual than calendar.
      endOfWeekDay: 'saturday',
      setEndOfWeekDay: (d) => set({ endOfWeekDay: d }),

      diaryLocked: false,
      setDiaryLocked: (v) => set({ diaryLocked: v }),

      // ── Quick reminders ──
      reminders: [],
      addReminder: (r) => set((s) => ({ reminders: [...s.reminders, r] })),
      removeReminder: (id) => set((s) => ({ reminders: s.reminders.filter(r => r.id !== id) })),
      // Sweep entries whose fire moment passed >2 minutes ago. The 2-min grace
      // covers clock skew and keeps a just-fired reminder visible briefly so
      // the user can see "yes, that one fired" if they happened to be in-app.
      pruneFiredReminders: () => set((s) => ({
        reminders: s.reminders.filter(r => r.fireAt > Date.now() - 2 * 60_000),
      })),

      // ── Day notes ──
      dayNotes: [],
      addDayNote: (note) => set((s) => ({ dayNotes: [...s.dayNotes, note] })),
      updateDayNote: (id, text) => set((s) => ({
        dayNotes: s.dayNotes.map(n => n.id === id ? { ...n, text } : n),
      })),
      deleteDayNote: (id) => set((s) => ({ dayNotes: s.dayNotes.filter(n => n.id !== id) })),

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
    }),
    {
      // Bumped to v21 — Activities and Timeline prefs now live here instead of AsyncStorage.
      // On first launch after update, the old AsyncStorage keys are dead.
      // timeline.tsx runs a one-time migration that reads the old keys and writes into the store.
      name: 'titan-app-storage-v23',
      storage: createJSONStorage(() => zustandStorage),
    }
  )
);