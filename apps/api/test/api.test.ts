import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { allocateProportionally, computeInvoice, formatMoney, parseMoney, parseQty } from '../../../packages/shared/src/index';

let server: Server;
let base = '';

before(() => {
  server = createApp(new Db(':memory:')).listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => server.close());

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function register(email: string, businessName: string) {
  const r = await call('', 'POST', '/auth/register', { businessName, name: 'Owner', email, password: 'test-pass-123' });
  assert.equal(r.status, 201);
  const biz = (await call(r.body.accessToken, 'GET', '/businesses')).body[0];
  return { token: r.body.accessToken as string, refreshToken: r.body.refreshToken as string, businessId: biz.id as string };
}

const baseLine = { serviceId: null, name: 'Item', description: '', unit: 'pc', discountType: 'percent', discountValue: 0, taxRateBp: 0 };
function invoiceBody(businessId: string, clientId: string, extra: object = {}) {
  return {
    businessId, clientId, issueDate: '2026-01-01', dueDate: '2099-01-31', reference: '', billingAddress: '',
    lines: [{ ...baseLine, qty: 1000, unitPrice: 10_000_000 }],
    overallDiscountType: 'percent', overallDiscountValue: 0, charges: [], notes: '', paymentTerms: '', installments: [], finalize: true, ...extra,
  };
}

test('money parsing and formatting are exact', () => {
  assert.equal(parseMoney('1,234.56'), 123456);
  assert.equal(parseMoney('0.1'), 10);
  assert.equal(parseMoney('19.999'), 2000);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseQty('2.5'), 2500);
  assert.equal(formatMoney(10_000_000), 'Rs. 100,000');
  assert.equal(formatMoney(123456), 'Rs. 1,234.56');
  assert.equal(formatMoney(-50), '-Rs. 0.50');
});

test('invoice totals: discounts, exclusive tax, charges', () => {
  const t = computeInvoice({
    lines: [
      { qty: 2500, unitPrice: 19999, discountType: 'percent', discountValue: 1000, taxRateBp: 1700 }, // 2.5 x 199.99, 10% off, 17% tax
      { qty: 3000, unitPrice: 3333, discountType: 'fixed', discountValue: 999, taxRateBp: 0 },
    ],
    overallDiscountType: 'percent', overallDiscountValue: 500, charges: [{ label: 'Transport', amount: 50000 }],
    taxInclusive: false, rounding: 'none', precision: 2,
  });
  assert.equal(t.subtotal, 49998 + 9999);
  assert.equal(t.itemDiscounts, 5000 + 999);
  assert.equal(t.overallDiscount, 2700); // 5% of 53,998 = 2,699.9
  assert.equal(t.lines[0].afterOverall + t.lines[1].afterOverall, 53998 - 2700);
  assert.equal(t.taxableAmount, 51298);
  assert.equal(t.taxAmount, Math.round((t.lines[0].afterOverall * 17) / 100));
  assert.equal(t.total, t.taxableAmount + t.taxAmount + 50000);
});

test('invoice totals: inclusive tax and rounding rules', () => {
  const t = computeInvoice({
    lines: [{ qty: 1000, unitPrice: 11700, discountType: 'percent', discountValue: 0, taxRateBp: 1700 }],
    overallDiscountType: 'fixed', overallDiscountValue: 0, charges: [], taxInclusive: true, rounding: 'none', precision: 2,
  });
  assert.deepEqual([t.taxableAmount, t.taxAmount, t.total], [10000, 1700, 11700]);
  const r = computeInvoice({
    lines: [{ qty: 1000, unitPrice: 123456, discountType: 'percent', discountValue: 0, taxRateBp: 0 }],
    overallDiscountType: 'fixed', overallDiscountValue: 0, charges: [], taxInclusive: false, rounding: 'nearest_10', precision: 2,
  });
  assert.deepEqual([r.total, r.roundingAdjustment], [123000, -456]);
  assert.deepEqual(allocateProportionally(100, [1, 1, 1]), [34, 33, 33]);
});

test('partial payments, installments, receipts and overpayment credit', async () => {
  const { token, businessId } = await register('a@test.dev', 'Alpha Co');
  const client = (await call(token, 'POST', '/clients', { name: 'Client A' })).body;

  const created = await call(token, 'POST', '/invoices', invoiceBody(businessId, client.id, {
    installments: [{ dueDate: '2099-01-10', amount: 3_000_000 }, { dueDate: '2099-01-20', amount: 2_000_000 }, { dueDate: '2099-01-30', amount: 5_000_000 }],
    initialPayment: { amount: 3_000_000, date: '2026-01-01', method: 'cash', reference: '', notes: '' },
  }));
  assert.equal(created.status, 201);
  const inv = created.body;
  assert.equal(inv.number, 'INV-00001');
  assert.deepEqual([inv.total, inv.paid, inv.balance, inv.displayStatus], [10_000_000, 3_000_000, 7_000_000, 'partially_paid']);

  const second = { clientId: client.id, businessId, invoiceId: inv.id, amount: 2_000_000, date: '2026-01-05', method: 'bank_transfer', reference: 'T1', notes: '', clientRequestId: 'req-00000001' };
  const p2 = await call(token, 'POST', '/payments', second);
  assert.equal(p2.status, 201);
  assert.equal(p2.body.number, 'RCT-000002');

  // the same offline request retried must not create a second payment
  const dup = await call(token, 'POST', '/payments', second);
  assert.equal(dup.body.id, p2.body.id);

  let detail = (await call(token, 'GET', `/invoices/${inv.id}`)).body;
  assert.deepEqual([detail.invoice.paid, detail.invoice.balance], [5_000_000, 5_000_000]);
  assert.deepEqual(detail.invoice.installments.map((s: any) => s.status), ['paid', 'paid', 'pending']);
  assert.equal(detail.payments.length, 2);

  // overpay by 10,000: only the balance is allocated, the rest becomes client credit
  const p3 = (await call(token, 'POST', '/payments', { clientId: client.id, businessId, invoiceId: inv.id, amount: 6_000_000, date: '2026-01-09', method: 'cash', reference: '', notes: '' })).body;
  assert.equal(p3.allocations[0].amount, 5_000_000);
  assert.equal(p3.unallocated, 1_000_000);
  detail = (await call(token, 'GET', `/invoices/${inv.id}`)).body;
  assert.deepEqual([detail.invoice.paid, detail.invoice.balance, detail.invoice.displayStatus], [10_000_000, 0, 'paid']);

  // credit is applied to the next invoice on request
  const inv2 = (await call(token, 'POST', '/invoices', invoiceBody(businessId, client.id))).body;
  const applied = (await call(token, 'POST', `/invoices/${inv2.id}/apply-credit`, {})).body;
  assert.equal(applied.applied, 1_000_000);
  assert.equal(applied.invoice.balance, 9_000_000);

  const ledger = (await call(token, 'GET', `/clients/${client.id}/ledger`)).body;
  assert.deepEqual([ledger.totalInvoiced, ledger.totalPaid, ledger.outstanding, ledger.credit], [20_000_000, 11_000_000, 9_000_000, 0]);
  assert.equal(ledger.entries.at(-1).balance, 9_000_000);

  // rejecting a payment restores the balance
  await call(token, 'POST', `/payments/${p2.body.id}/reject`);
  detail = (await call(token, 'GET', `/invoices/${inv.id}`)).body;
  assert.equal(detail.invoice.balance, 2_000_000);

  const dash = (await call(token, 'GET', '/dashboard')).body;
  assert.equal(dash.totalInvoiced, 20_000_000);
  assert.equal(dash.outstanding, 11_000_000);
  assert.equal(dash.totalReceived, 9_000_000);
});

test('drafts: edit, finalize, immutability, idempotent create', async () => {
  const { token, businessId } = await register('b@test.dev', 'Beta Co');
  const client = (await call(token, 'POST', '/clients', { name: 'Client B' })).body;
  const body = invoiceBody(businessId, client.id, { finalize: false, clientRequestId: 'draft-0001' });
  const d1 = (await call(token, 'POST', '/invoices', body)).body;
  const d2 = (await call(token, 'POST', '/invoices', body)).body;
  assert.equal(d1.id, d2.id);
  assert.deepEqual([d1.status, d1.number], ['draft', null]);

  const pay = await call(token, 'POST', '/payments', { clientId: client.id, businessId, invoiceId: d1.id, amount: 100, date: '2026-01-01', method: 'cash', reference: '', notes: '' });
  assert.equal(pay.status, 409);

  const fin = (await call(token, 'PUT', `/invoices/${d1.id}`, { ...body, finalize: true })).body;
  assert.deepEqual([fin.status, fin.number], ['final', 'INV-00001']);
  assert.equal((await call(token, 'PUT', `/invoices/${d1.id}`, body)).status, 409);
  const tooMuch = await call(token, 'PUT', `/invoices/${d1.id}/installments`, { installments: [{ dueDate: '2099-01-01', amount: 10_000_001 }] });
  assert.equal(tooMuch.status, 422);
});

test('finance: money in and out, with client payments counted as income', async () => {
  const { token, businessId } = await register('f@test.dev', 'Finance Co');
  const other = await register('g@test.dev', 'Other Co');
  const client = (await call(token, 'POST', '/clients', { name: 'Payer' })).body;
  const inv = (await call(token, 'POST', '/invoices', invoiceBody(businessId, client.id))).body;
  await call(token, 'POST', '/payments', { clientId: client.id, businessId, invoiceId: inv.id, amount: 4_000_000, date: '2026-02-01', method: 'cash' });
  const rent = await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Rent', amount: 1_500_000, date: '2026-02-03', party: 'Landlord' });
  assert.equal(rent.status, 201);
  await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Fuel & transport', amount: 250_000, date: '2026-02-04' });
  await call(token, 'POST', '/finance/entries', { businessId, type: 'income', category: 'Owner investment', amount: 1_000_000, date: '2026-02-05' });

  const s = (await call(token, 'GET', '/finance/summary?from=2026-02-01&to=2026-02-28')).body;
  assert.deepEqual([s.income, s.expense, s.net, s.fromClients], [5_000_000, 1_750_000, 3_250_000, 4_000_000]);
  assert.deepEqual(s.expenseByCategory[0], { category: 'Rent', amount: 1_500_000 });
  assert.equal(s.incomeByCategory[0].category, 'Client payments');

  const list = (await call(token, 'GET', '/finance/entries?type=expense')).body;
  assert.equal(list.length, 2);
  assert.equal((await call(token, 'GET', '/finance/entries')).body.length, 4);

  // other tenants see nothing and cannot touch the entry
  assert.equal((await call(other.token, 'GET', '/finance/entries')).body.length, 0);
  assert.equal((await call(other.token, 'DELETE', '/finance/entries/' + rent.body.id)).status, 404);
  assert.equal((await call(token, 'DELETE', '/finance/entries/' + rent.body.id)).status, 200);
  assert.equal((await call(token, 'GET', '/finance/summary')).body.expense, 250_000);

  assert.equal((await call(token, 'POST', '/auth/verify-password', { password: 'wrong-password' })).status, 403);
  assert.equal((await call(token, 'POST', '/auth/verify-password', { password: 'test-pass-123' })).status, 200);
});

test('tenant isolation, roles and sessions', async () => {
  const a = await register('c@test.dev', 'Gamma Co');
  const b = await register('d@test.dev', 'Delta Co');
  const client = (await call(a.token, 'POST', '/clients', { name: 'Private Client' })).body;
  const inv = (await call(a.token, 'POST', '/invoices', invoiceBody(a.businessId, client.id))).body;

  assert.equal((await call(b.token, 'GET', `/invoices/${inv.id}`)).status, 404);
  assert.equal((await call(b.token, 'GET', `/clients/${client.id}/ledger`)).status, 404);
  assert.equal((await call(b.token, 'GET', '/invoices')).body.length, 0);
  assert.equal((await call(b.token, 'GET', '/clients')).body.length, 0);
  // another tenant's client or business cannot be referenced
  const bClient = (await call(b.token, 'POST', '/clients', { name: 'B Client' })).body;
  assert.equal((await call(b.token, 'POST', '/invoices', invoiceBody(a.businessId, bClient.id))).status, 404);
  assert.equal((await call(b.token, 'POST', '/payments', { clientId: client.id, businessId: b.businessId, amount: 100, date: '2026-01-01', method: 'cash' })).status, 404);

  await call(a.token, 'POST', '/users', { name: 'Viewer', email: 'viewer@test.dev', password: 'test-pass-123', role: 'viewer' });
  const viewer = (await call('', 'POST', '/auth/login', { email: 'viewer@test.dev', password: 'test-pass-123' })).body;
  assert.equal((await call(viewer.accessToken, 'GET', '/invoices')).status, 200);
  assert.equal((await call(viewer.accessToken, 'POST', '/invoices', invoiceBody(a.businessId, client.id))).status, 403);
  assert.equal((await call(viewer.accessToken, 'POST', '/payments', {})).status, 403);

  assert.equal((await call('', 'GET', '/invoices')).status, 401);
  const refreshed = await call('', 'POST', '/auth/refresh', { refreshToken: a.refreshToken });
  assert.equal(refreshed.status, 200);
  assert.equal((await call('', 'POST', '/auth/refresh', { refreshToken: a.refreshToken })).status, 401); // rotated
  await call(refreshed.body.accessToken, 'POST', '/auth/logout');
  assert.equal((await call(refreshed.body.accessToken, 'GET', '/invoices')).status, 401);
});
