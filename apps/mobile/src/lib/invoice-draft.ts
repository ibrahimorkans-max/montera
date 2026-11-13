import {
  computeInvoice,
  type Client,
  parseRate,
  precisionOf,
  rateToString,
  type Frequency,
  type Quotation,
  type RecurringInvoice,
  moneyToInput,
  parseMoney,
  parsePercent,
  parseQty,
  percentToString,
  qtyToString,
  type BusinessProfile,
  type DiscountType,
  type Invoice,
  type InvoiceTotals,
  type PaymentMethod,
  type Service,
} from './shared';

/** Form state of the invoice builder. Numbers stay as typed text until they are calculated or sent. */
export interface LineDraft {
  key: string;
  serviceId: string | null;
  name: string;
  description: string;
  qty: string;
  unit: string;
  unitPrice: string;
  discountType: DiscountType;
  discountValue: string;
  taxPercent: string;
}

export type PaymentMode = 'unpaid' | 'paid' | 'partial' | 'installments' | 'advance';

export interface InvoiceDraft {
  /** set when editing a draft that already exists on the server */
  id?: string;
  clientRequestId: string;
  businessId: string;
  clientId: string;
  clientName: string;
  issueDate: string;
  dueDate: string;
  reference: string;
  billingAddress: string;
  lines: LineDraft[];
  overallDiscountType: DiscountType;
  overallDiscountValue: string;
  charges: { key: string; label: string; amount: string }[];
  notes: string;
  paymentTerms: string;
  paymentMode: PaymentMode;
  payAmount: string;
  payMethod: PaymentMethod;
  payDate: string;
  payReference: string;
  installments: { key: string; dueDate: string; amount: string }[];
  /** recurring schedules only */
  schedule: RecurringDraft;
  /** invoice/quotation currency; empty = the business currency */
  currency: string;
  /** typed exchange rate (business currency per 1 unit), empty = latest recorded */
  fxRate: string;
}

export interface RecurringDraft {
  name: string;
  frequency: Frequency;
  interval: string;
  endDate: string;
  dueDays: string;
  autoIssue: boolean;
}

const emptySchedule = (): RecurringDraft => ({ name: '', frequency: 'monthly', interval: '1', endDate: '', dueDays: '15', autoIssue: false });

export const newKey = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const today = () => (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

export function emptyDraft(): InvoiceDraft {
  return {
    clientRequestId: `inv-${newKey()}`,
    businessId: '',
    clientId: '',
    clientName: '',
    issueDate: today(),
    dueDate: today(),
    reference: '',
    billingAddress: '',
    lines: [],
    overallDiscountType: 'percent',
    overallDiscountValue: '',
    charges: [],
    notes: '',
    paymentTerms: '',
    paymentMode: 'unpaid',
    payAmount: '',
    payMethod: 'cash',
    payDate: today(),
    payReference: '',
    installments: [],
    schedule: emptySchedule(),
    currency: '',
    fxRate: '',
  };
}

export function emptyLine(): LineDraft {
  return { key: newKey(), serviceId: null, name: '', description: '', qty: '1', unit: '', unitPrice: '', discountType: 'percent', discountValue: '', taxPercent: '' };
}

export function lineFromService(s: Service, precision: number): LineDraft {
  return {
    key: newKey(),
    serviceId: s.id,
    name: s.name,
    description: s.description,
    qty: '1',
    unit: s.unit,
    unitPrice: moneyToInput(s.defaultPrice, precision),
    discountType: 'percent',
    discountValue: s.defaultDiscountBp ? percentToString(s.defaultDiscountBp) : '',
    taxPercent: s.taxRateBp ? percentToString(s.taxRateBp) : '',
  };
}

export function draftFromInvoice(i: Invoice): InvoiceDraft {
  const p = i.currencyPrecision;
  return {
    ...emptyDraft(),
    id: i.id,
    clientRequestId: i.clientRequestId ?? `inv-${newKey()}`,
    businessId: i.businessId,
    clientId: i.clientId,
    clientName: i.clientName,
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    reference: i.reference,
    billingAddress: i.billingAddress,
    lines: i.lines.map((l) => ({
      key: newKey(),
      serviceId: l.serviceId,
      name: l.name,
      description: l.description,
      qty: qtyToString(l.qty),
      unit: l.unit,
      unitPrice: moneyToInput(l.unitPrice, p),
      discountType: l.discountType,
      discountValue: l.discountValue ? (l.discountType === 'percent' ? percentToString(l.discountValue) : moneyToInput(l.discountValue, p)) : '',
      taxPercent: l.taxRateBp ? percentToString(l.taxRateBp) : '',
    })),
    overallDiscountType: i.overallDiscountType,
    overallDiscountValue: i.overallDiscountValue ? (i.overallDiscountType === 'percent' ? percentToString(i.overallDiscountValue) : moneyToInput(i.overallDiscountValue, p)) : '',
    charges: i.charges.map((c) => ({ key: newKey(), label: c.label, amount: moneyToInput(c.amount, p) })),
    notes: i.notes,
    paymentTerms: i.paymentTerms,
    paymentMode: i.installments.length ? 'installments' : 'unpaid',
    installments: i.installments.map((s) => ({ key: newKey(), dueDate: s.dueDate, amount: moneyToInput(s.amount, p) })),
    currency: i.currency,
    fxRate: i.fxRate && i.fxRate !== 1_000_000 ? rateToString(i.fxRate) : '',
  };
}

/** Decimal places of the draft's own currency. */
export const draftPrecision = (d: InvoiceDraft, business: BusinessProfile | undefined) =>
  d.currency && business && d.currency !== business.currency ? precisionOf(d.currency) : (business?.currencyPrecision ?? 2);
/** Currency fields for the API: nothing when the draft is in the business currency. */
export function currencyFields(d: InvoiceDraft, business: BusinessProfile | undefined) {
  if (!d.currency || !business || d.currency === business.currency) return {};
  const rate = d.fxRate.trim() ? parseRate(d.fxRate) : null;
  return { currency: d.currency, ...(rate ? { fxRate: rate } : {}) };
}

const discount = (type: DiscountType, value: string, precision: number) => (type === 'percent' ? parsePercent(value) : parseMoney(value, precision)) ?? 0;

export function lineToApi(l: LineDraft, precision: number) {
  return {
    serviceId: l.serviceId,
    name: l.name.trim(),
    description: l.description.trim(),
    qty: parseQty(l.qty) ?? 0,
    unit: l.unit.trim(),
    unitPrice: parseMoney(l.unitPrice, precision) ?? 0,
    discountType: l.discountType,
    discountValue: Math.max(0, discount(l.discountType, l.discountValue, precision)),
    taxRateBp: Math.max(0, parsePercent(l.taxPercent) ?? 0),
  };
}

export function chargesToApi(d: InvoiceDraft, precision: number) {
  return d.charges
    .map((c) => ({ label: c.label.trim(), amount: parseMoney(c.amount, precision) ?? 0 }))
    .filter((c) => c.label && c.amount !== 0);
}

/** The same calculation the server runs, for the live total while typing. */
export function draftTotals(d: InvoiceDraft, business: BusinessProfile | undefined): InvoiceTotals {
  const precision = draftPrecision(d, business);
  return computeInvoice({
    lines: d.lines.map((l) => lineToApi(l, precision)),
    overallDiscountType: d.overallDiscountType,
    overallDiscountValue: Math.max(0, discount(d.overallDiscountType, d.overallDiscountValue, precision)),
    charges: chargesToApi(d, precision),
    taxInclusive: business?.taxInclusive ?? false,
    rounding: business?.rounding ?? 'none',
    precision,
  });
}

/** Amount of the payment recorded together with the invoice, in minor units. */
export function initialPaymentAmount(d: InvoiceDraft, total: number, precision: number): number {
  if (d.paymentMode === 'unpaid') return 0;
  if (d.paymentMode === 'paid') return total;
  return Math.max(0, parseMoney(d.payAmount, precision) ?? 0);
}

export function draftToBody(d: InvoiceDraft, business: BusinessProfile | undefined, finalize: boolean) {
  const precision = draftPrecision(d, business);
  const total = draftTotals(d, business).total;
  const paid = finalize ? initialPaymentAmount(d, total, precision) : 0;
  return {
    businessId: d.businessId,
    clientId: d.clientId,
    issueDate: d.issueDate,
    dueDate: d.dueDate,
    reference: d.reference.trim(),
    billingAddress: d.billingAddress.trim(),
    lines: d.lines.map((l) => lineToApi(l, precision)),
    overallDiscountType: d.overallDiscountType,
    overallDiscountValue: Math.max(0, discount(d.overallDiscountType, d.overallDiscountValue, precision)),
    charges: chargesToApi(d, precision),
    notes: d.notes.trim(),
    paymentTerms: d.paymentTerms.trim(),
    installments:
      d.paymentMode === 'installments'
        ? d.installments.map((s) => ({ dueDate: s.dueDate, amount: parseMoney(s.amount, precision) ?? 0 })).filter((s) => s.amount > 0)
        : [],
    clientRequestId: d.clientRequestId,
    ...currencyFields(d, business),
    finalize,
    ...(paid > 0
      ? { initialPayment: { amount: paid, date: d.payDate, method: d.payMethod, reference: d.payReference.trim(), notes: d.paymentMode === 'advance' ? 'Advance received' : '' } }
      : {}),
  };
}

/** The invoice as it will look once saved, for the document preview before anything is issued. */
export function draftPreview(d: InvoiceDraft, business: BusinessProfile, client: Client | undefined, canPay: boolean) {
  const precision = draftPrecision(d, business);
  const totals = draftTotals(d, business);
  const body = draftToBody(canPay ? d : { ...d, paymentMode: 'unpaid' }, business, true);
  const paid = Math.min(body.initialPayment?.amount ?? 0, totals.total);
  const invoice: Invoice = {
    ...body,
    id: 'preview',
    number: null,
    status: 'final',
    displayStatus: paid >= totals.total && totals.total > 0 ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid',
    clientName: client?.name ?? d.clientName,
    businessName: business.tradingName || business.legalName,
    lines: body.lines.map((l, n) => ({ ...l, lineTotal: totals.lines[n].net })),
    installments: body.installments.map((s) => ({ ...s, paid: 0, status: 'pending' as const })),
    currency: d.currency || business.currency,
    currencyPrecision: precision,
    taxInclusive: business.taxInclusive,
    rounding: business.rounding,
    subtotal: totals.subtotal,
    itemDiscounts: totals.itemDiscounts,
    overallDiscount: totals.overallDiscount,
    taxableAmount: totals.taxableAmount,
    taxAmount: totals.taxAmount,
    chargesTotal: totals.chargesTotal,
    roundingAdjustment: totals.roundingAdjustment,
    total: totals.total,
    paid,
    balance: totals.total - paid,
    createdAt: '',
    finalizedAt: null,
  };
  const blankClient: Client = {
    id: d.clientId, name: d.clientName, contactPerson: '', phone: '', whatsapp: '', email: '', cnic: '', ntn: '', address: '', city: '', province: '', country: '',
    extraAddresses: [], extraContacts: [], category: '', openingBalance: 0, creditLimit: 0, notes: '', status: 'active',
  };
  return { invoice, business, client: client ?? blankClient, payments: [] };
}

// ---------------------------------------------------------------- quotations

function linesFrom(lines: Quotation['lines'], p: number): LineDraft[] {
  return lines.map((l) => ({
    key: newKey(),
    serviceId: l.serviceId,
    name: l.name,
    description: l.description,
    qty: qtyToString(l.qty),
    unit: l.unit,
    unitPrice: moneyToInput(l.unitPrice, p),
    discountType: l.discountType,
    discountValue: l.discountValue ? (l.discountType === 'percent' ? percentToString(l.discountValue) : moneyToInput(l.discountValue, p)) : '',
    taxPercent: l.taxRateBp ? percentToString(l.taxRateBp) : '',
  }));
}

/** The builder keeps a quotation's validity date in `dueDate` and its terms in `paymentTerms`. */
export function draftFromQuote(q: Quotation): InvoiceDraft {
  const p = q.currencyPrecision;
  return {
    ...emptyDraft(),
    id: q.id,
    clientRequestId: q.clientRequestId ?? `qt-${newKey()}`,
    businessId: q.businessId,
    clientId: q.clientId,
    clientName: q.clientName,
    issueDate: q.issueDate,
    dueDate: q.validUntil,
    reference: q.reference,
    billingAddress: q.billingAddress,
    lines: linesFrom(q.lines, p),
    overallDiscountType: q.overallDiscountType,
    overallDiscountValue: q.overallDiscountValue ? (q.overallDiscountType === 'percent' ? percentToString(q.overallDiscountValue) : moneyToInput(q.overallDiscountValue, p)) : '',
    charges: q.charges.map((c) => ({ key: newKey(), label: c.label, amount: moneyToInput(c.amount, p) })),
    notes: q.notes,
    paymentTerms: q.terms,
    currency: q.currency,
  };
}

export function draftToQuoteBody(d: InvoiceDraft, business: BusinessProfile | undefined) {
  const precision = draftPrecision(d, business);
  return {
    businessId: d.businessId,
    clientId: d.clientId,
    issueDate: d.issueDate,
    validUntil: d.dueDate,
    reference: d.reference.trim(),
    billingAddress: d.billingAddress.trim(),
    lines: d.lines.map((l) => lineToApi(l, precision)),
    overallDiscountType: d.overallDiscountType,
    overallDiscountValue: Math.max(0, discount(d.overallDiscountType, d.overallDiscountValue, precision)),
    charges: chargesToApi(d, precision),
    notes: d.notes.trim(),
    terms: d.paymentTerms.trim(),
    clientRequestId: d.clientRequestId,
    ...currencyFields(d, business),
  };
}

/** The quotation as it will look once saved, for the preview before saving. */
export function quotePreview(d: InvoiceDraft, business: BusinessProfile, client: Client | undefined) {
  const doc = draftPreview({ ...d, paymentMode: 'unpaid' }, business, client, false);
  const totals = draftTotals(d, business);
  const quotation: Quotation = {
    ...draftToQuoteBody(d, business),
    id: 'preview',
    number: 'QT-…',
    status: 'draft',
    displayStatus: 'draft',
    clientName: doc.invoice.clientName,
    businessName: doc.invoice.businessName,
    lines: doc.invoice.lines,
    currency: d.currency || business.currency,
    currencyPrecision: draftPrecision(d, business),
    taxInclusive: business.taxInclusive,
    subtotal: totals.subtotal,
    itemDiscounts: totals.itemDiscounts,
    overallDiscount: totals.overallDiscount,
    taxableAmount: totals.taxableAmount,
    taxAmount: totals.taxAmount,
    chargesTotal: totals.chargesTotal,
    roundingAdjustment: totals.roundingAdjustment,
    total: totals.total,
    convertedInvoiceId: null,
    convertedInvoiceNumber: null,
    createdAt: '',
  };
  return { quotation, business, client: doc.client };
}

// ---------------------------------------------------------------- recurring invoices

/** The builder keeps a schedule's first run date in `issueDate`. */
export function draftFromRecurring(r: RecurringInvoice): InvoiceDraft {
  const p = r.currencyPrecision;
  return {
    ...emptyDraft(),
    id: r.id,
    businessId: r.businessId,
    clientId: r.clientId,
    clientName: r.clientName,
    issueDate: r.startDate,
    dueDate: r.startDate,
    reference: r.reference,
    billingAddress: r.billingAddress,
    lines: linesFrom(r.lines, p),
    overallDiscountType: r.overallDiscountType,
    overallDiscountValue: r.overallDiscountValue ? (r.overallDiscountType === 'percent' ? percentToString(r.overallDiscountValue) : moneyToInput(r.overallDiscountValue, p)) : '',
    charges: r.charges.map((c) => ({ key: newKey(), label: c.label, amount: moneyToInput(c.amount, p) })),
    notes: r.notes,
    paymentTerms: r.paymentTerms,
    schedule: { name: r.name, frequency: r.frequency, interval: String(r.interval), endDate: r.endDate ?? '', dueDays: String(r.dueDays), autoIssue: r.autoIssue },
  };
}

export function draftToRecurringBody(d: InvoiceDraft, business: BusinessProfile | undefined) {
  const precision = draftPrecision(d, business);
  return {
    name: d.schedule.name.trim(),
    businessId: d.businessId,
    clientId: d.clientId,
    reference: d.reference.trim(),
    billingAddress: d.billingAddress.trim(),
    lines: d.lines.map((l) => lineToApi(l, precision)),
    overallDiscountType: d.overallDiscountType,
    overallDiscountValue: Math.max(0, discount(d.overallDiscountType, d.overallDiscountValue, precision)),
    charges: chargesToApi(d, precision),
    notes: d.notes.trim(),
    paymentTerms: d.paymentTerms.trim(),
    frequency: d.schedule.frequency,
    interval: Math.max(1, Math.floor(Number(d.schedule.interval) || 1)),
    startDate: d.issueDate,
    endDate: d.schedule.endDate.trim() || null,
    dueDays: Math.max(0, Math.floor(Number(d.schedule.dueDays) || 0)),
    autoIssue: d.schedule.autoIssue,
  };
}
