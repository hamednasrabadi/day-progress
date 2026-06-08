/**
 * PresetPickerSheet — bottom sheet for picking a curated challenge preset.
 *
 * Flow:
 *   - Tap a card → it expands to show the full description + footer
 *     "Add Challenge" button. Only one card open at a time. Tapping
 *     the same card collapses it.
 *   - Tap "Add Challenge" in the expanded card → the host creates the
 *     challenge directly (no editor pop-over) and the sheet dismisses.
 *
 * Filtering:
 *   - The picker thins out over time. Presets with an active or
 *     'achieved' challenge are HIDDEN. Buried (failed) and trashed
 *     (removed) presets remain in the catalogue and can be re-taken.
 *   - Each category section just hides empty when its filtered list
 *     is zero; categories whose presets are all taken disappear from
 *     the chip strip.
 *
 * Gesture detail:
 *   - The category chip strip uses BottomSheetScrollView with
 *     horizontal=true so its pan-handler coordinates with the sheet's
 *     vertical drag. A plain RN ScrollView at this position fights
 *     the sheet's gesture system and ends up non-interactive on some
 *     devices.
 */

import React, { forwardRef, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, LayoutAnimation } from 'react-native';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  CHALLENGE_PRESETS,
  PRESET_CATEGORIES,
  PresetCategory,
  ChallengePreset,
} from '../../lib/challengePresets';

type Theme = {
  bg: string;
  surface: string;
  border: string;
  textMain: string;
  textSub: string;
};

function hexToRgba(hex: string, a: number) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function difficultyLabel(d: ChallengePreset['difficulty']): string {
  return d === 'light' ? 'LIGHT' : d === 'moderate' ? 'MODERATE' : 'BRUTAL';
}

function difficultyColor(d: ChallengePreset['difficulty'], theme: Theme): string {
  if (d === 'brutal') return '#DC2626';
  if (d === 'moderate') return '#F59E0B';
  return theme.textSub;
}

type Props = {
  theme: Theme;
  takenPresetIds: Set<string>;
  onPick: (preset: ChallengePreset) => void;
};

export const PresetPickerSheet = forwardRef<BottomSheetModal, Props>(({ theme, takenPresetIds, onPick }, ref) => {
  // Filter the master list once per render so chip-counts and visible
  // cards always agree.
  const availablePresets = useMemo(
    () => CHALLENGE_PRESETS.filter(p => !takenPresetIds.has(p.id)),
    [takenPresetIds]
  );

  // Categories that still have at least one un-taken preset. Empty
  // categories drop out so the user isn't tapping into "no presets
  // here" rooms.
  const activeCategories = useMemo(
    () => PRESET_CATEGORIES.filter(cat => availablePresets.some(p => p.category === cat.id)),
    [availablePresets]
  );

  const [activeCat, setActiveCat] = useState<PresetCategory>('body');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // If the user's last selected category drops out (because they
  // claimed its only preset), fall back to the first available
  // category. Avoids "I see chips but no cards" empty states.
  const effectiveCat = useMemo(
    () => (activeCategories.some(c => c.id === activeCat) ? activeCat : (activeCategories[0]?.id ?? 'body')),
    [activeCat, activeCategories]
  );

  const visiblePresets = useMemo(
    () => availablePresets.filter(p => p.category === effectiveCat),
    [availablePresets, effectiveCat]
  );

  const renderBackdrop = (props: any) => (
    <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.6} />
  );

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={['92%']}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.surface, borderRadius: 32 }}
      handleIndicatorStyle={{ backgroundColor: theme.border, width: 40, height: 5 }}
      onDismiss={() => setExpandedId(null)}
    >
      {/* Sheet title — single line, matching the visual register of
          Storage and other sheet headers across the app (28pt, 900,
          letterSpacing -1, period suffix). */}
      <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 }}>
        <Text style={{ fontSize: 28, fontWeight: '900', color: theme.textMain, letterSpacing: -1 }}>
          Presets.
        </Text>
      </View>

      {availablePresets.length === 0 ? (
        // Empty state: every preset has been taken or completed. The
        // catalogue is supposed to thin out — this is the win state.
        <View style={{ paddingHorizontal: 32, paddingTop: 60, alignItems: 'center' }}>
          <Feather name="check-circle" size={36} color={theme.textSub} style={{ opacity: 0.2, marginBottom: 16 }} />
          <Text style={{ color: theme.textMain, fontSize: 16, fontWeight: '900', textAlign: 'center', marginBottom: 8 }}>Catalogue cleared.</Text>
          <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '500', textAlign: 'center', lineHeight: 19 }}>
            Every preset is either active or already won. Build a custom challenge from the + button.
          </Text>
        </View>
      ) : (
        <>
          {/* Category chip strip — react-native-gesture-handler's
              ScrollView. BottomSheetScrollView with horizontal=true
              fights the sheet's vertical drag handler at scroll
              start (every initial swipe was being interpreted as a
              dismiss attempt and snapped back, producing the jump-
              at-start the user reported). The GH variant cooperates
              with the same gesture handler tree without claiming
              "primary scroll" semantics. */}
          <View style={{ height: 44 }}>
            <GHScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 8, alignItems: 'center' }}
            >
              {activeCategories.map(cat => {
                const isActive = cat.id === effectiveCat;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setActiveCat(cat.id);
                      setExpandedId(null);
                    }}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 100,
                      backgroundColor: isActive ? theme.textMain : 'transparent',
                      borderWidth: 1,
                      borderColor: isActive ? theme.textMain : theme.border,
                    }}
                  >
                    <Text style={{ color: isActive ? theme.bg : theme.textMain, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 }}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </GHScrollView>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 4, paddingBottom: 10 }}>
            <Text style={{ color: theme.textMain, fontSize: 13, fontWeight: '900', letterSpacing: 1.5 }}>
              {(activeCategories.find(c => c.id === effectiveCat)?.label || '').toUpperCase()}
            </Text>
            <Text style={{ color: theme.textSub, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>
              {visiblePresets.length} {visiblePresets.length === 1 ? 'PRESET' : 'PRESETS'}
            </Text>
          </View>

          <BottomSheetScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}
          >
            {visiblePresets.map(preset => {
              const isExpanded = expandedId === preset.id;
              const dColor = difficultyColor(preset.difficulty, theme);
              return (
                <View
                  key={preset.id}
                  style={{
                    marginBottom: 10,
                    backgroundColor: theme.bg,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderLeftWidth: 4,
                    borderColor: isExpanded ? preset.color : theme.border,
                    borderLeftColor: preset.color,
                    overflow: 'hidden',
                  }}
                >
                  {/* Header row — the tap target for collapsing/expanding. */}
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                      setExpandedId(isExpanded ? null : preset.id);
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 }}>
                      <View
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 11,
                          backgroundColor: hexToRgba(preset.color, 0.14),
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Feather name={preset.icon} size={17} color={preset.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: theme.textMain,
                            fontSize: 15,
                            fontWeight: '900',
                            letterSpacing: -0.2,
                            marginBottom: 3,
                          }}
                        >
                          {preset.name}
                        </Text>
                        <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600', lineHeight: 17 }} numberOfLines={isExpanded ? undefined : 1}>
                          {preset.blurb}
                        </Text>
                      </View>
                      <Feather
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={theme.textSub}
                      />
                    </View>

                    {/* Meta strip — always visible, sits under the header. */}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingHorizontal: 16,
                        paddingBottom: isExpanded ? 12 : 14,
                        flexWrap: 'wrap',
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Feather name="target" size={11} color={theme.textSub} />
                        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700' }}>
                          {preset.target} {preset.unit}
                        </Text>
                      </View>
                      <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.border }} />
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Feather name="calendar" size={11} color={theme.textSub} />
                        <Text style={{ color: theme.textSub, fontSize: 11, fontWeight: '700' }}>
                          {preset.durationDays === 1 ? '1 day' : `${preset.durationDays} days`}
                        </Text>
                      </View>
                      <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.border }} />
                      <Text style={{ color: dColor, fontSize: 10, fontWeight: '900', letterSpacing: 1 }}>
                        {difficultyLabel(preset.difficulty)}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {/* Expanded body — full description, milestones, and the
                      footer commit. Footer styling matches the app's
                      premium-action pattern (terminal-feeling: thick
                      letter-spacing, hard-cut button, no rounded pill). */}
                  {isExpanded ? (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 14 }}>
                      <View style={{ height: 1, backgroundColor: theme.border, marginBottom: 4 }} />
                      <Text style={{ color: theme.textMain, fontSize: 13, lineHeight: 20, fontWeight: '500' }}>
                        {preset.explainer}
                      </Text>
                      {preset.milestones && preset.milestones.length > 0 ? (
                        <View>
                          <Text style={{ color: theme.textSub, fontSize: 9, fontWeight: '900', letterSpacing: 1.5, marginBottom: 8 }}>
                            MILESTONES
                          </Text>
                          {preset.milestones.map(m => (
                            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: preset.color }} />
                              <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600' }}>{m.text}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      <TouchableOpacity
                        onPress={() => {
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          onPick(preset);
                        }}
                        style={{
                          paddingVertical: 16,
                          borderRadius: 4,
                          borderWidth: 1,
                          borderColor: preset.color,
                          alignItems: 'center',
                          marginTop: 8,
                          backgroundColor: hexToRgba(preset.color, 0.08),
                        }}
                      >
                        <Text style={{ color: preset.color, fontSize: 13, fontWeight: '900', letterSpacing: 3 }}>
                          ADD CHALLENGE
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              );
            })}

            <Text
              style={{
                color: theme.textSub,
                fontSize: 11,
                fontWeight: '600',
                textAlign: 'center',
                marginTop: 14,
                opacity: 0.5,
                paddingHorizontal: 30,
                lineHeight: 17,
              }}
            >
              Won presets disappear from this list. Failed and removed ones return.
            </Text>
          </BottomSheetScrollView>
        </>
      )}
    </BottomSheetModal>
  );
});

PresetPickerSheet.displayName = 'PresetPickerSheet';
