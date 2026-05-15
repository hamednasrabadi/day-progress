/**
 * Quick-reminder notifications.
 *
 * Tiny module — a reminder is just (id, text, fireAt). We schedule a single
 * one-shot notification per entry using a deterministic identifier so cancel
 * is target-safe (no list traversal, no orphan triggers when the user removes
 * a reminder before it fires).
 *
 * Channel + foreground handling come from the global setup in
 * lib/notifChannels.ts and app/_layout.tsx; nothing reminder-specific lives
 * outside this file and the bell-icon UI in Timeline.
 */

import * as Notifications from 'expo-notifications';
import { REMINDER_CHANNEL_ID } from './notifChannels';

const ID_PREFIX = 'reminder-';
const idFor = (reminderId: string) => `${ID_PREFIX}${reminderId}`;

export async function scheduleReminder(reminder: { id: string; text: string; fireAt: number }): Promise<void> {
  // Defensive: if fireAt is in the past, fire immediately by scheduling a few
  // seconds out. Better to interrupt the user than silently drop the entry.
  const target = reminder.fireAt <= Date.now() ? Date.now() + 3_000 : reminder.fireAt;
  await Notifications.scheduleNotificationAsync({
    identifier: idFor(reminder.id),
    content: {
      title: 'Reminder',
      body: reminder.text,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(target),
      channelId: REMINDER_CHANNEL_ID,
    },
  });
}

export async function cancelReminder(reminderId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(idFor(reminderId));
  } catch {
    // Already-fired or never-scheduled triggers throw; silent is fine.
  }
}
