/**
 * Decimal-safe money helpers.
 *
 * Every amount is an integer count of minor units (paisa for PKR at precision 2).
 * Quantities are integer thousandths, percentages are integer basis points
 * (1% = 100 bp). No floating-point arithmetic touches a financial value.
 */

export const QTY_SCALE = 1000;
export const BP_SCALE = 10000;

/** Divide with round-half-away-from-zero, entirely in BigInt. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

function toSafeNumber(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error('Amount out of range');
  return n;
}

/** a * b / scale, rounded half away from zero. */
export function mulDiv(a: number, b: number, scale: number): number {
  return toSafeNumber(divRound(BigInt(a) * BigInt(b), BigInt(scale)));
}

/** Parse a decimal string ("1,234.50") into an integer scaled by 10^decimals. Returns null if invalid. */
export function parseDecimal(input: string | number | null | undefined, decimals: number): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[,\s]/g, '');
  if (s === '') return null;
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const whole = m[2] === '' ? '0' : m[2];
  const fracRaw = m[3] ?? '';
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, '0');
  let v = BigInt(whole + frac);
  // round on the first dropped digit
  if (fracRaw.length > decimals && fracRaw.charCodeAt(decimals) >= 53) v += 1n;
  if (m[1] === '-') v = -v;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

/** "12.5" -> 12500 (thousandths) */
export const parseQty = (s: string | number | null | undefined) => parseDecimal(s, 3);
/** "12.5" percent -> 1250 basis points */
export const parsePercent = (s: string | number | null | undefined) => parseDecimal(s, 2);
/** "1500.50" -> 150050 at precision 2 */
export const parseMoney = (s: string | number | null | undefined, precision = 2) => parseDecimal(s, precision);

/** Render a scaled integer as a plain decimal string, trimming trailing zeros when `trim`. */
export function scaledToString(value: number, decimals: number, trim = false): string {
  const neg = value < 0;
  const digits = String(Math.abs(value)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  let frac = decimals > 0 ? digits.slice(-decimals) : '';
  if (trim) frac = frac.replace(/0+$/, '');
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
}

export const qtyToString = (q: number) => scaledToString(q, 3, true);
export const percentToString = (bp: number) => scaledToString(bp, 2, true);
export const moneyToInput = (minor: number, precision = 2) => scaledToString(minor, precision, true);

const SYMBOLS: Record<string, string> = { PKR: 'Rs.', USD: '$', EUR: '€', GBP: '£', AED: 'AED', SAR: 'SAR', INR: '₹' };

/** "Rs. 100,000" / "Rs. 1,250.50" — fraction shown only when non-zero unless `fixed`. */
export function formatMoney(minor: number, currency = 'PKR', precision = 2, fixed = false): string {
  // whole amounts show no decimals; anything else shows the full precision (1,250.50 not 1,250.5)
  const exact = scaledToString(Math.abs(minor), precision);
  const [whole, fracFull] = exact.split('.');
  const frac = fixed || /[1-9]/.test(fracFull ?? '') ? fracFull : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sym = SYMBOLS[currency] ?? currency;
  return `${minor < 0 ? '-' : ''}${sym} ${grouped}${frac ? '.' + frac : ''}`;
}
