import { PAYMENT_METHOD_LABELS, applyToInstallments, formatMoney, type PaymentMethod, type ReportData } from '../../../packages/shared/src/index';
import { today, type Db, type Row } from './core';
import { INVOICE_SELECT, ownedRow } from './domain';
import { Converter, inBase, reportingCurrency } from './fx';

export interface ReportFilter {
  from: string;
  to: string;
  businessId?: string;
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Monday of the week containing the date. */
function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

function bucket<K extends string>(rows: { key: K; amount: number }[]) {
  const m = new Map<K, { amount: number; count: number }>();
  for (const r of rows) {
    const e = m.get(r.key) ?? { amount: 0, count: 0 };
    e.amount += r.amount;
    e.count++;
    m.set(r.key, e);
  }
  return m;
}

export function buildReport(db: Db, tenantId: string, f: ReportFilter): ReportData {
  const biz = f.businessId ? ownedRow(db, 'business', tenantId, f.businessId) : db.get('select * from business where tenant_id = ? order by created_at limit 1', tenantId);
  const bi = f.businessId ? 'and i.business_id = ?' : '';
  const bp = f.businessId ? 'and p.business_id = ?' : '';
  const bArgs = f.businessId ? [f.businessId] : [];
  const t = today();
  const target = f.businessId ? biz!.currency : reportingCurrency(db, tenantId);
  const conv = new Converter(db, tenantId, target);
  const bizRows = new Map(db.all('select id, currency, currency_precision from business where tenant_id = ?', tenantId).map((b) => [b.id as string, b]));
  /** invoice or payment amount → its business currency (stored rate) → report currency */
  const iv = (r: Row, minor: number) => {
    const b = bizRows.get(r.business_id)!;
    return conv.convert(inBase(minor, r.fx_factor), b.currency, b.currency_precision);
  };
  const pv = (p: Row) => iv(p, p.amount);

  // ---- invoices issued in the period, and every final invoice for balances as of today
  const finals = db.all(`${INVOICE_SELECT} where i.tenant_id = ? and i.status = 'final' ${bi}`, tenantId, ...bArgs);
  const inRange = finals.filter((r) => r.issue_date >= f.from && r.issue_date <= f.to);

  // ---- payments received in the period (rejected ones never count)
  const payments = db.all(
    `select p.*, c.name as client_name from payment p join client c on c.id = p.client_id
     where p.tenant_id = ? and p.verification_status <> 'rejected' and p.date between ? and ? ${bp} order by p.date`,
    tenantId, f.from, f.to, ...bArgs,
  );

  const daily = bucket(payments.map((p) => ({ key: p.date as string, amount: pv(p) })));
  const weekly = bucket(payments.map((p) => ({ key: weekStart(p.date), amount: pv(p) })));
  const monthly = bucket(payments.map((p) => ({ key: (p.date as string).slice(0, 7), amount: pv(p) })));
  const methods = bucket(payments.map((p) => ({ key: p.method as PaymentMethod, amount: pv(p) })));

  // ---- per client
  const clients = new Map<string, ReportData['clients'][number]>();
  const client = (id: string, name: string) => {
    let c = clients.get(id);
    if (!c) clients.set(id, (c = { clientId: id, clientName: name, invoiced: 0, collected: 0, outstanding: 0, invoiceCount: 0 }));
    return c;
  };
  for (const r of inRange) {
    const c = client(r.client_id, r.client_name);
    c.invoiced += iv(r, r.total);
    c.invoiceCount++;
  }
  for (const p of payments) client(p.client_id, p.client_name).collected += pv(p);
  for (const r of finals) if (r.total - r.paid > 0) client(r.client_id, r.client_name).outstanding += iv(r, r.total - r.paid);

  // ---- per service: line totals after item discounts, before the overall discount and tax
  const services = new Map<string, ReportData['services'][number] & { invoices: Set<string> }>();
  for (const r of inRange) {
    for (const l of JSON.parse(r.lines)) {
      const key = l.serviceId ?? `custom:${String(l.name).trim().toLowerCase()}`;
      let s = services.get(key);
      if (!s) services.set(key, (s = { name: l.name, serviceId: l.serviceId ?? null, qty: 0, revenue: 0, invoiceCount: 0, invoices: new Set() }));
      s.qty += l.qty;
      s.revenue += iv(r, l.lineTotal ?? 0);
      s.invoices.add(r.id);
    }
  }

  // ---- aging of what is owed today
  const aging = { notDue: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0 };
  const overdueInvoices: ReportData['overdueInvoices'] = [];
  let outstanding = 0;
  for (const r of finals) {
    if (r.total - r.paid <= 0) continue;
    const balance = iv(r, r.total - r.paid);
    outstanding += balance;
    const late = daysBetween(r.due_date, t);
    if (late <= 0) aging.notDue += balance;
    else {
      if (late <= 30) aging.d1to30 += balance;
      else if (late <= 60) aging.d31to60 += balance;
      else if (late <= 90) aging.d61to90 += balance;
      else aging.d90plus += balance;
      overdueInvoices.push({ invoiceId: r.id, number: r.number, clientName: r.client_name, dueDate: r.due_date, daysOverdue: late, balance });
    }
  }
  overdueInvoices.sort((a, b) => b.daysOverdue - a.daysOverdue);

  // ---- installments falling due in the period
  const inst: ReportData['installments'] = { scheduled: 0, collected: 0, outstanding: 0, overdue: 0, rows: [] };
  for (const r of finals) {
    const schedule = db.all('select * from installment where invoice_id = ? order by seq', r.id);
    if (!schedule.length) continue;
    const scheduleSum = schedule.reduce((a, x) => a + x.amount, 0);
    const toward = Math.max(0, r.paid - Math.max(0, r.total - scheduleSum));
    const states = applyToInstallments(schedule.map((x) => ({ amount: x.amount, dueDate: x.due_date })), toward, t);
    schedule.forEach((s, n) => {
      if (s.due_date < f.from || s.due_date > f.to) return;
      const st = states[n];
      inst.scheduled += iv(r, s.amount);
      inst.collected += iv(r, st.paid);
      inst.outstanding += iv(r, s.amount - st.paid);
      if (st.status === 'overdue') inst.overdue += iv(r, s.amount - st.paid);
      inst.rows.push({ invoiceId: r.id, invoiceNumber: r.number, clientName: r.client_name, dueDate: s.due_date, amount: iv(r, s.amount), paid: iv(r, st.paid), status: st.status });
    });
  }
  inst.rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const expenses = db.get(
    `select coalesce(sum(amount), 0) as s from finance_entry where tenant_id = ? and type = 'expense' and date between ? and ? ${f.businessId ? 'and business_id = ?' : ''}`,
    tenantId, f.from, f.to, ...bArgs,
  )!.s;

  return {
    from: f.from,
    to: f.to,
    currency: target,
    currencyPrecision: conv.precision,
    totals: {
      invoiced: inRange.reduce((a, r) => a + iv(r, r.total), 0),
      invoiceCount: inRange.length,
      collected: payments.reduce((a, p) => a + pv(p), 0),
      paymentCount: payments.length,
      outstanding,
      overdue: aging.d1to30 + aging.d31to60 + aging.d61to90 + aging.d90plus,
      expenses,
    },
    collections: {
      daily: [...daily].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
      weekly: [...weekly].map(([weekStart, v]) => ({ weekStart, ...v })).sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
      monthly: [...monthly].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month)),
    },
    methods: [...methods].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amount - a.amount),
    clients: [...clients.values()].sort((a, b) => b.invoiced - a.invoiced || b.outstanding - a.outstanding),
    services: [...services.values()].map(({ invoices, ...s }) => ({ ...s, invoiceCount: invoices.size })).sort((a, b) => b.revenue - a.revenue),
    aging,
    overdueInvoices,
    installments: inst,
  };
}

