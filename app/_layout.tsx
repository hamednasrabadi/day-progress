/**
 * Root layout — app entry point.
 *
 * Responsibilities:
 *   - Register the Notifee background event handler (must be at module scope, runs once).
 *   - Handle foreground alarm delivery and show the full-screen alarm modal.
 *   - Set up the expo-notifications foreground handler (single registration point).
 *   - Render the Stack navigator underneath everything.
 *
 * What does NOT belong here:
 *   - Tab bar config  →  (tabs)/_layout.tsx
 *   - Per-screen headers  →  individual screen files
 *   - Any AsyncStorage migration  →  timeline.tsx (runs once on first focus)
 */

import { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import notifee, { EventType } from '@notifee/react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ensureAppChannels } from '../lib/notifChannels';

// ── Notification foreground behaviour ──────────────────────────────────────
// Registered once at the module level so it applies for the lifetime of the app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ── Notifee background handler ─────────────────────────────────────────────
// Must live at module scope (outside any component) so Notifee can call it
// even when the app is fully dead. Only one registration across the whole app —
// previously duplicated in the tabs layout, removed from there.
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS || type === EventType.DISMISSED) {
    if (detail.notification?.id) {
      await notifee.cancelNotification(detail.notification.id);
    }
  }
});

export default function RootLayout() {
  const [activeAlarm, setActiveAlarm] = useState<any>(null);

  useEffect(() => {
    // Create Android channels for habits / tasks / time-capsule reminders. All
    // are HIGH/MAX importance so they pop up as heads-up banners over whatever
    // the user is doing. Idempotent — safe to call on every mount. Timeline has
    // its own channels and creates them lazily on first sync.
    ensureAppChannels();

    // Case 1: App was completely dead and Notifee forced it to wake for an alarm.
    notifee.getInitialNotification().then(initial => {
      if (initial?.notification?.android?.category === 'alarm') {
        setActiveAlarm(initial.notification);
      }
    });

    // Case 2: User is actively using the app when the alarm fires.
    const unsubscribe = notifee.onForegroundEvent(({ type, detail }) => {
      if (
        type === EventType.DELIVERED &&
        detail.notification?.android?.category === 'alarm'
      ) {
        setActiveAlarm(detail.notification);
      }
    });

    return unsubscribe;
  }, []);

  const stopAlarm = async () => {
    if (activeAlarm?.id) {
      await notifee.cancelNotification(activeAlarm.id);
    }
    setActiveAlarm(null);
  };

  return (
    <KeyboardProvider>
      {/* Normal app renders underneath */}
      <Stack screenOptions={{ headerShown: false }} />

      {/* Full-screen alarm overlay — rendered above the entire navigator */}
      <Modal visible={!!activeAlarm} animationType="slide" transparent={false}>
        <View style={styles.container}>
          <Text style={styles.title}>ALARM</Text>
          <Text style={styles.alarmName}>
            {activeAlarm?.title?.replace('🚨 ALARM: ', '') ?? ''}
          </Text>
          <Text style={styles.alarmBody}>{activeAlarm?.body ?? ''}</Text>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.btn, styles.snoozeBtn]} onPress={stopAlarm}>
              <Text style={styles.btnText}>SNOOZE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.stopBtn]} onPress={stopAlarm}>
              <Text style={styles.btnText}>STOP</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 13,
    fontWeight: '900',
    color: '#F43F5E',
    letterSpacing: 4,
    marginBottom: 24,
  },
  alarmName: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFF',
    textAlign: 'center',
    marginBottom: 10,
  },
  alarmBody: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 60,
    lineHeight: 22,
  },
  buttonRow: { flexDirection: 'row', gap: 16, width: '100%' },
  btn: {
    flex: 1,
    paddingVertical: 24,
    borderRadius: 20,
    alignItems: 'center',
  },
  snoozeBtn: { backgroundColor: '#3B82F6' },
  stopBtn: { backgroundColor: '#F43F5E' },
  btnText: { color: '#FFF', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
});