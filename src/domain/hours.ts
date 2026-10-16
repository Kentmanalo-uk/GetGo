export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface HoursEntry {
  weekday: number;
  opens: string; // HH:MM
  closes: string; // HH:MM
}

/** "07:30" or "07:30:00" → "7:30 AM" */
export function formatTime(value: string): string {
  const [h, m] = value.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export const trimSeconds = (value: string) => value.slice(0, 5);

export function validateHours(entries: HoursEntry[]): string | null {
  for (const e of entries) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.opens) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.closes)) {
      return `Enter valid times for ${WEEKDAYS[e.weekday]}.`;
    }
    if (e.closes <= e.opens) return `${WEEKDAYS[e.weekday]} must close after it opens.`;
  }
  const byDay = new Map<number, HoursEntry[]>();
  for (const e of entries) byDay.set(e.weekday, [...(byDay.get(e.weekday) ?? []), e]);
  for (const [day, list] of byDay) {
    const sorted = [...list].sort((a, b) => a.opens.localeCompare(b.opens));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].opens < sorted[i - 1].closes) return `${WEEKDAYS[day]} has overlapping hours.`;
    }
  }
  return null;
}

/** Groups consecutive days with identical hours: "Mon–Fri 7 AM – 9 PM". */
export function summarizeHours(entries: HoursEntry[]): Array<{ days: string; hours: string }> {
  const perDay = WEEKDAYS.map((_, day) =>
    entries
      .filter((e) => e.weekday === day)
      .sort((a, b) => a.opens.localeCompare(b.opens))
      .map((e) => `${formatTime(e.opens)} – ${formatTime(e.closes)}`)
      .join(', ') || 'Closed',
  );
  // Week shown Monday first.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const rows: Array<{ days: string; hours: string }> = [];
  let start = 0;
  for (let i = 1; i <= order.length; i++) {
    if (i === order.length || perDay[order[i]] !== perDay[order[start]]) {
      const first = WEEKDAYS_SHORT[order[start]];
      const last = WEEKDAYS_SHORT[order[i - 1]];
      rows.push({ days: start === i - 1 ? first : `${first}–${last}`, hours: perDay[order[start]] });
      start = i;
    }
  }
  return rows;
}

/** "Opens 7 AM", "Opens tomorrow 7 AM", "Opens Sat 7 AM" in Asia/Manila. */
export function describeNextOpen(iso: string | null, now = new Date()): string {
  if (!iso) return 'Closed';
  const date = new Date(iso);
  const fmtDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const time = date.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  const today = fmtDay(now);
  const tomorrow = fmtDay(new Date(now.getTime() + 86_400_000));
  if (fmtDay(date) === today) return `Opens ${time}`;
  if (fmtDay(date) === tomorrow) return `Opens tomorrow ${time}`;
  return `Opens ${date.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', weekday: 'short' })} ${time}`;
}

/** Today's date in Asia/Manila as YYYY-MM-DD. */
export function manilaToday(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}
