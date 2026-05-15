/**
 * Strength Score — single source of truth for the per-habit 0-100 score
 * shown on cards and rolled up into the global average.
 *
 * Originally lived in `app/(tabs)/habits.tsx`. Pulled out here so the
 * Challenges-tab unlock gate can reference it without dragging the
 * habits-tab file (with its imports of every UI lib) into another tab.
 *
 * Rules per scheduled day:
 *   completion: +5 (or +7.5 if score < 50, hidden comeback bonus)
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
const REST_PENALTY_BY_STREAK = [0, 0, -2, -4, -6, -8]; // index = streak length
const JS_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const diffInDays = (startStr: string, endStr: string) => {
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  const d1 = Date.UTC(sy, sm - 1, sd);
  const d2 = Date.UTC(ey, em - 1, ed);
  return Math.floor((d2 - d1) / 86400000);
};

export function calculateStrengthScore(habit: Habit, referenceDate: string): number {
  const [ry, rm, rd] = referenceDate.split('-').map(Number);
  const refUTC = Date.UTC(ry, rm - 1, rd);
  const createdDate = new Date(habit.createdAt);
  const createdUTC = Date.UTC(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate());

  if (refUTC < createdUTC) return 0;

  // Build a count map for O(1) lookups
  const dateCounts: Record<string, number> = {};
  habit.history.forEach(d => { dateCounts[d] = (dateCounts[d] || 0) + 1; });

  let score = 0;
  let restStreak = 0;

  for (let t = createdUTC; t <= refUTC; t += 86400000) {
    const d = new Date(t);
    const dStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

    if (habit.restDays?.includes(dStr)) {
      restStreak += 1;
      const idx = Math.min(restStreak, REST_PENALTY_BY_STREAK.length - 1);
      score += REST_PENALTY_BY_STREAK[idx];
      if (score < 0) score = 0;
      if (score > 100) score = 100;
      continue;
    }
    restStreak = 0;

    let isScheduled = false;
    if (habit.scheduleType === 'interval') {
      if (habit.startDate) {
        const diff = diffInDays(habit.startDate, dStr);
        isScheduled = diff >= 0 && diff % (habit.intervalDays || 1) === 0;
      }
    } else {
      const dayName = JS_DAYS[d.getUTCDay()];
      isScheduled = habit.frequency.length === 0 || habit.frequency.includes(dayName);
    }
    if (!isScheduled) continue;

    if (habit.skippedDays?.includes(dStr)) {
      score -= STRENGTH_LOSS;
    } else if ((dateCounts[dStr] || 0) >= habit.targetCount) {
      const gain = score < COMEBACK_THRESHOLD ? STRENGTH_GAIN * COMEBACK_MULTIPLIER : STRENGTH_GAIN;
      score += gain;
    } else {
      if (dStr === referenceDate) continue;
      score -= STRENGTH_LOSS;
    }

    if (score < 0) score = 0;
    if (score > 100) score = 100;
  }

  return Math.round(score);
}

/**
 * Global strength — average of `calculateStrengthScore` across all active
 * habits as of `referenceDate`. 0 when no active habits exist.
 */
export function calculateGlobalStrength(habits: Habit[], referenceDate: string): number {
  const active = habits.filter(h => h.status === 'active');
  if (active.length === 0) return 0;
  const scores = active.map(h => calculateStrengthScore(h, referenceDate));
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
