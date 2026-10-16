import { Plus, X } from '@/components/icons';
import { WEEKDAYS, type HoursEntry } from '@/domain/hours';
import { cx } from './ui/cx';

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

/**
 * Weekly opening hours: each day is closed or has one or two time ranges
 * (e.g. a lunch and a dinner service).
 */
export function HoursEditor({ value, onChange, error }: { value: HoursEntry[]; onChange: (next: HoursEntry[]) => void; error?: string | null }) {
  const forDay = (day: number) => value.filter((e) => e.weekday === day).sort((a, b) => a.opens.localeCompare(b.opens));
  const replaceDay = (day: number, entries: HoursEntry[]) => onChange([...value.filter((e) => e.weekday !== day), ...entries]);

  const copyToAll = (day: number) => {
    const template = forDay(day);
    onChange(ORDER.flatMap((d) => template.map((e) => ({ ...e, weekday: d }))));
  };

  return (
    <div>
      <ul className="divide-y divide-line border-y border-line">
        {ORDER.map((day) => {
          const entries = forDay(day);
          const open = entries.length > 0;
          return (
            <li key={day} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
              <label className="flex w-36 shrink-0 items-center gap-3 pt-2.5">
                <input
                  type="checkbox"
                  className="size-5 accent-ink"
                  checked={open}
                  onChange={(e) => replaceDay(day, e.target.checked ? [{ weekday: day, opens: '08:00', closes: '20:00' }] : [])}
                />
                <span className="font-medium">{WEEKDAYS[day]}</span>
              </label>
              <div className="flex-1 space-y-2">
                {!open && <p className="pt-2.5 text-small text-ink-3 sm:pt-2.5">Closed</p>}
                {entries.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="time"
                      aria-label={`${WEEKDAYS[day]} opens`}
                      value={entry.opens}
                      onChange={(e) => replaceDay(day, entries.map((x, j) => (j === i ? { ...x, opens: e.target.value } : x)))}
                      className="h-11 rounded-control border border-line-strong px-2 tabular"
                    />
                    <span className="text-ink-3">to</span>
                    <input
                      type="time"
                      aria-label={`${WEEKDAYS[day]} closes`}
                      value={entry.closes}
                      onChange={(e) => replaceDay(day, entries.map((x, j) => (j === i ? { ...x, closes: e.target.value } : x)))}
                      className="h-11 rounded-control border border-line-strong px-2 tabular"
                    />
                    {entries.length > 1 && (
                      <button
                        type="button"
                        aria-label="Remove time range"
                        onClick={() => replaceDay(day, entries.filter((_, j) => j !== i))}
                        className="inline-flex size-10 items-center justify-center rounded-control text-ink-3 hover:bg-canvas"
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    )}
                  </div>
                ))}
                {open && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-small">
                    {entries.length < 2 && (
                      <button
                        type="button"
                        onClick={() => replaceDay(day, [...entries, { weekday: day, opens: '17:00', closes: '21:00' }])}
                        className="inline-flex items-center gap-1 font-semibold text-ink-2 hover:text-ink"
                      >
                        <Plus className="size-3.5" aria-hidden /> Add a split shift
                      </button>
                    )}
                    <button type="button" onClick={() => copyToAll(day)} className="font-semibold text-ink-2 hover:text-ink">
                      Copy to every day
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className={cx('mt-2 text-small', error ? 'text-danger' : 'text-ink-3')}>
        {error ?? 'Times are Philippine time. For hours past midnight, close at 11:59 PM and open the next day at 12:00 AM.'}
      </p>
    </div>
  );
}
