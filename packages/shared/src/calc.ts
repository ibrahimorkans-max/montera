import { BP_SCALE, QTY_SCALE, divRound, mulDiv } from './money';

export type DiscountType = 'percent' | 'fixed';
export type RoundingRule = 'none' | 'nearest_1' | 'nearest_5' | 'nearest_10';

export interface LineInput {
  /** integer thousandths */
  qty: number;
  /** minor units */
  unitPrice: number;
  discountType: DiscountType;
  /** basis points when percent, minor units when fixed */
  discountValue: number;
  /** basis points */
  taxRateBp: number;
}

export interface ChargeInput {
  label: string;
  /** minor units; may be negative for a custom adjustment */
  amount: number;
}

export interface InvoiceCalcInput {
  lines: LineInput[];
  overallDiscountType: DiscountType;
  overallDiscountValue: number;
  charges: ChargeInput[];
  taxInclusive: boolean;
  rounding: RoundingRule;
  /** currency decimal places, 0-3 */
  precision: number;
}

export interface LineTotals {
  gross: number;
  discount: number;
  /** gross - item discount; what the line shows as its total */
  net: number;
  /** net after this line's share of the overall discount */
  afterOverall: number;
  tax: number;
}

export interface InvoiceTotals {
  lines: LineTotals[];
  subtotal: number;
  itemDiscounts: number;
  overallDiscount: number;
  taxableAmount: number;
  taxAmount: number;
  chargesTotal: number;
  roundingAdjustment: number;
  total: number;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}

/** Split `amount` across `weights` proportionally; the parts always sum to `amount` (largest remainder). */
export function allocateProportionally(amount: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (amount === 0 || totalWeight === 0) return weights.map(() => 0);
  const A = BigInt(amount);
  const W = BigInt(totalWeight);
  const parts = weights.map((w) => {
    const p = BigInt(w) * A;
    return { floor: p / W, rem: p % W };
  });
  let left = A - parts.reduce((a, p) => a + p.floor, 0n);
  const order = parts.map((p, i) => i).sort((a, b) => (parts[b].rem > parts[a].rem ? 1 : parts[b].rem < parts[a].rem ? -1 : a - b));
  const out = parts.map((p) => p.floor);
  for (const i of order) {
    if (left <= 0n) break;
    out[i] += 1n;
    left -= 1n;
  }
  return out.map(Number);
}

export function computeInvoice(input: InvoiceCalcInput): InvoiceTotals {
  const lines: LineTotals[] = input.lines.map((l) => {
    const gross = mulDiv(l.qty, l.unitPrice, QTY_SCALE);
    const rawDiscount = l.discountType === 'percent' ? mulDiv(gross, clamp(l.discountValue, 0, BP_SCALE), BP_SCALE) : l.discountValue;
    const discount = clamp(rawDiscount, 0, Math.max(gross, 0));
    return { gross, discount, net: gross - discount, afterOverall: 0, tax: 0 };
  });

  const subtotal = lines.reduce((a, l) => a + l.gross, 0);
  const itemDiscounts = lines.reduce((a, l) => a + l.discount, 0);
  const netTotal = subtotal - itemDiscounts;

  const rawOverall =
    input.overallDiscountType === 'percent'
      ? mulDiv(netTotal, clamp(input.overallDiscountValue, 0, BP_SCALE), BP_SCALE)
      : input.overallDiscountValue;
  const overallDiscount = clamp(rawOverall, 0, Math.max(netTotal, 0));

  const shares = allocateProportionally(
    overallDiscount,
    lines.map((l) => Math.max(l.net, 0)),
  );

  let taxAmount = 0;
  lines.forEach((l, i) => {
    l.afterOverall = l.net - shares[i];
    const rate = Math.max(input.lines[i].taxRateBp, 0);
    if (rate > 0) {
      l.tax = input.taxInclusive
        ? l.afterOverall - Number(divRound(BigInt(l.afterOverall) * BigInt(BP_SCALE), BigInt(BP_SCALE + rate)))
        : mulDiv(l.afterOverall, rate, BP_SCALE);
    }
    taxAmount += l.tax;
  });

  const afterDiscounts = netTotal - overallDiscount;
  const taxableAmount = input.taxInclusive ? afterDiscounts - taxAmount : afterDiscounts;
  const chargesTotal = input.charges.reduce((a, c) => a + c.amount, 0);
  const unrounded = taxableAmount + taxAmount + chargesTotal;

  const step = { none: 0, nearest_1: 1, nearest_5: 5, nearest_10: 10 }[input.rounding] * 10 ** input.precision;
  const total = step > 0 ? Number(divRound(BigInt(unrounded), BigInt(step))) * step : unrounded;

  return {
    lines,
    subtotal,
    itemDiscounts,
    overallDiscount,
    taxableAmount,
    taxAmount,
    chargesTotal,
    roundingAdjustment: total - unrounded,
    total,
  };
}

export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid';

export function paymentStatus(total: number, paid: number): PaymentStatus {
  if (paid <= 0) return 'unpaid';
  return paid >= total ? 'paid' : 'partially_paid';
}

export interface InstallmentState {
  amount: number;
  paid: number;
  status: 'paid' | 'partial' | 'pending' | 'overdue';
}

/** Apply the amount paid on an invoice to its schedule, oldest instalment first. */
export function applyToInstallments(
  schedule: { amount: number; dueDate: string }[],
  paid: number,
  today: string,
): InstallmentState[] {
  let left = Math.max(paid, 0);
  return schedule.map((s) => {
    const p = Math.min(left, s.amount);
    left -= p;
    const status = p >= s.amount ? 'paid' : s.dueDate < today ? 'overdue' : p > 0 ? 'partial' : 'pending';
    return { amount: s.amount, paid: p, status };
  });
}
