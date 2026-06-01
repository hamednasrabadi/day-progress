/**
 * Challenge chain logic.
 *
 * A daily-cadence challenge ("meditate 30 days") lives or dies on its chain —
 * the run of consecutive days it was logged. Cumulative ("read 12 books") and
 * one-shot ("ship one thing") challenges have no daily chain; for them this
 * returns `applicable: false`.
 *
 * This is the challenge analogue of the Habits streak in lib/habitScore.ts.
 * Difference: a challenge has no per-day "scheduled" concept — every calendar
 * day counts — so the rule is simpler than the habit one. All day math is done
 * on UTC day-numbers so it can't drift across DST (23h / 25h days).
 *
 * Pure functions only — no theme, no store, no React. The card / detail view
 * decide how to render what these return.
 */

import type { Challenge } from '../store/useAppStore';

const DAY_MS = 86_400_000;

const keyOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Absolute day index for a YYYY-MM-DD key — DST-immune, so "are these two days
// adjacent?" is just a difference of 1.
const dayNumber = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y || 1970, (m || 1) - 1, d || 1) / DAY_MS);
};

/**
 * Consecutive logged days ending exactly TODAY (0 if today isn't logged).
 * Cadence-agnostic — used for the "obsessive" achievement, which fires the
 * moment a 7th straight day is logged regardless of challenge type. This is the
 * exact behavior of the old inline `countConsecutiveLogDays`.
 */
export function consecutiveDaysEndingToday(logDates: string[]): number {
  if (!logDates || logDates.length === 0) return 0;
  const set = new Set(logDates);
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let streak = 0;
  while (set.has(keyOf(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export type ChallengeChain = {
  applicable: boolean;   // only daily-cadence challenges have a chain
  current: number;       // consecutive days up to today (or yesterday if today's still open)
  longest: number;       // best run the challenge has ever held
  loggedToday: boolean;
  atRiskToday: boolean;  // chain is alive via yesterday but today isn't logged yet
};

const EMPTY_CHAIN: ChallengeChain = { applicable: false, current: 0, longest: 0, loggedToday: false, atRiskToday: false };

/**
 * The chain state for a challenge. For daily cadence: the current run counts
 * back from today, with a one-day grace — if you logged yesterday but not yet
 * today, the chain is still "alive" (today is the day to keep it). The chain
 * only reads as broken (current 0) once a full day passed unlogged.
 */
export function computeChain(c: Challenge): ChallengeChain {
  const applicable = (c.cadence ?? 'cumulative') === 'daily';
  const logs = c.logDates || [];
  if (!applicable || logs.length === 0) return { ...EMPTY_CHAIN, applicable };

  const set = new Set(logs);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const loggedToday = set.has(keyOf(today));

  // Longest run ever — scan all logged days in chronological order.
  const sorted = Array.from(set).sort(); // YYYY-MM-DD sorts chronologically
  let longest = 0, run = 0, prev: number | null = null;
  for (const k of sorted) {
    const n = dayNumber(k);
    run = prev !== null && n - prev === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = n;
  }

  // Current run — start at today if logged, else yesterday (the grace day).
  // If neither is logged the chain is broken and current stays 0.
  const start = new Date(today);
  if (!loggedToday) start.setDate(start.getDate() - 1);
  let current = 0;
  if (set.has(keyOf(start))) {
    const cursor = new Date(start);
    while (set.has(keyOf(cursor))) {
      current += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  return { applicable, current, longest, loggedToday, atRiskToday: !loggedToday && current > 0 };
}
