/**
 * DaySpine — the slim hour-ruler at the top of Timeline.
 *
 * Shows colored segments for every block in the selected day with a NOW pointer
 * for today. The visible range auto-fits: it expands ±1 hour past the earliest
 * and latest blocks so blocks never crowd the edges. Major ticks every 3 hours.
 *
 * Memoized — props change only when the displayed activities change or the
 * current hour shifts. Re-render is cheap regardless because the layout math
 * is O(blocks) and the JSX is flat.
 */

import React from 'react';
import { Dimensions, Text, TouchableOpacity, View } from 'react-native';
import type { Theme } from '../../lib/timelineTheme';

const { width: SW } = Dimensions.get('window');

type SpineActivity = {
  renderStart: number;
  renderEnd: number;
  color: string;
  id: string;
  isBled: boolean;
};

export const DaySpine = React.memo(function DaySpine({
  acts, currentHour, isTodaySelected, theme, onPress,
}: {
  acts: SpineActivity[];
  currentHour: number;
  isTodaySelected: boolean;
  theme: Theme;
  onPress: (id: string) => void;
}) {
  const earliest = acts.length > 0 ? Math.min(...acts.map(a => a.renderStart)) : 7;
  const latest = acts.length > 0 ? Math.max(...acts.map(a => a.renderEnd)) : 22;
  const rangeStart = Math.max(0, Math.floor(earliest) - 1);
  const rangeEnd = Math.min(24, Math.ceil(latest) + 1);
  const range = rangeEnd - rangeStart;
  const W = SW - 48;
  const toX = (h: number) => Math.max(0, Math.min(1, (h - rangeStart) / range)) * W;
  // Every integer hour in the visible range gets a gridline. Every 3rd hour is a "major" tick
  // (stronger line + a label below). Major ticks align with the hour labels row so the grid reads
  // as a structured ruler, not a bare pill.
  const hours = Array.from({ length: range + 1 }, (_, i) => i + rangeStart);
  const isDark = theme.isDark;
  const borderStrong = isDark ? '#2A2A2A' : '#D1D5DB';

  return (
    <View>
      {/* Ruler — hour gridlines + inset colored segments + NOW line. No now-hour bg highlight. */}
      <View style={{ height: 40, position: 'relative' }}>
        {hours.map((h, i) => {
          const major = (h - rangeStart) % 3 === 0;
          return (
            <View key={`grid-${i}`} style={{ position: 'absolute', left: toX(h), top: 0, bottom: 0, width: 1, backgroundColor: major ? borderStrong : theme.border, opacity: major ? 0.9 : 0.5 }} />
          );
        })}
        {acts.map((a, i) => {
          const cs = Math.max(rangeStart, a.renderStart);
          const ce = Math.min(rangeEnd, a.renderEnd);
          if (cs >= ce) return null;
          const left = toX(cs);
          const width = Math.max(toX(ce) - left, 4);
          const isActive = isTodaySelected && currentHour >= a.renderStart && currentHour < a.renderEnd;
          const isPast = isTodaySelected && currentHour >= a.renderEnd;
          return (
            <TouchableOpacity
              key={`sp-${a.id}-${i}`}
              onPress={() => onPress(a.id)}
              activeOpacity={0.7}
              style={{
                position: 'absolute', left, width, top: 6, bottom: 6,
                backgroundColor: a.color, borderRadius: 5,
                opacity: isPast ? 0.3 : isActive ? 1 : 0.82,
                // Soft glow on the active segment — signals "this is happening now" without a pill overlay
                shadowColor: a.color,
                shadowOpacity: isActive ? 0.5 : 0,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 0 },
                elevation: isActive ? 3 : 0,
              }}
            />
          );
        })}
        {isTodaySelected && currentHour >= rangeStart && currentHour <= rangeEnd && (
          <>
            {/* NOW pointer — circular cap above the ruler + vertical line through the segments. */}
            <View pointerEvents="none" style={{ position: 'absolute', left: toX(currentHour) - 4, top: -8, width: 8, height: 8, borderRadius: 4, backgroundColor: theme.textMain, zIndex: 11 }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: toX(currentHour) - 1, top: -4, bottom: -4, width: 2, backgroundColor: theme.textMain, zIndex: 10 }} />
          </>
        )}
      </View>
      {/* Hour labels below — only major ticks (every 3 hours) */}
      <View style={{ flexDirection: 'row', marginTop: 6, height: 12, position: 'relative' }}>
        {hours.map((h, i) => (
          (h - rangeStart) % 3 === 0 ? (
            <Text key={`lbl-${i}`} style={{ position: 'absolute', left: toX(h) - 8, width: 16, textAlign: 'center', color: theme.textSub, fontSize: 9, fontWeight: '800', opacity: 0.6, letterSpacing: 0.3 }}>
              {h === 24 ? '00' : String(h).padStart(2, '0')}
            </Text>
          ) : null
        ))}
      </View>
    </View>
  );
});
