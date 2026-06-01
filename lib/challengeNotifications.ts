/**
 * Challenge deadline notifications.
 *
 * Challenges used to schedule nothing — a deadline could pass and the user
 * only learned of it by opening the tab (the dead-state flip runs on focus).
 * This module gives every active challenge with a future deadline up to three
 * one-shot notifications:
 *
 *   T-3 days  — "Three days left."   (only if the deadline is >3d out)
 *   T-1 day   — "One day left."
 *   T-0       — the expiry notice, fired the moment the deadline passes.
 *
 * Biting stakes: if the user wrote a consequence ("what's on the line"), it's
 * appended to the approaching + expiry bodies. A commitment device whose stake
 * is never resurfaced isn't a stake.
 *
 * We model this as a full resync rather than per-action bookkeeping: cancel
 * every challenge notification we previously scheduled, then reschedule from
 * the current challenge list. Challenges are few, so the cost is trivial and
 * it can't drift (no orphaned triggers after a bury / edit / complete). Call
 * `syncChallengeNotifications` whenever the set of active deadlines changes.
 *
 * Uses expo-notifications (same engine as quick reminders + task reminders);
 * the Android channel lives in lib/notifChannels.ts.
 */

import * as Notifications from 'expo-notifications';
import { CHALLENGE_CHANNEL_ID, ensureAppChannels } from './notifChannels';
import type { Challenge } from '../store/useAppStore';

const PREFIX = 'ch-';
const DAY_MS = 86_400_000;

const idFor = (kind: '3d' | '1d' | 'expiry', challengeId: string) => `${PREFIX}${kind}-${challengeId}`;

// "On the line: <consequence>" — only when the user actually wrote one.
function stakeLine(c: Challenge): string {
  const p = (c.punishment || '').trim();
  return p ? ` On the line: ${p}` : '';
}

async function scheduleAt(identifier: string, date: number, title: string, body: string): Promise<void> {
  if (date <= Date.now()) return; // never schedule into the past
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: { title, body, sound: true },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(date),
      channelId: CHALLENGE_CHANNEL_ID,
    },
  });
}

// Remove every challenge notification we previously scheduled. Targeted by the
// shared `ch-` identifier prefix so it never touches task / reminder / capsule
// triggers.
async function cancelAllChallengeNotifications(): Promise<void> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      all
        .filter(n => typeof n.identifier === 'string' && n.identifier.startsWith(PREFIX))
        .map(n => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
  } catch {
    // Best-effort; a failed cancel just means a stale trigger may fire once.
  }
}

export async function syncChallengeNotifications(challenges: Challenge[]): Promise<void> {
  await ensureAppChannels();
  await cancelAllChallengeNotifications();

  for (const c of challenges) {
    // Only live, unfinished challenges with a real future deadline get pings.
    if (c.deadState !== 'active' && c.deadState !== 'resurrected') continue;
    if (!c.deadlineTs || c.deadlineTs <= Date.now()) continue;
    if (c.current >= c.target) continue;

    const stake = stakeLine(c);
    try {
      await scheduleAt(idFor('3d', c.id), c.deadlineTs - 3 * DAY_MS, c.title, `Three days left.${stake}`);
      await scheduleAt(idFor('1d', c.id), c.deadlineTs - DAY_MS, c.title, `One day left.${stake}`);
      await scheduleAt(
        idFor('expiry', c.id),
        c.deadlineTs,
        c.title,
        c.punishment?.trim()
          ? `The line didn't hold. ${c.punishment.trim()}`
          : `The line didn't hold — the deadline passed.`
      );
    } catch {
      // One bad challenge shouldn't abort the whole resync.
    }
  }
}
