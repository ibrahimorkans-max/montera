import { z } from 'zod';
import { PAYMENT_METHODS, type FinanceEntry, type FinanceSummary } from '../../../packages/shared/src/index';
import { HttpError, type AuthContext } from './perm';
import { now, today, uid, type Db, type Row } from './core';
import { ownedRow } from './domain';
import { accountTypeFor, defaultAccount, ensureAccounts, ownedAccount } from './accounts';

export const financeSchema = z.object({
  businessId: z.string().min(1, 'Choose a business'),
  type: z.enum(['income', 'expense']),
  category: z.string().trim().min(1, 'Choose a category').max(60),
  amount: z.number().int().min(1, 'Amount must be above zero').max(1e13),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  method: z.enum(PAYMENT_METHODS).default('cash'),
  party: z.string().trim().max(200).default(''),
  notes: z.string().trim().max(2000).default(''),
  accountId: z.string().nullable().optional(),
  attachment: z.string().max(1_500_000).default(''),
  clientRequestId: z.string().min(8).max(64).optional(),
});
export type FinanceBody = z.infer<typeof financeSchema>;

export interface FinanceFilter {
  businessId?: string;
  from?: string;
  to?: string;
  type?: string;
}

/**
 * Money movements: entries typed in by the user plus every client payment that is not rejected.
 * Payments are read live from the payment table, so the two can never drift apart.
 */
function movements(db: Db, tenantId: string, f: FinanceFilter, tail = '', tailArgs: any[] = []): Row[] {
  const from = f.from ?? '0000-01-01';
  const to = f.to ?? '9999-12-31';
  const biz = f.businessId ? 'and business_id = ?' : '';
  const bizArgs = f.businessId ? [f.businessId] : [];
  const sql = `
    select * from (
      select e.id, 'manual' as source, e.type, e.category, e.amount, e.date, e.method, e.party, e.notes, e.business_id, e.created_at, e.account_id, coalesce(a.name, '') as account_name, (e.attachment <> '') as has_attachment
        from finance_entry e left join money_account a on a.id = e.account_id where e.tenant_id = ? and e.date between ? and ? ${biz.replace('business_id', 'e.business_id')}
      union all
      select p.id, 'payment', 'income', 'Client payments', coalesce(p.account_amount, p.amount), p.date, p.method, c.name, p.number, p.business_id, p.created_at, p.account_id, coalesce(a.name, ''), 0
        from payment p join client c on c.id = p.client_id left join money_account a on a.id = p.account_id
        where p.tenant_id = ? and p.verification_status <> 'rejected' and p.date between ? and ? ${biz.replace('business_id', 'p.business_id')}
      union all
      select r.id, 'refund', 'expense', 'Advance refunds', r.amount, r.date, r.method, c.name, r.notes, r.business_id, r.created_at, r.account_id, coalesce(a.name, ''), 0
        from client_refund r join client c on c.id = r.client_id left join money_account a on a.id = r.account_id
        where r.tenant_id = ? and r.date between ? and ? ${biz.replace('business_id', 'r.business_id')}
    ) ${f.type === 'income' || f.type === 'expense' ? `where type = '${f.type}'` : ''}
    order by date desc, created_at desc ${tail}`;
  return db.all(sql, tenantId, from, to, ...bizArgs, tenantId, from, to, ...bizArgs, tenantId, from, to, ...bizArgs, ...tailArgs);
}

const map = (r: Row): FinanceEntry => ({
  id: r.id,
  source: r.source,
  type: r.type,
  category: r.category,
  amount: r.amount,
  date: r.date,
  method: r.method,
  party: r.party,
  notes: r.notes,
  businessId: r.business_id,
  accountId: r.account_id,
  accountName: r.account_name,
  hasAttachment: !!r.has_attachment,
});

export function listEntries(db: Db, tenantId: string, f: FinanceFilter, limit: number, offset: number): FinanceEntry[] {
  return movements(db, tenantId, f, 'limit ? offset ?', [limit, offset]).map(map);
}

function byCategory(rows: Row[], type: string) {
  const sums = new Map<string, number>();
  for (const r of rows) if (r.type === type) sums.set(r.category, (sums.get(r.category) ?? 0) + r.amount);
  return [...sums.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

export function summary(db: Db, tenantId: string, f: FinanceFilter): FinanceSummary {
  const biz = f.businessId ? ownedRow(db, 'business', tenantId, f.businessId) : db.get('select * from business where tenant_id = ? order by created_at limit 1', tenantId);
  const rows = movements(db, tenantId, f);
  const sum = (type: string) => rows.reduce((a, r) => (r.type === type ? a + r.amount : a), 0);

  // last six calendar months, independent of the selected range
  const t = today();
  const start = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 6, 1));
  const months: string[] = [];
  for (let i = 0; i < 6; i++) months.push(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  const recent = movements(db, tenantId, { businessId: f.businessId, from: `${months[0]}-01` });
  const monthly = months.map((month) => ({ month, income: 0, expense: 0 }));
  for (const r of recent) {
    const slot = monthly.find((x) => x.month === r.date.slice(0, 7));
    if (slot) slot[r.type as 'income' | 'expense'] += r.amount;
  }

  const income = sum('income');
  const expense = sum('expense');
  return {
    income,
    expense,
    net: income - expense,
    fromClients: rows.reduce((a, r) => (r.source === 'payment' ? a + r.amount : a), 0),
    incomeByCategory: byCategory(rows, 'income'),
    expenseByCategory: byCategory(rows, 'expense'),
    monthly,
    currency: biz?.currency ?? 'PKR',
    currencyPrecision: biz?.currency_precision ?? 2,
  };
}

export function saveEntry(db: Db, auth: AuthContext, body: FinanceBody, id?: string): FinanceEntry {
  return db.tx(() => {
    ownedRow(db, 'business', auth.tenantId, body.businessId);
    if (!id && body.clientRequestId) {
      const dup = db.get('select id from finance_entry where tenant_id = ? and client_request_id = ?', auth.tenantId, body.clientRequestId);
      if (dup) return listEntries(db, auth.tenantId, {}, 1000, 0).find((e) => e.id === dup.id)!;
    }
    ensureAccounts(db, { businessId: body.businessId });
    const account = body.accountId ? ownedAccount(db, auth.tenantId, body.accountId) : ownedAccount(db, auth.tenantId, defaultAccount(db, body.businessId, accountTypeFor(body.method)));
    if (account.business_id !== body.businessId) throw new HttpError(422, 'That account belongs to another business.');
    if (id) {
      if (!db.get('select 1 from finance_entry where id = ? and tenant_id = ?', id, auth.tenantId)) throw new HttpError(404, 'Entry not found.');
      db.run(
        'update finance_entry set business_id=?, type=?, category=?, amount=?, date=?, method=?, party=?, notes=?, account_id=?, attachment=? where id=? and tenant_id=?',
        body.businessId, body.type, body.category, body.amount, body.date, body.method, body.party, body.notes, account.id, body.attachment, id, auth.tenantId,
      );
    } else {
      id = uid();
      db.run(
        'insert into finance_entry (id, tenant_id, business_id, type, category, amount, date, method, party, notes, account_id, attachment, client_request_id, created_by, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id, auth.tenantId, body.businessId, body.type, body.category, body.amount, body.date, body.method, body.party, body.notes, account.id, body.attachment, body.clientRequestId ?? null, auth.userId, now(),
      );
    }
    db.audit(auth.tenantId, auth.userId, 'finance.save', 'finance_entry', id, { type: body.type, amount: body.amount });
    const { attachment, clientRequestId: _r, accountId: _a, ...rest } = body;
    return { id: id!, source: 'manual', ...rest, accountId: account.id, accountName: account.name, hasAttachment: !!attachment };
  });
}

export function deleteEntry(db: Db, auth: AuthContext, id: string) {
  const r = db.run('delete from finance_entry where id = ? and tenant_id = ?', id, auth.tenantId);
  if (!r.changes) throw new HttpError(404, 'Entry not found.');
  db.audit(auth.tenantId, auth.userId, 'finance.delete', 'finance_entry', id);
}
