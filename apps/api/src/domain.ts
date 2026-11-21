import { z } from 'zod';
import {
  DASHBOARD_STYLES,
  RATE_SCALE,
  financialYear,
  minorFactor,
  precisionOf,
  INVOICE_TEMPLATES,
  PAYMENT_METHODS,
  applyToInstallments,
  computeInvoice,
  type BusinessProfile,
  type Client,
  type ClientLedger,
  type DashboardSummary,
  type InstallmentRow,
  type Invoice,
  type InvoiceDisplayStatus,
  type LedgerEntry,
  type Payment,
  type Service,
} from '../../../packages/shared/src/index';
import { HttpError, type AuthContext } from './perm';
import { accountTypeFor, defaultAccount, ensureAccounts, ownedAccount } from './accounts';
import { Converter, findRate, inBase, reportingCurrency } from './fx';
import { totalCash } from './accounts';
import { now, today, uid, type Db, type Row } from './core';

// ---------------------------------------------------------------- schemas

const text = (max = 500) => z.string().trim().max(max).default('');
const image = z.string().max(1_500_000).default(''); // data URI
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.number().int().min(0).max(1e13);
const bp = z.number().int().min(0).max(10000);

export const businessSchema = z.object({
  legalName: z.string().trim().min(1, 'Legal business name is required').max(200),
  tradingName: text(200),
  ownerName: text(200),
  logo: image,
  registrationNo: text(100),
  ntn: text(100),
  phone: text(50),
  whatsapp: text(50),
  email: text(200),
  address: text(1000),
  website: text(200),
  bankDetails: text(1000),
  iban: text(64),
  paymentInstructions: text(2000),
  signature: image,
  stamp: image,
  invoiceFooter: text(2000),
  invoiceDisclaimer: text(2000),
  currency: z.string().trim().min(3).max(3).toUpperCase().default('PKR'),
  currencyPrecision: z.number().int().min(0).max(3).default(2),
  invoicePrefix: z.string().trim().max(12).default('INV-'),
  taxInclusive: z.boolean().default(false),
  rounding: z.enum(['none', 'nearest_1', 'nearest_5', 'nearest_10']).default('none'),
  invoiceTemplate: z.enum(INVOICE_TEMPLATES).default('amber'),
  accentColor: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, 'Use a colour like #1F4E9C').default(''),
  fyStartMonth: z.number().int().min(1).max(12).default(7),
  numberReset: z.enum(['never', 'yearly']).default('never'),
  dashboardStyle: z.enum(DASHBOARD_STYLES).default('monetra'),
  status: z.enum(['active', 'inactive']).default('active'),
});

export const clientSchema = z.object({
  name: z.string().trim().min(1, 'Client name is required').max(200),
  contactPerson: text(200),
  phone: text(50),
  whatsapp: text(50),
  email: text(200),
  cnic: text(50),
  ntn: text(50),
  address: text(1000),
  city: text(100),
  province: text(100),
  country: text(100),
  extraAddresses: z.array(z.string().trim().max(1000)).max(20).default([]),
  extraContacts: z.array(z.object({ name: text(200), phone: text(50) })).max(20).default([]),
  category: text(100),
  openingBalance: z.number().int().min(-1e13).max(1e13).default(0),
  creditLimit: z.number().int().min(0).max(1e13).default(0),
  notes: text(4000),
  status: z.enum(['active', 'inactive']).default('active'),
});

export const serviceSchema = z.object({
  name: z.string().trim().min(1, 'Service name is required').max(200),
  category: text(100),
  description: text(2000),
  defaultPrice: money.default(0),
  unit: text(30),
  taxRateBp: bp.default(0),
  defaultDiscountBp: bp.default(0),
  status: z.enum(['active', 'inactive']).default('active'),
});

const lineSchema = z.object({
  serviceId: z.string().nullable().default(null),
  name: z.string().trim().min(1, 'Item name is required').max(200),
  description: text(2000),
  qty: z.number().int().min(1, 'Quantity must be above zero').max(1e12),
  unit: text(30),
  unitPrice: money,
  discountType: z.enum(['percent', 'fixed']).default('percent'),
  discountValue: money.default(0),
  taxRateBp: bp.default(0),
});

const initialPaymentSchema = z.object({
  amount: z.number().int().min(1).max(1e13),
  date: isoDate,
  method: z.enum(PAYMENT_METHODS),
  reference: text(200),
  notes: text(2000),
});

export const lineSchemaPublic = () => lineSchema;
export const invoiceSchema = z.object({
  businessId: z.string().min(1, 'Choose the issuing business'),
  clientId: z.string().min(1, 'Choose a client'),
  issueDate: isoDate,
  dueDate: isoDate,
  reference: text(200),
  billingAddress: text(1000),
  lines: z.array(lineSchema).max(500),
  overallDiscountType: z.enum(['percent', 'fixed']).default('percent'),
  overallDiscountValue: money.default(0),
  charges: z.array(z.object({ label: z.string().trim().min(1).max(100), amount: z.number().int().min(-1e13).max(1e13) })).max(50).default([]),
  notes: text(4000),
  paymentTerms: text(2000),
  installments: z.array(z.object({ dueDate: isoDate, amount: z.number().int().min(1).max(1e13) })).max(120).default([]),
  clientRequestId: z.string().min(8).max(64).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  fxRate: z.number().int().min(1).max(1e15).optional(),
  overrideCreditLimit: z.boolean().default(false),
  finalize: z.boolean().default(false),
  initialPayment: initialPaymentSchema.optional(),
});
export type InvoiceBody = z.infer<typeof invoiceSchema>;

export const installmentsSchema = z.object({ installments: invoiceSchema.shape.installments });

export const paymentSchema = z.object({
  clientId: z.string().min(1),
  businessId: z.string().min(1),
  invoiceId: z.string().nullable().optional(),
  amount: z.number().int().min(1, 'Amount must be above zero').max(1e13),
  date: isoDate,
  method: z.enum(PAYMENT_METHODS),
  reference: text(200),
  notes: text(2000),
  proof: image,
  clientRequestId: z.string().min(8).max(64).optional(),
  allocations: z.array(z.object({ invoiceId: z.string().min(1), amount: z.number().int().min(1).max(1e13) })).max(200).optional(),
  autoAllocate: z.boolean().default(false),
  accountId: z.string().nullable().optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
});
export type PaymentBody = z.infer<typeof paymentSchema>;

// ---------------------------------------------------------------- mappers

export function mapBusiness(r: Row): BusinessProfile {
  return {
    id: r.id,
    legalName: r.legal_name,
    tradingName: r.trading_name,
    ownerName: r.owner_name,
    logo: r.logo,
    registrationNo: r.registration_no,
    ntn: r.ntn,
    phone: r.phone,
    whatsapp: r.whatsapp,
    email: r.email,
    address: r.address,
    website: r.website,
    bankDetails: r.bank_details,
    iban: r.iban,
    paymentInstructions: r.payment_instructions,
    signature: r.signature,
    stamp: r.stamp,
    invoiceFooter: r.invoice_footer,
    invoiceDisclaimer: r.invoice_disclaimer ?? '',
    currency: r.currency,
    currencyPrecision: r.currency_precision,
    invoicePrefix: r.invoice_prefix,
    taxInclusive: !!r.tax_inclusive,
    rounding: r.rounding,
    invoiceTemplate: r.invoice_template,
    accentColor: r.accent_color,
    fyStartMonth: r.fy_start_month,
    numberReset: r.number_reset,
    dashboardStyle: r.dashboard_style,
    status: r.status,
  };
}

export function mapClient(r: Row): Client {
  return {
    id: r.id,
    name: r.name,
    contactPerson: r.contact_person,
    phone: r.phone,
    whatsapp: r.whatsapp,
    email: r.email,
    cnic: r.cnic,
    ntn: r.ntn,
    address: r.address,
    city: r.city,
    province: r.province,
    country: r.country,
    extraAddresses: JSON.parse(r.extra_addresses),
    extraContacts: JSON.parse(r.extra_contacts),
    category: r.category,
    openingBalance: r.opening_balance,
    creditLimit: r.credit_limit,
    notes: r.notes,
    status: r.status,
    outstanding: r.outstanding === undefined ? undefined : Math.round(r.outstanding),
    credit: r.credit === undefined ? undefined : Math.round(r.credit),
  };
}

export function mapService(r: Row): Service {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    description: r.description,
    defaultPrice: r.default_price,
    unit: r.unit,
    taxRateBp: r.tax_rate_bp,
    defaultDiscountBp: r.default_discount_bp,
    status: r.status,
  };
}

/** Invoices with their client, business and the amount confirmed against them. Always filter by i.tenant_id. */
export const INVOICE_SELECT = `
  select i.*, c.name as client_name,
    case when b.trading_name <> '' then b.trading_name else b.legal_name end as business_name,
    coalesce((select sum(a.amount) from payment_allocation a join payment p on p.id = a.payment_id
              where a.invoice_id = i.id and p.verification_status <> 'rejected'), 0) as paid
  from invoice i join client c on c.id = i.client_id join business b on b.id = i.business_id`;

function displayStatus(r: Row): InvoiceDisplayStatus {
  if (r.status !== 'final') return r.status;
  if (r.paid >= r.total) return 'paid';
  if (r.due_date < today()) return 'overdue';
  return r.paid > 0 ? 'partially_paid' : 'unpaid';
}

export function mapInvoice(r: Row, installmentRows: Row[] = []): Invoice {
  const scheduleSum = installmentRows.reduce((a, x) => a + x.amount, 0);
  // Money first covers the unscheduled part of the invoice, then instalments oldest first.
  const towardSchedule = Math.max(0, r.paid - Math.max(0, r.total - scheduleSum));
  const states = applyToInstallments(
    installmentRows.map((x) => ({ amount: x.amount, dueDate: x.due_date })),
    towardSchedule,
    today(),
  );
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    displayStatus: displayStatus(r),
    businessId: r.business_id,
    businessName: r.business_name,
    clientId: r.client_id,
    clientName: r.client_name,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    reference: r.reference,
    billingAddress: r.billing_address,
    lines: JSON.parse(r.lines),
    overallDiscountType: r.overall_discount_type,
    overallDiscountValue: r.overall_discount_value,
    charges: JSON.parse(r.charges),
    notes: r.notes,
    paymentTerms: r.payment_terms,
    installments: installmentRows.map((x, i) => ({ id: x.id, dueDate: x.due_date, amount: x.amount, paid: states[i].paid, status: states[i].status })),
    clientRequestId: r.client_request_id ?? undefined,
    currency: r.currency,
    currencyPrecision: r.currency_precision,
    fxRate: r.fx_rate,
    taxInclusive: !!r.tax_inclusive,
    rounding: r.rounding,
    subtotal: r.subtotal,
    itemDiscounts: r.item_discounts,
    overallDiscount: r.overall_discount,
    taxableAmount: r.taxable_amount,
    taxAmount: r.tax_amount,
    chargesTotal: r.charges_total,
    roundingAdjustment: r.rounding_adjustment,
    total: r.total,
    paid: r.status === 'final' ? r.paid : 0,
    balance: r.status === 'final' ? r.total - r.paid : 0,
    createdAt: r.created_at,
    finalizedAt: r.finalized_at,
  };
}

const PAYMENT_SELECT = `
  select p.id, p.tenant_id, p.number, p.client_id, p.business_id, p.amount, p.date, p.method, p.reference, p.notes,
    p.received_by_name, p.verification_status, p.created_at, (p.proof <> '') as has_proof,
    c.name as client_name, coalesce(p.currency, b.currency) as currency, coalesce(p.currency_precision, b.currency_precision) as currency_precision,
    p.account_id, coalesce(acc.name, '') as account_name, p.fx_factor
  from payment p join client c on c.id = p.client_id join business b on b.id = p.business_id left join money_account acc on acc.id = p.account_id`;

function mapPayments(db: Db, rows: Row[]): Payment[] {
  return rows.map((r) => {
    const allocations = db
      .all(
        'select a.invoice_id, a.amount, i.number from payment_allocation a join invoice i on i.id = a.invoice_id where a.payment_id = ? order by a.created_at',
        r.id,
      )
      .map((a) => ({ invoiceId: a.invoice_id, invoiceNumber: a.number, amount: a.amount }));
    const allocated = allocations.reduce((s, a) => s + a.amount, 0);
    return {
      id: r.id,
      number: r.number,
      clientId: r.client_id,
      clientName: r.client_name,
      businessId: r.business_id,
      amount: r.amount,
      date: r.date,
      method: r.method,
      reference: r.reference,
      notes: r.notes,
      receivedBy: r.received_by_name,
      verificationStatus: r.verification_status,
      hasProof: !!r.has_proof,
      allocations,
      unallocated: r.verification_status === 'rejected' ? 0 : r.amount - allocated,
      currency: r.currency,
      currencyPrecision: r.currency_precision,
      accountId: r.account_id,
      accountName: r.account_name,
      createdAt: r.created_at,
    };
  });
}

// ---------------------------------------------------------------- lookups

export function ownedRow(db: Db, table: 'business' | 'client' | 'service' | 'invoice' | 'payment' | 'quotation' | 'recurring_invoice', tenantId: string, id: string): Row {
  const row = db.get(`select * from ${table} where id = ? and tenant_id = ?`, id, tenantId);
  if (!row) throw new HttpError(404, 'Record not found.');
  return row;
}

export function getInvoice(db: Db, tenantId: string, id: string): Invoice {
  const r = db.get(`${INVOICE_SELECT} where i.tenant_id = ? and i.id = ?`, tenantId, id);
  if (!r) throw new HttpError(404, 'Invoice not found.');
  return mapInvoice(r, db.all('select * from installment where invoice_id = ? order by seq', id));
}

export function listPayments(db: Db, tenantId: string, where = '', params: any[] = [], limit = 50, offset = 0): Payment[] {
  return mapPayments(
    db,
    db.all(`${PAYMENT_SELECT} where p.tenant_id = ? ${where} order by p.date desc, p.created_at desc limit ? offset ?`, tenantId, ...params, limit, offset),
  );
}

export function getPayment(db: Db, tenantId: string, id: string): Payment {
  const [p] = listPayments(db, tenantId, 'and p.id = ?', [id], 1);
  if (!p) throw new HttpError(404, 'Payment not found.');
  p.proof = db.get('select proof from payment where id = ?', id)!.proof;
  return p;
}

const CLIENT_SELECT = `
  select c.*,
    c.opening_balance
      + coalesce((select sum(i.total * (i.fx_factor / 1000000.0)) from invoice i where i.client_id = c.id and i.status = 'final'), 0)
      - coalesce((select sum(a.amount * (i.fx_factor / 1000000.0)) from payment_allocation a join payment p on p.id = a.payment_id
                  join invoice i on i.id = a.invoice_id
                  where i.client_id = c.id and i.status = 'final' and p.verification_status <> 'rejected'), 0) as outstanding,
    coalesce((select sum(p.amount * (p.fx_factor / 1000000.0)) from payment p where p.client_id = c.id and p.verification_status <> 'rejected'), 0)
      - coalesce((select sum(a.amount * (p.fx_factor / 1000000.0)) from payment_allocation a join payment p on p.id = a.payment_id
                  where p.client_id = c.id and p.verification_status <> 'rejected'), 0)
      - coalesce((select sum(r.amount) from client_refund r where r.client_id = c.id), 0) as credit
  from client c`;

export function listClients(db: Db, tenantId: string, q: string, limit: number, offset: number): Client[] {
  const like = `%${q}%`;
  return db
    .all(
      `${CLIENT_SELECT} where c.tenant_id = ? and (c.name like ? or c.phone like ? or c.contact_person like ? or c.city like ?)
       order by c.name collate nocase limit ? offset ?`,
      tenantId, like, like, like, like, limit, offset,
    )
    .map(mapClient);
}

export function getClient(db: Db, tenantId: string, id: string): Client {
  const r = db.get(`${CLIENT_SELECT} where c.tenant_id = ? and c.id = ?`, tenantId, id);
  if (!r) throw new HttpError(404, 'Client not found.');
  return mapClient(r);
}

// ---------------------------------------------------------------- invoices

export function computeFor(
  db: Db,
  tenantId: string,
  body: Pick<InvoiceBody, 'businessId' | 'clientId' | 'lines' | 'overallDiscountType' | 'overallDiscountValue' | 'charges'> & { currency?: string; fxRate?: number; issueDate?: string },
) {
  const business = ownedRow(db, 'business', tenantId, body.businessId);
  ownedRow(db, 'client', tenantId, body.clientId);
  const currency = body.currency ?? business.currency;
  const precision = currency === business.currency ? business.currency_precision : precisionOf(currency);
  let fxRate = RATE_SCALE;
  if (currency !== business.currency) {
    const found = body.fxRate ?? findRate(db, tenantId, currency, business.currency, body.issueDate);
    if (!found) throw new HttpError(422, `Enter the exchange rate: how many ${business.currency} is 1 ${currency}?`);
    fxRate = found;
  }
  const fx = { currency, precision, fxRate, fxFactor: minorFactor(fxRate, precision, business.currency_precision) };
  const totals = computeInvoice({
    lines: body.lines,
    overallDiscountType: body.overallDiscountType,
    overallDiscountValue: body.overallDiscountValue,
    charges: body.charges,
    taxInclusive: !!business.tax_inclusive,
    rounding: business.rounding,
    precision,
  });
  const lines = body.lines.map((l, i) => ({ ...l, lineTotal: totals.lines[i].net }));
  return { business, totals, lines, fx };
}

function assertFinalizable(body: Pick<InvoiceBody, 'lines' | 'issueDate' | 'dueDate' | 'installments'>, total: number) {
  if (body.lines.length === 0) throw new HttpError(422, 'Add at least one item before finalizing.');
  if (total < 0) throw new HttpError(422, 'Invoice total cannot be negative.');
  if (body.dueDate < body.issueDate) throw new HttpError(422, 'Due date cannot be before the invoice date.');
  assertSchedule(body.installments, total);
}

function assertSchedule(installments: { amount: number }[], total: number) {
  const sum = installments.reduce((a, x) => a + x.amount, 0);
  if (sum > total) throw new HttpError(422, 'Installments add up to more than the invoice total.');
}

function writeInstallments(db: Db, tenantId: string, invoiceId: string, installments: { dueDate: string; amount: number }[]) {
  db.run('delete from installment where invoice_id = ? and tenant_id = ?', invoiceId, tenantId);
  [...installments]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .forEach((x, i) => db.run('insert into installment (id, tenant_id, invoice_id, seq, due_date, amount) values (?,?,?,?,?,?)', uid(), tenantId, invoiceId, i + 1, x.dueDate, x.amount));
}

/** Next invoice or quotation number. With yearly reset the financial year is part of the number, e.g. INV-2026-27-00001. */
export function nextDocNumber(db: Db, tenantId: string, business: Row, kind: 'invoice' | 'quote', date: string): string {
  const prefix = kind === 'invoice' ? business.invoice_prefix : 'QT-';
  if (business.number_reset === 'yearly') {
    const fy = financialYear(date, business.fy_start_month);
    const seq = db.nextCounter(tenantId, `${kind}:${business.id}:${fy}`);
    return `${prefix}${fy}-${String(seq).padStart(5, '0')}`;
  }
  const seq = db.nextCounter(tenantId, `${kind}:${business.id}`);
  return `${prefix}${String(seq).padStart(5, '0')}`;
}
const assignNumber = (db: Db, tenantId: string, business: Row, date: string) => nextDocNumber(db, tenantId, business, 'invoice', date);

/** What the client would owe the business after adding `extra` (business currency), and their limit. */
export function creditCheck(db: Db, tenantId: string, clientId: string, extra: number): { limit: number; after: number; over: boolean } {
  const c = db.get(`${CLIENT_SELECT} where c.tenant_id = ? and c.id = ?`, tenantId, clientId)!;
  const after = Math.round(c.outstanding) + extra;
  return { limit: c.credit_limit, after, over: c.credit_limit > 0 && after > c.credit_limit };
}

function assertCreditLimit(db: Db, tenantId: string, clientId: string, extra: number, override: boolean) {
  const r = creditCheck(db, tenantId, clientId, extra);
  if (r.over && !override) throw new HttpError(422, `This invoice takes the client to ${r.after / 100} against a credit limit of ${r.limit / 100}. Ask a manager to approve it.`);
}

/** Create a draft or final invoice. Repeating a clientRequestId returns the invoice already saved. */
export function createInvoice(db: Db, auth: AuthContext, body: InvoiceBody, canVerify: boolean): Invoice {
  return db.tx(() => {
    if (body.clientRequestId) {
      const dup = db.get('select id from invoice where tenant_id = ? and client_request_id = ?', auth.tenantId, body.clientRequestId);
      if (dup) return getInvoice(db, auth.tenantId, dup.id);
    }
    const { business, totals, lines, fx } = computeFor(db, auth.tenantId, body);
    if (body.finalize) assertFinalizable(body, totals.total);
    if (body.initialPayment && !body.finalize) throw new HttpError(422, 'A payment can only be recorded against a final invoice.');
    if (body.finalize) assertCreditLimit(db, auth.tenantId, body.clientId, inBase(totals.total - Math.min(body.initialPayment?.amount ?? 0, totals.total), fx.fxFactor), body.overrideCreditLimit);

    const id = uid();
    const ts = now();
    db.run(
      `insert into invoice (id, tenant_id, business_id, client_id, number, status, issue_date, due_date, reference, billing_address,
        lines, charges, overall_discount_type, overall_discount_value, notes, payment_terms,
        currency, currency_precision, tax_inclusive, rounding, fx_rate, fx_factor,
        subtotal, item_discounts, overall_discount, taxable_amount, tax_amount, charges_total, rounding_adjustment, total,
        client_request_id, created_by, created_at, updated_at, finalized_at)
       values (?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?)`,
      id, auth.tenantId, body.businessId, body.clientId,
      body.finalize ? assignNumber(db, auth.tenantId, business, body.issueDate) : null,
      body.finalize ? 'final' : 'draft',
      body.issueDate, body.dueDate, body.reference, body.billingAddress,
      JSON.stringify(lines), JSON.stringify(body.charges), body.overallDiscountType, body.overallDiscountValue, body.notes, body.paymentTerms,
      fx.currency, fx.precision, business.tax_inclusive, business.rounding, fx.fxRate, fx.fxFactor,
      totals.subtotal, totals.itemDiscounts, totals.overallDiscount, totals.taxableAmount, totals.taxAmount, totals.chargesTotal, totals.roundingAdjustment, totals.total,
      body.clientRequestId ?? null, auth.userId, ts, ts, body.finalize ? ts : null,
    );
    writeInstallments(db, auth.tenantId, id, body.installments);
    db.audit(auth.tenantId, auth.userId, body.finalize ? 'invoice.finalize' : 'invoice.create_draft', 'invoice', id, { total: totals.total });

    if (body.initialPayment) {
      recordPayment(db, auth, { ...body.initialPayment, clientId: body.clientId, businessId: body.businessId, invoiceId: id, proof: '', autoAllocate: false }, canVerify);
    }
    return getInvoice(db, auth.tenantId, id);
  });
}

/** Update a draft; optionally finalize it in the same step. Final invoices are immutable. */
export function updateDraft(db: Db, auth: AuthContext, id: string, body: InvoiceBody, canVerify: boolean): Invoice {
  return db.tx(() => {
    const existing = ownedRow(db, 'invoice', auth.tenantId, id);
    if (existing.status !== 'draft') throw new HttpError(409, 'Only draft invoices can be edited.');
    const { business, totals, lines, fx } = computeFor(db, auth.tenantId, body);
    if (body.finalize) assertFinalizable(body, totals.total);
    if (body.initialPayment && !body.finalize) throw new HttpError(422, 'A payment can only be recorded against a final invoice.');
    if (body.finalize) assertCreditLimit(db, auth.tenantId, body.clientId, inBase(totals.total - Math.min(body.initialPayment?.amount ?? 0, totals.total), fx.fxFactor), body.overrideCreditLimit);
    const ts = now();
    db.run(
      `update invoice set business_id=?, client_id=?, number=?, status=?, issue_date=?, due_date=?, reference=?, billing_address=?,
        lines=?, charges=?, overall_discount_type=?, overall_discount_value=?, notes=?, payment_terms=?,
        currency=?, currency_precision=?, tax_inclusive=?, rounding=?, fx_rate=?, fx_factor=?,
        subtotal=?, item_discounts=?, overall_discount=?, taxable_amount=?, tax_amount=?, charges_total=?, rounding_adjustment=?, total=?,
        updated_at=?, finalized_at=?
       where id=? and tenant_id=?`,
      body.businessId, body.clientId,
      body.finalize ? assignNumber(db, auth.tenantId, business, body.issueDate) : null,
      body.finalize ? 'final' : 'draft',
      body.issueDate, body.dueDate, body.reference, body.billingAddress,
      JSON.stringify(lines), JSON.stringify(body.charges), body.overallDiscountType, body.overallDiscountValue, body.notes, body.paymentTerms,
      fx.currency, fx.precision, business.tax_inclusive, business.rounding, fx.fxRate, fx.fxFactor,
      totals.subtotal, totals.itemDiscounts, totals.overallDiscount, totals.taxableAmount, totals.taxAmount, totals.chargesTotal, totals.roundingAdjustment, totals.total,
      ts, body.finalize ? ts : null, id, auth.tenantId,
    );
    writeInstallments(db, auth.tenantId, id, body.installments);
    db.audit(auth.tenantId, auth.userId, body.finalize ? 'invoice.finalize' : 'invoice.update_draft', 'invoice', id, { total: totals.total });
    if (body.initialPayment) {
      recordPayment(db, auth, { ...body.initialPayment, clientId: body.clientId, businessId: body.businessId, invoiceId: id, proof: '', autoAllocate: false }, canVerify);
    }
    return getInvoice(db, auth.tenantId, id);
  });
}

export function finalizeInvoice(db: Db, auth: AuthContext, id: string, overrideCreditLimit = false): Invoice {
  return db.tx(() => {
    const inv = getInvoice(db, auth.tenantId, id);
    if (inv.status !== 'draft') throw new HttpError(409, 'This invoice is already finalized.');
    assertFinalizable(inv, inv.total);
    const row = ownedRow(db, 'invoice', auth.tenantId, id);
    assertCreditLimit(db, auth.tenantId, inv.clientId, inBase(inv.total, row.fx_factor), overrideCreditLimit);
    const business = ownedRow(db, 'business', auth.tenantId, inv.businessId);
    const ts = now();
    db.run("update invoice set status = 'final', number = ?, finalized_at = ?, updated_at = ? where id = ? and tenant_id = ?", assignNumber(db, auth.tenantId, business, inv.issueDate), ts, ts, id, auth.tenantId);
    db.audit(auth.tenantId, auth.userId, 'invoice.finalize', 'invoice', id, { total: inv.total });
    return getInvoice(db, auth.tenantId, id);
  });
}

/** Cancel an invoice. Money already allocated to it is released back to the client as credit. */
export function cancelInvoice(db: Db, auth: AuthContext, id: string, reason: string): Invoice {
  return db.tx(() => {
    const inv = ownedRow(db, 'invoice', auth.tenantId, id);
    if (inv.status === 'cancelled') throw new HttpError(409, 'This invoice is already cancelled.');
    const released = db.get('select coalesce(sum(amount), 0) as s from payment_allocation where invoice_id = ? and tenant_id = ?', id, auth.tenantId)!.s;
    db.run('delete from payment_allocation where invoice_id = ? and tenant_id = ?', id, auth.tenantId);
    db.run("update invoice set status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? where id = ? and tenant_id = ?", now(), reason, now(), id, auth.tenantId);
    db.audit(auth.tenantId, auth.userId, 'invoice.cancel', 'invoice', id, { reason, releasedToCredit: released });
    return getInvoice(db, auth.tenantId, id);
  });
}

export function deleteDraft(db: Db, auth: AuthContext, id: string) {
  db.tx(() => {
    const inv = ownedRow(db, 'invoice', auth.tenantId, id);
    if (inv.status !== 'draft') throw new HttpError(409, 'Only drafts can be deleted. Cancel a final invoice instead.');
    db.run('delete from installment where invoice_id = ? and tenant_id = ?', id, auth.tenantId);
    db.run('delete from invoice where id = ? and tenant_id = ?', id, auth.tenantId);
    db.audit(auth.tenantId, auth.userId, 'invoice.delete_draft', 'invoice', id);
  });
}

export function replaceInstallments(db: Db, auth: AuthContext, id: string, installments: { dueDate: string; amount: number }[]): Invoice {
  return db.tx(() => {
    const inv = ownedRow(db, 'invoice', auth.tenantId, id);
    if (inv.status === 'cancelled') throw new HttpError(409, 'This invoice is cancelled.');
    assertSchedule(installments, inv.total);
    writeInstallments(db, auth.tenantId, id, installments);
    db.audit(auth.tenantId, auth.userId, 'invoice.schedule', 'invoice', id, { count: installments.length });
    return getInvoice(db, auth.tenantId, id);
  });
}

// ---------------------------------------------------------------- payments

function invoiceBalance(db: Db, tenantId: string, invoiceId: string): number {
  const r = db.get(`${INVOICE_SELECT} where i.tenant_id = ? and i.id = ?`, tenantId, invoiceId)!;
  return r.total - r.paid;
}

function allocate(db: Db, tenantId: string, paymentId: string, invoiceId: string, amount: number) {
  if (amount <= 0) return;
  db.run('insert into payment_allocation (id, tenant_id, payment_id, invoice_id, amount, created_at) values (?,?,?,?,?,?)', uid(), tenantId, paymentId, invoiceId, amount, now());
}

/**
 * Save a payment and issue its receipt number. When an invoice is named, at most its
 * remaining balance is allocated; anything beyond that stays on the payment as client credit.
 */
export function recordPayment(db: Db, auth: AuthContext, body: PaymentBody, verified: boolean): Payment {
  return db.tx(() => {
    if (body.clientRequestId) {
      const dup = db.get('select id from payment where tenant_id = ? and client_request_id = ?', auth.tenantId, body.clientRequestId);
      if (dup) return getPayment(db, auth.tenantId, dup.id);
    }
    ownedRow(db, 'client', auth.tenantId, body.clientId);
    const business = ownedRow(db, 'business', auth.tenantId, body.businessId);
    ensureAccounts(db, { businessId: business.id });

    // Which invoices this money pays, and how much each gets. Never more than an invoice's balance.
    const plan: { invoiceId: string; amount: number }[] = [];
    const openInvoice = (invoiceId: string) => {
      const inv = ownedRow(db, 'invoice', auth.tenantId, invoiceId);
      if (inv.status !== 'final') throw new HttpError(409, 'Payments can only be recorded against a final invoice.');
      if (inv.client_id !== body.clientId || inv.business_id !== body.businessId) throw new HttpError(422, 'This invoice belongs to a different client or business.');
      return inv;
    };
    let currency = body.currency;
    let fxFactor = RATE_SCALE;
    const useInvoiceCurrency = (inv: Row) => {
      if (currency && currency !== inv.currency) throw new HttpError(422, `Invoice ${inv.number} is in ${inv.currency}. Record a separate payment for it.`);
      currency = inv.currency;
      fxFactor = inv.fx_factor;
    };
    if (body.invoiceId) {
      const inv = openInvoice(body.invoiceId);
      useInvoiceCurrency(inv);
      plan.push({ invoiceId: inv.id, amount: Math.min(body.amount, Math.max(0, invoiceBalance(db, auth.tenantId, inv.id))) });
    } else if (body.allocations?.length) {
      let total = 0;
      const seen = new Set<string>();
      for (const a of body.allocations) {
        if (seen.has(a.invoiceId)) throw new HttpError(422, 'The same invoice is listed twice.');
        seen.add(a.invoiceId);
        const inv = openInvoice(a.invoiceId);
        useInvoiceCurrency(inv);
        const balance = invoiceBalance(db, auth.tenantId, inv.id);
        if (a.amount > balance) throw new HttpError(422, `Invoice ${inv.number} only has ${balance / 10 ** inv.currency_precision} left to pay.`);
        total += a.amount;
        plan.push({ invoiceId: inv.id, amount: a.amount });
      }
      if (total > body.amount) throw new HttpError(422, 'The amounts given to invoices add up to more than the payment.');
    } else if (body.autoAllocate) {
      currency = currency ?? business.currency;
      let left = body.amount;
      const open = db.all(
        `${INVOICE_SELECT} where i.tenant_id = ? and i.client_id = ? and i.business_id = ? and i.status = 'final' and i.currency = ? order by i.due_date, i.issue_date`,
        auth.tenantId, body.clientId, body.businessId, currency,
      );
      for (const inv of open) {
        if (left <= 0) break;
        const take = Math.min(left, inv.total - inv.paid);
        if (take <= 0) continue;
        plan.push({ invoiceId: inv.id, amount: take });
        fxFactor = inv.fx_factor;
        left -= take;
      }
    }
    const cur: string = currency ?? business.currency;
    currency = cur;
    const precision = cur === business.currency ? business.currency_precision : precisionOf(currency);
    if (cur !== business.currency && !body.invoiceId && !body.allocations?.length) {
      const rate = findRate(db, auth.tenantId, cur, business.currency, body.date);
      if (!rate) throw new HttpError(422, `Add an exchange rate for ${cur} first.`);
      fxFactor = minorFactor(rate, precision, business.currency_precision);
    }

    // The account the money landed in. An account in another currency receives the converted amount.
    const account = body.accountId ? ownedAccount(db, auth.tenantId, body.accountId) : ownedAccount(db, auth.tenantId, defaultAccount(db, business.id, accountTypeFor(body.method)));
    if (account.business_id !== business.id) throw new HttpError(422, 'That account belongs to another business.');
    let accountAmount = body.amount;
    if (account.currency !== currency) {
      if (account.currency !== business.currency) throw new HttpError(422, `${account.name} holds ${account.currency}; choose an account in ${currency} or ${business.currency}.`);
      accountAmount = inBase(body.amount, fxFactor);
    }

    const id = uid();
    const number = `RCT-${String(db.nextCounter(auth.tenantId, 'payment')).padStart(6, '0')}`;
    db.run(
      `insert into payment (id, tenant_id, number, client_id, business_id, amount, date, method, reference, notes, proof,
        received_by, received_by_name, verification_status, client_request_id, created_at, account_id, account_amount, currency, currency_precision, fx_factor)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, auth.tenantId, number, body.clientId, body.businessId, body.amount, body.date, body.method, body.reference, body.notes, body.proof ?? '',
      auth.userId, auth.name, verified ? 'verified' : 'pending', body.clientRequestId ?? null, now(),
      account.id, accountAmount, currency, precision, fxFactor,
    );
    for (const p of plan) allocate(db, auth.tenantId, id, p.invoiceId, p.amount);
    const allocated = plan.reduce((a, p) => a + p.amount, 0);
    db.audit(auth.tenantId, auth.userId, 'payment.record', 'payment', id, { amount: body.amount, allocated, credit: body.amount - allocated, invoices: plan.length });
    return getPayment(db, auth.tenantId, id);
  });
}

export function setPaymentVerification(db: Db, auth: AuthContext, id: string, status: 'verified' | 'rejected'): Payment {
  return db.tx(() => {
    const p = ownedRow(db, 'payment', auth.tenantId, id);
    if (p.verification_status === 'rejected') throw new HttpError(409, 'This payment was already rejected.');
    if (status === 'rejected') db.run('delete from payment_allocation where payment_id = ? and tenant_id = ?', id, auth.tenantId);
    db.run('update payment set verification_status = ? where id = ? and tenant_id = ?', status, id, auth.tenantId);
    db.audit(auth.tenantId, auth.userId, `payment.${status}`, 'payment', id, { amount: p.amount });
    return getPayment(db, auth.tenantId, id);
  });
}

/** Apply the client's unallocated advance (same business, oldest first) to an invoice. Returns the amount applied. */
export function applyCredit(db: Db, auth: AuthContext, invoiceId: string, limit?: number): { applied: number; invoice: Invoice } {
  return db.tx(() => {
    const inv = ownedRow(db, 'invoice', auth.tenantId, invoiceId);
    if (inv.status !== 'final') throw new HttpError(409, 'Credit can only be applied to a final invoice.');
    let left = Math.max(0, invoiceBalance(db, auth.tenantId, invoiceId));
    if (limit !== undefined) left = Math.min(left, limit);
    const sources = db.all(
      `select p.id, p.amount - coalesce((select sum(a.amount) from payment_allocation a where a.payment_id = p.id), 0) as free
       from payment p where p.tenant_id = ? and p.client_id = ? and p.business_id = ? and p.verification_status <> 'rejected'
         and coalesce(p.currency, ?) = ?
       order by p.date, p.created_at`,
      auth.tenantId, inv.client_id, inv.business_id, inv.currency, inv.currency,
    );
    let refunded = db.get('select coalesce(sum(amount), 0) as s from client_refund where tenant_id = ? and client_id = ? and business_id = ?', auth.tenantId, inv.client_id, inv.business_id)!.s;
    let applied = 0;
    for (const s of sources) {
      if (left <= 0) break;
      const used = Math.min(refunded, Math.max(0, s.free));
      refunded -= used;
      const take = Math.min(s.free - used, left);
      if (take <= 0) continue;
      allocate(db, auth.tenantId, s.id, invoiceId, take);
      left -= take;
      applied += take;
    }
    if (applied > 0) db.audit(auth.tenantId, auth.userId, 'invoice.apply_credit', 'invoice', invoiceId, { applied });
    return { applied, invoice: getInvoice(db, auth.tenantId, invoiceId) };
  });
}

// ---------------------------------------------------------------- reporting

export function listInstallments(db: Db, tenantId: string, businessId?: string): InstallmentRow[] {
  const rows = db.all(
    `${INVOICE_SELECT} where i.tenant_id = ? and i.status = 'final' ${businessId ? 'and i.business_id = ?' : ''}
     and exists (select 1 from installment s where s.invoice_id = i.id)`,
    ...(businessId ? [tenantId, businessId] : [tenantId]),
  );
  const out: InstallmentRow[] = [];
  for (const r of rows) {
    const inv = mapInvoice(r, db.all('select * from installment where invoice_id = ? order by seq', r.id));
    for (const s of inv.installments) {
      out.push({ ...s, invoiceId: inv.id, invoiceNumber: inv.number, clientId: inv.clientId, clientName: inv.clientName, currency: inv.currency, currencyPrecision: inv.currencyPrecision });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function dashboard(db: Db, tenantId: string, opts: { businessId?: string; from?: string; to?: string }): DashboardSummary {
  const businesses = opts.businessId ? [ownedRow(db, 'business', tenantId, opts.businessId)] : db.all('select * from business where tenant_id = ? order by created_at', tenantId);
  const target = opts.businessId ? businesses[0].currency : reportingCurrency(db, tenantId);
  const conv = new Converter(db, tenantId, target);
  const bizCurrency = new Map(businesses.map((b) => [b.id as string, b.currency as string]));
  const bizPrecision = new Map(businesses.map((b) => [b.id as string, b.currency_precision as number]));
  /** document amount → business currency (stored rate) → dashboard currency (latest rate) */
  const toTarget = (minor: number, factor: number, businessId: string) => conv.convert(inBase(minor, factor), bizCurrency.get(businessId)!, bizPrecision.get(businessId));
  const ids = businesses.map((b) => b.id as string);
  const ph = ids.map(() => '?').join(',') || "''";
  const from = opts.from ?? '0000-01-01';
  const to = opts.to ?? '9999-12-31';
  const t = today();
  const month = t.slice(0, 7);
  const months12: string[] = [];
  {
    const d = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 12, 1));
    for (let i = 0; i < 12; i++) months12.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  }
  const monthly = new Map(months12.map((m) => [m, { month: m, invoiced: 0, collected: 0, expenses: 0 }]));
  const perBiz = new Map(businesses.map((b) => [b.id as string, { businessId: b.id, name: b.trading_name || b.legal_name, currency: target, invoiced: 0, received: 0, outstanding: 0, overdue: 0 }]));

  const finals = db.all(`${INVOICE_SELECT} where i.tenant_id = ? and i.status = 'final' and i.business_id in (${ph})`, tenantId, ...ids);
  let outstanding = 0, overdue = 0, partiallyPaidCount = 0, unpaidCount = 0, totalInvoiced = 0, paidCount = 0, overdueCount = 0;
  const overdueByClient = new Map<string, { clientId: string; clientName: string; amount: number; oldestDueDate: string }>();
  for (const r of finals) {
    const total = toTarget(r.total, r.fx_factor, r.business_id);
    const balance = toTarget(r.total - r.paid, r.fx_factor, r.business_id);
    const b = perBiz.get(r.business_id)!;
    if (r.issue_date >= from && r.issue_date <= to) {
      totalInvoiced += total;
      b.invoiced += total;
    }
    const m = monthly.get(r.issue_date.slice(0, 7));
    if (m) m.invoiced += total;
    if (r.total - r.paid <= 0) {
      paidCount++;
      continue;
    }
    outstanding += balance;
    b.outstanding += balance;
    if (r.paid > 0) partiallyPaidCount++;
    else unpaidCount++;
    if (r.due_date < t) {
      overdueCount++;
      overdue += balance;
      b.overdue += balance;
      const e = overdueByClient.get(r.client_id) ?? { clientId: r.client_id, clientName: r.client_name, amount: 0, oldestDueDate: r.due_date };
      e.amount += balance;
      if (r.due_date < e.oldestDueDate) e.oldestDueDate = r.due_date;
      overdueByClient.set(r.client_id, e);
    }
  }

  let totalReceived = 0, monthCollections = 0;
  const methodMix = new Map<string, number>();
  for (const p of db.all(`select * from payment where tenant_id = ? and verification_status <> 'rejected' and business_id in (${ph})`, tenantId, ...ids)) {
    const v = toTarget(p.amount, p.fx_factor, p.business_id);
    if (p.date >= from && p.date <= to) {
      totalReceived += v;
      perBiz.get(p.business_id)!.received += v;
      methodMix.set(p.method, (methodMix.get(p.method) ?? 0) + v);
    }
    if (p.date.slice(0, 7) === month) monthCollections += v;
    const m = monthly.get(p.date.slice(0, 7));
    if (m) m.collected += v;
  }

  let monthExpenses = 0;
  const expenseMix = new Map<string, number>();
  for (const e of db.all(
    `select e.*, a.currency from finance_entry e left join money_account a on a.id = e.account_id where e.tenant_id = ? and e.type = 'expense' and e.business_id in (${ph})`,
    tenantId, ...ids,
  )) {
    const v = conv.convert(e.amount, e.currency ?? bizCurrency.get(e.business_id)!);
    if (e.date.slice(0, 7) === month) monthExpenses += v;
    if (e.date >= from && e.date <= to) expenseMix.set(e.category, (expenseMix.get(e.category) ?? 0) + v);
    const m = monthly.get(e.date.slice(0, 7));
    if (m) m.expenses += v;
  }

  const recent = db.all(`${INVOICE_SELECT} where i.tenant_id = ? and i.business_id in (${ph}) order by i.created_at desc limit 5`, tenantId, ...ids);
  const draftCount = db.get(`select count(*) as n from invoice where tenant_id = ? and status = 'draft' and business_id in (${ph})`, tenantId, ...ids)!.n;
  const bp_ = opts.businessId ? 'and p.business_id = ?' : '';
  return {
    totalInvoiced,
    totalReceived,
    outstanding,
    overdue,
    partiallyPaidCount,
    unpaidCount,
    paidCount,
    overdueCount,
    draftCount,
    monthCollections,
    monthExpenses,
    cashBalance: totalCash(db, tenantId, ids, conv),
    currency: target,
    currencyPrecision: conv.precision,
    recentInvoices: recent.map((r) => mapInvoice(r)),
    recentPayments: listPayments(db, tenantId, bp_, opts.businessId ? [opts.businessId] : [], 5),
    upcomingInstallments: listInstallments(db, tenantId, opts.businessId).filter((s) => s.status !== 'paid').slice(0, 5),
    overdueClients: [...overdueByClient.values()].sort((a, b) => b.amount - a.amount).slice(0, 10),
    monthly: [...monthly.values()],
    methodMix: [...methodMix].map(([method, amount]) => ({ method: method as PaymentBody['method'], amount })).sort((a, b) => b.amount - a.amount),
    expenseMix: [...expenseMix].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    businesses: opts.businessId ? [] : [...perBiz.values()],
    dashboardStyle: businesses[0]?.dashboard_style ?? 'monetra',
    missingRates: conv.missing,
  };
}

export function clientLedger(db: Db, tenantId: string, clientId: string): ClientLedger {
  const client = getClient(db, tenantId, clientId);
  const invoiceRows = db.all(`${INVOICE_SELECT} where i.tenant_id = ? and i.client_id = ? order by i.issue_date desc, i.created_at desc`, tenantId, clientId);
  const invoices = invoiceRows.map((r) => mapInvoice(r));
  const factor = new Map(invoiceRows.map((r) => [r.id as string, r.fx_factor as number]));
  const payments = listPayments(db, tenantId, 'and p.client_id = ?', [clientId], 1000);
  const refunds = db.all('select * from client_refund where tenant_id = ? and client_id = ? order by date, created_at', tenantId, clientId);
  const foreign = (amount: number, currency: string, precision: number) => ` (${(amount / 10 ** precision).toLocaleString('en-US')} ${currency})`;

  const raw: Omit<LedgerEntry, 'balance'>[] = [];
  for (const i of invoices) {
    if (i.status !== 'final') continue;
    const base = inBase(i.total, factor.get(i.id));
    raw.push({ date: i.issueDate, type: 'invoice', refId: i.id, label: `Invoice ${i.number}${base !== i.total || i.fxRate !== RATE_SCALE ? foreign(i.total, i.currency, i.currencyPrecision) : ''}`, debit: base, credit: 0 });
  }
  const payRows = new Map(db.all('select id, fx_factor from payment where tenant_id = ? and client_id = ?', tenantId, clientId).map((r) => [r.id as string, r.fx_factor as number]));
  for (const p of [...payments].reverse()) {
    if (p.verificationStatus === 'rejected') continue;
    const base = inBase(p.amount, payRows.get(p.id));
    raw.push({ date: p.date, type: 'payment', refId: p.id, label: `Payment ${p.number}${payRows.get(p.id) !== RATE_SCALE ? foreign(p.amount, p.currency, p.currencyPrecision) : ''}`, debit: 0, credit: base });
  }
  for (const r of refunds) raw.push({ date: r.date, type: 'payment', refId: r.id, label: 'Advance refunded', debit: r.amount, credit: 0 });
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));

  let balance = client.openingBalance;
  const entries: LedgerEntry[] = [{ date: '', type: 'opening', refId: null, label: 'Opening balance', debit: Math.max(balance, 0), credit: Math.max(-balance, 0), balance }];
  for (const e of raw) {
    balance += e.debit - e.credit;
    entries.push({ ...e, balance });
  }
  const finals = invoices.filter((i) => i.status === 'final');
  return {
    client,
    totalInvoiced: finals.reduce((a, i) => a + inBase(i.total, factor.get(i.id)), 0),
    totalPaid: payments.filter((p) => p.verificationStatus !== 'rejected').reduce((a, p) => a + inBase(p.amount, payRows.get(p.id)), 0),
    outstanding: client.outstanding ?? 0,
    credit: client.credit ?? 0,
    overdue: finals.filter((i) => i.displayStatus === 'overdue').reduce((a, i) => a + inBase(i.balance, factor.get(i.id)), 0),
    entries,
    invoices,
    payments,
  };
}

/** Apply all of a client's advance to their open invoices, oldest due first. */
export function applyCreditAll(db: Db, auth: AuthContext, clientId: string): number {
  return db.tx(() => {
    const open = db.all(`${INVOICE_SELECT} where i.tenant_id = ? and i.client_id = ? and i.status = 'final' order by i.due_date, i.issue_date`, auth.tenantId, clientId).filter((r) => r.total > r.paid);
    let applied = 0;
    for (const r of open) applied += applyCredit(db, auth, r.id).applied;
    return applied;
  });
}
