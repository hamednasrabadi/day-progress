/**
 * Pure-function check for lib/recurrence.ts — the next-occurrence engine
 * behind recurring tasks (and the editor's next-instance preview).
 *
 * Why this exists: the weekly branch shipped a silent data-degradation bug —
 * it read recurDays[0] only, so a multi-day pick (made under `custom`, kept
 * when the user switched the type back to `weekly`) collapsed to its first
 * day with no warning. The engine was pulled out of todo.tsx into
 * lib/recurrence.ts specifically so this script can pin the clock and walk
 * the calendar edges (month rollover, day-31 clamp, year wrap) from plain
 * Node. The module's only store import is `import type` (erased by Node's
 * type stripping), so it loads with zero React Native machinery.
 *
 * Run: node scripts/verify-recurrence.mjs   (Node 23.6+ — native TS imports)
 * Exits 0 on PASS, 1 on FAIL.
 */

const { calculateNextOccurrence } = await import(new URL('../lib/recurrence.ts', import.meta.url));

const failures = [];
const note = (ok, label, detail) => {
  if (ok) { console.log(`  ✓ ${label}`); }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failures.push(label); }
};

// expected is YYYY-MM-DD; now is [y, m(1-12), d] for readability.
const check = (label, task, now, expected) => {
  const got = calculateNextOccurrence(task, new Date(now[0], now[1] - 1, now[2]));
  note(got === expected, label, got !== expected ? `expected ${expected}, got ${got}` : undefined);
};

// Anchor date used below: 2026-06-10 is a WEDNESDAY.
const WED = [2026, 6, 10];

console.log('daily:');
check('daily → tomorrow', { recurType: 'daily' }, WED, '2026-06-11');
check('daily wraps the year', { recurType: 'daily' }, [2026, 12, 31], '2027-01-01');

console.log('weekly:');
check('single day, later this week', { recurType: 'weekly', recurDays: ['Mon'] }, WED, '2026-06-15');
check('single day, earlier in the week', { recurType: 'weekly', recurDays: ['Sun'] }, WED, '2026-06-14');
check('same weekday → strictly next week', { recurType: 'weekly', recurDays: ['Wed'] }, WED, '2026-06-17');
// THE regression: multi-day weekly must honor the NEAREST selected day, not
// recurDays[0]. From Wed, ['Mon','Fri'] means Fri the 12th — not Mon the 15th.
check('multi-day picks the nearest (the recurDays[0] bug)', { recurType: 'weekly', recurDays: ['Mon', 'Fri'] }, WED, '2026-06-12');
check('empty recurDays falls back to +7', { recurType: 'weekly', recurDays: [] }, WED, '2026-06-17');

console.log('custom:');
check('multi-day nearest', { recurType: 'custom', recurDays: ['Mon', 'Fri'] }, WED, '2026-06-12');
check('same weekday → strictly next week', { recurType: 'custom', recurDays: ['Wed'] }, WED, '2026-06-17');
check('scan crosses a month boundary', { recurType: 'custom', recurDays: ['Wed'] }, [2026, 6, 27], '2026-07-01');
check('corrupt day names fall out at +7', { recurType: 'custom', recurDays: ['Xyz'] }, WED, '2026-06-17');

console.log('monthly:');
check('plain next month', { recurType: 'monthly', recurDayOfMonth: 5 }, WED, '2026-07-05');
check('day 31 in a 31-day month', { recurType: 'monthly', recurDayOfMonth: 31 }, WED, '2026-07-31');
check('day 31 clamps to Feb 28 (no spill into March)', { recurType: 'monthly', recurDayOfMonth: 31 }, [2026, 1, 15], '2026-02-28');
check('December wraps to January', { recurType: 'monthly', recurDayOfMonth: 10 }, [2026, 12, 15], '2027-01-10');

if (failures.length) {
  console.log(`\nFAIL — ${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nPASS — recurrence engine holds on all calendar edges.');
