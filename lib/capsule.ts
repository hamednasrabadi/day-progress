/**
 * Capsule (sealed-note) unlock math — single source of truth.
 *
 * `getUnlockMoment` lived as a module-local in app/(tabs)/notes.tsx until the
 * export path (lib/notesExport.ts) needed the same "is this capsule still
 * sealed?" answer. A drifting twin predicate is exactly how a capsule could
 * leak into an export before its date, so both surfaces now read this file.
 *
 * Pure functions only — no store, no React.
 */

import type { Note } from '../store/useAppStore';

// Resolve a sealed note's unlock moment as a timestamp. Prefers unlockDateStr
// (calendar-date, re-anchored to local midnight in the CURRENT timezone) over
// the legacy unlockDate timestamp — that way capsules sealed in one timezone
// still unlock at midnight wall-clock time after the user travels.
export const getUnlockMoment = (note: { unlockDateStr?: string; unlockDate?: number }): number => {
  if (note.unlockDateStr) {
    const [y, m, d] = note.unlockDateStr.split('-').map(Number);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) return new Date(y, m - 1, d).getTime();
  }
  return note.unlockDate || 0;
};

// True while a sealed note must stay closed. Mirrors the CapsuleCard lock
// logic in notes.tsx: event-locked capsules wait for their challenge (the
// Challenges tab flips isSealed=false + stamps unlockDate on completion),
// date-locked ones wait for the clock. Once opened, isSealed is false and
// this is a cheap early return.
export const isStillSealed = (n: Note, now: number = Date.now()): boolean => {
  if (!n.isSealed) return false;
  const eventLocked = !!n.unlockOnChallengeId && !n.unlockDate && !n.unlockDateStr;
  if (eventLocked) return true;
  return now < getUnlockMoment(n);
};
