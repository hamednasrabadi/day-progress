/**
 * Challenge presets — curated, ready-to-launch challenges.
 *
 * Editorial rules (the reason this file is opinionated, not a feed of
 * everything the internet calls a "30-day challenge"):
 *
 *   1. NO YELLOW. No pop-psychology, no "this will change your life",
 *      no false promises, no Goggins suffering theatre, no Wim-Hof
 *      cold-shower miracle claims, no Robin-Sharma 5am cult, no
 *      Cameron morning-pages mysticism, no "you'll be shocked" copy.
 *      Every preset is either a real, measurable behavior with a
 *      defensible reason to do it, or it's not in here.
 *   2. State the rule. Don't sell the outcome. The user knows what
 *      they get from a thirty-day no-spend month — we don't need to
 *      promise transformation. We just describe what they're agreeing
 *      to and what failure looks like.
 *   3. One-at-a-time picking. Tapping a preset creates the challenge
 *      directly — no editor pop-up, no second confirmation. The user
 *      can edit or delete it from the active list.
 *   4. Adventure presets are one-day commitments by design. The
 *      challenge is doing the thing once, not building it into a
 *      streak.
 */

import { Feather } from '@expo/vector-icons';

export type PresetCategory =
  | 'body'
  | 'mind'
  | 'social'
  | 'discipline'
  | 'craft'
  | 'money'
  | 'declutter'
  | 'adventure'
  | 'reset';

export type PresetDifficulty = 'light' | 'moderate' | 'brutal';

export type ChallengePreset = {
  id: string;
  category: PresetCategory;
  name: string;
  // Short blurb shown on the card — the rule, not the promise.
  blurb: string;
  // Longer copy shown on the card — describes what counts, what
  // doesn't, where most people slip. Plain language, no sell.
  explainer: string;
  target: number;
  unit: string;
  durationDays: number;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  difficulty: PresetDifficulty;
  milestones?: { id: string; text: string; completed: boolean }[];
};

export const PRESET_CATEGORIES: { id: PresetCategory; label: string }[] = [
  { id: 'body', label: 'Body' },
  { id: 'mind', label: 'Mind' },
  { id: 'social', label: 'Social' },
  { id: 'discipline', label: 'Discipline' },
  { id: 'craft', label: 'Craft' },
  { id: 'money', label: 'Money' },
  { id: 'declutter', label: 'Declutter' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'reset', label: 'Reset' },
];

const ms = (n: number, text: string) => ({ id: `m${n}`, text, completed: false });

export const CHALLENGE_PRESETS: ChallengePreset[] = [
  // ── BODY ───────────────────────────────────────────────────────────
  // Step floor moved to 7,500 — that's where the 2019 JAMA cohort study
  // (Lee et al.) actually puts the mortality benefit plateau. The old
  // 10,000 number was a 1965 Yamasa pedometer marketing line.
  {
    id: 'step_base',
    category: 'body',
    name: 'Daily Step Floor',
    blurb: '7,500 steps a day for 30 days.',
    explainer: '7,500 is roughly where the cardiovascular and longevity benefits flatten in observational data. Hit it every day for thirty days. Days you don\'t leave the house are the test.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'navigation-2',
    color: '#10B981',
    difficulty: 'moderate',
    milestones: [ms(1, 'Day 7'), ms(2, 'Day 14'), ms(3, 'Day 21'), ms(4, 'Day 30')],
  },
  {
    id: 'step_hard',
    category: 'body',
    name: '12,500 Steps',
    blurb: 'Twelve and a half thousand. Thirty days.',
    explainer: 'A harder variant. Roughly two hours of walking per day. Most people will need to plan a daily walk or cut a commute. Skipping a day breaks the day, not the challenge.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'wind',
    color: '#1F2937',
    difficulty: 'brutal',
    milestones: [ms(1, 'Day 7'), ms(2, 'Day 14'), ms(3, 'Day 21'), ms(4, 'Day 30')],
  },
  {
    id: 'eight_hours_dark',
    category: 'body',
    name: 'Eight Hours Dark',
    blurb: 'In bed, lights off, at the same hour every night.',
    explainer: 'Pick a bedtime. Be in bed with phone outside the room and lights off — every night. Sleep itself isn\'t the metric, since you can\'t will it; the controlled conditions are.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'moon',
    color: '#1E3A8A',
    difficulty: 'moderate',
    milestones: [ms(1, 'Day 7'), ms(2, 'Day 14'), ms(3, 'Day 21'), ms(4, 'Day 30')],
  },
  {
    id: 'sugar_zero',
    category: 'body',
    name: 'No Added Sugar',
    blurb: 'Zero added sugar for 30 days.',
    explainer: 'Whole fruit fine; anything with added sugar — drinks, sauces, bread, "low-fat" anything — is out. Define grey areas before day one (honey? maple? alcohol?). The rule is yours; just write it down.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'x-octagon',
    color: '#DC2626',
    difficulty: 'brutal',
  },

  // ── MIND ───────────────────────────────────────────────────────────
  {
    id: 'quiet_hour',
    category: 'mind',
    name: 'The Quiet Hour',
    blurb: 'Twenty minutes of silent meditation, daily.',
    explainer: 'Sit. Eyes closed or soft gaze. No app, no music, no guidance. Twenty minutes. Mind wandering is not failure — noticing it and returning is the practice.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'circle',
    color: '#6366F1',
    difficulty: 'moderate',
    milestones: [ms(1, 'Day 3'), ms(2, 'Day 10'), ms(3, 'Day 21'), ms(4, 'Day 30')],
  },
  {
    id: 'three_things',
    category: 'mind',
    name: 'Three Things Daily',
    blurb: 'Three specific gratitudes. Nothing generic.',
    explainer: 'Each evening, write three concrete things from the day. "My partner laughed at my joke" beats "my family". Specificity is the rule. Twenty-one days.',
    target: 21,
    unit: 'days',
    durationDays: 21,
    icon: 'edit-3',
    color: '#F59E0B',
    difficulty: 'light',
  },
  {
    id: 'news_blackout',
    category: 'mind',
    name: 'News Blackout',
    blurb: 'No news sites, podcasts, or alerts.',
    explainer: 'Thirty days off the news cycle. No headlines, no aggregators, no doom-scroll homepages. If something matters enough, a person will tell you about it.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'volume-x',
    color: '#374151',
    difficulty: 'moderate',
  },
  {
    id: 'read_twenty',
    category: 'mind',
    name: 'Read Twenty',
    blurb: '20 pages a day, on paper.',
    explainer: 'Twenty pages. Audiobooks don\'t count. Twenty pages a day finishes about a book per week. Pick a book before you start.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'book-open',
    color: '#92400E',
    difficulty: 'light',
  },

  // ── SOCIAL ─────────────────────────────────────────────────────────
  {
    id: 'strangers_daily',
    category: 'social',
    name: 'Strangers Daily',
    blurb: 'One real conversation with a stranger. Every day.',
    explainer: 'Not a transaction. Not "how are you" at a checkout. A real exchange — three or more turns. If you can\'t recall what they said by evening, it didn\'t count.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'users',
    color: '#EA580C',
    difficulty: 'brutal',
  },
  {
    id: 'voice_not_text',
    category: 'social',
    name: 'Voice, Not Text',
    blurb: 'Call instead of text. Once a day.',
    explainer: 'Pick someone every day and call them. Two minutes counts. The rule is voice — not video, not text. Some people will be surprised; some will not pick up. Both fine.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'phone-call',
    color: '#3B82F6',
    difficulty: 'moderate',
  },
  {
    id: 'ghost_reach',
    category: 'social',
    name: 'Ghost Reach',
    blurb: 'Each day, message someone you haven\'t in 6+ months.',
    explainer: 'Two weeks of reaching back to people you let drift. No agenda — just "I was thinking about you, here\'s why". Some won\'t reply. That is also information.',
    target: 14,
    unit: 'days',
    durationDays: 14,
    icon: 'send',
    color: '#06B6D4',
    difficulty: 'moderate',
  },
  {
    id: 'real_compliment',
    category: 'social',
    name: 'The Real Compliment',
    blurb: 'One specific, non-physical compliment per day.',
    explainer: '"Nice shirt" doesn\'t count. "The way you handled that customer was patient and clear" does. Specificity is the only rule.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'heart',
    color: '#F472B6',
    difficulty: 'light',
  },
  {
    id: 'listen_no_reply',
    category: 'social',
    name: 'Listen Without Reply',
    blurb: 'Don\'t speak until they finish.',
    explainer: 'Twenty-one days of not interrupting, not formulating your response while they talk, not pivoting to your own story. Catch yourself when you do, then reset.',
    target: 21,
    unit: 'days',
    durationDays: 21,
    icon: 'headphones',
    color: '#7C3AED',
    difficulty: 'moderate',
  },

  // ── DISCIPLINE ─────────────────────────────────────────────────────
  {
    id: 'fixed_wake',
    category: 'discipline',
    name: 'Fixed Wake',
    blurb: 'Same wake time. Weekends included.',
    explainer: 'Pick an hour. Wake at it for thirty days, no Saturday lie-ins. Circadian regularity is the goal — not heroism, not "winning the day".',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'sunrise',
    color: '#F59E0B',
    difficulty: 'moderate',
  },
  {
    id: 'wake_early',
    category: 'discipline',
    name: 'Early Wake',
    blurb: 'Up at 6:00 AM. Weekends included.',
    explainer: 'A specific early wake time. Six AM is the baseline; pick five if you want it harder. Thirty days. The point is reclaiming a quiet block before the day demands you — what you do with it is a separate question.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'sun',
    color: '#F59E0B',
    difficulty: 'brutal',
    milestones: [ms(1, 'Week 1'), ms(2, 'Week 2'), ms(3, 'Week 3'), ms(4, 'Day 30')],
  },
  {
    id: 'one_task_first',
    category: 'discipline',
    name: 'One Task First',
    blurb: 'Hardest thing first. Before email. Before scroll.',
    explainer: 'Each morning, identify the single most-avoided task and start it before checking anything. Thirty days.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'crosshair',
    color: '#DC2626',
    difficulty: 'moderate',
  },
  {
    id: 'deep_work_hour',
    category: 'discipline',
    name: 'Deep Work Hour',
    blurb: 'Sixty minutes of unbroken focus, daily.',
    explainer: 'One hour, no notifications, no tabs, no chat — pure work on the thing that matters most. Use the Deep Work timer in Tasks if it helps. Thirty sessions in thirty days.',
    target: 30,
    unit: 'sessions',
    durationDays: 30,
    icon: 'zap',
    color: '#1F2937',
    difficulty: 'moderate',
  },

  // ── CRAFT ──────────────────────────────────────────────────────────
  {
    id: 'words_500',
    category: 'craft',
    name: '500 Words Daily',
    blurb: 'Write 500 words. No editing.',
    explainer: 'Five hundred words a day for thirty-one days. Anything — fiction, journal, drafts. The rule is no editing while writing.',
    target: 31,
    unit: 'days',
    durationDays: 31,
    icon: 'edit-2',
    color: '#B91C1C',
    difficulty: 'moderate',
  },
  {
    id: 'photo_a_day',
    category: 'craft',
    name: 'One Photo a Day',
    blurb: 'One intentional photo. Not a snapshot.',
    explainer: 'Each day, take one photo you actually thought about. Frame it. Choose the light. Thirty images at the end.',
    target: 30,
    unit: 'photos',
    durationDays: 30,
    icon: 'camera',
    color: '#7C3AED',
    difficulty: 'light',
  },
  {
    id: 'code_30',
    category: 'craft',
    name: '100 Days of Code',
    blurb: 'One hour of code. Every day.',
    explainer: 'A hundred days, an hour minimum, on a side project. Day forty is statistically where most people stop posting. That part is the actual challenge.',
    target: 100,
    unit: 'days',
    durationDays: 100,
    icon: 'code',
    color: '#059669',
    difficulty: 'moderate',
    milestones: [ms(1, 'Day 10'), ms(2, 'Day 30'), ms(3, 'Day 60'), ms(4, 'Day 100')],
  },
  {
    id: 'daily_doodle',
    category: 'craft',
    name: 'The Daily Mark',
    blurb: 'One drawing per day.',
    explainer: 'A page in a sketchbook every day. Pencil, pen, anything. The metric is the unbroken record, not the quality.',
    target: 31,
    unit: 'days',
    durationDays: 31,
    icon: 'pen-tool',
    color: '#7C3AED',
    difficulty: 'light',
  },
  {
    id: 'ship_one',
    category: 'craft',
    name: 'Ship One Thing',
    blurb: 'Publish one thing. Public. Within 30 days.',
    explainer: 'One artifact: an essay, an app, a song, a video. Posted somewhere strangers can see it. The deadline is the feature.',
    target: 1,
    unit: 'shipped',
    durationDays: 30,
    icon: 'send',
    color: '#10B981',
    difficulty: 'moderate',
    milestones: [ms(1, 'Idea locked'), ms(2, 'First draft'), ms(3, 'Final pass'), ms(4, 'Shipped')],
  },

  // ── MONEY ──────────────────────────────────────────────────────────
  {
    id: 'no_spend',
    category: 'money',
    name: 'No-Spend Month',
    blurb: 'Essentials only.',
    explainer: 'Thirty days, only essentials: rent, groceries, transport, bills. Define what counts BEFORE day one — the grey area is where the challenge dies.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'slash',
    color: '#047857',
    difficulty: 'brutal',
  },
  {
    id: 'track_every_cent',
    category: 'money',
    name: 'Track Every Cent',
    blurb: 'Log every transaction, same-day.',
    explainer: 'Thirty days where every dollar that leaves your account gets logged within twenty-four hours. The patterns tend to become legible by week two.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'dollar-sign',
    color: '#10B981',
    difficulty: 'moderate',
  },
  {
    id: 'twenty_four_rule',
    category: 'money',
    name: 'The 24-Hour Rule',
    blurb: 'Wait a day before any non-essential buy.',
    explainer: 'Thirty days. Anything you want to buy that isn\'t food, rent, or a bill: wait twenty-four hours. If you still want it, buy it.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'clock',
    color: '#0891B2',
    difficulty: 'light',
  },

  // ── DECLUTTER ──────────────────────────────────────────────────────
  {
    id: 'thirty_bags',
    category: 'declutter',
    name: 'The 30-Bag Purge',
    blurb: 'One donation bag a day. Thirty days.',
    explainer: 'Each day, fill one bag with things you do not need and remove it from the house — donation, trash, sale.',
    target: 30,
    unit: 'bags',
    durationDays: 30,
    icon: 'archive',
    color: '#475569',
    difficulty: 'moderate',
  },
  {
    id: 'unfollow_50',
    category: 'declutter',
    name: 'Unfollow Fifty',
    blurb: 'Cut fifty accounts that no longer earn the slot.',
    explainer: 'Across every feed — Instagram, X, TikTok, YouTube — unfollow fifty accounts in a week. Anyone you wouldn\'t miss. The feed reorganizes around what\'s left.',
    target: 50,
    unit: 'accounts',
    durationDays: 7,
    icon: 'user-minus',
    color: '#374151',
    difficulty: 'light',
  },
  {
    id: 'inbox_zero',
    category: 'declutter',
    name: 'Inbox Zero',
    blurb: 'End each day with no unread mail.',
    explainer: 'Fourteen days of closing the inbox at zero — read, archive, reply, delete. "Marked as read" doesn\'t count.',
    target: 14,
    unit: 'days',
    durationDays: 14,
    icon: 'inbox',
    color: '#475569',
    difficulty: 'moderate',
  },

  // ── ADVENTURE ──────────────────────────────────────────────────────
  // One-day commitments. Doing it once is the entire challenge —
  // there's no streak, no compounding. Built deliberately so the
  // category isn't full of "30 days of X" repeats.
  {
    id: 'day_silence',
    category: 'adventure',
    name: 'A Day of Silence',
    blurb: 'One day. No words. No music. No movies.',
    explainer: 'Sunrise to bedtime, don\'t speak. Don\'t fill the gap with podcasts, music, video, or scrolling. Carry a notepad if you must communicate. The point is meeting silence head-on, not hiding from it.',
    target: 1,
    unit: 'day',
    durationDays: 1,
    icon: 'volume-x',
    color: '#374151',
    difficulty: 'brutal',
  },
  {
    id: 'ignore_limit',
    category: 'adventure',
    name: 'Ignore One Limit',
    blurb: 'A specific fear. Today.',
    explainer: 'Pick one limit you carry — a fear, an avoidance, a "I don\'t do that" — and act against it once today. Specificity matters more than scale; "introduce myself to the loud neighbour" beats "be braver".',
    target: 1,
    unit: 'limit',
    durationDays: 1,
    icon: 'crosshair',
    color: '#DC2626',
    difficulty: 'moderate',
  },
  {
    id: 'nomad',
    category: 'adventure',
    name: 'The Nomad',
    blurb: 'Train or bus, no destination. Get off at random.',
    explainer: 'Pick public transit. Don\'t plan a stop. Get off somewhere you\'ve never been and walk for at least an hour. No phone navigation home until you\'re ready to leave.',
    target: 1,
    unit: 'trip',
    durationDays: 1,
    icon: 'compass',
    color: '#2563EB',
    difficulty: 'moderate',
  },
  {
    id: 'anonymity_run',
    category: 'adventure',
    name: 'Anonymity Run',
    blurb: 'Spend a day in a new city as someone else.',
    explainer: 'A city or town no one knows you in. Pick a different name, a different backstory, a different walk. Try the persona on for the day. Drop it before you sleep.',
    target: 1,
    unit: 'day',
    durationDays: 1,
    icon: 'user-x',
    color: '#7C3AED',
    difficulty: 'moderate',
  },
  {
    id: 'echo_map',
    category: 'adventure',
    name: 'The Echo Map',
    blurb: 'Navigate the city with a paper map. Phone away.',
    explainer: 'Buy or print a paper map of an area you don\'t know well. Spend the day exploring it without GPS. Get lost. Ask someone for directions if you have to.',
    target: 1,
    unit: 'walk',
    durationDays: 1,
    icon: 'map',
    color: '#059669',
    difficulty: 'light',
  },
  {
    id: 'artifact_hunt',
    category: 'adventure',
    name: 'The Artifact Hunt',
    blurb: 'Pick a specific object. Walk until you find five.',
    explainer: 'Choose something obscure but findable: a blue door, a gargoyle, a red bicycle, a yellow cat. Walk until you spot five. No destination, no time limit.',
    target: 5,
    unit: 'finds',
    durationDays: 1,
    icon: 'search',
    color: '#EA580C',
    difficulty: 'light',
  },

  // ── RESET ──────────────────────────────────────────────────────────
  {
    id: 'quiet_feed',
    category: 'reset',
    name: 'The Quiet Feed',
    blurb: 'No infinite-scroll apps. Thirty days.',
    explainer: 'Delete or block every infinite-scroll surface: TikTok, Reels, X, Reddit, YouTube Shorts. Thirty days. Failures count as days; just record them honestly.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'eye-off',
    color: '#1F2937',
    difficulty: 'brutal',
  },
  {
    id: 'phone_one_hour',
    category: 'reset',
    name: 'One Hour Phone',
    blurb: 'Total screen time under 60 minutes daily.',
    explainer: 'Use the OS screen-time tools as the source of truth. Sixty minutes total for thirty days. Calls and maps not counted. Going over is failing the day.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'smartphone',
    color: '#1F2937',
    difficulty: 'brutal',
  },
  {
    id: 'dry_month',
    category: 'reset',
    name: 'Dry Month',
    blurb: 'No alcohol for 31 days.',
    explainer: 'Thirty-one days, no alcohol. Notice sleep, money, time, mood — but treat noticing as a side effect, not the goal. The goal is the abstinence itself.',
    target: 31,
    unit: 'days',
    durationDays: 31,
    icon: 'x-circle',
    color: '#1E3A8A',
    difficulty: 'moderate',
  },
  {
    id: 'quiet_phone',
    category: 'reset',
    name: 'The Quiet Phone',
    blurb: '30 days without optional apps.',
    explainer: 'Remove every optional app for thirty days. After it ends, reintroduce only the ones you actually missed. Most people don\'t put half of them back.',
    target: 30,
    unit: 'days',
    durationDays: 30,
    icon: 'minimize-2',
    color: '#374151',
    difficulty: 'moderate',
  },
];

export function getPresetsByCategory(cat: PresetCategory): ChallengePreset[] {
  return CHALLENGE_PRESETS.filter(p => p.category === cat);
}
