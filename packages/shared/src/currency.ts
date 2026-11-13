/** Currencies the app knows, with their minor-unit precision. Any other ISO code falls back to 2 decimals. */
export const CURRENCIES: { code: string; name: string; precision: number }[] = [
  { code: 'PKR', name: 'Pakistani Rupee', precision: 2 },
  { code: 'USD', name: 'US Dollar', precision: 2 },
  { code: 'EUR', name: 'Euro', precision: 2 },
  { code: 'GBP', name: 'British Pound', precision: 2 },
  { code: 'AED', name: 'UAE Dirham', precision: 2 },
  { code: 'SAR', name: 'Saudi Riyal', precision: 2 },
  { code: 'QAR', name: 'Qatari Riyal', precision: 2 },
  { code: 'KWD', name: 'Kuwaiti Dinar', precision: 3 },
  { code: 'OMR', name: 'Omani Rial', precision: 3 },
  { code: 'BHD', name: 'Bahraini Dinar', precision: 3 },
  { code: 'INR', name: 'Indian Rupee', precision: 2 },
  { code: 'BDT', name: 'Bangladeshi Taka', precision: 2 },
  { code: 'AFN', name: 'Afghan Afghani', precision: 2 },
  { code: 'CNY', name: 'Chinese Yuan', precision: 2 },
  { code: 'JPY', name: 'Japanese Yen', precision: 0 },
  { code: 'TRY', name: 'Turkish Lira', precision: 2 },
  { code: 'CAD', name: 'Canadian Dollar', precision: 2 },
  { code: 'AUD', name: 'Australian Dollar', precision: 2 },
];

export const precisionOf = (code: string) => CURRENCIES.find((c) => c.code === code)?.precision ?? 2;

/** Exchange rates are stored as integers: base currency units per 1 foreign unit, times one million. */
export const RATE_SCALE = 1_000_000;

/** "278.5" -> 278500000 */
export function parseRate(input: string): number | null {
  const s = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{0,6})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  const v = Number(w) * RATE_SCALE + Number(f.padEnd(6, '0'));
  return v > 0 && Number.isSafeInteger(v) ? v : null;
}

export function rateToString(rate: number): string {
  const w = Math.floor(rate / RATE_SCALE);
  const f = String(rate % RATE_SCALE).padStart(6, '0').replace(/0+$/, '');
  return f ? `${w}.${f}` : String(w);
}

/**
 * Convert minor units of one currency into minor units of the base currency.
 * `rate` is base units per 1 foreign unit (scaled by RATE_SCALE).
 */
export function toBase(minor: number, rate: number, fromPrecision: number, basePrecision: number): number {
  if (rate === RATE_SCALE && fromPrecision === basePrecision) return minor;
  const num = BigInt(minor) * BigInt(rate) * 10n ** BigInt(Math.max(0, basePrecision - fromPrecision));
  const den = BigInt(RATE_SCALE) * 10n ** BigInt(Math.max(0, fromPrecision - basePrecision));
  const neg = num < 0n;
  const n = neg ? -num : num;
  const q = (n * 2n + den) / (den * 2n);
  return Number(neg ? -q : q);
}

/**
 * Factor stored on each invoice and payment: base minor units per one million minor units
 * of the document's own currency. Lets reports convert with a single multiplication.
 */
export function minorFactor(rate: number, fromPrecision: number, basePrecision: number): number {
  return toBase(RATE_SCALE, rate, fromPrecision, basePrecision);
}

/** Financial-year label for a date, e.g. "2026-27" for a July–June year, or "2026" for a calendar year. */
export function financialYear(date: string, startMonth: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (startMonth <= 1) return String(y);
  const start = m >= startMonth ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
