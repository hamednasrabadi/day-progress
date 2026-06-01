/**
 * Weekly review window.
 *
 * The review prompt shows up IN the Habits tab content for a 30-hour window:
 * from 6pm on the user's chosen end-of-week day until the end of the NEXT day
 * (6pm + 30h = midnight after the following day). Inside that window the user
 * gets one chance to write a review; the submitted text is saved into the Notes
 * tab. This module only answers "is the window open right now, and which week
 * does it close?" — the keying matches the old weeklyReflections anchor (the
 * end-of-week DATE) so a reflection logged here lines up with prior entries.
 */

export type EndOfWeekDay = 'friday' | 'sunday';

export type WeeklyReviewWindow = {
  open: boolean;     // is now inside the 30h window?
  anchor: string;    // YYYY-MM-DD of the most recent end-of-week day (the key)
  opensAt: number;   // ms — anchor day at 18:00 local
  closesAt: number;  // ms — opensAt + 30h
};

const THIRTY_HOURS = 30 * 60 * 60 * 1000;

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Window for the most-recent end-of-week day relative to `now`.
 *
 * The window opens at 18:00 on that day and lasts 30h, so:
 *   - on the end-of-week day itself it's open from 6pm onward,
 *   - the day after it stays open until that day ends (midnight),
 *   - two+ days later it's closed.
 * Before 6pm on the end-of-week day the anchor points at today but `open` is
 * false (it hasn't opened yet) — the previous week's window closed days ago.
 */
export function getWeeklyReviewWindow(endOfWeekDay: EndOfWeekDay, now: Date = new Date()): WeeklyReviewWindow {
  const eowDow = endOfWeekDay === 'friday' ? 5 : 0; // JS getDay: Sun=0, Fri=5
  const daysSinceEnd = (now.getDay() - eowDow + 7) % 7; // 0 if today closes the week
  const anchorDate = new Date(now);
  anchorDate.setDate(now.getDate() - daysSinceEnd);
  anchorDate.setHours(18, 0, 0, 0); // opens at 6pm on the end-of-week day
  const opensAt = anchorDate.getTime();
  const closesAt = opensAt + THIRTY_HOURS;
  const t = now.getTime();
  return { open: t >= opensAt && t < closesAt, anchor: fmt(anchorDate), opensAt, closesAt };
}
