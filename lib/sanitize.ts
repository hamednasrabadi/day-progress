/**
 * Defensive shape-normalization for persisted + imported data.
 *
 * Two paths feed external / old data into the live store:
 *   1. Hydration — the persist `migrate` in store/useAppStore.ts reads an old
 *      MMKV blob, possibly written by a much older build.
 *   2. Restore — applyBackup() in lib/backup.ts writes a parsed backup file's
 *      slices straight into the store with setState.
 *
 * Neither used to guarantee that array fields are actually arrays. A habit
 * missing `history`/`frequency`, or a note missing `content`/`status`, would
 * sail in and then throw the first time a renderer called `.length` / `.split`
 * / `.includes` on it — blanking the entire Habits or Notes tab. (habitScore.ts
 * is a shared source of truth, so one bad habit also took down the Challenges
 * tab.) These pure helpers coerce every crash-prone field back to a safe
 * default so malformed data can never reach a renderer.
 *
 * They only repair KNOWN data keys and pass everything else through untouched,
 * so it's safe to run sanitizeStateSlice over a whole persisted blob. Kept
 * dependency-free (no store import) so the store and lib/backup.ts can both use
 * it without a circular import.
 */

const isObject = (v: any): boolean => !!v && typeof v === 'object' && !Array.isArray(v);
const strArray = (v: any): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

// Coerce one habit's crash-prone array fields. Every other field is preserved.
// (frequency/history/restDays/skippedDays are typed string[] but old or foreign
// data may omit them — see lib/habitScore.ts, which reads all four.)
export function sanitizeHabit(h: any): any {
  if (!isObject(h)) return h; // non-objects are dropped by the array pass below
  return {
    ...h,
    history: strArray(h.history),
    restDays: strArray(h.restDays),
    skippedDays: strArray(h.skippedDays),
    frequency: strArray(h.frequency),
  };
}

// Coerce one note's crash-prone / disappear-prone fields. A v1 note that lacks
// `status` matches no feed filter and silently vanishes; one that lacks
// `content` crashes the card preview's stripAllMarkdown(...).split('\n').
export function sanitizeNote(n: any): any {
  if (!isObject(n)) return n;
  const out: any = { ...n };
  if (typeof out.content !== 'string') out.content = '';
  if (out.status !== 'active' && out.status !== 'archived' && out.status !== 'trash') out.status = 'active';
  if (typeof out.order !== 'number') out.order = typeof out.createdAt === 'number' ? out.createdAt : 0;
  return out;
}

// Slices that MUST be arrays of plain objects in the live store. The root app
// shell selects tasks/challenges and immediately .filter()s them, so a non-array
// here would crash every tab — not just one feed.
const ARRAY_KEYS = ['tasks', 'projects', 'habits', 'challenges', 'achievements', 'deepWorkSessions', 'intents', 'notes'] as const;
// Slices that must be a (date-keyed) object map.
const OBJECT_KEYS = ['dayLog', 'weeklyReflections'] as const;

/**
 * Return a shape-normalized copy of a partial state object. Only touches keys
 * that are PRESENT (absent keys stay absent so store defaults apply). Drops
 * non-object entries from array slices, runs the per-item sanitizer for habits
 * + notes, and coerces a wrong-typed slice to [] / {}.
 */
export function sanitizeStateSlice(partial: any): any {
  if (!isObject(partial)) return partial;
  const out: any = { ...partial };
  for (const key of ARRAY_KEYS) {
    if (!(key in out)) continue;
    const arr = Array.isArray(out[key]) ? out[key].filter(isObject) : [];
    out[key] = key === 'habits' ? arr.map(sanitizeHabit) : key === 'notes' ? arr.map(sanitizeNote) : arr;
  }
  for (const key of OBJECT_KEYS) {
    if (!(key in out)) continue;
    if (!isObject(out[key])) out[key] = {};
  }
  return out;
}
