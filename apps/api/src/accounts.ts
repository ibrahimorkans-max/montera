import { z } from 'zod';
import {
  PAYMENT_METHODS,
  precisionOf,
  type AccountType,
  type CashFlow,
  type Cashbook,
  type CashbookDay,
  type MoneyAccount,
  type Movement,
  type PaymentMethod,
  type ProfitLoss,
  type Refund,
  type Transfer,
} from '../../../packages/shared/src/index';
import { HttpError, type AuthContext } from './perm';
import { now, today, uid, type Db, type Row } from './core';
import { Converter, inBase, reportingCurrency } from './fx';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ---------------------------------------------------------------- accounts

export const accountSchema = z.object({
  businessId: z.string().min(1),
  name: z.string().trim().min(1, 'Name the account').max(80),
  type: z.enum(['cash', 'bank', 'wallet']),
  institution: z.string().trim().max(120).default(''),
  accountNumber: z.string().trim().max(64).default(''),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  openingBalance: z.number().int().min(-1e13).max(1e13).default(0),
  openingDate: isoDate.optional(),
  isDefault: z.boolean().default(false),
  status: z.enum(['active', 'archived']).default('active'),
});

/** Which kind of account a payment method lands in by default. */
export const accountTypeFor = (method: PaymentMethod): AccountType => (method === 'cash' ? 'cash' : method === 'easypaisa' || method === 'jazzcash' ? 'wallet' : 'bank');

/**
 * Every business gets a cash, bank and wallet account the first time it is seen, and older
 * payments and expenses that predate accounts are filed into the matching default account.
 */
export function ensureAccounts(db: Db, filter: { tenantId?: string; businessId?: string } = {}) {
  const where = ['1 = 1'];
  const args: any[] = [];
  if (filter.tenantId) (where.push('tenant_id = ?'), args.push(filter.tenantId));
  if (filter.businessId) (where.push('id = ?'), args.push(filter.businessId));
  for (const b of db.all(`select * from business where ${where.join(' and ')}`, ...args)) {
    db.tx(() => {
      const defaults: [AccountType, string][] = [
        ['cash', 'Cash in hand'],
        ['bank', 'Bank account'],
        ['wallet', 'Mobile wallet'],
      ];
      for (const [type, name] of defaults) {
        if (db.get('select 1 from money_account where business_id = ? and type = ? and is_default = 1', b.id, type)) continue;
        db.run(
          `insert into money_account (id, tenant_id, business_id, name, type, institution, account_number, currency, opening_balance, opening_date, is_default, status, created_at)
           values (?,?,?,?,?,'','',?,0,?,1,'active',?)`,
          uid(), b.tenant_id, b.id, name, type, b.currency, b.created_at.slice(0, 10), now(),
        );
      }
      for (const p of db.all('select id, method from payment where business_id = ? and account_id is null', b.id)) {
        db.run('update payment set account_id = ? where id = ?', defaultAccount(db, b.id, accountTypeFor(p.method)), p.id);
      }
      for (const e of db.all('select id, method from finance_entry where business_id = ? and account_id is null', b.id)) {
        db.run('update finance_entry set account_id = ? where id = ?', defaultAccount(db, b.id, accountTypeFor(e.method)), e.id);
      }
    });
  }
}

export function defaultAccount(db: Db, businessId: string, type: AccountType): string {
  const a =
    db.get("select id from money_account where business_id = ? and type = ? and status = 'active' order by is_default desc, created_at limit 1", businessId, type) ??
    db.get("select id from money_account where business_id = ? and status = 'active' order by is_default desc, created_at limit 1", businessId);
  if (!a) throw new HttpError(409, 'This business has no money account. Add one under Finance → Accounts.');
  return a.id;
}

export function ownedAccount(db: Db, tenantId: string, id: string): Row {
  const a = db.get('select * from money_account where id = ? and tenant_id = ?', id, tenantId);
  if (!a) throw new HttpError(404, 'Account not found.');
  return a;
}

/** Signed movements of one or more accounts, in each account's own currency. */
function rawMovements(db: Db, tenantId: string, accountIds: string[], from = '0000-01-01', to = '9999-12-31'): Row[] {
  if (accountIds.length === 0) return [];
  const ids = accountIds.map(() => '?').join(',');
  return db.all(
    `select * from (
      select a.id as ref_id, 'opening' as kind, a.id as account_id, a.opening_date as date, a.created_at as at,
             case when a.opening_balance > 0 then a.opening_balance else 0 end as money_in,
             case when a.opening_balance < 0 then -a.opening_balance else 0 end as money_out,
             'Opening balance' as label, '' as party
        from money_account a where a.tenant_id = ? and a.id in (${ids}) and a.opening_balance <> 0
      union all
      select p.id, 'payment', p.account_id, p.date, p.created_at, coalesce(p.account_amount, p.amount), 0, 'Payment ' || p.number, c.name
        from payment p join client c on c.id = p.client_id
        where p.tenant_id = ? and p.account_id in (${ids}) and p.verification_status <> 'rejected'
      union all
      select e.id, e.type, e.account_id, e.date, e.created_at,
             case when e.type = 'income' then e.amount else 0 end, case when e.type = 'expense' then e.amount else 0 end, e.category, e.party
        from finance_entry e where e.tenant_id = ? and e.account_id in (${ids})
      union all
      select t.id, 'transfer_out', t.from_account_id, t.date, t.created_at, 0, t.amount, 'Transfer to ' || a.name, ''
        from transfer t join money_account a on a.id = t.to_account_id where t.tenant_id = ? and t.from_account_id in (${ids})
      union all
      select t.id, 'transfer_in', t.to_account_id, t.date, t.created_at, t.to_amount, 0, 'Transfer from ' || a.name, ''
        from transfer t join money_account a on a.id = t.from_account_id where t.tenant_id = ? and t.to_account_id in (${ids})
      union all
      select r.id, 'refund', r.account_id, r.date, r.created_at, 0, r.amount, 'Advance refund', c.name
        from client_refund r join client c on c.id = r.client_id where r.tenant_id = ? and r.account_id in (${ids})
    ) where date between ? and ? order by date, at`,
    tenantId, ...accountIds, tenantId, ...accountIds, tenantId, ...accountIds, tenantId, ...accountIds, tenantId, ...accountIds, tenantId, ...accountIds, from, to,
  );
}

function balanceOf(db: Db, tenantId: string, accountId: string, onOrBefore = '9999-12-31'): number {
  return rawMovements(db, tenantId, [accountId], '0000-01-01', onOrBefore).reduce((a, m) => a + m.money_in - m.money_out, 0);
}

function mapAccount(db: Db, r: Row, balanceDate?: string): MoneyAccount {
  return {
    id: r.id,
    businessId: r.business_id,
    businessName: r.business_name ?? '',
    name: r.name,
    type: r.type,
    institution: r.institution,
    accountNumber: r.account_number,
    currency: r.currency,
    currencyPrecision: precisionOf(r.currency),
    openingBalance: r.opening_balance,
    openingDate: r.opening_date,
    isDefault: !!r.is_default,
    status: r.status,
    balance: balanceOf(db, r.tenant_id, r.id, balanceDate),
  };
}

const ACCOUNT_SELECT = `select a.*, case when b.trading_name <> '' then b.trading_name else b.legal_name end as business_name
  from money_account a join business b on b.id = a.business_id`;

export function listAccounts(db: Db, tenantId: string, businessId?: string, includeArchived = false): MoneyAccount[] {
  return db
    .all(
      `${ACCOUNT_SELECT} where a.tenant_id = ? ${businessId ? 'and a.business_id = ?' : ''} ${includeArchived ? '' : "and a.status = 'active'"}
       order by b.created_at, case a.type when 'cash' then 0 when 'bank' then 1 else 2 end, a.is_default desc, a.name`,
      ...(businessId ? [tenantId, businessId] : [tenantId]),
    )
    .map((r) => mapAccount(db, r));
}

export function getAccount(db: Db, tenantId: string, id: string): MoneyAccount {
  const r = db.get(`${ACCOUNT_SELECT} where a.tenant_id = ? and a.id = ?`, tenantId, id);
  if (!r) throw new HttpError(404, 'Account not found.');
  return mapAccount(db, r);
}

export function saveAccount(db: Db, auth: AuthContext, body: z.infer<typeof accountSchema>, id?: string): MoneyAccount {
  return db.tx(() => {
    const biz = db.get('select * from business where id = ? and tenant_id = ?', body.businessId, auth.tenantId);
    if (!biz) throw new HttpError(404, 'Business not found.');
    const currency = body.currency ?? biz.currency;
    if (id) {
      const a = ownedAccount(db, auth.tenantId, id);
      if (a.business_id !== body.businessId) throw new HttpError(422, 'An account cannot move to another business.');
      const used = rawMovements(db, auth.tenantId, [id]).some((m) => m.kind !== 'opening');
      if (used && a.currency !== currency) throw new HttpError(409, 'The currency of an account with transactions cannot change.');
      if (a.is_default && body.status === 'archived') throw new HttpError(409, 'Make another account the default before archiving this one.');
    }
    if (body.isDefault) db.run('update money_account set is_default = 0 where business_id = ? and type = ?', body.businessId, body.type);
    const values = [body.name, body.type, body.institution, body.accountNumber, currency, body.openingBalance, body.openingDate ?? today(), body.isDefault ? 1 : 0, body.status];
    let accountId = id;
    if (id) {
      db.run(
        'update money_account set name=?, type=?, institution=?, account_number=?, currency=?, opening_balance=?, opening_date=?, is_default=?, status=? where id=? and tenant_id=?',
        ...values, id, auth.tenantId,
      );
    } else {
      accountId = uid();
      db.run(
        `insert into money_account (id, tenant_id, business_id, name, type, institution, account_number, currency, opening_balance, opening_date, is_default, status, created_at)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        accountId, auth.tenantId, body.businessId, ...values, now(),
      );
    }
    db.audit(auth.tenantId, auth.userId, id ? 'account.update' : 'account.create', 'money_account', accountId!, { name: body.name });
    return getAccount(db, auth.tenantId, accountId!);
  });
}

// ---------------------------------------------------------------- transfers

export const transferSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amount: z.number().int().min(1, 'Enter the amount').max(1e13),
  /** required when the two accounts use different currencies */
  toAmount: z.number().int().min(1).max(1e13).optional(),
  date: isoDate,
  reference: z.string().trim().max(120).default(''),
  notes: z.string().trim().max(1000).default(''),
  clientRequestId: z.string().min(8).max(64).optional(),
});

const TRANSFER_SELECT = `select t.*, f.name as from_name, d.name as to_name from transfer t
  join money_account f on f.id = t.from_account_id join money_account d on d.id = t.to_account_id`;
const mapTransfer = (r: Row): Transfer => ({
  id: r.id,
  businessId: r.business_id,
  fromAccountId: r.from_account_id,
  fromAccountName: r.from_name,
  toAccountId: r.to_account_id,
  toAccountName: r.to_name,
  amount: r.amount,
  toAmount: r.to_amount,
  date: r.date,
  reference: r.reference,
  notes: r.notes,
  createdAt: r.created_at,
});

export function listTransfers(db: Db, tenantId: string, businessId?: string): Transfer[] {
  return db.all(`${TRANSFER_SELECT} where t.tenant_id = ? ${businessId ? 'and t.business_id = ?' : ''} order by t.date desc, t.created_at desc limit 200`, ...(businessId ? [tenantId, businessId] : [tenantId])).map(mapTransfer);
}

export function saveTransfer(db: Db, auth: AuthContext, body: z.infer<typeof transferSchema>): Transfer {
  return db.tx(() => {
    if (body.clientRequestId) {
      const dup = db.get('select id from transfer where tenant_id = ? and client_request_id = ?', auth.tenantId, body.clientRequestId);
      if (dup) return mapTransfer(db.get(`${TRANSFER_SELECT} where t.id = ?`, dup.id)!);
    }
    if (body.fromAccountId === body.toAccountId) throw new HttpError(422, 'Choose two different accounts.');
    const from = ownedAccount(db, auth.tenantId, body.fromAccountId);
    const to = ownedAccount(db, auth.tenantId, body.toAccountId);
    if (from.business_id !== to.business_id) throw new HttpError(422, 'Both accounts must belong to the same business.');
    if (from.status !== 'active' || to.status !== 'active') throw new HttpError(409, 'Archived accounts cannot be used.');
    const toAmount = from.currency === to.currency ? body.amount : body.toAmount;
    if (!toAmount) throw new HttpError(422, `Enter how much arrives in ${to.name} (${to.currency}).`);
    const id = uid();
    db.run(
      `insert into transfer (id, tenant_id, business_id, from_account_id, to_account_id, amount, to_amount, date, reference, notes, client_request_id, created_by, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, auth.tenantId, from.business_id, from.id, to.id, body.amount, toAmount, body.date, body.reference, body.notes, body.clientRequestId ?? null, auth.userId, now(),
    );
    db.audit(auth.tenantId, auth.userId, 'transfer.create', 'transfer', id, { from: from.name, to: to.name, amount: body.amount });
    return mapTransfer(db.get(`${TRANSFER_SELECT} where t.id = ?`, id)!);
  });
}

export function deleteTransfer(db: Db, auth: AuthContext, id: string) {
  const r = db.run('delete from transfer where id = ? and tenant_id = ?', id, auth.tenantId);
  if (!r.changes) throw new HttpError(404, 'Transfer not found.');
  db.audit(auth.tenantId, auth.userId, 'transfer.delete', 'transfer', id);
}

// ---------------------------------------------------------------- advance refunds

export const refundSchema = z.object({
  businessId: z.string().min(1),
  accountId: z.string().nullable().optional(),
  amount: z.number().int().min(1, 'Enter the amount').max(1e13),
  date: isoDate,
  method: z.enum(PAYMENT_METHODS).default('cash'),
  notes: z.string().trim().max(1000).default(''),
});

/** Advance (unallocated money) the client holds with one business, in that business's currency. */
export function clientCredit(db: Db, tenantId: string, clientId: string, businessId: string): number {
  const r = db.get(
    `select
       coalesce((select sum(p.amount) from payment p where p.tenant_id = ? and p.client_id = ? and p.business_id = ? and p.verification_status <> 'rejected'), 0)
     - coalesce((select sum(a.amount) from payment_allocation a join payment p on p.id = a.payment_id
                 where p.tenant_id = ? and p.client_id = ? and p.business_id = ? and p.verification_status <> 'rejected'), 0)
     - coalesce((select sum(amount) from client_refund where tenant_id = ? and client_id = ? and business_id = ?), 0) as credit`,
    tenantId, clientId, businessId, tenantId, clientId, businessId, tenantId, clientId, businessId,
  )!;
  return r.credit;
}

export function refundCredit(db: Db, auth: AuthContext, clientId: string, body: z.infer<typeof refundSchema>): Refund {
  return db.tx(() => {
    if (!db.get('select 1 from client where id = ? and tenant_id = ?', clientId, auth.tenantId)) throw new HttpError(404, 'Client not found.');
    const credit = clientCredit(db, auth.tenantId, clientId, body.businessId);
    if (body.amount > credit) throw new HttpError(422, 'The refund is more than the advance this client holds.');
    const accountId = body.accountId ? ownedAccount(db, auth.tenantId, body.accountId).id : defaultAccount(db, body.businessId, accountTypeFor(body.method));
    const id = uid();
    db.run(
      'insert into client_refund (id, tenant_id, business_id, client_id, account_id, amount, date, method, notes, created_by, created_at) values (?,?,?,?,?,?,?,?,?,?,?)',
      id, auth.tenantId, body.businessId, clientId, accountId, body.amount, body.date, body.method, body.notes, auth.userId, now(),
    );
    db.audit(auth.tenantId, auth.userId, 'client.refund', 'client', clientId, { amount: body.amount });
    const r = db.get('select r.*, a.name as account_name from client_refund r join money_account a on a.id = r.account_id where r.id = ?', id)!;
    return { id, clientId, businessId: r.business_id, accountId, accountName: r.account_name, amount: r.amount, date: r.date, method: r.method, notes: r.notes };
  });
}

// ---------------------------------------------------------------- cashbook

/** Day-by-day money in and out with opening and closing balances, for accounts sharing one currency. */
export function cashbook(db: Db, tenantId: string, f: { businessId?: string; accountId?: string; from: string; to: string }): Cashbook {
  let accounts: MoneyAccount[];
  if (f.accountId) accounts = [getAccount(db, tenantId, f.accountId)];
  else {
    const businessId = f.businessId ?? db.get('select id from business where tenant_id = ? order by created_at limit 1', tenantId)?.id;
    const biz = db.get('select currency from business where id = ? and tenant_id = ?', businessId, tenantId);
    if (!biz) throw new HttpError(404, 'Business not found.');
    accounts = listAccounts(db, tenantId, businessId).filter((a) => a.currency === biz.currency);
  }
  const ids = accounts.map((a) => a.id);
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const dayBefore = new Date(Date.parse(`${f.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const opening = ids.reduce((s, id) => s + balanceOf(db, tenantId, id, dayBefore), 0);

  const days: CashbookDay[] = [];
  let running = opening;
  for (const m of rawMovements(db, tenantId, ids, f.from, f.to)) {
    let day = days[days.length - 1];
    if (!day || day.date !== m.date) {
      day = { date: m.date, opening: running, moneyIn: 0, moneyOut: 0, closing: running, lines: [] };
      days.push(day);
    }
    running += m.money_in - m.money_out;
    day.moneyIn += m.money_in;
    day.moneyOut += m.money_out;
    day.closing = running;
    const line: Movement = {
      id: `${m.kind}-${m.ref_id}`,
      date: m.date,
      kind: m.kind,
      accountId: m.account_id,
      accountName: names.get(m.account_id) ?? '',
      label: m.label,
      party: m.party,
      moneyIn: m.money_in,
      moneyOut: m.money_out,
      balance: running,
      refId: m.ref_id,
    };
    day.lines.push(line);
  }
  const currency = accounts[0]?.currency ?? 'PKR';
  return {
    from: f.from,
    to: f.to,
    currency,
    currencyPrecision: precisionOf(currency),
    accounts,
    opening,
    closing: running,
    moneyIn: days.reduce((a, d) => a + d.moneyIn, 0),
    moneyOut: days.reduce((a, d) => a + d.moneyOut, 0),
    days: days.reverse(),
  };
}

// ---------------------------------------------------------------- profit & loss, cash flow

function months(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const end = to.slice(0, 7);
  while (out.length < 120) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= end) break;
    m++;
    if (m > 12) (m = 1), y++;
  }
  return out;
}

function scope(db: Db, tenantId: string, businessId?: string) {
  const businesses = businessId ? db.all('select * from business where tenant_id = ? and id = ?', tenantId, businessId) : db.all('select * from business where tenant_id = ?', tenantId);
  if (businessId && businesses.length === 0) throw new HttpError(404, 'Business not found.');
  const target = businessId ? businesses[0].currency : reportingCurrency(db, tenantId);
  return { businesses, ids: businesses.map((b) => b.id), conv: new Converter(db, tenantId, target), target };
}
const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

export function profitLoss(db: Db, tenantId: string, f: { businessId?: string; from: string; to: string; basis: 'accrual' | 'cash' }): ProfitLoss & { missingRates: boolean } {
  const { businesses, ids, conv, target } = scope(db, tenantId, f.businessId);
  const bizCurrency = new Map(businesses.map((b) => [b.id, b.currency as string]));
  const inTarget = (minor: number, businessId: string) => conv.convert(minor, bizCurrency.get(businessId)!);
  const monthKeys = months(f.from, f.to);
  const monthly = new Map(monthKeys.map((m) => [m, { month: m, income: 0, expenses: 0, profit: 0 }]));
  const add = (map: Map<string, number>, key: string, v: number) => map.set(key, (map.get(key) ?? 0) + v);
  const income = new Map<string, number>();
  const expenses = new Map<string, number>();
  let taxCollected = 0;

  if (ids.length) {
    const ph = placeholders(ids.length);
    if (f.basis === 'accrual') {
      for (const r of db.all(`select * from invoice where tenant_id = ? and status = 'final' and business_id in (${ph}) and issue_date between ? and ?`, tenantId, ...ids, f.from, f.to)) {
        const revenue = inTarget(inBase(r.total - r.tax_amount, r.fx_factor), r.business_id);
        add(income, 'Sales & services', revenue);
        taxCollected += inTarget(inBase(r.tax_amount, r.fx_factor), r.business_id);
        monthly.get(r.issue_date.slice(0, 7))!.income += revenue;
      }
    } else {
      for (const p of db.all(`select * from payment where tenant_id = ? and verification_status <> 'rejected' and business_id in (${ph}) and date between ? and ?`, tenantId, ...ids, f.from, f.to)) {
        const v = inTarget(inBase(p.amount, p.fx_factor), p.business_id);
        add(income, 'Client payments', v);
        monthly.get(p.date.slice(0, 7))!.income += v;
      }
    }
    for (const e of db.all(
      `select e.*, a.currency from finance_entry e join money_account a on a.id = e.account_id where e.tenant_id = ? and e.business_id in (${ph}) and e.date between ? and ?`,
      tenantId, ...ids, f.from, f.to,
    )) {
      const v = conv.convert(e.amount, e.currency);
      if (e.type === 'income') {
        add(income, e.category, v);
        monthly.get(e.date.slice(0, 7))!.income += v;
      } else if (e.category !== 'Owner withdrawal') {
        // money the owner takes out is not a business cost
        add(expenses, e.category, v);
        monthly.get(e.date.slice(0, 7))!.expenses += v;
      }
    }
  }
  for (const m of monthly.values()) m.profit = m.income - m.expenses;
  const totalIncome = [...income.values()].reduce((a, b) => a + b, 0);
  const totalExpenses = [...expenses.values()].reduce((a, b) => a + b, 0);
  const sorted = (m: Map<string, number>) => [...m].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  return {
    from: f.from,
    to: f.to,
    basis: f.basis,
    currency: target,
    currencyPrecision: precisionOf(target),
    income: sorted(income),
    totalIncome,
    expenses: sorted(expenses),
    totalExpenses,
    netProfit: totalIncome - totalExpenses,
    marginBp: totalIncome > 0 ? Math.round(((totalIncome - totalExpenses) * 10_000) / totalIncome) : 0,
    taxCollected,
    monthly: [...monthly.values()],
    missingRates: conv.missing,
  };
}

export function cashFlow(db: Db, tenantId: string, f: { businessId?: string; from: string; to: string }): CashFlow & { missingRates: boolean } {
  const { ids, conv, target } = scope(db, tenantId, f.businessId);
  const accounts = ids.length ? db.all(`select * from money_account where tenant_id = ? and business_id in (${placeholders(ids.length)})`, tenantId, ...ids) : [];
  const inScope = new Set(accounts.map((a) => a.id));
  const currencyOf = new Map(accounts.map((a) => [a.id as string, a.currency as string]));
  const dayBefore = new Date(Date.parse(`${f.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const perAccount = accounts.map((a) => ({ accountId: a.id, name: a.name, type: a.type, opening: conv.convert(balanceOf(db, tenantId, a.id, dayBefore), a.currency), closing: 0 }));
  const opening = perAccount.reduce((s, a) => s + a.opening, 0);

  const monthKeys = months(f.from, f.to);
  const monthly = new Map(monthKeys.map((m) => [m, { month: m, opening: 0, moneyIn: 0, moneyOut: 0, closing: 0 }]));
  const inflows = new Map<string, number>();
  const outflows = new Map<string, number>();
  const add = (map: Map<string, number>, k: string, v: number) => map.set(k, (map.get(k) ?? 0) + v);
  const transferIds = new Map<string, number>();
  for (const m of rawMovements(db, tenantId, [...inScope], f.from, f.to)) {
    if (m.kind === 'opening') continue;
    // money moving between two accounts that are both in scope is not a cash flow
    if (m.kind === 'transfer_in' || m.kind === 'transfer_out') {
      const t = db.get('select from_account_id, to_account_id from transfer where id = ?', m.ref_id)!;
      if (inScope.has(t.from_account_id) && inScope.has(t.to_account_id)) {
        transferIds.set(m.ref_id, 1);
        continue;
      }
    }
    const vIn = conv.convert(m.money_in, currencyOf.get(m.account_id)!);
    const vOut = conv.convert(m.money_out, currencyOf.get(m.account_id)!);
    const label = m.kind === 'payment' ? 'Client payments' : m.kind === 'refund' ? 'Advance refunds' : m.kind.startsWith('transfer') ? 'Transfers' : m.label;
    if (vIn) add(inflows, label, vIn);
    if (vOut) add(outflows, label, vOut);
    const row = monthly.get(m.date.slice(0, 7))!;
    row.moneyIn += vIn;
    row.moneyOut += vOut;
  }
  let running = opening;
  for (const row of monthly.values()) {
    row.opening = running;
    running += row.moneyIn - row.moneyOut;
    row.closing = running;
  }
  for (const a of perAccount) {
    const acc = accounts.find((x) => x.id === a.accountId)!;
    a.closing = conv.convert(balanceOf(db, tenantId, a.accountId, f.to), acc.currency);
  }
  const sorted = (m: Map<string, number>) => [...m].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  const totalIn = [...inflows.values()].reduce((a, b) => a + b, 0);
  const totalOut = [...outflows.values()].reduce((a, b) => a + b, 0);
  return {
    from: f.from,
    to: f.to,
    currency: target,
    currencyPrecision: precisionOf(target),
    opening,
    closing: opening + totalIn - totalOut,
    inflows: sorted(inflows),
    outflows: sorted(outflows),
    totalIn,
    totalOut,
    monthly: [...monthly.values()],
    accounts: perAccount,
    missingRates: conv.missing,
  };
}

/** Cash, bank and wallet money today across the given businesses, in one currency. */
export function totalCash(db: Db, tenantId: string, businessIds: string[], conv: Converter): number {
  if (!businessIds.length) return 0;
  const accounts = db.all(`select id, currency from money_account where tenant_id = ? and status = 'active' and business_id in (${placeholders(businessIds.length)})`, tenantId, ...businessIds);
  return accounts.reduce((s, a) => s + conv.convert(balanceOf(db, tenantId, a.id), a.currency), 0);
}
