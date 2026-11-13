/** Recurring-invoice schedules, shared by the API (which generates invoices) and the app (which previews dates). */

export type Frequency = 'weekly' | 'monthly' | 'yearly' | 'custom';
export const FREQUENCY_LABELS: Record<Frequency, string> = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', custom: 'Every N days' };

function parts(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDaysIso(date: string, days: number): string {
  const { y, m, d } = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * The n-th run date (n = 0 is the start date). Months and years are counted from the start
 * date each time, so a schedule starting on the 31st runs on the last day of short months
 * and returns to the 31st afterwards instead of drifting.
 */
export function occurrence(start: string, frequency: Frequency, interval: number, n: number): string {
  const step = Math.max(1, Math.floor(interval));
  if (frequency === 'weekly') return addDaysIso(start, 7 * step * n);
  if (frequency === 'custom') return addDaysIso(start, step * n);
  const { y, m, d } = parts(start);
  const months = (frequency === 'yearly' ? 12 : 1) * step * n;
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return iso(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Human description such as "Every 2 months" or "Every week". */
export function describeSchedule(frequency: Frequency, interval: number): string {
  const n = Math.max(1, Math.floor(interval));
  const unit = { weekly: 'week', monthly: 'month', yearly: 'year', custom: 'day' }[frequency];
  return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
}
