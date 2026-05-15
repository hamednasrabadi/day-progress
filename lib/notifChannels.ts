/**
 * Cross-tab Android notification channel setup.
 *
 * Each surface that fires a user-visible reminder gets its own channel so the
 * user can mute one without losing the others. Every reminder channel is
 * HIGH/MAX importance so notifications surface as a heads-up banner over the
 * current screen rather than sitting silently in the tray.
 *
 * Timeline has its own channel setup in lib/timelineNotifications.ts since it
 * needs both an alerts channel and a low-importance pinned "Now Playing" one.
 *
 * On iOS this is a no-op — heads-up presentation is controlled by
 * setNotificationHandler in app/_layout.tsx (already returns shouldShowBanner).
 */

import * as Notifications from 'expo-notifications';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { Platform } from 'react-native';

export const HABIT_CHANNEL_ID    = 'notif_pop_v4';   // habits.tsx already references this id
export const TASK_CHANNEL_ID     = 'task-reminders';
export const CAPSULE_CHANNEL_ID  = 'capsule-unlock';
// "Remind me" quick reminders — set from Timeline's bell icon. Separate
// channel from task-reminders so the user can mute one without losing the
// other, and so notification grouping reads cleanly.
export const REMINDER_CHANNEL_ID = 'quick-reminders';

let ready = false;

export async function ensureAppChannels(): Promise<void> {
  if (ready || Platform.OS !== 'android') { ready = true; return; }

  // Habits — fired by notifee. Keep the existing id so historical scheduled
  // triggers still resolve to a real channel after this code lands.
  await notifee.createChannel({
    id: HABIT_CHANNEL_ID,
    name: 'Habit reminders',
    importance: AndroidImportance.HIGH,
    sound: 'pop',
  });

  // Tasks — fired by expo-notifications.
  await Notifications.setNotificationChannelAsync(TASK_CHANNEL_ID, {
    name: 'Task reminders',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
  });

  // Time-capsule unlock — fired by expo-notifications when a sealed note's
  // unlock date arrives. Single shot per capsule, MAX importance because it's
  // a "moment" notification (your past self is talking to you).
  await Notifications.setNotificationChannelAsync(CAPSULE_CHANNEL_ID, {
    name: 'Time capsule unlocks',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
  });

  // Quick "remind me" reminders. MAX importance because a user setting a
  // 5-minute timer wants the OS to interrupt them — it's the whole point.
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
  });

  ready = true;
}
