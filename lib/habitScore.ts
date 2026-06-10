/**
 * Strength Score — single source of truth for the per-habit 0-100 score
 * shown on cards and rolled up into the global average.
 *
 * Originally lived in `app/(tabs)/habits.tsx`. Pulled out here so the
 * Challenges-tab unlock gate can reference it without dragging the
 * habits-tab file (with its imports of every UI lib) into another tab.
 *
 * Rules per scheduled day:
 *   completion: +5  (+7.5 "comeback" only once a habit has reached 50 and then
 *               slipped back under it — a first-time climb to 50 gets the normal +5)
 *   miss/skip:  -8
 *   rest day 1 in a row: 0   (rest is free)
 *   rest day 2 in a row: -2
 *   rest day 3 in a row: -4
 *   rest day 4 in a row: -6
 *   rest day 5+ in a row: -8  (rest becomes equivalent to running away)
 *
 * Today's pending state never penalizes — user might still complete it.
 * Score capped at [0, 100]. Walks forward from habit creation to reference date.
 */

import type { Habit } from '../store/useAppStore';

const STRENGTH_GAIN = 5;
const STRENGTH_LOSS = 8;
const COMEBACK_THRESHOLD = 50;
const COMEBACK_MULTIPLIER = 1.5;
// A new habit's pull on the GLOBAL average ramps 0→1 over its first this-many days,
// so adding a habit doesn't tank your overall strength — it blends in as it matures.
const MATURITY_RAMP_DAYS = 14;
const REST_PENALTY_BY_STREAK = [0, 0, -2, -4, -6, -8]; // index = streak length
const JS_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const diffInDays = (startStr: string, endStr: string) => {
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  const d1 = Date.UTC(sy, sm - 1, sd);
  const d2 = Date.UTC(ey, em - 1, ed);
  return Math.floor((d2 - d1) / 86400000);
};

/**
 * Is `dateStr` (YYYY-MM-DD) a day this habit is actually due on? Weekly habits
 * match by weekday (empty frequency = every day); interval habits match every
 * Nth day from startDate. This is the single definition of "scheduled" — the
 * score walk, the conquered-day check, AND the streak counter all use it, so a
 * habit scheduled e.g. Mon/Wed/Fri isn't judged (or streak-broken) on the days
 * it was never supposed to run.
 */
export function isHabitScheduledOn(habit: Habit, dateStr: string): boolean {
  if (habit.scheduleType === 'interval') {
    if (!habit.startDate) return false;
    const diff = diffInDays(habit.startDate, dateStr);
    return diff >= 0 && diff % (habit.intervalDays || 1) === 0;
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const dayName = JS_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return (habit.frequency?.length ?? 0) === 0 || !!habit.frequency?.includes(dayName);
}

export function calculateStrengthScore(habit: Habit, referenceDate: string): number {
  // Retired habits freeze at retirement — no penalties (or anything) accrue
  // after retiredAt, so the trophy keeps the score it earned.
  if (habit.status === 'retired' && habit.retiredAt && habit.retiredAt < referenceDate) {
    referenceDate = habit.retiredAt;
  }
  const [ry, rm, rd] = referenceDate.split('-').map(Number);
  const refUTC = Date.UTC(ry, rm - 1, rd);
  const createdDate = new Date(habit.createdAt);
  const createdUTC = Date.UTC(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate());

  if (refUTC < createdUTC) return 0;

  // Build a count map for O(1) lookups
  const dateCounts: Record<string, number> = {};
  (habit.history ?? []).forEach(d => { dateCounts[d] = (dateCounts[d] || 0) + 1; });

  let score = 0;
  let restStreak = 0;
  // Latches true once the habit first reaches the threshold. Gates the comeback bonus
  // so it only helps an ESTABLISHED habit that slipped back under 50 — never a habit
  // climbing to 50 for the first time.
  let hasReached50 = false;
  const paused = habit.pausedRanges;

  for (let t = createdUTC; t <= refUTC; t += 86400000) {
    const d = new Date(t);
    const dStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

    // Long-pause (archived) windows are skipped entirely — no penalty, no gain.
    // The score freezes across the pause and resumes where it left off.
    if (paused && paused.some(r => dStr >= r.from && (!r.to || dStr < r.to))) {
      restStreak = 0;
      continue;
    }

    if (habit.restDays?.includes(dStr)) {
      restStreak += 1;
      const idx = Math.min(restStreak, REST_PENALTY_BY_STREAK.length - 1);
      score += REST_PENALTY_BY_STREAK[idx];
      if (score < 0) score = 0;
      if (score > 100) score = 100;
      continue;
    }
    restStreak = 0;

    if (!isHabitScheduledOn(habit, dStr)) continue;

    if (habit.skippedDays?.includes(dStr)) {
      score -= STRENGTH_LOSS;
    } else if ((dateCounts[dStr] || 0) >= habit.targetCount) {
      // Bonus only for an established habit clawing back (hasReached50) — a first-time
      // climb to 50 earns the normal gain, no head start.
      const gain = (score < COMEBACK_THRESHOLD && hasReached50) ? STRENGTH_GAIN * COMEBACK_MULTIPLIER : STRENGTH_GAIN;
      score += gain;
    } else {
      if (dStr === referenceDate) continue;
      score -= STRENGTH_LOSS;
    }

    if (score < 0) score = 0;
    if (score > 100) score = 100;
    if (score >= COMEBACK_THRESHOLD) hasReached50 = true;
  }

  return Math.round(score);
}

// A "conquered day" needs at least this many habits scheduled — finishing a
// day that only had one or two habits is too trivial to mean much.
export const MIN_HABITS_FOR_CONQUEST = 3;

/**
 * Was `dateStr` a "conquered day": every active habit scheduled that day is
 * satisfied (completed to target, or skipped/rested), AND at least
 * MIN_HABITS_FOR_CONQUEST habits were scheduled. Mirrors the streak logic in
 * the Habits tab so both agree on what "conquering a day" means. Drives the
 * STRENGTH_SCORE unlock (store toggleHabitAction).
 */
export function isDayConquered(habits: Habit[], dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateUTC = Date.UTC(y, m - 1, d);
  const scheduled = habits.filter(h => {
    if (h.status !== 'active') return false;
    const created = new Date(h.createdAt);
    const createdUTC = Date.UTC(created.getFullYear(), created.getMonth(), created.getDate());
    if (dateUTC < createdUTC) return false; // habit didn't exist yet
    return isHabitScheduledOn(h, dateStr);
  });
  if (scheduled.length < MIN_HABITS_FOR_CONQUEST) return false;
  return scheduled.every(h => {
    if (h.skippedDays?.includes(dateStr) || h.restDays?.includes(dateStr)) return true;
    const c = (h.history ?? []).reduce((n, x) => n + (x === dateStr ? 1 : 0), 0);
    return c >= h.targetCount;
  });
}

/**
 * Maturity weight (0..1) of a habit's pull on the GLOBAL average. Active habits ramp
 * from 0 to full over their first MATURITY_RAMP_DAYS of calendar life, so a freshly
 * created habit barely counts — adding one no longer tanks your strength; it blends in
 * as it matures. Kept retired habits are trophies earned over time, so they count fully.
 */
function habitMaturityWeight(habit: Habit, referenceDate: string): number {
  if (habit.status === 'retired') return 1;
  const created = new Date(habit.createdAt);
  const createdStr = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`;
  const age = diffInDays(createdStr, referenceDate);
  if (age <= 0) return 0;
  return Math.min(1, age / MATURITY_RAMP_DAYS);
}

/**
 * Global strength — maturity-WEIGHTED average of `calculateStrengthScore` across all
 * counted habits as of `referenceDate`. The weighting (above) means a new habit doesn't
 * drag the score down on day one; it joins gradually as it ages. 0 when none counted.
 */
export function calculateGlobalStrength(habits: Habit[], referenceDate: string): number {
  // Active habits (live scores) AND kept retired habits (frozen trophies) count
  // — the grade respects effort that's done, not just effort ongoing. VANISHED
  // retired habits are excluded: vanish is the "delete from the grade" option
  // for a habit you've dropped. Archived (long-paused) habits are excluded too.
  const counted = habits.filter(h => h.status === 'active' || (h.status === 'retired' && !h.vanished));
  if (counted.length === 0) return 0;
  let weightedSum = 0;
  let weightTotal = 0;
  let plainSum = 0;
  for (const h of counted) {
    const score = calculateStrengthScore(h, referenceDate);
    const weight = habitMaturityWeight(h, referenceDate);
    weightedSum += score * weight;
    weightTotal += weight;
    plainSum += score;
  }
  // Everything counted is brand-new (all weight 0) — e.g. a first-day user whose habits
  // were all created today. Fall back to the plain mean so the score still shows.
  if (weightTotal === 0) return Math.round(plainSum / counted.length);
  return Math.round(weightedSum / weightTotal);
}
