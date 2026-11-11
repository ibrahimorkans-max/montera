import { z } from 'zod';
import type { Quotation, QuotationDisplayStatus } from '../../../packages/shared/src/index';
import { HttpError, type AuthContext } from './perm';
import { now, today, uid, type Db, type Row } from './core';
import { computeFor, createInvoice, lineSchemaPublic, nextDocNumber, ownedRow } from './domain';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max = 500) => z.string().trim().max(max).default('');

export const quotationSchema = z.object({
  businessId: z.string().min(1, 'Choose the issuing business'),
  clientId: z.string().min(1, 'Choose a client'),
  issueDate: isoDate,
  validUntil: isoDate,
  reference: text(200),
  billingAddress: text(1000),
  lines: z.array(lineSchemaPublic()).max(500),
  overallDiscountType: z.enum(['percent', 'fixed']).default('percent'),
  overallDiscountValue: z.number().int().min(0).max(1e13).default(0),
  charges: z.array(z.object({ label: z.string().trim().min(1).max(100), amount: z.number().int().min(-1e13).max(1e13) })).max(50).default([]),
  notes: text(4000),
  terms: text(4000),
  clientRequestId: z.string().min(8).max(64).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  fxRate: z.number().int().min(1).max(1e15).optional(),
});
export type QuotationBody = z.infer<typeof quotationSchema>;

export const QUOTE_SELECT = `
  select q.*, c.name as client_name,
    case when b.trading_name <> '' then b.trading_name else b.legal_name end as business_name,
    i.number as converted_number
  from quotation q join client c on c.id = q.client_id join business b on b.id = q.business_id
  left join invoice i on i.id = q.converted_invoice_id`;

function displayStatus(r: Row): QuotationDisplayStatus {
  if (r.converted_invoice_id) return 'converted';
  if (r.status === 'sent' && r.valid_until < today()) return 'expired';
  return r.status;
}

export function mapQuote(r: Row): Quotation {
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
    validUntil: r.valid_until,
    reference: r.reference,
    billingAddress: r.billing_address,
    lines: JSON.parse(r.lines),
    overallDiscountType: r.overall_discount_type,
    overallDiscountValue: r.overall_discount_value,
    charges: JSON.parse(r.charges),
    notes: r.notes,
    terms: r.terms,
    clientRequestId: r.client_request_id ?? undefined,
    currency: r.currency,
    currencyPrecision: r.currency_precision,
    taxInclusive: !!r.tax_inclusive,
    subtotal: r.subtotal,
    itemDiscounts: r.item_discounts,
    overallDiscount: r.overall_discount,
    taxableAmount: r.taxable_amount,
    taxAmount: r.tax_amount,
    chargesTotal: r.charges_total,
    roundingAdjustment: r.rounding_adjustment,
    total: r.total,
    convertedInvoiceId: r.converted_invoice_id,
    convertedInvoiceNumber: r.converted_number ?? null,
    createdAt: r.created_at,
  };
}

export function getQuote(db: Db, tenantId: string, id: string): Quotation {
  const r = db.get(`${QUOTE_SELECT} where q.tenant_id = ? and q.id = ?`, tenantId, id);
  if (!r) throw new HttpError(404, 'Quotation not found.');
  return mapQuote(r);
}

const STATUS_FILTER: Record<string, string> = {
  draft: "q.status = 'draft'",
  sent: "q.status = 'sent' and q.valid_until >= date('now') and q.converted_invoice_id is null",
  accepted: "q.status = 'accepted' and q.converted_invoice_id is null",
  rejected: "q.status = 'rejected'",
  expired: "q.status = 'sent' and q.valid_until < date('now') and q.converted_invoice_id is null",
  converted: 'q.converted_invoice_id is not null',
};

export function listQuotes(db: Db, tenantId: string, f: { q?: string; status?: string; clientId?: string }, limit: number, offset: number): Quotation[] {
  const where = ['q.tenant_id = ?'];
  const args: any[] = [tenantId];
  if (f.q) {
    where.push('(q.number like ? or c.name like ? or q.reference like ?)');
    args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  if (f.clientId) (where.push('q.client_id = ?'), args.push(f.clientId));
  if (f.status && STATUS_FILTER[f.status]) where.push(STATUS_FILTER[f.status]);
  return db.all(`${QUOTE_SELECT} where ${where.join(' and ')} order by q.issue_date desc, q.created_at desc limit ? offset ?`, ...args, limit, offset).map(mapQuote);
}

function validate(body: QuotationBody) {
  if (body.validUntil < body.issueDate) throw new HttpError(422, 'The quotation cannot expire before its date.');
}

export function saveQuote(db: Db, auth: AuthContext, body: QuotationBody, id?: string): Quotation {
  return db.tx(() => {
    if (!id && body.clientRequestId) {
      const dup = db.get('select id from quotation where tenant_id = ? and client_request_id = ?', auth.tenantId, body.clientRequestId);
      if (dup) return getQuote(db, auth.tenantId, dup.id);
    }
    validate(body);
    const { business, totals, lines, fx } = computeFor(db, auth.tenantId, body);
    if (totals.total < 0) throw new HttpError(422, 'The quotation total cannot be negative.');
    const values = [
      body.businessId, body.clientId, body.issueDate, body.validUntil, body.reference, body.billingAddress,
      JSON.stringify(lines), JSON.stringify(body.charges), body.overallDiscountType, body.overallDiscountValue, body.notes, body.terms,
      fx.currency, fx.precision, business.tax_inclusive, business.rounding,
      totals.subtotal, totals.itemDiscounts, totals.overallDiscount, totals.taxableAmount, totals.taxAmount, totals.chargesTotal, totals.roundingAdjustment, totals.total,
    ];
    if (id) {
      const existing = ownedRow(db, 'quotation', auth.tenantId, id);
      if (existing.converted_invoice_id) throw new HttpError(409, 'This quotation was already converted into an invoice.');
      if (existing.status === 'accepted' || existing.status === 'rejected') throw new HttpError(409, 'Accepted or rejected quotations cannot be edited. Duplicate it instead.');
      if (existing.business_id !== body.businessId) throw new HttpError(422, 'The issuing business of a numbered quotation cannot change.');
      db.run(
        `update quotation set business_id=?, client_id=?, issue_date=?, valid_until=?, reference=?, billing_address=?,
          lines=?, charges=?, overall_discount_type=?, overall_discount_value=?, notes=?, terms=?,
          currency=?, currency_precision=?, tax_inclusive=?, rounding=?,
          subtotal=?, item_discounts=?, overall_discount=?, taxable_amount=?, tax_amount=?, charges_total=?, rounding_adjustment=?, total=?, updated_at=?, fx_rate=?, fx_factor=?
         where id=? and tenant_id=?`,
        ...values, now(), fx.fxRate, fx.fxFactor, id, auth.tenantId,
      );
      db.audit(auth.tenantId, auth.userId, 'quotation.update', 'quotation', id, { total: totals.total });
      return getQuote(db, auth.tenantId, id);
    }
    const newId = uid();
    const number = nextDocNumber(db, auth.tenantId, business, 'quote', body.issueDate);
    db.run(
      `insert into quotation (id, tenant_id, number, status, business_id, client_id, issue_date, valid_until, reference, billing_address,
        lines, charges, overall_discount_type, overall_discount_value, notes, terms,
        currency, currency_precision, tax_inclusive, rounding,
        subtotal, item_discounts, overall_discount, taxable_amount, tax_amount, charges_total, rounding_adjustment, total,
        client_request_id, created_by, created_at, updated_at, fx_rate, fx_factor)
       values (?,?,?, 'draft', ?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?)`,
      newId, auth.tenantId, number, ...values, body.clientRequestId ?? null, auth.userId, now(), now(), fx.fxRate, fx.fxFactor,
    );
    db.audit(auth.tenantId, auth.userId, 'quotation.create', 'quotation', newId, { total: totals.total });
    return getQuote(db, auth.tenantId, newId);
  });
}

const TRANSITIONS: Record<string, string[]> = {
  draft: ['sent'],
  sent: ['accepted', 'rejected', 'draft'],
  accepted: ['sent'],
  rejected: ['sent'],
};

export function setQuoteStatus(db: Db, auth: AuthContext, id: string, status: 'draft' | 'sent' | 'accepted' | 'rejected'): Quotation {
  return db.tx(() => {
    const q = ownedRow(db, 'quotation', auth.tenantId, id);
    if (q.converted_invoice_id) throw new HttpError(409, 'This quotation was already converted into an invoice.');
    if (!TRANSITIONS[q.status]?.includes(status)) throw new HttpError(409, `A ${q.status} quotation cannot be marked ${status}.`);
    db.run('update quotation set status = ?, updated_at = ? where id = ? and tenant_id = ?', status, now(), id, auth.tenantId);
    db.audit(auth.tenantId, auth.userId, `quotation.${status}`, 'quotation', id);
    return getQuote(db, auth.tenantId, id);
  });
}

/**
 * Turn a quotation into a draft invoice (never a final one: the user reviews and finalizes it).
 * Running it twice returns the same invoice.
 */
export function convertQuote(db: Db, auth: AuthContext, id: string, canVerify: boolean): { invoiceId: string } {
  return db.tx(() => {
    const q = ownedRow(db, 'quotation', auth.tenantId, id);
    if (q.converted_invoice_id && db.get('select 1 from invoice where id = ?', q.converted_invoice_id)) return { invoiceId: q.converted_invoice_id };
    if (q.status === 'rejected') throw new HttpError(409, 'A rejected quotation cannot be converted. Mark it as sent again first.');
    const t = today();
    const inv = createInvoice(
      db,
      auth,
      {
        businessId: q.business_id,
        clientId: q.client_id,
        issueDate: t,
        dueDate: t,
        reference: q.reference || q.number,
        billingAddress: q.billing_address,
        lines: JSON.parse(q.lines).map(({ lineTotal: _ignored, ...l }: any) => l),
        overallDiscountType: q.overall_discount_type,
        overallDiscountValue: q.overall_discount_value,
        charges: JSON.parse(q.charges),
        notes: q.notes,
        paymentTerms: q.terms,
        installments: [],
        clientRequestId: `quote-${q.id}`.slice(0, 64),
        currency: q.currency,
        fxRate: q.fx_rate,
        overrideCreditLimit: false,
        finalize: false,
      },
      canVerify,
    );
    db.run("update quotation set status = 'accepted', converted_invoice_id = ?, updated_at = ? where id = ? and tenant_id = ?", inv.id, now(), id, auth.tenantId);
    db.audit(auth.tenantId, auth.userId, 'quotation.convert', 'quotation', id, { invoiceId: inv.id });
    return { invoiceId: inv.id };
  });
}

export function deleteQuote(db: Db, auth: AuthContext, id: string) {
  db.tx(() => {
    const q = ownedRow(db, 'quotation', auth.tenantId, id);
    if (q.status !== 'draft') throw new HttpError(409, 'Only draft quotations can be deleted.');
    db.run('delete from quotation where id = ? and tenant_id = ?', id, auth.tenantId);
    db.audit(auth.tenantId, auth.userId, 'quotation.delete', 'quotation', id);
  });
}
