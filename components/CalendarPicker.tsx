/**
 * CalendarPicker — month grid date picker. Supports Gregorian + Shamsi.
 *
 * Originally inlined inside `app/(tabs)/todo.tsx`. Extracted here so Timeline can use it
 * for one-time block scheduling without code duplication. Todo tab still uses its local
 * copy for now; eventual cleanup can unify them.
 *
 * The theme prop accepts any object with the subset of color tokens this component needs.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export type CalendarSystem = 'gregorian' | 'shamsi';

type MinimalTheme = {
  bg: string;
  border: string;
  textMain: string;
  textSub: string;
};

const SHAMSI_MONTHS = ['Farvardin','Ordibehesht','Khordad','Tir','Mordad','Shahrivar','Mehr','Aban','Azar','Dey','Bahman','Esfand'];
const GREGORIAN_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Gregorian → Jalali. Input year/month/day in Gregorian (month 1-12), returns [jy, jm, jd].
export function g2j(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0,31,28,31,30,31,30,31,31,30,31,30,31];
  let jy, jm, jd;
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g_d_m.slice(0, gm).reduce((a, b) => a + b, 0);
  jy = -1595 + 33 * Math.floor(days / 12053); days %= 12053;
  jy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return [jy, jm, jd];
}

// Jalali → Gregorian. Input year/month/day in Jalali (month 1-12), returns [gy, gm, gd].
export function j2g(jy: number, jm: number, jd: number): [number, number, number] {
  let gy = (jy <= 979) ? 621 : 1600;
  jy -= (jy <= 979) ? 0 : 979;
  let days = (365 * jy) + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + 78 + jd + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
  gy += 400 * Math.floor(days / 146097); days %= 146097;
  if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const sal_a = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm: number;
  for (gm = 1; gm <= 12; gm++) { const v = sal_a[gm]; if (gd <= v) break; gd -= v; }
  return [gy, gm, gd];
}

type Props = {
  value: string;
  onChange: (next: string) => void;
  theme: MinimalTheme;
  calSystem: CalendarSystem;
  minDate?: string; // YYYY-MM-DD; dates before this are disabled
  // Default behavior is to disable any date earlier than today — Timeline's
  // "schedule a one-time block" use case. Diary backdating wants the
  // opposite: dates BEFORE today are exactly what's selectable. Setting
  // allowPast bypasses the past-disable check; combine with `maxDate` to
  // cap the range on the other side.
  allowPast?: boolean;
  // YYYY-MM-DD; dates after this are disabled. Pair with allowPast to make
  // a "past-only" picker (e.g. diary entries can't be in the future).
  maxDate?: string;
};

export const CalendarPicker: React.FC<Props> = ({ value, onChange, theme, calSystem, minDate, allowPast, maxDate }) => {
  const isShamsi = calSystem === 'shamsi';
  const today = new Date();

  const initView = () => {
    if (value) {
      const [gy, gm, gd] = value.split('-').map(Number);
      if (isShamsi) { const [jy, jm] = g2j(gy, gm, gd); return { y: jy, m: jm }; }
      return { y: gy, m: gm };
    }
    if (isShamsi) { const [jy, jm] = g2j(today.getFullYear(), today.getMonth() + 1, today.getDate()); return { y: jy, m: jm }; }
    return { y: today.getFullYear(), m: today.getMonth() + 1 };
  };

  const init = initView();
  const [vy, setVy] = useState(init.y);
  const [vm, setVm] = useState(init.m);

  const changeMonth = (dir: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    let nm = vm + dir;
    let ny = vy;
    if (nm > 12) { nm = 1; ny++; }
    else if (nm < 1) { nm = 12; ny--; }
    setVm(nm); setVy(ny);
  };

  const buildGrid = () => {
    if (isShamsi) {
      const dim = vm <= 6 ? 31 : vm <= 11 ? 30 : 29;
      const [gy, gm, gd] = j2g(vy, vm, 1);
      const first = new Date(gy, gm - 1, gd).getDay();
      const offset = (first + 1) % 7;
      return { dim, offset };
    }
    return { dim: new Date(vy, vm, 0).getDate(), offset: new Date(vy, vm - 1, 1).getDay() };
  };

  const { dim, offset } = buildGrid();
  const monthLabel = isShamsi ? `${SHAMSI_MONTHS[vm - 1]} ${vy}` : `${GREGORIAN_MONTHS[vm - 1]} ${vy}`;
  const wdays = isShamsi ? ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const isSelected = (d: number): boolean => {
    let gy = vy, gm = vm, gd = d;
    if (isShamsi) [gy, gm, gd] = j2g(vy, vm, d);
    return value === `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
  };

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  return (
    <View style={{ backgroundColor: theme.bg, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: theme.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <TouchableOpacity onPress={() => changeMonth(-1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={18} color={theme.textMain} />
        </TouchableOpacity>
        <Text style={{ color: theme.textMain, fontWeight: '900', fontSize: 13 }}>{monthLabel}</Text>
        <TouchableOpacity onPress={() => changeMonth(1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-right" size={18} color={theme.textMain} />
        </TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {wdays.map((d, i) => (
          <Text key={i} style={{ width: '14.28%', textAlign: 'center', color: theme.textSub, fontSize: 10, fontWeight: '900', paddingVertical: 4 }}>{d}</Text>
        ))}
        {Array.from({ length: offset }).map((_, i) => <View key={`b${i}`} style={{ width: '14.28%', height: 32 }} />)}
        {Array.from({ length: dim }, (_, i) => i + 1).map(d => {
          const sel = isSelected(d);
          let gy = vy, gm = vm, gd = d;
          if (isShamsi) [gy, gm, gd] = j2g(vy, vm, d);
          const thisStr = `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
          const isPast = !allowPast && new Date(gy, gm - 1, gd).getTime() < now.getTime();
          const beforeMin = !!minDate && thisStr < minDate;
          const afterMax = !!maxDate && thisStr > maxDate;
          const isDisabled = isPast || beforeMin || afterMax;
          return (
            <TouchableOpacity
              key={d}
              disabled={isDisabled}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(sel ? '' : thisStr); }}
              style={{ width: '14.28%', height: 32, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: sel ? theme.textMain : 'transparent', opacity: isDisabled ? 0.2 : 1 }}
            >
              <Text style={{ color: sel ? theme.bg : theme.textMain, fontWeight: sel ? '900' : '600', fontSize: 13 }}>{d}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};
