/**
 * Task recurrence — the next-occurrence engine.
 *
 * Originally lived in `app/(tabs)/todo.tsx`. Pulled out (the same move as
 * lib/habitScore.ts) so the date math is exercisable from plain Node —
 * scripts/verify-recurrence.mjs runs it against fixed dates — without
 * dragging the Tasks tab's UI imports along.
 *
 * Pure functions only — no store, no React. All math runs on the device's
 * local calendar: a "day" here means the user's wall-clock day.
 */

import type { Task } from '../store/useAppStore';

// Weekday names exactly as JS Date#getDay() indexes them (0 = Sunday). The
// editor's day picker stores these strings, so picker and engine always agree.
export const JS_DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The date (YYYY-MM-DD) a recurring task wakes after being completed today.
// Strictly in the future — completing an "every Wed" task on a Wednesday
// schedules NEXT Wednesday. `now` is injectable so tests can pin the clock.
export function calculateNextOccurrence(task: Task, now: Date = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (task.recurType === 'daily') { date.setDate(date.getDate() + 1); }
  else if ((task.recurType === 'weekly' || task.recurType === 'custom') && task.recurDays && task.recurDays.length > 0) {
    // One forward scan serves both types: walk day by day until a selected
    // weekday hits. Weekly can't just read recurDays[0] — a multi-day pick
    // made under `custom` survives switching the type back to `weekly` (the
    // editor keeps the selection), and honoring only the first entry silently
    // dropped the rest. Corrupt recurDays (no recognizable day) falls out of
    // the loop at today + 7, the same fallback the typeless branch uses.
    for (let i = 1; i <= 7; i++) {
      date.setDate(date.getDate() + 1);
      if (task.recurDays.includes(JS_DAY_SHORT[date.getDay()])) break;
    }
  } else if (task.recurType === 'monthly' && task.recurDayOfMonth) {
    let nextMonth = date.getMonth() + 1; let year = date.getFullYear();
    if (nextMonth > 11) { nextMonth = 0; year += 1; }
    // Clamp to actual days-in-month — without this, "31st of every month" on
    // a Feb/Apr/Jun/Sep/Nov rollover causes setFullYear to spill into the
    // following month (Feb 31 → Mar 3), and subsequent recurrences then
    // anchor off the rolled date and drift permanently. With the clamp,
    // months without 31 land on their last day instead.
    const daysInTarget = new Date(year, nextMonth + 1, 0).getDate();
    const day = Math.min(task.recurDayOfMonth, daysInTarget);
    date.setFullYear(year, nextMonth, day);
  } else { date.setDate(date.getDate() + 7); }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
