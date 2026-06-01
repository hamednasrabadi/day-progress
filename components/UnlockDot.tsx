/**
 * UnlockDot — the small blue "new" indicator that surfaces next to any
 * just-unlocked UI element.
 *
 * Pure presentational. Reads `useIsNew(featureId)` from the unlock store
 * to decide whether to render at all; when the parent calls
 * `markDotSeen(featureId)` (typically in its onPress handler), the next
 * render returns null and the dot disappears.
 *
 * Positioning: absolute top: 0, right: 0 relative to the nearest
 * positioned ancestor. Call sites that want a flush-corner placement
 * should give their container `position: 'relative'`. For inline
 * placement (e.g. next to a section label), pass `inline` and the
 * absolute positioning is skipped — the dot becomes a normal flex child.
 */

import React from 'react';
import { View } from 'react-native';
import { useIsNew } from '../lib/unlocks';

type Props = {
  featureId: string;
  // When true, the dot renders as a regular flex child (no absolute
  // positioning) so it can sit inline alongside a label. Default false:
  // the dot anchors to its container's top-right corner.
  inline?: boolean;
  // Optional override for the marginLeft when inline — useful for tighter
  // packing next to short labels.
  inlineMargin?: number;
};

export function UnlockDot({ featureId, inline = false, inlineMargin = 6 }: Props) {
  const show = useIsNew(featureId);
  if (!show) return null;
  return (
    <View
      pointerEvents="none"
      style={
        inline
          ? { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2563EB', marginLeft: inlineMargin }
          : { position: 'absolute', top: 0, right: 0, width: 6, height: 6, borderRadius: 3, backgroundColor: '#2563EB' }
      }
    />
  );
}
