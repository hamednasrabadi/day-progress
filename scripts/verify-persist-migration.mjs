/**
 * Pure-function check for the v4 → v5 persist migration (the calm-pivot cut).
 *
 * Why this exists: "data loss = instant death." The v5 migration strips the
 * cut Timeline slices out of a returning user's MMKV blob; if it ever dropped
 * a KEEPER (intents / dayLog / weeklyReflections / endOfWeekDay) instead, a
 * real user would silently lose data on update. There is no RN-capable test
 * runner in this repo (and tooling is deliberately deferred), so rather than
 * import the store (which pulls in react-native-mmkv at module scope) we read
 * the REAL deletion list straight out of store/useAppStore.ts and exercise it.
 * That keeps the check tied to the source — it can't quietly drift.
 *
 * Run: node scripts/verify-persist-migration.mjs
 * Exits 0 on PASS, 1 on FAIL.
 *
 * Scope: this verifies the migration's TRANSFORM in isolation. The end-to-end
 * on-device run (real MMKV blob → hydrated store) is the device-test the user
 * owns; this guards the logic that test would otherwise have to catch by hand.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(here, '..', 'store', 'useAppStore.ts');

// The contract, stated independently of the store so a wrong edit is caught:
const EXPECTED_CUT = ['activities', 'dayNotes', 'birthdays', 'reminders'];
const KEEPERS = ['intents', 'dayLog', 'weeklyReflections', 'endOfWeekDay'];

const failures = [];
const note = (ok, label, detail) => {
  if (ok) { console.log(`  ✓ ${label}`); }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failures.push(label); }
};

// ── 1. Pull the real `if (version < 5)` block out of the store source ────────
const src = readFileSync(STORE_PATH, 'utf8');

// Find the block and brace-match it (the block contains a nested `{ ...next }`,
// so a naive "next }" won't do).
function extractBlock(text, marker) {
  const start = text.indexOf(marker);
  if (start === -1) return null;
  const open = text.indexOf('{', start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(open, i + 1); }
  }
  return null;
}

const v5Block = extractBlock(src, 'if (version < 5)');
const v6Block = extractBlock(src, 'if (version < 6)');
note(!!v5Block, 'found the `if (version < 5)` migration block in the store');
note(!!v6Block, 'found the `if (version < 6)` migration block in the store');

// Persist version must be at least 6, or the v5/v6 cut blocks never run. Assert
// a FLOOR, not an exact value — the store keeps bumping past this for later,
// unrelated migrations (shape-normalization, etc.).
const verMatch = src.match(/version:\s*(\d+)\b/);
note(!!verMatch && Number(verMatch[1]) >= 6, 'persist `version` is at least 6 (v5/v6 cut blocks run)');

// The storage name must match what the store + cleanup actually use (a mismatch
// would orphan the live data). Bumped to v28 for the fresh-start cut.
note(src.includes("titan-app-storage-v28"), "storage `name` present (titan-app-storage-v28)");

// Extract the keys the real blocks delete (v5 + v6, unioned).
const deletedKeys = [v5Block, v6Block]
  .filter(Boolean)
  .flatMap(block => [...block.matchAll(/delete\s+next\.([A-Za-z0-9_]+)/g)].map(m => m[1]));

const deletedSet = new Set(deletedKeys);
const sameSet = deletedSet.size === EXPECTED_CUT.length && EXPECTED_CUT.every(k => deletedSet.has(k));
note(sameSet, 'block deletes EXACTLY the cut slices', `expected ${JSON.stringify(EXPECTED_CUT)}, source deletes ${JSON.stringify(deletedKeys)}`);

const keeperLeak = KEEPERS.filter(k => deletedSet.has(k));
note(keeperLeak.length === 0, 'block deletes NO keeper slice', keeperLeak.length ? `leaked: ${JSON.stringify(keeperLeak)}` : '');

// ── 2. Behavioral check: apply the REAL deletion list to a v4 snapshot ───────
// Mirrors the migrate's top guard + the v5 block's spread-then-delete.
function applyV5(state, dropKeys) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
  const next = { ...state };
  for (const k of dropKeys) delete next[k];
  return next;
}

// A representative pre-migration (version 4) blob: cut slices populated,
// keepers populated, plus a spread of unrelated slices that must ride through
// untouched.
const snapshot = Object.freeze({
  // cut
  activities: [{ id: 'a1', label: 'Deep work', start: '09:00' }],
  dayNotes: [{ id: 'dn1', text: 'felt good' }],
  birthdays: [{ id: 'b1', name: 'Sam', month: 4, day: 12 }],
  reminders: [{ id: 'r1', text: 'call mom', fireAt: 0, createdAt: 0 }],
  // keepers (rehomed into Habits)
  intents: [{ id: 'i1', label: 'ship phase 0', completed: false }],
  dayLog: { '2026-05-30': 4, '2026-05-31': 5 },
  weeklyReflections: { '2026-W22': { weekKey: '2026-W22', text: 'steady' } },
  endOfWeekDay: 'sunday',
  // unrelated slices — must survive verbatim
  tasks: [{ id: 't1', title: 'x' }],
  projects: [{ id: 'p1' }],
  habits: [{ id: 'h1', history: ['2026-05-30'] }],
  notes: [{ id: 'n1' }],
  challenges: [{ id: 'c1', target: 30 }],
  unlockedFeatures: { SUBTASKS: true, CHALLENGES_TAB: true },
  installDate: '2026-05-01',
  lastKnownDate: '2026-05-31',
  totalTasksCreated: 7,
});

const out = applyV5(snapshot, deletedKeys);

note(out && typeof out === 'object', 'transform returns an object');
for (const k of EXPECTED_CUT) note(!(k in out), `cut slice "${k}" is gone`);

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (const k of KEEPERS) {
  note(k in out && deepEq(out[k], snapshot[k]), `keeper "${k}" survives intact`);
}
for (const k of ['tasks', 'projects', 'habits', 'notes', 'challenges', 'unlockedFeatures', 'installDate', 'lastKnownDate', 'totalTasksCreated']) {
  note(k in out && deepEq(out[k], snapshot[k]), `unrelated slice "${k}" survives intact`);
}

// Did not mutate the input (migrate spreads a fresh object).
note('activities' in snapshot, 'original snapshot is not mutated (cut slice still present on input)');

// ── 3. Idempotency + degenerate inputs (mirror the migrate guard) ────────────
const twice = applyV5(applyV5(snapshot, deletedKeys), deletedKeys);
note(deepEq(twice, out), 'idempotent: applying twice equals applying once');

note(applyV5(null, deletedKeys) === null, 'null passes through (guard)');
note(applyV5(undefined, deletedKeys) === undefined, 'undefined passes through (guard)');
note(applyV5('nope', deletedKeys) === 'nope', 'non-object passes through (guard)');

// ── Result ───────────────────────────────────────────────────────────────────
console.log('');
if (failures.length === 0) {
  console.log('PASS — v4→v5 migration drops the cut slices and preserves every keeper.');
  process.exit(0);
} else {
  console.log(`FAIL — ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
