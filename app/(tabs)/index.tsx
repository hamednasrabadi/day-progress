import { Redirect } from 'expo-router';

/**
 * (tabs) group index — the "/" landing route.
 *
 * Timeline used to live here and was the app's landing screen; it was removed in
 * the calm-pivot. Deleting it left "/" (and the "/(tabs)" group root that
 * challenges.tsx redirects to on day < 2) with no matching route, which is the
 * "Unmatched Route — page could not be found" error on cold start.
 *
 * This redirect restores a real index so both paths resolve. It sends them to
 * the anchor tab (Habits — see unstable_settings.initialRouteName in _layout).
 * Registered with href:null in the tab layout so it never shows as a tab.
 */
export default function TabsIndex() {
  return <Redirect href={'/(tabs)/habits' as any} />;
}
