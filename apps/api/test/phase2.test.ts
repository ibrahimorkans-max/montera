import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import ExcelJS from 'exceljs';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { runDue } from '../src/recurring';
import { occurrence } from '../../../packages/shared/src/index';

let server: Server;
let base = '';
let db: Db;

before(() => {
  db = new Db(':memory:');
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => server.close());

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? ((await res.json()) as any) : Buffer.from(await res.arrayBuffer()) };
}

async function setup(email: string) {
  const r = await call('', 'POST', '/auth/register', { businessName: 'Phase Two Co', name: 'Owner', email, password: 'test-pass-123' });
  const token = r.body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  const clientId = (await call(token, 'POST', '/clients', { name: 'Client One' })).body.id as string;
  return { token, businessId, clientId };
}

const line = { serviceId: null, name: 'Consulting', description: '', qty: 2000, unit: 'hour', unitPrice: 500_000, discountType: 'percent', discountValue: 0, taxRateBp: 0 };
const iso = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test('schedule dates do not drift on short months', () => {
  assert.equal(occurrence('2026-01-31', 'monthly', 1, 1), '2026-02-28');
  assert.equal(occurrence('2026-01-31', 'monthly', 1, 2), '2026-03-31');
  assert.equal(occurrence('2024-02-29', 'yearly', 1, 1), '2025-02-28');
  assert.equal(occurrence('2026-01-01', 'weekly', 2, 3), '2026-02-12');
  assert.equal(occurrence('2026-01-01', 'custom', 10, 2), '2026-01-21');
  assert.equal(occurrence('2026-11-30', 'monthly', 3, 1), '2027-02-28');
});

test('quotations: number, lifecycle, expiry and one-tap conversion', async () => {
  const { token, businessId, clientId } = await setup('q@test.dev');
  const body = { businessId, clientId, issueDate: iso(0), validUntil: iso(14), reference: 'PRJ-1', billingAddress: '', lines: [line], overallDiscountType: 'percent', overallDiscountValue: 1000, charges: [], notes: '', terms: 'Valid for 14 days' };
  const q = await call(token, 'POST', '/quotations', body);
  assert.equal(q.status, 201);
  assert.equal(q.body.number, 'QT-00001');
  assert.equal(q.body.total, 900_000);
  assert.equal(q.body.displayStatus, 'draft');

  assert.equal((await call(token, 'POST', `/quotations/${q.body.id}/status`, { status: 'accepted' })).status, 409); // must be sent first
  const sent = await call(token, 'POST', `/quotations/${q.body.id}/status`, { status: 'sent' });
  assert.equal(sent.body.displayStatus, 'sent');

  // convert: a draft invoice with the same lines, and converting again returns the same invoice
  const c1 = await call(token, 'POST', `/quotations/${q.body.id}/convert`);
  const c2 = await call(token, 'POST', `/quotations/${q.body.id}/convert`);
  assert.equal(c1.body.invoiceId, c2.body.invoiceId);
  const inv = (await call(token, 'GET', `/invoices/${c1.body.invoiceId}`)).body.invoice;
  assert.deepEqual([inv.status, inv.total, inv.reference], ['draft', 900_000, 'PRJ-1']);
  const after = (await call(token, 'GET', `/quotations/${q.body.id}`)).body.quotation;
  assert.deepEqual([after.displayStatus, after.convertedInvoiceId], ['converted', c1.body.invoiceId]);
  assert.equal((await call(token, 'PUT', `/quotations/${q.body.id}`, body)).status, 409);

  // an expired quotation shows as expired and is filtered as such
  const old = (await call(token, 'POST', '/quotations', { ...body, issueDate: iso(-30), validUntil: iso(-1) })).body;
  await call(token, 'POST', `/quotations/${old.id}/status`, { status: 'sent' });
  const expired = (await call(token, 'GET', '/quotations?status=expired')).body;
  assert.deepEqual(expired.map((x: any) => x.id), [old.id]);

  // only drafts can be deleted
  assert.equal((await call(token, 'DELETE', `/quotations/${old.id}`)).status, 409);
  const draft = (await call(token, 'POST', '/quotations', body)).body;
  assert.equal((await call(token, 'DELETE', `/quotations/${draft.id}`)).status, 200);
});

test('recurring: drafts for approval, automatic issue, no duplicates, pause and end', async () => {
  const { token, businessId, clientId } = await setup('r@test.dev');
  const base = { name: 'Monthly retainer', businessId, clientId, reference: '', billingAddress: '', lines: [line], overallDiscountType: 'percent', overallDiscountValue: 0, charges: [], notes: '', paymentTerms: '', frequency: 'weekly', interval: 1, endDate: null, dueDays: 7 };

  // started 15 days ago, weekly: runs on day -15, -8, -1 => 3 drafts straight away
  const review = await call(token, 'POST', '/recurring', { ...base, startDate: iso(-15), autoIssue: false });
  assert.equal(review.status, 201);
  assert.equal(review.body.generatedCount, 3);
  assert.equal(review.body.pendingDrafts, 3);
  assert.equal(review.body.nextDate, iso(6));
  const pending = (await call(token, 'GET', '/recurring-pending')).body;
  assert.equal(pending.length, 3);
  assert.ok(pending.every((i: any) => i.status === 'draft' && i.number === null));
  assert.equal(pending[0].dueDate, iso(-8));

  // running again creates nothing new
  assert.equal(runDue(db), 0);
  assert.equal((await call(token, 'GET', '/recurring-pending')).body.length, 3);

  // automatic issuing produces final, numbered invoices
  const auto = await call(token, 'POST', '/recurring', { ...base, name: 'Auto', startDate: iso(-1), autoIssue: true });
  const detail = (await call(token, 'GET', `/recurring/${auto.body.id}`)).body;
  assert.equal(detail.invoices.length, 1);
  assert.equal(detail.invoices[0].status, 'final');
  assert.match(detail.invoices[0].number, /^INV-/);

  // a staff member cannot turn on automatic issuing
  await call(token, 'POST', '/users', { name: 'Staff', email: 'staff@test.dev', password: 'test-pass-123', role: 'staff' });
  const staff = (await call('', 'POST', '/auth/login', { email: 'staff@test.dev', password: 'test-pass-123' })).body.accessToken;
  assert.equal((await call(staff, 'POST', '/recurring', { ...base, startDate: iso(5), autoIssue: true })).status, 403);

  // paused schedules do not run; an end date in the past ends the schedule
  await call(token, 'POST', `/recurring/${review.body.id}/status`, { status: 'paused' });
  const ended = await call(token, 'POST', '/recurring', { ...base, name: 'Ended', startDate: iso(-20), endDate: iso(-10), autoIssue: false });
  assert.equal(ended.body.generatedCount, 2); // day -20 and -13
  assert.equal(ended.body.status, 'ended');
  assert.equal(ended.body.nextDate, null);
});

test('reports: collections, aging, client and service revenue, and Excel export', async () => {
  const { token, businessId, clientId } = await setup('rep@test.dev');
  const inv = (extra: object) => ({ businessId, clientId, issueDate: iso(-40), dueDate: iso(-35), reference: '', billingAddress: '', lines: [line], overallDiscountType: 'percent', overallDiscountValue: 0, charges: [], notes: '', paymentTerms: '', installments: [], finalize: true, ...extra });
  const a = (await call(token, 'POST', '/invoices', inv({}))).body; // 1,000,000 overdue 35 days
  await call(token, 'POST', '/payments', { clientId, businessId, invoiceId: a.id, amount: 400_000, date: iso(-2), method: 'cash' });
  await call(token, 'POST', '/payments', { clientId, businessId, invoiceId: a.id, amount: 100_000, date: iso(-1), method: 'bank_transfer' });
  await call(token, 'POST', '/invoices', inv({ issueDate: iso(-1), dueDate: iso(10), installments: [{ dueDate: iso(3), amount: 500_000 }, { dueDate: iso(40), amount: 500_000 }] }));
  await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Rent', amount: 50_000, date: iso(-1) });

  const r = (await call(token, 'GET', `/reports?from=${iso(-60)}&to=${iso(0)}`)).body;
  assert.equal(r.totals.invoiced, 2_000_000);
  assert.equal(r.totals.collected, 500_000);
  assert.equal(r.totals.outstanding, 1_500_000);
  assert.equal(r.totals.overdue, 500_000);
  assert.equal(r.totals.expenses, 50_000);
  assert.equal(r.aging.d31to60, 500_000);
  assert.equal(r.aging.notDue, 1_000_000);
  assert.deepEqual(r.collections.daily.map((d: any) => d.amount), [400_000, 100_000]);
  assert.equal(r.collections.monthly.reduce((s: number, m: any) => s + m.amount, 0), 500_000);
  assert.deepEqual(r.methods.map((m: any) => m.method), ['cash', 'bank_transfer']);
  assert.deepEqual([r.clients[0].invoiced, r.clients[0].collected, r.clients[0].outstanding], [2_000_000, 500_000, 1_500_000]);
  assert.deepEqual([r.services[0].name, r.services[0].qty, r.services[0].revenue, r.services[0].invoiceCount], ['Consulting', 4000, 2_000_000, 2]);
  assert.equal(r.overdueInvoices[0].daysOverdue, 35);

  const narrow = (await call(token, 'GET', `/reports?from=${iso(0)}&to=${iso(30)}`)).body;
  assert.equal(narrow.installments.rows.length, 1);
  assert.equal(narrow.installments.scheduled, 500_000);

  const x = await call(token, 'GET', `/reports/export.xlsx?from=${iso(-60)}&to=${iso(0)}`);
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-disposition') ?? '', /monetra-report-.*\.xlsx/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((x.body as Buffer).buffer as ArrayBuffer);
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    ['Summary', 'Daily collections', 'Weekly collections', 'Monthly collections', 'Payment methods', 'Client revenue', 'Service revenue', 'Overdue invoices', 'Installments', 'Invoices', 'Payments'],
  );
  const pays = wb.getWorksheet('Payments')!;
  assert.equal(pays.getRow(2).getCell(7).value, 4000); // Rs. 4,000 as a number, not text
  assert.equal(pays.getRow(4).getCell(7).value, 5000); // total row

  assert.equal((await call(token, 'GET', `/reports?from=${iso(0)}&to=${iso(-1)}`)).status, 422);
  assert.equal((await call('', 'GET', '/reports/export.xlsx')).status, 401);
});
