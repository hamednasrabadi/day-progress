import { create } from 'zustand';

/**
 * Live, non-persisted measurement of the rendered tab-bar height.
 *
 * Why this exists: keyboard-anchored bars (the Tasks quick-add bar) need to know
 * exactly how far their resting bottom edge sits above the screen bottom, so a
 * KeyboardStickyView can rise to land them flush on top of the keyboard. That
 * distance equals the tab bar's REAL rendered height. useBottomTabBarHeight()
 * (the navigation hook) isn't pixel-identical to what AnimatedTabBar actually
 * paints — it misses the button padding + 1px top border + sub-pixel rounding,
 * which left the bar a few px off the keyboard no matter how the inset math was
 * tuned. So AnimatedTabBar measures itself via onLayout and writes the exact
 * height here; consumers read it back.
 *
 * Not persisted — purely a transient layout value, re-measured on every mount
 * and whenever insets change (rotation, system-bar changes). The 0.5px guard
 * stops sub-pixel onLayout jitter from triggering needless re-renders.
 */
type TabBarMetrics = {
  height: number;
  setHeight: (h: number) => void;
};

export const useTabBarMetrics = create<TabBarMetrics>((set) => ({
  height: 0,
  setHeight: (h) => set((s) => (Math.abs(s.height - h) > 0.5 ? { height: h } : s)),
}));
