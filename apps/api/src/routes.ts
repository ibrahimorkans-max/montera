import { z } from 'zod';
import { now, uid, type Db } from './core';
import * as acc from './accounts';
import * as d from './domain';
import * as fin from './finance';
import * as fx from './fx';
import * as pur from './purchases';
import { HttpError, can, need, type Req, type Res } from './perm';
import * as quotes from './quotes';
import * as rec from './recurring';
import { buildReport, type ReportFilter } from './reports';

/** Anything with Express-style route methods: the Express app on the server, MiniApp on the phone. */
export interface AppLike {
  get(path: string, ...handlers: any[]): unknown;
  post(path: string, ...handlers: any[]): unknown;
  put(path: string, ...handlers: any[]): unknown;
  delete(path: string, ...handlers: any[]): unknown;
}

const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const toDb = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : v);

/** Generic tenant-scoped insert/update for the simple master-data tables. */
export function upsert(db: Db, table: 'business' | 'client' | 'service', tenantId: string, data: Record<string, unknown>, id?: string): string {
  const cols = Object.keys(data).map(camelToSnake);
  const vals = Object.values(data).map(toDb) as any[];
  if (id) {
    d.ownedRow(db, table, tenantId, id);
    db.run(`update ${table} set ${cols.map((c) => `${c} = ?`).join(', ')} where id = ? and tenant_id = ?`, ...vals, id, tenantId);
    return id;
  }
  const newId = uid();
  db.run(
    `insert into ${table} (id, tenant_id, created_at, ${cols.join(', ')}) values (?, ?, ?, ${cols.map(() => '?').join(', ')})`,
    newId, tenantId, now(), ...vals,
  );
  return newId;
}

/**
 * Every business route (clients, invoices, payments, finance, reports…). The server registers
 * them on Express; the phone registers the same code on MiniApp to work offline.
 * All handlers are synchronous and use only the portable database interface.
 */
export function registerRoutes(app: AppLike, db: Db) {
  const T = (req: Req) => req.auth.tenantId;
  const page = (req: Req) => ({
    limit: Math.min(Math.max(Number(req.query.limit) || 30, 1), 100),
    offset: Math.max(Number(req.query.offset) || 0, 0),
    q: String(req.query.q ?? '').trim(),
  });

  // ------------------------------------------------------------ business profiles

  app.get('/businesses', (req: Req, res: Res) => {
    res.json(db.all('select * from business where tenant_id = ? order by created_at', T(req)).map(d.mapBusiness));
  });
  app.post('/businesses', need('businesses.manage'), (req: Req, res: Res) => {
    const id = upsert(db, 'business', T(req), d.businessSchema.parse(req.body));
    acc.ensureAccounts(db, { businessId: id });
    db.audit(T(req), req.auth.userId, 'business.create', 'business', id);
    res.status(201).json(d.mapBusiness(d.ownedRow(db, 'business', T(req), id)));
  });
  app.put('/businesses/:id', need('businesses.manage'), (req: Req, res: Res) => {
    upsert(db, 'business', T(req), d.businessSchema.parse(req.body), String(req.params.id));
    db.audit(T(req), req.auth.userId, 'business.update', 'business', String(req.params.id));
    res.json(d.mapBusiness(d.ownedRow(db, 'business', T(req), String(req.params.id))));
  });

  // ------------------------------------------------------------ clients

  app.get('/clients', (req: Req, res: Res) => {
    const { limit, offset, q } = page(req);
    res.json(d.listClients(db, T(req), q, limit, offset));
  });
  app.get('/clients/:id', (req: Req, res: Res) => res.json(d.getClient(db, T(req), String(req.params.id))));
  app.get('/clients/:id/ledger', need('invoices.view'), (req: Req, res: Res) => res.json(d.clientLedger(db, T(req), String(req.params.id))));
  app.post('/clients', need('clients.manage'), (req: Req, res: Res) => {
    const id = upsert(db, 'client', T(req), d.clientSchema.parse(req.body));
    db.audit(T(req), req.auth.userId, 'client.create', 'client', id);
    res.status(201).json(d.getClient(db, T(req), id));
  });
  app.put('/clients/:id', need('clients.manage'), (req: Req, res: Res) => {
    upsert(db, 'client', T(req), d.clientSchema.parse(req.body), String(req.params.id));
    db.audit(T(req), req.auth.userId, 'client.update', 'client', String(req.params.id));
    res.json(d.getClient(db, T(req), String(req.params.id)));
  });

  // ------------------------------------------------------------ services & products

  app.get('/services', (req: Req, res: Res) => {
    const { limit, offset, q } = page(req);
    const like = `%${q}%`;
    res.json(
      db
        .all('select * from service where tenant_id = ? and (name like ? or category like ?) order by name collate nocase limit ? offset ?', T(req), like, like, Math.max(limit, 100), offset)
        .map(d.mapService),
    );
  });
  app.post('/services', need('invoices.create'), (req: Req, res: Res) => {
    const id = upsert(db, 'service', T(req), d.serviceSchema.parse(req.body));
    res.status(201).json(d.mapService(d.ownedRow(db, 'service', T(req), id)));
  });
  app.put('/services/:id', need('invoices.create'), (req: Req, res: Res) => {
    upsert(db, 'service', T(req), d.serviceSchema.parse(req.body), String(req.params.id));
    res.json(d.mapService(d.ownedRow(db, 'service', T(req), String(req.params.id))));
  });

  // ------------------------------------------------------------ invoices

  app.get('/invoices', need('invoices.view'), (req: Req, res: Res) => {
    const { limit, offset, q } = page(req);
    const where: string[] = ['i.tenant_id = ?'];
    const args: any[] = [T(req)];
    if (q) {
      where.push('(i.number like ? or c.name like ? or i.reference like ?)');
      args.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    for (const [param, col] of [['clientId', 'i.client_id'], ['businessId', 'i.business_id']] as const) {
      if (req.query[param]) {
        where.push(`${col} = ?`);
        args.push(String(req.query[param]));
      }
    }
    if (req.query.from) (where.push('i.issue_date >= ?'), args.push(String(req.query.from)));
    if (req.query.to) (where.push('i.issue_date <= ?'), args.push(String(req.query.to)));
    const status = String(req.query.status ?? '');
    const having: Record<string, string> = {
      draft: "status = 'draft'",
      cancelled: "status = 'cancelled'",
      paid: "status = 'final' and paid >= total",
      unpaid: "status = 'final' and paid = 0 and total > 0",
      partially_paid: "status = 'final' and paid > 0 and paid < total",
      overdue: "status = 'final' and paid < total and due_date < date('now')",
      outstanding: "status = 'final' and paid < total",
    };
    const sql = `select * from (${d.INVOICE_SELECT} where ${where.join(' and ')}) ${having[status] ? `where ${having[status]}` : ''}
                 order by issue_date desc, created_at desc limit ? offset ?`;
    res.json(db.all(sql, ...args, limit, offset).map((r) => d.mapInvoice(r)));
  });

  app.get('/invoices/:id', need('invoices.view'), (req: Req, res: Res) => {
    const invoice = d.getInvoice(db, T(req), String(req.params.id));
    const payments = d.listPayments(db, T(req), 'and p.id in (select payment_id from payment_allocation where invoice_id = ?)', [invoice.id], 200);
    const client = d.getClient(db, T(req), invoice.clientId);
    const business = d.mapBusiness(d.ownedRow(db, 'business', T(req), invoice.businessId));
    res.json({ invoice, payments, client, business });
  });

  app.post('/invoices', need('invoices.create'), (req: Req, res: Res) => {
    const body = d.invoiceSchema.parse(req.body);
    if (body.overrideCreditLimit && !can(req, 'invoices.approve')) throw new HttpError(403, 'Only a manager can approve going over a credit limit.');
    if (body.finalize && !can(req, 'invoices.finalize')) throw new HttpError(403, 'You can save drafts, but finalizing needs a higher permission.');
    if (body.initialPayment && !can(req, 'payments.record')) throw new HttpError(403, 'You do not have permission to record payments.');
    res.status(201).json(d.createInvoice(db, req.auth, body, can(req, 'payments.verify')));
  });

  app.put('/invoices/:id', need('invoices.edit_draft'), (req: Req, res: Res) => {
    const body = d.invoiceSchema.parse(req.body);
    if (body.overrideCreditLimit && !can(req, 'invoices.approve')) throw new HttpError(403, 'Only a manager can approve going over a credit limit.');
    if (body.finalize && !can(req, 'invoices.finalize')) throw new HttpError(403, 'You can save drafts, but finalizing needs a higher permission.');
    if (body.initialPayment && !can(req, 'payments.record')) throw new HttpError(403, 'You do not have permission to record payments.');
    res.json(d.updateDraft(db, req.auth, String(req.params.id), body, can(req, 'payments.verify')));
  });

  app.post('/invoices/:id/finalize', need('invoices.finalize'), (req: Req, res: Res) => {
    const { overrideCreditLimit } = z.object({ overrideCreditLimit: z.boolean().default(false) }).parse(req.body ?? {});
    if (overrideCreditLimit && !can(req, 'invoices.approve')) throw new HttpError(403, 'Only a manager can approve going over a credit limit.');
    res.json(d.finalizeInvoice(db, req.auth, String(req.params.id), overrideCreditLimit));
  });
  app.post('/invoices/:id/cancel', need('invoices.cancel'), (req: Req, res: Res) => {
    const { reason } = z.object({ reason: z.string().trim().max(500).default('') }).parse(req.body ?? {});
    res.json(d.cancelInvoice(db, req.auth, String(req.params.id), reason));
  });
  app.delete('/invoices/:id', need('invoices.edit_draft'), (req: Req, res: Res) => {
    d.deleteDraft(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });
  app.put('/invoices/:id/installments', need('invoices.finalize'), (req: Req, res: Res) => {
    res.json(d.replaceInstallments(db, req.auth, String(req.params.id), d.installmentsSchema.parse(req.body).installments));
  });
  app.post('/invoices/:id/apply-credit', need('payments.record'), (req: Req, res: Res) => {
    const { amount } = z.object({ amount: z.number().int().min(1).optional() }).parse(req.body ?? {});
    res.json(d.applyCredit(db, req.auth, String(req.params.id), amount));
  });

  // ------------------------------------------------------------ payments & receipts

  app.get('/payments', need('invoices.view'), (req: Req, res: Res) => {
    const { limit, offset, q } = page(req);
    const where: string[] = [];
    const args: any[] = [];
    if (q) (where.push('and (p.number like ? or c.name like ? or p.reference like ?)'), args.push(`%${q}%`, `%${q}%`, `%${q}%`));
    if (req.query.clientId) (where.push('and p.client_id = ?'), args.push(String(req.query.clientId)));
    if (req.query.businessId) (where.push('and p.business_id = ?'), args.push(String(req.query.businessId)));
    res.json(d.listPayments(db, T(req), where.join(' '), args, limit, offset));
  });
  app.get('/payments/:id', need('invoices.view'), (req: Req, res: Res) => {
    const payment = d.getPayment(db, T(req), String(req.params.id));
    res.json({
      payment,
      client: d.getClient(db, T(req), payment.clientId),
      business: d.mapBusiness(d.ownedRow(db, 'business', T(req), payment.businessId)),
      invoices: payment.allocations.map((a) => d.getInvoice(db, T(req), a.invoiceId)),
    });
  });
  app.post('/payments', need('payments.record'), (req: Req, res: Res) => {
    res.status(201).json(d.recordPayment(db, req.auth, d.paymentSchema.parse(req.body), can(req, 'payments.verify')));
  });
  app.post('/payments/:id/verify', need('payments.verify'), (req: Req, res: Res) => res.json(d.setPaymentVerification(db, req.auth, String(req.params.id), 'verified')));
  app.post('/payments/:id/reject', need('payments.verify'), (req: Req, res: Res) => res.json(d.setPaymentVerification(db, req.auth, String(req.params.id), 'rejected')));

  // ------------------------------------------------------------ dashboard, installments, audit

  app.get('/dashboard', need('invoices.view'), (req: Req, res: Res) => {
    const s = (k: string) => (req.query[k] ? String(req.query[k]) : undefined);
    res.json(d.dashboard(db, T(req), { businessId: s('businessId'), from: s('from'), to: s('to') }));
  });
  app.get('/installments', need('invoices.view'), (req: Req, res: Res) => {
    res.json(d.listInstallments(db, T(req), req.query.businessId ? String(req.query.businessId) : undefined));
  });
  app.get('/audit', need('reports.view'), (req: Req, res: Res) => {
    const { limit, offset } = page(req);
    res.json(db.all('select a.*, u.name as user_name from audit_log a left join app_user u on u.id = a.user_id where a.tenant_id = ? order by a.at desc limit ? offset ?', T(req), limit, offset));
  });

  // ------------------------------------------------------------ finance: money in and money out

  const financeFilter = (req: Req): fin.FinanceFilter => {
    const s = (k: string) => (req.query[k] ? String(req.query[k]) : undefined);
    return { businessId: s('businessId'), from: s('from'), to: s('to'), type: s('type') };
  };
  app.get('/finance/categories', need('reports.view'), (req: Req, res: Res) => res.json(fin.usedCategories(db, T(req))));
  app.get('/finance/summary', need('reports.view'), (req: Req, res: Res) => res.json(fin.summary(db, T(req), financeFilter(req))));
  app.get('/finance/entries', need('reports.view'), (req: Req, res: Res) => {
    const { limit, offset } = page(req);
    res.json(fin.listEntries(db, T(req), financeFilter(req), limit, offset));
  });
  app.post('/finance/entries', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(fin.saveEntry(db, req.auth, fin.financeSchema.parse(req.body))));
  app.put('/finance/entries/:id', need('finance.manage'), (req: Req, res: Res) => res.json(fin.saveEntry(db, req.auth, fin.financeSchema.parse(req.body), String(req.params.id))));
  app.delete('/finance/entries/:id', need('finance.manage'), (req: Req, res: Res) => {
    fin.deleteEntry(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ purchases: bills for things bought (each one is Money out)

  const purchaseFilter = (req: Req): pur.PurchaseFilter => {
    const s = (k: string) => (req.query[k] ? String(req.query[k]) : undefined);
    return { businessId: s('businessId'), from: s('from'), to: s('to'), q: s('q') };
  };
  app.get('/purchases/summary', need('reports.view'), (req: Req, res: Res) => res.json(pur.purchaseSummary(db, T(req), purchaseFilter(req))));
  app.get('/purchases/suppliers', need('reports.view'), (req: Req, res: Res) => res.json(pur.suppliers(db, T(req))));
  app.get('/purchases', need('reports.view'), (req: Req, res: Res) => {
    const { limit, offset } = page(req);
    res.json(pur.listPurchases(db, T(req), purchaseFilter(req), limit, offset));
  });
  app.get('/purchases/:id', need('reports.view'), (req: Req, res: Res) => res.json(pur.getPurchase(db, T(req), String(req.params.id))));
  app.post('/purchases', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(pur.savePurchase(db, req.auth, pur.purchaseSchema.parse(req.body))));
  app.put('/purchases/:id', need('finance.manage'), (req: Req, res: Res) => res.json(pur.savePurchase(db, req.auth, pur.purchaseSchema.parse(req.body), String(req.params.id))));
  app.put('/purchases/:id/installments/:n', need('finance.manage'), (req: Req, res: Res) =>
    res.json(pur.setInstallmentPaid(db, req.auth, String(req.params.id), Number(req.params.n), z.object({ paid: z.boolean() }).parse(req.body).paid)),
  );
  app.delete('/purchases/:id', need('finance.manage'), (req: Req, res: Res) => {
    pur.deletePurchase(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ quotations

  app.get('/quotations', need('invoices.view'), (req: Req, res: Res) => {
    const { limit, offset, q } = page(req);
    res.json(quotes.listQuotes(db, T(req), { q, status: String(req.query.status ?? ''), clientId: req.query.clientId ? String(req.query.clientId) : undefined }, limit, offset));
  });
  app.get('/quotations/:id', need('invoices.view'), (req: Req, res: Res) => {
    const quotation = quotes.getQuote(db, T(req), String(req.params.id));
    res.json({
      quotation,
      client: d.getClient(db, T(req), quotation.clientId),
      business: d.mapBusiness(d.ownedRow(db, 'business', T(req), quotation.businessId)),
    });
  });
  app.post('/quotations', need('invoices.create'), (req: Req, res: Res) => res.status(201).json(quotes.saveQuote(db, req.auth, quotes.quotationSchema.parse(req.body))));
  app.put('/quotations/:id', need('invoices.edit_draft'), (req: Req, res: Res) => res.json(quotes.saveQuote(db, req.auth, quotes.quotationSchema.parse(req.body), String(req.params.id))));
  app.post('/quotations/:id/status', need('invoices.create'), (req: Req, res: Res) => {
    const { status } = z.object({ status: z.enum(['draft', 'sent', 'accepted', 'rejected']) }).parse(req.body);
    res.json(quotes.setQuoteStatus(db, req.auth, String(req.params.id), status));
  });
  app.post('/quotations/:id/convert', need('invoices.create'), (req: Req, res: Res) => res.json(quotes.convertQuote(db, req.auth, String(req.params.id), can(req, 'payments.verify'))));
  app.delete('/quotations/:id', need('invoices.edit_draft'), (req: Req, res: Res) => {
    quotes.deleteQuote(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ recurring invoices

  app.get('/recurring', need('invoices.view'), (req: Req, res: Res) => res.json(rec.listRecurring(db, T(req))));
  app.get('/recurring/:id', need('invoices.view'), (req: Req, res: Res) => {
    const schedule = rec.getRecurring(db, T(req), String(req.params.id));
    const invoices = db.all(`${d.INVOICE_SELECT} where i.tenant_id = ? and i.recurring_id = ? order by i.issue_date desc limit 50`, T(req), schedule.id).map((r) => d.mapInvoice(r));
    res.json({ schedule, invoices });
  });
  app.post('/recurring', need('invoices.create'), (req: Req, res: Res) => {
    const saved = rec.saveRecurring(db, req.auth, rec.recurringSchema.parse(req.body), can(req, 'invoices.finalize'));
    rec.runDue(db, { id: saved.id }); // a start date of today or earlier produces its invoice straight away
    res.status(201).json(rec.getRecurring(db, T(req), saved.id));
  });
  app.put('/recurring/:id', need('invoices.create'), (req: Req, res: Res) => {
    const saved = rec.saveRecurring(db, req.auth, rec.recurringSchema.parse(req.body), can(req, 'invoices.finalize'), String(req.params.id));
    rec.runDue(db, { id: saved.id });
    res.json(rec.getRecurring(db, T(req), saved.id));
  });
  app.post('/recurring/:id/status', need('invoices.create'), (req: Req, res: Res) => {
    const { status } = z.object({ status: z.enum(['active', 'paused']) }).parse(req.body);
    const saved = rec.setRecurringStatus(db, req.auth, String(req.params.id), status);
    if (status === 'active') rec.runDue(db, { id: saved.id });
    res.json(rec.getRecurring(db, T(req), saved.id));
  });
  app.delete('/recurring/:id', need('invoices.create'), (req: Req, res: Res) => {
    rec.deleteRecurring(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });
  /** Drafts generated by schedules that are waiting for someone to approve them. */
  app.get('/recurring-pending', need('invoices.view'), (req: Req, res: Res) => {
    res.json(db.all(`${d.INVOICE_SELECT} where i.tenant_id = ? and i.status = 'draft' and i.recurring_id is not null order by i.issue_date`, T(req)).map((r) => d.mapInvoice(r)));
  });

  // ------------------------------------------------------------ reports

  const reportFilter = (req: Req): ReportFilter => {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    const t = new Date().toISOString().slice(0, 10);
    const from = date.safeParse(req.query.from).success ? String(req.query.from) : `${t.slice(0, 7)}-01`;
    const to = date.safeParse(req.query.to).success ? String(req.query.to) : t;
    if (to < from) throw new HttpError(422, 'The end of the period is before its start.');
    return { from, to, businessId: req.query.businessId ? String(req.query.businessId) : undefined };
  };
  app.get('/reports', need('reports.view'), (req: Req, res: Res) => res.json(buildReport(db, T(req), reportFilter(req))));

  // ------------------------------------------------------------ money accounts, transfers, cashbook

  const dateQ = (req: Req, key: string, fallback: string) => (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query[key] ?? '')) ? String(req.query[key]) : fallback);
  const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const bizQ = (req: Req) => (req.query.businessId ? String(req.query.businessId) : undefined);

  app.get('/accounts', need('invoices.view'), (req: Req, res: Res) => {
    acc.ensureAccounts(db, { tenantId: T(req) });
    res.json(acc.listAccounts(db, T(req), bizQ(req), req.query.all === '1'));
  });
  app.get('/accounts/:id', need('invoices.view'), (req: Req, res: Res) => res.json(acc.getAccount(db, T(req), String(req.params.id))));
  app.post('/accounts', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(acc.saveAccount(db, req.auth, acc.accountSchema.parse(req.body))));
  app.put('/accounts/:id', need('finance.manage'), (req: Req, res: Res) => res.json(acc.saveAccount(db, req.auth, acc.accountSchema.parse(req.body), String(req.params.id))));
  app.get('/transfers', need('invoices.view'), (req: Req, res: Res) => res.json(acc.listTransfers(db, T(req), bizQ(req))));
  app.post('/transfers', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(acc.saveTransfer(db, req.auth, acc.transferSchema.parse(req.body))));
  app.delete('/transfers/:id', need('finance.manage'), (req: Req, res: Res) => {
    acc.deleteTransfer(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });
  app.get('/cashbook', need('reports.view'), (req: Req, res: Res) => {
    acc.ensureAccounts(db, { tenantId: T(req) });
    res.json(acc.cashbook(db, T(req), { businessId: bizQ(req), accountId: req.query.accountId ? String(req.query.accountId) : undefined, from: dateQ(req, 'from', todayIso()), to: dateQ(req, 'to', todayIso()) }));
  });
  app.get('/reports/pnl', need('reports.view'), (req: Req, res: Res) => {
    res.json(acc.profitLoss(db, T(req), { businessId: bizQ(req), from: dateQ(req, 'from', monthStart()), to: dateQ(req, 'to', todayIso()), basis: req.query.basis === 'cash' ? 'cash' : 'accrual' }));
  });
  app.get('/reports/cashflow', need('reports.view'), (req: Req, res: Res) => {
    acc.ensureAccounts(db, { tenantId: T(req) });
    res.json(acc.cashFlow(db, T(req), { businessId: bizQ(req), from: dateQ(req, 'from', monthStart()), to: dateQ(req, 'to', todayIso()) }));
  });

  // ------------------------------------------------------------ client advance, credit limits

  app.post('/clients/:id/apply-credit', need('payments.record'), (req: Req, res: Res) => res.json({ applied: d.applyCreditAll(db, req.auth, String(req.params.id)) }));
  app.post('/clients/:id/refunds', need('payments.refund'), (req: Req, res: Res) => res.status(201).json(acc.refundCredit(db, req.auth, String(req.params.id), acc.refundSchema.parse(req.body))));
  app.get('/clients/:id/credit-check', need('invoices.view'), (req: Req, res: Res) => {
    const extra = Number(req.query.amount) || 0;
    res.json(d.creditCheck(db, T(req), String(req.params.id), extra));
  });

  // ------------------------------------------------------------ exchange rates

  app.get('/exchange-rates', need('invoices.view'), (req: Req, res: Res) => res.json({ reportingCurrency: fx.reportingCurrency(db, T(req)), rates: fx.listRates(db, T(req)) }));
  app.post('/exchange-rates', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(fx.saveRate(db, req.auth, fx.rateSchema.parse(req.body))));
  app.delete('/exchange-rates/:id', need('finance.manage'), (req: Req, res: Res) => {
    fx.deleteRate(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });
  app.get('/exchange-rates/lookup', need('invoices.view'), (req: Req, res: Res) => {
    const q = z.object({ currency: z.string().length(3), base: z.string().length(3), date: z.string().optional() }).parse(req.query);
    res.json({ rate: fx.findRate(db, T(req), q.currency.toUpperCase(), q.base.toUpperCase(), q.date) });
  });
  app.put('/settings/reporting-currency', need('businesses.manage'), (req: Req, res: Res) => {
    const { currency } = z.object({ currency: z.string().trim().length(3).toUpperCase() }).parse(req.body);
    db.run('update tenant set reporting_currency = ? where id = ?', currency, T(req));
    res.json({ reportingCurrency: currency });
  });

}

export { HttpError };
