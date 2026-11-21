import { z } from 'zod';
import { PAYMENT_METHODS, type Purchase, type PurchaseSummary } from '../../../packages/shared/src/index';
import { HttpError, type AuthContext } from './perm';
import { now, today, uid, type Db, type Row } from './core';
import { ownedRow } from './domain';
import { accountTypeFor, defaultAccount, ensureAccounts, ownedAccount } from './accounts';

/**
 * Purchase bills: what the business bought, from whom, and for how much.
 * Every purchase owns one Money out entry (finance_entry.purchase_id), so balances, the cashbook,
 * Finance and Profit & Loss all include it without knowing purchases exist.
 */
export const purchaseSchema = z.object({
  businessId: z.string().min(1, 'Choose a business'),
  supplier: z.string().trim().min(1, 'Enter who you bought from').max(200),
  billNo: z.string().trim().max(60).default(''),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  lines: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Every item needs a name').max(200),
        qty: z.number().int().min(1, 'Quantity must be above zero').max(1e12),
        unit: z.string().trim().max(20).default(''),
        unitPrice: z.number().int().min(0).max(1e13),
      }),
    )
    .min(1, 'Add at least one item')
    .max(200),
  category: z.string().trim().min(1).max(60).default('Purchases'),
  method: z.enum(PAYMENT_METHODS).default('cash'),
  accountId: z.string().nullable().optional(),
  notes: z.string().trim().max(2000).default(''),
  reference: z.string().trim().max(100).default(''),
  installments: z
    .array(
      z.object({
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
        amount: z.number().int().min(1, 'Each installment needs an amount'),
        paid: z.boolean().default(false),
        paidDate: z.string().optional(),
      }),
    )
    .max(120)
    .default([]),
  attachment: z.string().max(1_500_000).default(''),
  clientRequestId: z.string().min(8).max(64).optional(),
});
export type PurchaseBody = z.infer<typeof purchaseSchema>;

const lineAmount = (qty: number, unitPrice: number) => Math.round((qty * unitPrice) / 1000);

const SELECT = `select p.*, coalesce(a.name, '') as account_name, b.currency, b.currency_precision, e.id as entry_id
  from purchase p join business b on b.id = p.business_id
  left join money_account a on a.id = p.account_id
  left join finance_entry e on e.purchase_id = p.id`;

type Plan = { dueDate: string; amount: number; paid: boolean; paidDate?: string }[];
const planOf = (r: Row): Plan => {
  try {
    return JSON.parse(r.installments || '[]');
  } catch {
    return [];
  }
};
/** What has actually left the account: everything, or only the installments marked paid. */
const paidOf = (total: number, plan: Plan) => (plan.length ? plan.filter((x) => x.paid).reduce((a, x) => a + x.amount, 0) : total);

function map(r: Row): Purchase {
  const plan = planOf(r);
  const paid = paidOf(r.total, plan);
  return {
    reference: r.reference ?? '',
    installments: plan,
    paid,
    balance: r.total - paid,
    id: r.id,
    number: r.number,
    businessId: r.business_id,
    supplier: r.supplier,
    billNo: r.bill_no,
    date: r.date,
    lines: JSON.parse(r.lines),
    total: r.total,
    category: r.category,
    method: r.method,
    accountId: r.account_id,
    accountName: r.account_name,
    notes: r.notes,
    hasAttachment: !!r.attachment,
    financeEntryId: r.entry_id ?? null,
    currency: r.currency,
    currencyPrecision: r.currency_precision,
    createdAt: r.created_at,
  };
}

export interface PurchaseFilter {
  businessId?: string;
  from?: string;
  to?: string;
  q?: string;
}

function where(tenantId: string, f: PurchaseFilter): [string, any[]] {
  const parts = ['p.tenant_id = ?'];
  const args: any[] = [tenantId];
  if (f.businessId) parts.push('p.business_id = ?'), args.push(f.businessId);
  if (f.from) parts.push('p.date >= ?'), args.push(f.from);
  if (f.to) parts.push('p.date <= ?'), args.push(f.to);
  if (f.q) {
    parts.push("(p.supplier like ? or p.number like ? or p.bill_no like ? or p.lines like ? or p.reference like ?)");
    const like = `%${f.q}%`;
    args.push(like, like, like, like, like);
  }
  return [parts.join(' and '), args];
}

export function listPurchases(db: Db, tenantId: string, f: PurchaseFilter, limit: number, offset: number): Purchase[] {
  const [w, args] = where(tenantId, f);
  return db.all(`${SELECT} where ${w} order by p.date desc, p.created_at desc limit ? offset ?`, ...args, limit, offset).map(map);
}

export function getPurchase(db: Db, tenantId: string, id: string): Purchase & { attachment: string } {
  const r = db.get(`${SELECT} where p.id = ? and p.tenant_id = ?`, id, tenantId);
  if (!r) throw new HttpError(404, 'Purchase not found.');
  return { ...map(r), attachment: r.attachment };
}

export function savePurchase(db: Db, auth: AuthContext, body: PurchaseBody, id?: string): Purchase {
  return db.tx(() => {
    const biz = ownedRow(db, 'business', auth.tenantId, body.businessId);
    if (!id && body.clientRequestId) {
      const dup = db.get('select id from purchase where tenant_id = ? and client_request_id = ?', auth.tenantId, body.clientRequestId);
      if (dup) return getPurchase(db, auth.tenantId, dup.id);
    }
    const lines = body.lines.map((l) => ({ ...l, amount: lineAmount(l.qty, l.unitPrice) }));
    const total = lines.reduce((a, l) => a + l.amount, 0);
    if (total <= 0) throw new HttpError(422, 'The bill total must be above zero.');
    const plan: Plan = body.installments.map((x) => ({ dueDate: x.dueDate, amount: x.amount, paid: x.paid, ...(x.paid ? { paidDate: x.paidDate || today() } : {}) }));
    const planned = plan.reduce((a, x) => a + x.amount, 0);
    if (plan.length && planned !== total) throw new HttpError(422, `The installments add up to ${planned / 10 ** (biz.currency_precision ?? 2)} but the bill total is ${total / 10 ** (biz.currency_precision ?? 2)}. Make them equal.`);

    ensureAccounts(db, { businessId: body.businessId });
    const account = body.accountId
      ? ownedAccount(db, auth.tenantId, body.accountId)
      : ownedAccount(db, auth.tenantId, defaultAccount(db, body.businessId, accountTypeFor(body.method)));
    if (account.business_id !== body.businessId) throw new HttpError(422, 'That account belongs to another business.');

    const t = now();
    let number: string;
    if (id) {
      const old = db.get('select * from purchase where id = ? and tenant_id = ?', id, auth.tenantId);
      if (!old) throw new HttpError(404, 'Purchase not found.');
      number = old.number;
      db.run(
        'update purchase set business_id=?, supplier=?, bill_no=?, date=?, lines=?, total=?, category=?, method=?, account_id=?, notes=?, reference=?, installments=?, attachment=?, updated_at=? where id=? and tenant_id=?',
        body.businessId, body.supplier, body.billNo, body.date, JSON.stringify(lines), total, body.category, body.method, account.id, body.notes, body.reference, JSON.stringify(plan),
        // editing without a new photo keeps the saved one
        body.attachment || old.attachment, t, id, auth.tenantId,
      );
    } else {
      id = uid();
      number = `PUR-${String(db.nextCounter(auth.tenantId, 'purchase')).padStart(4, '0')}`;
      db.run(
        'insert into purchase (id, tenant_id, business_id, number, supplier, bill_no, date, lines, total, category, method, account_id, notes, reference, installments, attachment, client_request_id, created_by, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id, auth.tenantId, body.businessId, number, body.supplier, body.billNo, body.date, JSON.stringify(lines), total, body.category, body.method, account.id, body.notes, body.reference, JSON.stringify(plan), body.attachment,
        body.clientRequestId ?? null, auth.userId, t, t,
      );
    }

    syncEntry(db, auth, id);
    db.audit(auth.tenantId, auth.userId, 'purchase.save', 'purchase', id, { number, total, currency: biz.currency });
    return getPurchase(db, auth.tenantId, id);
  });
}

/**
 * Keep the bill's Money out entry equal to what has been paid: the whole total, or the sum of
 * installments marked paid. Nothing paid yet means no entry, so balances are untouched.
 */
function syncEntry(db: Db, auth: AuthContext, id: string) {
  const p = db.get('select * from purchase where id = ? and tenant_id = ?', id, auth.tenantId);
  if (!p) throw new HttpError(404, 'Purchase not found.');
  const plan = planOf(p);
  const paid = paidOf(p.total, plan);
  const lines = JSON.parse(p.lines) as { name: string }[];
  const planNote = plan.length ? ` · ${plan.filter((x) => x.paid).length} of ${plan.length} installments paid` : '';
  const notes = `Purchase ${p.number}${p.bill_no ? ` · bill ${p.bill_no}` : ''}${p.reference ? ` · txn ${p.reference}` : ''}${planNote} · ${lines.map((l) => l.name).join(', ')}`.slice(0, 2000);
  // the entry is dated when the money last left: the bill date, or the latest paid installment
  const date = plan.length ? plan.filter((x) => x.paid).map((x) => x.paidDate || p.date).sort().pop() || p.date : p.date;
  const entry = db.get('select id from finance_entry where purchase_id = ? and tenant_id = ?', id, auth.tenantId);
  if (paid <= 0) {
    if (entry) db.run('delete from finance_entry where id = ?', entry.id);
    return;
  }
  if (entry) {
    db.run(
      'update finance_entry set business_id=?, category=?, amount=?, date=?, method=?, party=?, notes=?, account_id=? where id=?',
      p.business_id, p.category, paid, date, p.method, p.supplier, notes, p.account_id, entry.id,
    );
  } else {
    db.run(
      "insert into finance_entry (id, tenant_id, business_id, type, category, amount, date, method, party, notes, account_id, purchase_id, created_by, created_at) values (?,?,?,'expense',?,?,?,?,?,?,?,?,?,?)",
      uid(), auth.tenantId, p.business_id, p.category, paid, date, p.method, p.supplier, notes, p.account_id, id, auth.userId, now(),
    );
  }
}

/** Mark one installment of a bill paid or unpaid; its money out follows. */
export function setInstallmentPaid(db: Db, auth: AuthContext, id: string, index: number, paid: boolean): Purchase {
  return db.tx(() => {
    const p = db.get('select * from purchase where id = ? and tenant_id = ?', id, auth.tenantId);
    if (!p) throw new HttpError(404, 'Purchase not found.');
    const plan = planOf(p);
    if (!plan[index]) throw new HttpError(404, 'Installment not found.');
    plan[index] = { dueDate: plan[index].dueDate, amount: plan[index].amount, paid, ...(paid ? { paidDate: today() } : {}) };
    db.run('update purchase set installments = ?, updated_at = ? where id = ?', JSON.stringify(plan), now(), id);
    syncEntry(db, auth, id);
    db.audit(auth.tenantId, auth.userId, paid ? 'purchase.installment_paid' : 'purchase.installment_unpaid', 'purchase', id, { number: p.number, index });
    return getPurchase(db, auth.tenantId, id);
  });
}

export function deletePurchase(db: Db, auth: AuthContext, id: string) {
  db.tx(() => {
    const p = db.get('select number from purchase where id = ? and tenant_id = ?', id, auth.tenantId);
    if (!p) throw new HttpError(404, 'Purchase not found.');
    db.run('delete from finance_entry where purchase_id = ? and tenant_id = ?', id, auth.tenantId);
    db.run('delete from purchase where id = ?', id);
    db.audit(auth.tenantId, auth.userId, 'purchase.delete', 'purchase', id, { number: p.number });
  });
}

/** Suppliers already used, most recent first, so they can be picked instead of retyped. */
export function suppliers(db: Db, tenantId: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of db.all('select supplier from purchase where tenant_id = ? order by date desc, created_at desc limit 500', tenantId)) {
    if (seen.has(r.supplier.toLowerCase())) continue;
    seen.add(r.supplier.toLowerCase());
    out.push(r.supplier);
  }
  return out.slice(0, 50);
}

export function purchaseSummary(db: Db, tenantId: string, f: PurchaseFilter): PurchaseSummary {
  const biz = f.businessId ? ownedRow(db, 'business', tenantId, f.businessId) : db.get('select * from business where tenant_id = ? order by created_at limit 1', tenantId);
  const [w, args] = where(tenantId, f);
  const rows = db.all(`select p.supplier, p.lines, p.total, p.installments from purchase p where ${w}`, ...args);
  const unpaid = rows.reduce((a, r) => a + (r.total - paidOf(r.total, planOf(r))), 0);

  const suppliersMap = new Map<string, { name: string; amount: number; count: number }>();
  const items = new Map<string, { name: string; qty: number; unit: string; amount: number }>();
  for (const r of rows) {
    const s = suppliersMap.get(r.supplier.toLowerCase()) ?? { name: r.supplier, amount: 0, count: 0 };
    s.amount += r.total;
    s.count += 1;
    suppliersMap.set(r.supplier.toLowerCase(), s);
    for (const l of JSON.parse(r.lines) as { name: string; qty: number; unit: string; amount: number }[]) {
      const key = `${l.name.toLowerCase()}|${(l.unit ?? '').toLowerCase()}`;
      const it = items.get(key) ?? { name: l.name, qty: 0, unit: l.unit ?? '', amount: 0 };
      it.qty += l.qty;
      it.amount += l.amount;
      items.set(key, it);
    }
  }

  // last six calendar months, independent of the selected range
  const t = today();
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) months.push(new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1 - i, 1)).toISOString().slice(0, 7));
  const [bw, bargs] = where(tenantId, { businessId: f.businessId, from: `${months[0]}-01` });
  const monthly = months.map((month) => ({ month, amount: 0 }));
  for (const r of db.all(`select p.date, p.total from purchase p where ${bw}`, ...bargs)) {
    const slot = monthly.find((m) => m.month === r.date.slice(0, 7));
    if (slot) slot.amount += r.total;
  }

  const total = rows.reduce((a, r) => a + r.total, 0);
  return {
    unpaid,
    total,
    count: rows.length,
    average: rows.length ? Math.round(total / rows.length) : 0,
    thisMonth: monthly[5].amount,
    lastMonth: monthly[4].amount,
    monthly,
    bySupplier: [...suppliersMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 6),
    byItem: [...items.values()].sort((a, b) => b.amount - a.amount).slice(0, 8),
    recent: listPurchases(db, tenantId, f, 5, 0),
    currency: biz?.currency ?? 'PKR',
    currencyPrecision: biz?.currency_precision ?? 2,
  };
}
