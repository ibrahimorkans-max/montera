import { z } from 'zod';
import { ROLE_PERMISSIONS, computeInvoice, occurrence, addDaysIso, type RecurringInvoice, type Role } from '../../../packages/shared/src/index';
import { HttpError, type AuthContext } from './perm';
import { now, today, uid, type Db, type Row } from './core';
import { computeFor, createInvoice, creditCheck, lineSchemaPublic, ownedRow } from './domain';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max = 500) => z.string().trim().max(max).default('');
/** Safety cap: a schedule never creates more than this many invoices in one run (e.g. after a long outage). */
const MAX_PER_RUN = 24;

export const recurringSchema = z.object({
  name: z.string().trim().min(1, 'Give this schedule a name').max(120),
  businessId: z.string().min(1, 'Choose the issuing business'),
  clientId: z.string().min(1, 'Choose a client'),
  reference: text(200),
  billingAddress: text(1000),
  lines: z.array(lineSchemaPublic()).min(1, 'Add at least one item').max(500),
  overallDiscountType: z.enum(['percent', 'fixed']).default('percent'),
  overallDiscountValue: z.number().int().min(0).max(1e13).default(0),
  charges: z.array(z.object({ label: z.string().trim().min(1).max(100), amount: z.number().int().min(-1e13).max(1e13) })).max(50).default([]),
  notes: text(4000),
  paymentTerms: text(2000),
  frequency: z.enum(['weekly', 'monthly', 'yearly', 'custom']),
  interval: z.number().int().min(1).max(365),
  startDate: isoDate,
  endDate: isoDate.nullable().default(null),
  dueDays: z.number().int().min(0).max(365).default(0),
  autoIssue: z.boolean().default(false),
});
export type RecurringBody = z.infer<typeof recurringSchema>;

const SELECT = `
  select r.*, c.name as client_name,
    case when b.trading_name <> '' then b.trading_name else b.legal_name end as business_name,
    b.currency, b.currency_precision, b.tax_inclusive, b.rounding,
    (select count(*) from invoice i where i.recurring_id = r.id and i.status = 'draft') as pending_drafts
  from recurring_invoice r join client c on c.id = r.client_id join business b on b.id = r.business_id`;

function nextDate(r: Row): string | null {
  if (r.status === 'ended') return null;
  const d = occurrence(r.start_date, r.frequency, r.interval_count, r.generated_count);
  return r.end_date && d > r.end_date ? null : d;
}

export function mapRecurring(r: Row): RecurringInvoice {
  const lines = JSON.parse(r.lines);
  const charges = JSON.parse(r.charges);
  const totals = computeInvoice({
    lines,
    overallDiscountType: r.overall_discount_type,
    overallDiscountValue: r.overall_discount_value,
    charges,
    taxInclusive: !!r.tax_inclusive,
    rounding: r.rounding,
    precision: r.currency_precision,
  });
  return {
    id: r.id,
    name: r.name,
    businessId: r.business_id,
    businessName: r.business_name,
    clientId: r.client_id,
    clientName: r.client_name,
    reference: r.reference,
    billingAddress: r.billing_address,
    lines,
    overallDiscountType: r.overall_discount_type,
    overallDiscountValue: r.overall_discount_value,
    charges,
    notes: r.notes,
    paymentTerms: r.payment_terms,
    frequency: r.frequency,
    interval: r.interval_count,
    startDate: r.start_date,
    endDate: r.end_date,
    dueDays: r.due_days,
    autoIssue: !!r.auto_issue,
    status: r.status,
    nextDate: nextDate(r),
    generatedCount: r.generated_count,
    lastGeneratedAt: r.last_generated_at,
    currency: r.currency,
    currencyPrecision: r.currency_precision,
    total: totals.total,
    pendingDrafts: r.pending_drafts,
  };
}

export function getRecurring(db: Db, tenantId: string, id: string): RecurringInvoice {
  const r = db.get(`${SELECT} where r.tenant_id = ? and r.id = ?`, tenantId, id);
  if (!r) throw new HttpError(404, 'Recurring invoice not found.');
  return mapRecurring(r);
}

export function listRecurring(db: Db, tenantId: string): RecurringInvoice[] {
  return db.all(`${SELECT} where r.tenant_id = ? order by case r.status when 'active' then 0 when 'paused' then 1 else 2 end, r.name collate nocase`, tenantId).map(mapRecurring);
}

export function saveRecurring(db: Db, auth: AuthContext, body: RecurringBody, canFinalize: boolean, id?: string): RecurringInvoice {
  if (body.autoIssue && !canFinalize) throw new HttpError(403, 'Only users who can finalize invoices may turn on automatic issuing.');
  if (body.endDate && body.endDate < body.startDate) throw new HttpError(422, 'The end date cannot be before the start date.');
  return db.tx(() => {
    const { totals, lines } = computeFor(db, auth.tenantId, body);
    if (totals.total < 0) throw new HttpError(422, 'The invoice total cannot be negative.');
    const values = [
      body.name, body.businessId, body.clientId, body.reference, body.billingAddress, JSON.stringify(lines.map(({ lineTotal: _x, ...l }) => l)),
      JSON.stringify(body.charges), body.overallDiscountType, body.overallDiscountValue, body.notes, body.paymentTerms,
      body.frequency, body.interval, body.endDate, body.dueDays, body.autoIssue ? 1 : 0,
    ];
    if (id) {
      const existing = ownedRow(db, 'recurring_invoice', auth.tenantId, id);
      // changing the start date or rhythm restarts the count from the new start
      const restart = existing.start_date !== body.startDate || existing.frequency !== body.frequency || existing.interval_count !== body.interval;
      db.run(
        `update recurring_invoice set name=?, business_id=?, client_id=?, reference=?, billing_address=?, lines=?, charges=?, overall_discount_type=?,
          overall_discount_value=?, notes=?, payment_terms=?, frequency=?, interval_count=?, end_date=?, due_days=?, auto_issue=?,
          start_date=?, generated_count=?, status=?, updated_at=? where id=? and tenant_id=?`,
        ...values, body.startDate, restart ? 0 : existing.generated_count,
        existing.status === 'ended' && (!body.endDate || body.endDate >= today()) ? 'active' : existing.status, now(), id, auth.tenantId,
      );
      db.audit(auth.tenantId, auth.userId, 'recurring.update', 'recurring_invoice', id, { autoIssue: body.autoIssue });
      return getRecurring(db, auth.tenantId, id);
    }
    const newId = uid();
    db.run(
      `insert into recurring_invoice (id, tenant_id, name, business_id, client_id, reference, billing_address, lines, charges, overall_discount_type,
        overall_discount_value, notes, payment_terms, frequency, interval_count, end_date, due_days, auto_issue,
        start_date, generated_count, status, created_by, created_at, updated_at)
       values (?,?, ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?, 0, 'active', ?,?,?)`,
      newId, auth.tenantId, ...values, body.startDate, auth.userId, now(), now(),
    );
    db.audit(auth.tenantId, auth.userId, 'recurring.create', 'recurring_invoice', newId, { autoIssue: body.autoIssue });
    return getRecurring(db, auth.tenantId, newId);
  });
}

export function setRecurringStatus(db: Db, auth: AuthContext, id: string, status: 'active' | 'paused'): RecurringInvoice {
  const r = ownedRow(db, 'recurring_invoice', auth.tenantId, id);
  if (r.status === 'ended' && status === 'active') throw new HttpError(409, 'This schedule has ended. Extend its end date to restart it.');
  db.run('update recurring_invoice set status = ?, updated_at = ? where id = ? and tenant_id = ?', status, now(), id, auth.tenantId);
  db.audit(auth.tenantId, auth.userId, `recurring.${status === 'active' ? 'resume' : 'pause'}`, 'recurring_invoice', id);
  return getRecurring(db, auth.tenantId, id);
}

export function deleteRecurring(db: Db, auth: AuthContext, id: string) {
  ownedRow(db, 'recurring_invoice', auth.tenantId, id);
  db.tx(() => {
    // invoices already generated stay; they simply lose the link
    db.run('update invoice set recurring_id = null where recurring_id = ? and tenant_id = ?', id, auth.tenantId);
    db.run('delete from recurring_invoice where id = ? and tenant_id = ?', id, auth.tenantId);
    db.audit(auth.tenantId, auth.userId, 'recurring.delete', 'recurring_invoice', id);
  });
}

/**
 * Create every invoice that is due (run date on or before today) for one schedule.
 * Invoices are drafts awaiting approval unless the schedule has automatic issuing AND the
 * person who set it up is still allowed to finalize invoices. Each run date has a fixed
 * request id, so a run that is repeated or interrupted never creates duplicates.
 */
function runOne(db: Db, r: Row): number {
  const creator = db.get("select * from app_user where id = ? and tenant_id = ? and status = 'active'", r.created_by, r.tenant_id);
  if (!creator) return 0;
  const role = creator.role as Role;
  const auth: AuthContext = { userId: creator.id, tenantId: r.tenant_id, role, sessionId: 'recurring', name: creator.name };
  const canFinalize = (ROLE_PERMISSIONS[role] ?? []).includes('invoices.finalize');
  const t = today();
  let made = 0;
  let count = r.generated_count;
  while (made < MAX_PER_RUN) {
    const date = occurrence(r.start_date, r.frequency, r.interval_count, count);
    if (date > t) break;
    if (r.end_date && date > r.end_date) {
      db.run("update recurring_invoice set status = 'ended', updated_at = ? where id = ?", now(), r.id);
      break;
    }
    db.tx(() => {
      // over the client's credit limit: create a draft so a person decides
      const autoIssue = !!r.auto_issue && canFinalize && !creditCheck(db, r.tenant_id, r.client_id, computeFor(db, r.tenant_id, { businessId: r.business_id, clientId: r.client_id, lines: JSON.parse(r.lines), overallDiscountType: r.overall_discount_type, overallDiscountValue: r.overall_discount_value, charges: JSON.parse(r.charges) }).totals.total).over;
      const inv = createInvoice(
        db,
        auth,
        {
          businessId: r.business_id,
          clientId: r.client_id,
          issueDate: date,
          dueDate: addDaysIso(date, r.due_days),
          reference: r.reference,
          billingAddress: r.billing_address,
          lines: JSON.parse(r.lines),
          overallDiscountType: r.overall_discount_type,
          overallDiscountValue: r.overall_discount_value,
          charges: JSON.parse(r.charges),
          notes: r.notes,
          paymentTerms: r.payment_terms,
          installments: [],
          clientRequestId: `rec-${r.id.slice(0, 36)}-${date}`,
          overrideCreditLimit: false,
          finalize: autoIssue,
        },
        false,
      );
      db.run('update invoice set recurring_id = ? where id = ?', r.id, inv.id);
      count++;
      db.run('update recurring_invoice set generated_count = ?, last_generated_at = ? where id = ?', count, now(), r.id);
      db.audit(r.tenant_id, null, 'recurring.generate', 'invoice', inv.id, { recurringId: r.id, date, status: inv.status });
    });
    made++;
  }
  if (r.end_date && occurrence(r.start_date, r.frequency, r.interval_count, count) > r.end_date) {
    db.run("update recurring_invoice set status = 'ended', updated_at = ? where id = ?", now(), r.id);
  }
  return made;
}

/** Run every active schedule that is due, optionally limited to one tenant or one schedule. */
export function runDue(db: Db, filter: { tenantId?: string; id?: string } = {}): number {
  const where = ["status = 'active'"];
  const args: any[] = [];
  if (filter.tenantId) (where.push('tenant_id = ?'), args.push(filter.tenantId));
  if (filter.id) (where.push('id = ?'), args.push(filter.id));
  let total = 0;
  for (const r of db.all(`select * from recurring_invoice where ${where.join(' and ')}`, ...args)) {
    try {
      total += runOne(db, r);
    } catch (e) {
      // one bad schedule (e.g. its client was removed) must not stop the others
      console.error(`recurring ${r.id} failed:`, (e as Error).message);
    }
  }
  return total;
}
