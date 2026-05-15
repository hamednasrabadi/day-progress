/**
 * Timeline notifications — all notifee plumbing for the Timeline tab.
 *
 * Three responsibilities:
 *   1. Scheduled pre-alert + start-alert for every block the user opted into (hasReminder),
 *      across the next SYNC_WINDOW_DAYS days. Unique IDs per instance so cancellations are targeted.
 *   2. Pinned "Now Playing" ongoing notification (Android) showing the currently-active block.
 *      Kept fresh by the Timeline tab's 60s tick while foregrounded, and refreshed on every
 *      save/delete/focus.
 *   3. Channel setup + permission request helpers.
 *
 * All Timeline-owned notification IDs start with the `tl-` prefix so global cancels are surgical.
 */

import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  TriggerType,
  TimestampTrigger,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import type { Activity } from '../store/useAppStore';

// ── IDs / channels ────────────────────────────────────────────────────
const TL_PREFIX = 'tl-';
const NOW_PLAYING_ID = 'tl-now-playing';
const ALERTS_CHANNEL = 'tl-alerts';
const NOW_CHANNEL = 'tl-now';

const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SYNC_WINDOW_DAYS = 3;

export type NotifPrefs = {
  globalNotifsEnabled: boolean;
  preNotifOffset: number; // minutes before start
  ongoingBlockEnabled: boolean;
  // Weekly-reflection reminder — fires 9 AM on the user's chosen end-of-week
  // day. Optional so callers that don't care (legacy / partial state) can omit.
  endOfWeekDay?: 'friday' | 'saturday';
  // Map of date-string (YYYY-MM-DD) → reflection record. We use this to skip
  // scheduling a reminder when one's already been logged for the upcoming week.
  weeklyReflections?: Record<string, unknown>;
};

// ── Channel setup (idempotent) ─────────────────────────────────────────
let channelsReady = false;
async function ensureChannels() {
  if (channelsReady || Platform.OS !== 'android') { channelsReady = true; return; }
  await notifee.createChannel({
    id: ALERTS_CHANNEL,
    name: 'Block alerts',
    // HIGH = heads-up popup over the current screen + sound. Block/commit alerts
    // are time-critical (a pre-alert that sits silently in the tray defeats the
    // point), so we want the OS to surface them on top of whatever the user is doing.
    importance: AndroidImportance.HIGH,
  });
  await notifee.createChannel({
    id: NOW_CHANNEL,
    name: 'Now playing',
    importance: AndroidImportance.LOW, // intentional — pinned ongoing notif, no popup
    sound: undefined,
  });
  channelsReady = true;
}

// ── Permission request — wraps notifee so callers don't import two libs ────
export async function requestTimelinePermissions(): Promise<boolean> {
  await ensureChannels();
  const settings = await notifee.requestPermission();
  // authorizationStatus: 0 = denied, 1 = authorized, 2 = provisional
  return settings.authorizationStatus >= 1;
}

// ── Formatters (mirror Timeline's own, kept local to avoid cross-import churn) ──
function formatClock(dec: number): string {
  if (isNaN(dec)) return '';
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function dateStamp(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function dateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function durationLabel(hours: number): string {
  if (hours <= 0) return '0m';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Activity → concrete calendar instances ─────────────────────────────
type Instance = {
  activity: Activity;
  date: Date;
  startMs: number;
  endMs: number;
  durationH: number;
};

function isEffectiveOn(a: Activity, iso: string): boolean {
  if (a.effectiveFrom && a.effectiveFrom > iso) return false;
  if (a.effectiveUntil && a.effectiveUntil <= iso) return false;
  return true;
}

function enumerateInstances(activities: Activity[], from: Date, days: number): Instance[] {
  const out: Instance[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(from);
    day.setDate(day.getDate() + i);
    day.setHours(0, 0, 0, 0);
    const iso = dateISO(day);
    const dayName = DAYS_EN[day.getDay()];
    for (const a of activities) {
      if (!isEffectiveOn(a, iso)) continue;
      if (a.scheduledDate) {
        if (a.scheduledDate !== iso) continue;
      } else {
        if (a.day !== dayName) continue;
      }
      const startMs = day.getTime() + a.startHour * 3600_000;
      // Cross-midnight blocks (endHour < startHour) extend into the next day.
      const endBase = a.endHour < a.startHour ? 24 + a.endHour : a.endHour;
      const endMs = day.getTime() + endBase * 3600_000;
      const durationH = endBase - a.startHour;
      if (endMs <= Date.now()) continue; // fully past — skip
      out.push({ activity: a, date: day, startMs, endMs, durationH });
    }
  }
  out.sort((x, y) => x.startMs - y.startMs);
  return out;
}

// ── Find the activity active RIGHT NOW ──────────────────────────────────
function findCurrentActivity(activities: Activity[], now: Date): Activity | null {
  const iso = dateISO(now);
  const dayName = DAYS_EN[now.getDay()];
  const nowHour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  // Check today's activities first.
  const todayMatch = activities.find(a => {
    if (!isEffectiveOn(a, iso)) return false;
    if (a.scheduledDate) { if (a.scheduledDate !== iso) return false; }
    else { if (a.day !== dayName) return false; }
    const endBase = a.endHour < a.startHour ? 24 + a.endHour : a.endHour;
    return a.startHour <= nowHour && nowHour < endBase;
  });
  if (todayMatch) return todayMatch;
  // Also check yesterday's bled-across-midnight blocks that extend into today.
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const yIso = dateISO(yesterday);
  const yDay = DAYS_EN[yesterday.getDay()];
  const bledMatch = activities.find(a => {
    if (a.endHour >= a.startHour) return false; // not bled
    if (!isEffectiveOn(a, yIso)) return false;
    if (a.scheduledDate) { if (a.scheduledDate !== yIso) return false; }
    else { if (a.day !== yDay) return false; }
    // It bleeds into today — check today's portion [0, endHour)
    return nowHour < a.endHour;
  });
  return bledMatch ?? null;
}

// ── Cancellation helpers ────────────────────────────────────────────────
export async function cancelAllTimelineNotifications() {
  try {
    const triggerIds = await notifee.getTriggerNotificationIds();
    const ours = triggerIds.filter(id => id.startsWith(TL_PREFIX));
    if (ours.length > 0) await notifee.cancelTriggerNotifications(ours);
    const displayed = await notifee.getDisplayedNotifications();
    for (const d of displayed) {
      if (d.id && d.id.startsWith(TL_PREFIX)) await notifee.cancelDisplayedNotification(d.id);
    }
  } catch {}
}

async function cancelScheduledAlerts() {
  try {
    const triggerIds = await notifee.getTriggerNotificationIds();
    // Cancel pre/start alerts, commit checkpoints (40% / 80% / end), AND
    // scheduled now-playing transitions — we rebuild the full window every sync.
    // tl-mid- is the historical 50% prefix, kept here so any leftovers from
    // older app versions get cleaned up the next time sync runs.
    const ours = triggerIds.filter(id =>
      id.startsWith('tl-pre-') || id.startsWith('tl-start-') ||
      id.startsWith('tl-mid-') || id.startsWith('tl-40-') ||
      id.startsWith('tl-80-') || id.startsWith('tl-end-') ||
      id.startsWith('tl-np-') || id.startsWith('tl-weekly-reflection-')
    );
    if (ours.length > 0) await notifee.cancelTriggerNotifications(ours);
  } catch {}
}

// ── Post the pinned "now playing" notification (immediate) ──────────────
export async function refreshNowPlaying(activities: Activity[], enabled: boolean) {
  await ensureChannels();
  if (!enabled) {
    try {
      await notifee.cancelDisplayedNotification(NOW_PLAYING_ID);
      await notifee.cancelTriggerNotification(NOW_PLAYING_ID);
    } catch {}
    return;
  }
  const now = new Date();
  const active = findCurrentActivity(activities, now);

  if (!active) {
    await notifee.displayNotification({
      id: NOW_PLAYING_ID,
      title: 'Timeline · Free',
      body: 'No block scheduled.',
      android: {
        channelId: NOW_CHANNEL,
        color: '#666666',
        ongoing: true,
        onlyAlertOnce: true,
        smallIcon: 'ic_launcher',
        category: AndroidCategory.STATUS,
        visibility: AndroidVisibility.PUBLIC,
        pressAction: { id: 'default' },
      },
      ios: { threadId: NOW_PLAYING_ID },
    });
    return;
  }

  const nowHour = now.getHours() + now.getMinutes() / 60;
  // Adjust for bled blocks where "now" is in the morning and the block started yesterday.
  const effectiveStart = active.endHour < active.startHour && nowHour < active.endHour
    ? active.startHour - 24
    : active.startHour;
  const endBase = active.endHour < active.startHour ? 24 + active.endHour : active.endHour;
  const remainingH = Math.max(0, endBase - (nowHour < active.endHour && active.endHour < active.startHour ? nowHour + 24 : nowHour));
  const elapsedH = Math.max(0, (nowHour < active.endHour && active.endHour < active.startHour ? nowHour + 24 : nowHour) - effectiveStart);
  const totalH = endBase - effectiveStart;
  const pct = totalH > 0 ? Math.min(100, Math.round((elapsedH / totalH) * 100)) : 0;

  const body = `${durationLabel(remainingH)} remaining · ${formatClock(active.startHour)}–${formatClock(active.endHour)} · ${pct}%`;

  await notifee.displayNotification({
    id: NOW_PLAYING_ID,
    title: active.label,
    body,
    android: {
      channelId: NOW_CHANNEL,
      color: active.color,
      colorized: true,
      ongoing: true,
      onlyAlertOnce: true,
      smallIcon: 'ic_launcher',
      category: AndroidCategory.STATUS,
      visibility: AndroidVisibility.PUBLIC,
      pressAction: { id: 'default' },
      progress: { max: 100, current: pct },
    },
    ios: { threadId: NOW_PLAYING_ID },
  });
}

// ── Main sync — rebuilds the next-3-days alert window ───────────────────
export async function syncTimelineNotifications(activities: Activity[], prefs: NotifPrefs) {
  await ensureChannels();
  await cancelScheduledAlerts();

  const hasGranted = await notifee.getNotificationSettings();
  // If user hasn't granted, skip scheduling — but still clear any stale ones.
  if (hasGranted.authorizationStatus < 1) {
    await refreshNowPlaying(activities, false);
    return;
  }

  const from = new Date();
  const instances = enumerateInstances(activities, from, SYNC_WINDOW_DAYS);
  const nowMs = Date.now();

  // ── Pre-alert + start-alert + commit checkpoints ─────────────────────
  // Reminder rules:
  //   - Plain block with hasReminder: pre-alert (T - preNotifOffset) + start (T).
  //   - Commit block (isHype): pre-alert (T - preNotifOffset) + 40% + 80% + end.
  //     Total of 4 notifications. We deliberately SKIP the start ping for commit
  //     blocks (the pre-alert already covered "it's about to start"); replacing
  //     it with two checkpoints inside the block (40% / 80%) gives a sense of
  //     "you committed to this — how's it going?" without doubling up at the
  //     start. The end notification asks the user to open Timeline to reflect.
  // The 4-cap is on purpose: more pings would degrade into noise. Users who
  // want fewer can untoggle Commit on blocks that don't need this attention.
  if (prefs.globalNotifsEnabled) {
    for (const inst of instances) {
      const isCommit = !!inst.activity.isHype;
      if (!inst.activity.hasReminder && !isCommit) continue;
      const stamp = dateStamp(inst.date);
      const id = inst.activity.id;

      // Pre-alert (T - preNotifOffset) — fires for both plain and commit blocks.
      if (prefs.preNotifOffset > 0) {
        const preMs = inst.startMs - prefs.preNotifOffset * 60_000;
        if (preMs > nowMs) {
          const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: preMs };
          await notifee.createTriggerNotification(
            {
              id: `tl-pre-${id}-${stamp}`,
              title: isCommit ? `Commit · Starting in ${prefs.preNotifOffset}m` : `Starting in ${prefs.preNotifOffset}m`,
              body: `${inst.activity.label} · ${formatClock(inst.activity.startHour)}–${formatClock(inst.activity.endHour)}`,
              android: {
                channelId: ALERTS_CHANNEL,
                color: inst.activity.color,
                colorized: true,
                smallIcon: 'ic_launcher',
                pressAction: { id: 'default' },
              },
              ios: { threadId: 'tl-alerts' },
            },
            trigger,
          );
        }
      }

      // Start ping at T — plain blocks only. Commit blocks skip this in favor
      // of the 40% / 80% checkpoints below; firing both would be a double-ping
      // around the start (pre + start within minutes of each other).
      if (!isCommit && inst.startMs > nowMs) {
        const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: inst.startMs };
        await notifee.createTriggerNotification(
          {
            id: `tl-start-${id}-${stamp}`,
            title: inst.activity.label,
            body: `Starting now · ${formatClock(inst.activity.startHour)}–${formatClock(inst.activity.endHour)}`,
            android: {
              channelId: ALERTS_CHANNEL,
              color: inst.activity.color,
              colorized: true,
              smallIcon: 'ic_launcher',
              pressAction: { id: 'default' },
            },
            ios: { threadId: 'tl-alerts' },
          },
          trigger,
        );
      }

      // Commit-only checkpoints: 40%, 80%, end.
      // 40% / 80% are skipped for short blocks (<25 min) — for a 10-min block,
      // 40% is at 4 min and 80% is at 8 min; that's three pings inside one
      // short focus window, more noise than help. End-of-block reflection
      // still fires regardless of duration; the close-out matters most.
      if (isCommit) {
        const durationMs = inst.endMs - inst.startMs;
        const durationMin = inst.durationH * 60;
        if (durationMin >= 25) {
          const fortyMs = inst.startMs + durationMs * 0.4;
          if (fortyMs > nowMs) {
            const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: fortyMs };
            await notifee.createTriggerNotification(
              {
                id: `tl-40-${id}-${stamp}`,
                title: `${inst.activity.label} · 40% in`,
                body: 'Still locked in? Course-correct if you drifted.',
                android: {
                  channelId: ALERTS_CHANNEL,
                  color: inst.activity.color,
                  colorized: true,
                  smallIcon: 'ic_launcher',
                  pressAction: { id: 'default' },
                },
                ios: { threadId: 'tl-alerts' },
              },
              trigger,
            );
          }
          const eightyMs = inst.startMs + durationMs * 0.8;
          if (eightyMs > nowMs) {
            const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: eightyMs };
            await notifee.createTriggerNotification(
              {
                id: `tl-80-${id}-${stamp}`,
                title: `${inst.activity.label} · 80%`,
                body: 'Almost done — last push.',
                android: {
                  channelId: ALERTS_CHANNEL,
                  color: inst.activity.color,
                  colorized: true,
                  smallIcon: 'ic_launcher',
                  pressAction: { id: 'default' },
                },
                ios: { threadId: 'tl-alerts' },
              },
              trigger,
            );
          }
        }
        if (inst.endMs > nowMs) {
          const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: inst.endMs };
          await notifee.createTriggerNotification(
            {
              id: `tl-end-${id}-${stamp}`,
              title: `${inst.activity.label} · ended`,
              body: 'Open Timeline to reflect on how it went.',
              android: {
                channelId: ALERTS_CHANNEL,
                color: inst.activity.color,
                colorized: true,
                smallIcon: 'ic_launcher',
                pressAction: { id: 'default' },
              },
              ios: { threadId: 'tl-alerts' },
            },
            trigger,
          );
        }
      }
    }
  }

  // ── Now-playing transitions — pre-scheduled so the pinned notification updates
  //    as blocks change even while the app is backgrounded. Each trigger uses the
  //    shared NOW_PLAYING_ID, so delivery replaces (not stacks) the pinned slot.
  //    Limitation: `createTriggerNotification` with duplicate id replaces the pending
  //    trigger, so only ONE transition can be pre-queued at a time. We queue the
  //    single nearest boundary — the foreground tick handles anything after that
  //    while the app is open. Re-runs on focus/save/delete keep this fresh.
  if (prefs.ongoingBlockEnabled && instances.length > 0) {
    // Find the nearest future boundary — either the next block's start, or the current block's end.
    const current = findCurrentActivity(activities, new Date());
    let nextBoundaryMs = Infinity;
    let nextBoundaryKind: 'start' | 'end' = 'start';
    let nextActivity: Activity | null = null;

    if (current) {
      const endBase = current.endHour < current.startHour ? 24 + current.endHour : current.endHour;
      // Compute current-block end timestamp relative to today.
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const endMs = todayStart.getTime() + endBase * 3600_000;
      if (endMs > nowMs) {
        nextBoundaryMs = endMs;
        nextBoundaryKind = 'end';
        nextActivity = current;
      }
    }
    for (const inst of instances) {
      if (inst.startMs > nowMs && inst.startMs < nextBoundaryMs) {
        nextBoundaryMs = inst.startMs;
        nextBoundaryKind = 'start';
        nextActivity = inst.activity;
      }
    }

    if (isFinite(nextBoundaryMs) && nextActivity) {
      const isStart = nextBoundaryKind === 'start';
      // The trigger's payload becomes the pinned notification when it fires.
      const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: nextBoundaryMs };
      await notifee.createTriggerNotification(
        {
          id: NOW_PLAYING_ID,
          title: isStart ? nextActivity.label : 'Timeline · Free',
          body: isStart
            ? `${formatClock(nextActivity.startHour)}–${formatClock(nextActivity.endHour)}`
            : 'No block scheduled.',
          android: {
            channelId: NOW_CHANNEL,
            color: isStart ? nextActivity.color : '#666666',
            colorized: isStart,
            ongoing: true,
            onlyAlertOnce: true,
            smallIcon: 'ic_launcher',
            category: AndroidCategory.STATUS,
            visibility: AndroidVisibility.PUBLIC,
            pressAction: { id: 'default' },
          },
          ios: { threadId: NOW_PLAYING_ID },
        },
        trigger,
      );
    }
  }

  // ── Weekly reflection reminder ─────────────────────────────────────────
  // 9 AM on the user's chosen end-of-week day (friday/saturday). Skipped if a
  // reflection was already logged for that same date. Only schedules the next
  // upcoming occurrence — re-runs of this sync (focus, settings change) keep
  // it rolling forward week to week.
  if (prefs.globalNotifsEnabled && prefs.endOfWeekDay) {
    const targetDow = prefs.endOfWeekDay === 'friday' ? 5 : 6; // JS: 0=Sun..6=Sat
    const candidate = new Date();
    candidate.setHours(9, 0, 0, 0);
    // Roll to the next matching weekday; if today is the day but 9 AM has
    // passed, push to next week.
    let daysAhead = (targetDow - candidate.getDay() + 7) % 7;
    if (daysAhead === 0 && candidate.getTime() <= nowMs) daysAhead = 7;
    candidate.setDate(candidate.getDate() + daysAhead);
    const candidateIso = dateISO(candidate);
    // Suppress when the user has already logged a reflection for the upcoming
    // end-of-week date — no reason to nag about a ritual they've completed.
    const alreadyLogged = !!prefs.weeklyReflections && Object.prototype.hasOwnProperty.call(prefs.weeklyReflections, candidateIso);
    if (!alreadyLogged && candidate.getTime() > nowMs) {
      const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: candidate.getTime() };
      await notifee.createTriggerNotification(
        {
          id: `tl-weekly-reflection-${candidateIso}`,
          title: 'Time to reflect on your week',
          body: 'Open Timeline to capture how this week went.',
          android: {
            channelId: ALERTS_CHANNEL,
            smallIcon: 'ic_launcher',
            pressAction: { id: 'default' },
          },
          ios: { threadId: 'tl-alerts' },
        },
        trigger,
      );
    }
  }

  // Show the pinned notification NOW — caller expects it visible immediately.
  await refreshNowPlaying(activities, prefs.ongoingBlockEnabled);
}
