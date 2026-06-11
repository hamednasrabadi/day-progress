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

import { useEffect, useMemo, useState } from 'react';
import { AppState, AppStateStatus, Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { ThemeProvider, DarkTheme, DefaultTheme } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import * as SystemUI from 'expo-system-ui';
import notifee, { EventType } from '@notifee/react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { preloadSounds } from '../lib/sounds';
import { ensureAppChannels } from '../lib/notifChannels';
import { useAppStore } from '../store/useAppStore';
import { Whisper } from '../components/Whisper';
import { GrowthIntro } from '../components/GrowthIntro';
import { UpdateBanner } from '../components/UpdateBanner';
import { getTheme } from '../lib/timelineTheme';
import { todayStr, EMPTY_APP_STATE_FOR_UNLOCKS, useDaysSinceInstall, useIsUnlocked, FEATURE_IDS } from '../lib/unlocks';
import { useUnlockTriggers } from '../lib/unlockTriggers';

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

  // ── First-launch growth intro ───────────────────────────────────────────
  // Gated on hydration so a returning user (introSeen restored from backup)
  // never sees a flash of the intro before persisted state loads. On a true
  // fresh install introSeen is false from the start, so it shows immediately.
  const [hydrated, setHydrated] = useState<boolean>(() => useAppStore.persist?.hasHydrated?.() ?? false);
  useEffect(() => {
    if (useAppStore.persist?.hasHydrated?.()) { setHydrated(true); return; }
    const unsub = useAppStore.persist?.onFinishHydration?.(() => setHydrated(true));
    return () => { unsub?.(); };
  }, []);
  const introSeen = useAppStore(s => s.introSeen);
  const setIntroSeen = useAppStore(s => s.setIntroSeen);
  const themeMode = useAppStore(s => s.themeMode);
  const theme = getTheme(themeMode);
  // expo-router sets no navigation theme, so React Navigation and the native
  // react-native-screens containers fall back to the light DefaultTheme — its
  // white `background` is what flashes through during the native screen
  // attach/detach on every tab switch. Hand the navigators a theme whose
  // background/card match the app's own bg per mode, so there's no light layer
  // left to show through.
  const navTheme = useMemo(() => {
    const base = theme.isDark ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: theme.bg, card: theme.bg } };
  }, [theme.isDark, theme.bg]);
  // navTheme above only recolors React Navigation's JS-level views. The NATIVE
  // root view sitting beneath the whole navigator keeps its default white, and
  // that's the sliver that still flashes through during the native screen
  // attach/detach on a tab switch (most visible now that freezeOnBlur detaches
  // off-screen tabs). Paint that native layer to match the active theme bg —
  // keyed on theme.bg so it tracks light/dark/blue switches.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.bg);
  }, [theme.bg]);
  const showIntro = hydrated && !introSeen;

  // ── Progressive-unlock plumbing ─────────────────────────────────────────
  // installDate stamps once (first launch ever, action is idempotent so
  // subsequent calls are no-ops). lastKnownDate advances on every foreground
  // event but only forward — the store's setLastKnownDate clamps against
  // backward clock manipulation. Both run on mount + each AppState.active
  // transition so the day counter stays honest across launches and
  // foreground-from-background cycles within the same calendar day.
  useEffect(() => {
    const stamp = () => {
      const today = todayStr();
      const s = useAppStore.getState();
      s.setInstallDate(today);
      s.setLastKnownDate(today);
    };
    stamp();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') stamp();
    });
    return () => sub.remove();
  }, []);

  // ── One-time birthday-notification purge ────────────────────────────────
  // The Birthdays feature was cut in the calm-pivot, but any yearly birthday
  // notifications a prior build scheduled are still live in the OS and would
  // fire forever. Cancel them by their `birthday-` identifier prefix — target-
  // safe, so habit / challenge / seal notifications are untouched. Gated by a
  // persisted flag so it runs once.
  useEffect(() => {
    if (useAppStore.getState().birthdayNotifsPurged) return;
    (async () => {
      try {
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        await Promise.all(
          scheduled
            .filter(n => typeof n.identifier === 'string' && n.identifier.startsWith('birthday-'))
            .map(n => Notifications.cancelScheduledNotificationAsync(n.identifier))
        );
      } catch {
        // Best-effort: if the query fails we leave the flag unset and retry next launch.
        return;
      }
      useAppStore.getState().markBirthdayNotifsPurged();
    })();
  }, []);

  // Trigger evaluator snapshot. Counters come from per-tab stores via narrow
  // selectors that return primitives — Zustand's shallow comparison means
  // root-layout re-renders only fire when a counter actually moves, not on
  // every unrelated store edit. As more tabs land their triggers, add their
  // counters here.
  const daysSinceInstall = useDaysSinceInstall();
  const totalTasksCreated = useAppStore(s => s.totalTasksCreated ?? 0);
  // Active = not completed and not archived (per the Tasks prompt's spec).
  // Intentionally broader than the in-tab `baseActiveTasks` which also drops
  // trash/resting — the gating is about "things demanding attention," not
  // the precise feed filter.
  const activeTaskCount = useAppStore(
    s => s.tasks.filter(t => !t.completed && t.status !== 'archived').length
  );
  // Timeline counters — primitives, so root only re-renders on actual change.
  const totalBlocksCreated = useAppStore(s => s.totalBlocksCreated ?? 0);
  const dayRatingsCount = useAppStore(s => s.dayRatingsCount ?? 0);
  const activeDaysWithBlock = useAppStore(s => s.activeDaysWithBlock ?? 0);
  // Notes counters + the derived sealingUnlocked flag (NOT a stored field —
  // derived from the SEALING unlock so it can't drift). CAPSULE_LOCK in the
  // Challenges tab reads sealingUnlocked from this snapshot.
  const totalNotesCreated = useAppStore(s => s.totalNotesCreated ?? 0);
  const diaryEntriesCreated = useAppStore(s => s.diaryEntriesCreated ?? 0);
  const sealingUnlocked = useIsUnlocked(FEATURE_IDS.SEALING);
  // Challenges + Habits counters. activeChallengesCount derived (active or
  // resurrected, not dead/buried/achieved/trash) — a primitive so root only
  // re-renders when the count moves.
  const totalChallengesCreated = useAppStore(s => s.totalChallengesCreated ?? 0);
  const activeChallengesCount = useAppStore(
    s => s.challenges.filter(c => c.deadState === 'active' || c.deadState === 'resurrected').length
  );
  const totalHabitsCreated = useAppStore(s => s.totalHabitsCreated ?? 0);
  const maxSingleHabitCompletions = useAppStore(s => s.maxSingleHabitCompletions ?? 0);
  const dayConqueredEver = useAppStore(s => s.dayConqueredEver ?? false);
  const unlockSnapshot = useMemo(() => ({
    ...EMPTY_APP_STATE_FOR_UNLOCKS,
    daysSinceInstall,
    totalTasksCreated,
    activeTaskCount,
    totalBlocksCreated,
    dayRatingsCount,
    activeDaysWithBlock,
    totalNotesCreated,
    diaryEntriesCreated,
    sealingUnlocked,
    totalChallengesCreated,
    activeChallengesCount,
    totalHabitsCreated,
    maxSingleHabitCompletions,
    dayConqueredEver,
  }), [daysSinceInstall, totalTasksCreated, activeTaskCount, totalBlocksCreated, dayRatingsCount, activeDaysWithBlock, totalNotesCreated, diaryEntriesCreated, sealingUnlocked, totalChallengesCreated, activeChallengesCount, totalHabitsCreated, maxSingleHabitCompletions, dayConqueredEver]);
  useUnlockTriggers(unlockSnapshot);

  // (The Challenges reveal is now anchored to installDate directly — see the gate
  // in app/(tabs)/challenges.tsx — so there's no first-appearance stamp to set.)

  useEffect(() => {
    // Create Android channels for habits / tasks / time-capsule reminders. All
    // are HIGH/MAX importance so they pop up as heads-up banners over whatever
    // the user is doing. Idempotent — safe to call on every mount. Timeline has
    // its own channels and creates them lazily on first sync.
    ensureAppChannels();
    // Preload UI sound effects so the first tap / completion plays with no lag.
    preloadSounds();

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
      {/* Normal app renders underneath. ThemeProvider hands React Navigation
          and the native react-native-screens containers a dark `background`
          (per mode) so no white DefaultTheme layer flashes through on switches. */}
      <ThemeProvider value={navTheme}>
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>

      {/* Global unlock toast — drops from the top on every screen when a feature
          unlocks; auto-dismisses. Reads the whisperQueue. Sits BELOW the alarm
          modal (separate RN portal layer, so zIndex doesn't compete). */}
      <Whisper />

      {/* First-launch growth intro — sets the "this app reveals itself" frame
          and offers the power-user "show me everything" fork. One-shot. */}
      <GrowthIntro
        visible={showIntro}
        theme={theme}
        onBegin={() => setIntroSeen(true)}
      />

      {/* "A new version is out" check — best-effort GitHub manifest fetch on launch.
          Renders nothing when up to date or offline; see lib/updateCheck. */}
      <UpdateBanner theme={theme} />

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