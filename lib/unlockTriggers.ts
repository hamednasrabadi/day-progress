/**
 * Progressive unlock trigger engine — runs every state-change tick to decide
 * which features should be revealed to the user based on their actual usage.
 *
 * Called once from the root layout with an AppStateForUnlocks snapshot
 * assembled from every tab's store. The hook iterates the trigger table on
 * each change, skips any feature already unlocked, and dispatches:
 *   1. unlock(featureId)        — flips the persistent flag
 *   2. enqueueWhisper(...)      — surfaces the announcement bar (single)
 *
 * Whisper de-duplication: enqueueWhisper checks whispersSeen and skips IDs
 * the user has already been notified about, so the trigger table can be
 * naïve — it just describes WHAT should unlock at WHAT threshold without
 * needing per-call gating logic.
 *
 * Per-tab triggers are added in subsequent prompts. The scaffold lives here
 * with an empty triggers array so the call site in app/_layout.tsx is wired
 * from day one — when the trigger conditions arrive, they slot in without
 * touching the root layout.
 */

import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { AppStateForUnlocks, FEATURE_IDS } from './unlocks';

// ── Trigger definitions ───────────────────────────────────────────────────
// Each entry: a feature ID (or array of IDs that unlock together), the
// human-readable whisper, and a predicate that decides whether the snapshot
// satisfies the unlock condition. The engine skips entries whose featureIds
// are all already unlocked.

type UnlockTrigger = {
  // Features that flip on when this trigger fires. Multiple IDs in one
  // trigger means "unlock these together with one announcement" — used
  // when a single user behaviour earns several related capabilities.
  featureIds: string[];
  // Single message shown in the whisper bar. Keep it short, declarative,
  // and matched in tone to the existing copy in seeded notes / habit
  // whispers (direct, second-person, no exclamation marks). Optional:
  // omit for unlocks whose announcement is purely visual (e.g. PROJECTS
  // gets a dot on the editor section, no whisper).
  whisper?: string;
  // Predicate. Returns true when the user has crossed the threshold.
  // Reads only from the immutable AppStateForUnlocks snapshot to keep
  // each predicate referentially transparent.
  when: (s: AppStateForUnlocks) => boolean;
};

// Per-tab triggers. Each block groups by tab so adding the next batch
// (Notes, Habits, Challenges, Timeline) is a contiguous insert.
const TRIGGERS: UnlockTrigger[] = [
  // ── Tasks ────────────────────────────────────────────────────────────
  // Sub-tasks: enough activity to want to break things down.
  {
    featureIds: [FEATURE_IDS.SUBTASKS],
    whisper: 'Break things down — sub-tasks are now available.',
    when: (s) => s.totalTasksCreated >= 3,
  },
  // Promise + Deep Work — both gate at "you have a real workload now."
  // Single combined whisper; the underlying engine still flips both
  // featureIds.
  {
    featureIds: [FEATURE_IDS.PROMISE, FEATURE_IDS.DEEP_WORK],
    whisper: 'Two new tools — make commitments, track the work.',
    when: (s) => s.activeTaskCount >= 4,
  },
  // Recurring: by 5 tasks, patterns start to repeat.
  {
    featureIds: [FEATURE_IDS.RECURRING],
    whisper: 'Some things keep coming back. You can automate them.',
    when: (s) => s.totalTasksCreated >= 5,
  },
  // Projects: organisational pressure. Deliberately no whisper —
  // discovery is the dot on the editor's Projects section header.
  {
    featureIds: [FEATURE_IDS.PROJECTS],
    when: (s) => s.totalTasksCreated >= 8,
  },
  // ADHD Mode: list overflow → offer the one-at-a-time relief view.
  {
    featureIds: [FEATURE_IDS.ADHD_MODE],
    whisper: "Your list is full. There's another way to see this.",
    when: (s) => s.activeTaskCount >= 10,
  },

  // ── Timeline ─────────────────────────────────────────────────────────
  // Smart Suggestions + Focus Block Runner unlock together once the day has
  // structure. The whisper speaks to the suggestion strip (the visible part);
  // FOCUS_BLOCK_RUNNER flips on in the same beat so it's ready when its UI
  // lands. (Runner UI is not built yet — the flag just pre-authorises it.)
  {
    featureIds: [FEATURE_IDS.SMART_SUGGESTIONS, FEATURE_IDS.FOCUS_BLOCK_RUNNER],
    whisper: 'Your day has shape — gaps can be filled smarter.',
    when: (s) => s.totalBlocksCreated >= 3,
  },
  // Now Playing: once the schedule has been live across several days, turn on
  // the pinned ongoing notification. No visible in-app change — behaviour only.
  {
    featureIds: [FEATURE_IDS.NOW_PLAYING],
    whisper: 'Your schedule runs in the background now.',
    when: (s) => s.activeDaysWithBlock >= 5,
  },

  // DAILY_REVIEW (dayRatingsCount >= 3) is intentionally NOT wired yet: its
  // whisper promises "go deeper" but the structured end-of-day form doesn't
  // exist. Firing it would advertise a missing feature. The counter is
  // already tracked (dayRatingsCount), so the trigger drops in cleanly once
  // the form is built. See testing_backlog / the Daily Review design note.

  // ── Notes ──────────────────────────────────────────────────────────────
  // Diary + expanded highlight colors unlock together once the user is
  // actually writing. One whisper covers both.
  {
    featureIds: [FEATURE_IDS.DIARY, FEATURE_IDS.HIGHLIGHT_COLORS],
    whisper: "You've been writing. There's more here now.",
    when: (s) => s.totalNotesCreated >= 3,
  },
  // Mood tagging: appears the moment the user writes their first diary entry.
  // No whisper — the mood field simply shows up inside the diary entry sheet.
  {
    featureIds: [FEATURE_IDS.MOOD_TAGGING],
    when: (s) => s.diaryEntriesCreated >= 1,
  },
  // Sealing: a time-based reveal at 10 days. Whisper carries NO feature name
  // by design — "Something that was locked is now available." The discovery
  // is the point. Once SEALING is unlocked, the root snapshot derives
  // sealingUnlocked=true, which lets the Challenges CAPSULE_LOCK trigger fire.
  {
    featureIds: [FEATURE_IDS.SEALING],
    whisper: 'Something that was locked is now available.',
    when: (s) => s.daysSinceInstall >= 10,
  },

  // ── Challenges ───────────────────────────────────────────────────────────
  // The tab itself reveals on day 3. Whisper carries no feature name — the
  // dot on the new tab icon is the discovery. (unlockAll bypasses all of this
  // and just shows the tab silently.)
  {
    featureIds: [FEATURE_IDS.CHALLENGES_TAB],
    whisper: 'A new tab is available.',
    when: (s) => s.daysSinceInstall >= 3,
  },
  // Milestones: the moment the first challenge exists. No whisper — the
  // section just appears inside that challenge's detail.
  {
    featureIds: [FEATURE_IDS.MILESTONES],
    when: (s) => s.totalChallengesCreated >= 1,
  },
  // Linked habits: once juggling 2+ active challenges. No whisper, dot on the
  // field in the edit sheet.
  {
    featureIds: [FEATURE_IDS.LINKED_HABITS],
    when: (s) => s.activeChallengesCount >= 2,
  },
  // Capsule-locked finish: only for users who discovered Sealing in Notes
  // first (day 10+). No whisper — appears quietly in the edit sheet.
  {
    featureIds: [FEATURE_IDS.CAPSULE_LOCK],
    when: (s) => s.sealingUnlocked === true,
  },

  // ── Habits ───────────────────────────────────────────────────────────────
  // Pact unlocks at 3 habits. (The vault/archive is no longer gated — it ships
  // available from day one — so this trigger announces Pact alone.)
  {
    featureIds: [FEATURE_IDS.PACT],
    whisper: 'You have habits now. You can make them mean something.',
    when: (s) => s.totalHabitsCreated >= 3,
  },
  // Completion notes: once any single habit has been completed 5+ times. No
  // whisper; the note field then appears for ALL habits' completion sheets.
  {
    featureIds: [FEATURE_IDS.COMPLETION_NOTES],
    when: (s) => s.maxSingleHabitCompletions >= 5,
  },
  // Strength Score: the first time a day is "conquered" (3+ habits fully done
  // in one day). Whisper marks the moment.
  {
    featureIds: [FEATURE_IDS.STRENGTH_SCORE],
    whisper: 'You conquered a day. Your strength is being tracked.',
    when: (s) => s.dayConqueredEver === true,
  },
  // Weekly Review: the end-of-week reflection (saved into Notes) unlocks once
  // the user has logged three "how did it go?" day ratings — enough of a
  // reflecting habit to make a weekly pass meaningful. dayRatingsCount counts
  // distinct days rated (monotonic), so this is three separate days.
  {
    featureIds: [FEATURE_IDS.WEEKLY_REVIEW],
    whisper: 'You can close out your weeks now.',
    when: (s) => s.dayRatingsCount >= 3,
  },
];

// ── Hook ──────────────────────────────────────────────────────────────────

export function useUnlockTriggers(snapshot: AppStateForUnlocks): void {
  // Reading via getState() here (not via useAppStore selectors) on purpose:
  // we only need to ACT on changes — the snapshot prop already represents
  // the changed input, so we read the current unlockedFeatures + dispatch
  // without subscribing this hook to store updates (which would re-run on
  // every unrelated tick).
  useEffect(() => {
    const { unlockedFeatures, unlock, enqueueWhisper } = useAppStore.getState();
    for (const t of TRIGGERS) {
      // Skip if every feature in this trigger is already unlocked. We don't
      // re-fire announcements for things the user has already seen.
      const allDone = t.featureIds.every(id => !!unlockedFeatures?.[id]);
      if (allDone) continue;
      if (!t.when(snapshot)) continue;
      for (const id of t.featureIds) unlock(id);
      // Whisper is optional — PROJECTS-style "no announcement, just a dot"
      // unlocks skip the queue entirely. The unlock still fires; only the
      // toast is suppressed.
      if (t.whisper) enqueueWhisper(t.featureIds, t.whisper);
    }
    // The snapshot itself is the dep — re-evaluating triggers only matters
    // when one of the input numbers actually moved.
  }, [snapshot]);
}
