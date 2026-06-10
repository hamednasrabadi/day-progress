/**
 * UpdateBanner — surfaces the "a new version is out" check (lib/updateCheck) as a
 * one-time launch modal. Soft by default: dismiss with "Later" and it's remembered
 * per-version, so it won't nag again until the next release. A manifest `min` above
 * this build (and a download url to send them to) flips it to a blocking prompt for
 * critical releases. Renders nothing when up to date, offline, or blocked.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Modal, View, Text, TouchableOpacity, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { type Theme, hexToRgba } from '../lib/timelineTheme';
import { checkForUpdate, getDismissedVersion, setDismissedVersion, type UpdateStatus } from '../lib/updateCheck';

export function UpdateBanner({ theme }: { theme: Theme }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await checkForUpdate();
      if (cancelled || !s) return;
      // Soft nudges respect a prior "Later" for the same version; forced ones don't.
      if (!s.mandatory && (await getDismissedVersion()) === s.latest) return;
      if (!cancelled) setStatus(s);
    })();
    return () => { cancelled = true; };
  }, []);

  const dismiss = useCallback(() => {
    if (status) setDismissedVersion(status.latest);
    setStatus(null);
  }, [status]);

  if (!status) return null;

  // Only truly block when we both require it AND have somewhere to send them —
  // a "required" manifest with no url would otherwise be a dead end.
  const blocking = status.mandatory && !!status.url;
  const accent = theme.success;
  const openUrl = () => { if (status.url) Linking.openURL(status.url).catch(() => {}); };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (!blocking) dismiss(); }}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 32 }}>
        <View style={{ width: '100%', maxWidth: 360, backgroundColor: theme.surface, borderRadius: 22, borderWidth: 1, borderColor: theme.border, padding: 26 }}>
          <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: hexToRgba(accent, 0.14), alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <Feather name="arrow-up-circle" size={22} color={accent} />
          </View>
          <Text style={{ color: theme.textMain, fontSize: 19, fontWeight: '800', letterSpacing: -0.3, marginBottom: 8 }}>
            {blocking ? 'Update required' : 'Update available'}
          </Text>
          <Text style={{ color: theme.textSub, fontSize: 14, fontWeight: '500', lineHeight: 21, marginBottom: 22 }}>
            A new version ({status.latest}) is out.{status.notes ? ` ${status.notes}` : ''}{blocking ? '\n\nThis update is required to keep going.' : ''}
          </Text>
          {status.url ? (
            <TouchableOpacity onPress={openUrl} activeOpacity={0.9} style={{ paddingVertical: 15, borderRadius: 14, backgroundColor: accent, alignItems: 'center', marginBottom: blocking ? 0 : 10 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '900', letterSpacing: 1 }}>UPDATE</Text>
            </TouchableOpacity>
          ) : null}
          {!blocking ? (
            <TouchableOpacity onPress={dismiss} hitSlop={10} style={{ paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '700' }}>Later</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
