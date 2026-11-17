import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import ExcelJS from 'exceljs';
import { createApp } from '../src/app';
import { Db } from '../src/db';

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
  return { status: res.status, body: type.includes('json') ? ((await res.json()) as any) : Buffer.from(await res.arrayBuffer()) };
}

async function setup(email: string) {
  const r = await call('', 'POST', '/auth/register', { businessName: 'Gone Co', name: 'Owner', email, password: 'test-pass-123' });
  const token = r.body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  const clientId = (await call(token, 'POST', '/clients', { name: 'Client One' })).body.id as string;
  return { token, businessId, clientId, tenantId: r.body.user.tenantId as string };
}
const line = { serviceId: null, name: 'Work', description: '', qty: 1000, unit: '', unitPrice: 1_000_000, discountType: 'percent', discountValue: 0, taxRateBp: 0 };

test('invoice created with its first installment already paid shows that installment as paid', async () => {
  const { token, businessId, clientId } = await setup('inst@test.dev');
  const r = await call(token, 'POST', '/invoices', {
    businessId, clientId, issueDate: '2026-03-01', dueDate: '2026-03-10', reference: '', billingAddress: '', lines: [line],
    overallDiscountType: 'percent', overallDiscountValue: 0, charges: [], notes: '', paymentTerms: '', finalize: true,
    // Rs 2,000 down payment + installment 1 (Rs 4,000) paid; schedule covers the full Rs 8,000 left after the down payment
    installments: [{ dueDate: '2026-03-10', amount: 400_000 }, { dueDate: '2026-04-10', amount: 400_000 }],
    initialPayment: { amount: 600_000, date: '2026-03-01', method: 'cash', reference: '', notes: '' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.installments.map((s: any) => s.status), ['paid', 'pending'].map((s, i) => (i === 1 && '2026-04-10' < new Date().toISOString().slice(0, 10) ? 'overdue' : s)));
  assert.equal(r.body.balance, 400_000);
});

test('custom finance categories are offered again', async () => {
  const { token, businessId } = await setup('cat@test.dev');
  await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Equipment', amount: 5_000, date: '2026-03-01' });
  await call(token, 'POST', '/finance/entries', { businessId, type: 'income', category: 'Scrap sales', amount: 5_000, date: '2026-03-02' });
  const c = (await call(token, 'GET', '/finance/categories')).body;
  assert.deepEqual(c, { income: ['Scrap sales'], expense: ['Equipment'] });
});

test('owner exports everything, then deletes the account', async () => {
  const keep = await setup('keep@test.dev');
  const { token, businessId, tenantId } = await setup('owner@test.dev');
  await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Rent', amount: 1_234_50, date: '2026-03-01' });

  const x = await call(token, 'GET', '/account/export.xlsx');
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(x.body as any);
  assert.ok(wb.getWorksheet('Clients') && wb.getWorksheet('Invoices') && wb.getWorksheet('Money in & out'));
  const money = wb.getWorksheet('Money in & out')!;
  const header = (money.getRow(1).values as any[]).indexOf('amount');
  assert.equal(money.getRow(2).getCell(header).value, 1234.5);
  assert.ok(!(wb.getWorksheet('Team')!.getRow(1).values as any[]).includes('password_hash'));

  assert.equal((await call(token, 'POST', '/account/delete', { password: 'wrong', confirm: 'DELETE' })).status, 422);
  assert.equal((await call(token, 'POST', '/account/delete', { password: 'test-pass-123', confirm: 'nope' })).status, 422);
  assert.equal((await call(token, 'POST', '/account/delete', { password: 'test-pass-123', confirm: 'DELETE' })).status, 200);

  for (const t of ['tenant', 'app_user', 'business', 'client', 'finance_entry', 'money_account', 'audit_log', 'auth_session']) {
    const col = t === 'tenant' ? 'id' : 'tenant_id';
    assert.equal(db.get(`select count(*) as n from ${t} where ${col} = ?`, tenantId)!.n, 0, t);
  }
  assert.equal((await call(token, 'GET', '/businesses')).status, 401);
  assert.equal((await call('', 'POST', '/auth/login', { email: 'owner@test.dev', password: 'test-pass-123' })).status, 401);
  // other accounts are untouched
  assert.equal((await call(keep.token, 'GET', '/clients')).body.length, 1);
});

test('only the owner can export or delete', async () => {
  const { token } = await setup('boss@test.dev');
  const staff = await call(token, 'POST', '/users', { name: 'Staff', email: 'staff@test.dev', password: 'staff-pass-123', role: 'staff' });
  assert.equal(staff.status, 201, JSON.stringify(staff.body));
  const s = (await call('', 'POST', '/auth/login', { email: 'staff@test.dev', password: 'staff-pass-123' })).body.accessToken;
  assert.equal((await call(s, 'GET', '/account/export.xlsx')).status, 403);
  assert.equal((await call(s, 'POST', '/account/delete', { password: 'staff-pass-123', confirm: 'DELETE' })).status, 403);
});
