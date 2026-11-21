import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { Db } from '../src/db';

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

const day = new Date().toISOString().slice(0, 10);

test('a purchase bill is money out, and its dashboard adds it up', async () => {
  const r = await call('', 'POST', '/auth/register', { businessName: 'Buyer Co', name: 'Owner', email: 'buyer@test.dev', password: 'test-pass-123' });
  const token = r.body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  const cash = (await call(token, 'GET', '/accounts')).body.find((a: any) => a.type === 'cash');
  const before = cash.balance as number;

  // 2.5 kg cement at Rs 400 + 3 bricks at Rs 15.50 = Rs 1,046.50
  const p = await call(token, 'POST', '/purchases', {
    businessId, supplier: 'Ali Traders', billNo: 'B-77', date: day, method: 'cash',
    lines: [
      { name: 'Cement', qty: 2500, unit: 'kg', unitPrice: 40_000 },
      { name: 'Bricks', qty: 3000, unit: '', unitPrice: 1_550 },
    ],
  });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal(p.body.total, 104_650);
  assert.equal(p.body.number, 'PUR-0001');
  assert.deepEqual(p.body.lines.map((l: any) => l.amount), [100_000, 4_650]);

  // it is Money out on the Finance screen and comes off the cash balance
  const entries = (await call(token, 'GET', '/finance/entries?type=expense')).body;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, 'purchase');
  assert.equal(entries[0].purchaseId, p.body.id);
  assert.equal(entries[0].amount, 104_650);
  assert.equal(entries[0].category, 'Purchases');
  assert.equal(entries[0].party, 'Ali Traders');
  assert.equal((await call(token, 'GET', '/finance/summary')).body.expense, 104_650);
  const after1 = (await call(token, 'GET', '/accounts')).body.find((a: any) => a.id === cash.id).balance;
  assert.equal(after1, before - 104_650);

  // the linked money out cannot be changed from Finance
  const fe = await call(token, 'DELETE', `/finance/entries/${entries[0].id}`);
  assert.equal(fe.status, 422);
  assert.match(fe.body.error, /PUR-0001/);

  // editing the bill updates its money out
  const e = await call(token, 'PUT', `/purchases/${p.body.id}`, {
    businessId, supplier: 'Ali Traders', date: day, method: 'cash', lines: [{ name: 'Cement', qty: 1000, unit: 'kg', unitPrice: 50_000 }],
  });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal((await call(token, 'GET', '/finance/summary')).body.expense, 50_000);

  await call(token, 'POST', '/purchases', { businessId, supplier: 'ali traders', date: day, lines: [{ name: 'cement', qty: 1000, unit: 'kg', unitPrice: 30_000 }] });
  const s = (await call(token, 'GET', '/purchases/summary')).body;
  assert.equal(s.total, 80_000);
  assert.equal(s.count, 2);
  assert.equal(s.thisMonth, 80_000);
  assert.deepEqual(s.bySupplier, [{ name: 'Ali Traders', amount: 80_000, count: 2 }]);
  assert.deepEqual(s.byItem, [{ name: 'Cement', qty: 2000, unit: 'kg', amount: 80_000 }]);
  assert.equal((await call(token, 'GET', '/purchases/suppliers')).body.length, 1, 'same supplier in different case is listed once');
  assert.equal((await call(token, 'GET', '/purchases?q=cement')).body.length, 2);

  // deleting the bill gives the money back
  assert.equal((await call(token, 'DELETE', `/purchases/${p.body.id}`)).status, 200);
  assert.equal((await call(token, 'GET', '/finance/summary')).body.expense, 30_000);
  assert.equal((await call(token, 'GET', `/purchases/${p.body.id}`)).status, 404);

  // validation
  const bad = await call(token, 'POST', '/purchases', { businessId, supplier: '', date: day, lines: [] });
  assert.equal(bad.status, 422);
});

test('a purchase on installments only counts what has been paid', async () => {
  const r = await call('', 'POST', '/auth/register', { businessName: 'Plan Co', name: 'Owner', email: 'plan@test.dev', password: 'test-pass-123' });
  const token = r.body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  const lines = [{ name: 'Generator', qty: 1000, unit: '', unitPrice: 300_000 }];

  // installments must add up to the bill
  const bad = await call(token, 'POST', '/purchases', { businessId, supplier: 'Power Ltd', date: day, method: 'bank_transfer', lines, installments: [{ dueDate: day, amount: 100_000 }] });
  assert.equal(bad.status, 422);

  const p = await call(token, 'POST', '/purchases', {
    businessId, supplier: 'Power Ltd', date: day, method: 'bank_transfer', reference: 'TXN-123', lines,
    installments: [
      { dueDate: day, amount: 100_000, paid: true },
      { dueDate: day, amount: 200_000, paid: false },
    ],
  });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal(p.body.reference, 'TXN-123');
  assert.equal(p.body.paid, 100_000);
  assert.equal(p.body.balance, 200_000);
  assert.equal((await call(token, 'GET', '/finance/summary')).body.expense, 100_000);
  assert.equal((await call(token, 'GET', '/purchases/summary')).body.unpaid, 200_000);

  // paying the second installment moves the rest out
  const paid = await call(token, 'PUT', `/purchases/${p.body.id}/installments/1`, { paid: true });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.balance, 0);
  assert.equal((await call(token, 'GET', '/finance/summary')).body.expense, 300_000);

  // unpaying everything removes the money out entirely
  await call(token, 'PUT', `/purchases/${p.body.id}/installments/0`, { paid: false });
  await call(token, 'PUT', `/purchases/${p.body.id}/installments/1`, { paid: false });
  assert.equal((await call(token, 'GET', '/finance/entries?type=expense')).body.length, 0);
  assert.equal((await call(token, 'GET', `/purchases/${p.body.id}`)).body.balance, 300_000);
});
