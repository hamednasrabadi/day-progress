/**
 * Shared swatch grid used by every color picker in the app (Tasks, Projects,
 * Habits, Notes, Challenges). Centralizing it means the swatch size, the
 * selected-state treatment (ring + slight scale) and the tap haptic are
 * identical everywhere by construction — the pickers can't drift apart again.
 *
 * Sizing is RESPONSIVE: swatches are computed to fill the measured row width
 * with a consistent `gap`, clamped to [minSize, maxSize]. That keeps the row
 * tight and even on any screen — small phones shrink the swatches, large phones
 * grow them — instead of `space-between` leaving big holes between fixed-size
 * dots (the "too much empty space" problem).
 *
 * The palette is passed in (PALETTE / PROJECT_PALETTE / CHALLENGE_PALETTE from
 * lib/palette.ts), and `rows` controls the layout: 2 for the standard grids, 1
 * for the minimal project row.
 *
 * The component owns the haptic — callers should NOT fire their own on
 * `onChange`, or the tap will buzz twice.
 */
import React, { useState } from 'react';
import { View, TouchableOpacity, ViewStyle, LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';

type ColorPickerProps = {
  colors: string[];
  value: string;
  onChange: (color: string) => void;
  // Selected ring color — pass the theme's primary text color (theme.textMain).
  ringColor: string;
  // Faint edge so pale swatches read against the surface — pass theme.border.
  borderColor: string;
  rows?: number;       // default 2
  gap?: number;        // horizontal + vertical spacing, default 14
  minSize?: number;    // swatch clamp (small screens), default 28
  maxSize?: number;    // swatch clamp (large screens), default 46
  style?: ViewStyle;   // outer container style (margins, borders, etc.)
};

export function ColorPicker({
  colors, value, onChange, ringColor, borderColor,
  rows = 2, gap = 14, minSize = 28, maxSize = 46, style,
}: ColorPickerProps) {
  const [width, setWidth] = useState(0);
  const perRow = Math.ceil(colors.length / rows);
  const chunks: string[][] = [];
  for (let i = 0; i < colors.length; i += perRow) chunks.push(colors.slice(i, i + perRow));

  // Fill the measured width with `gap` spacing; clamp so it never gets silly.
  // Falls back to maxSize for the first frame before onLayout measures.
  const size = width > 0
    ? Math.max(minSize, Math.min(maxSize, Math.floor((width - gap * (perRow - 1)) / perRow)))
    : maxSize;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w && Math.abs(w - width) > 0.5) setWidth(w);
  };

  return (
    <View style={style} onLayout={onLayout}>
      {chunks.map((row, ri) => (
        <View
          key={ri}
          style={{ flexDirection: 'row', gap, marginBottom: ri === chunks.length - 1 ? 0 : gap }}
        >
          {row.map(c => {
            const selected = value === c;
            return (
              <TouchableOpacity
                key={c}
                activeOpacity={0.8}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(c); }}
                style={{
                  width: size, height: size, borderRadius: size / 2,
                  backgroundColor: c,
                  borderWidth: selected ? 2.5 : 0.5,
                  borderColor: selected ? ringColor : borderColor,
                  transform: [{ scale: selected ? 1.1 : 1 }],
                }}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}
