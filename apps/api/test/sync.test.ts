import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { withIdSeed } from '../src/core';
import { MiniApp } from '../src/mini';
import { registerRoutes } from '../src/routes';
import { applySnapshot, type Snapshot } from '../src/sync';

let server: Server;
let base = '';

before(() => {
  server = createApp(new Db(':memory:')).listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => server.close());

async function call(token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, etag: res.headers.get('etag'), body: res.status === 304 ? null : ((await res.json()) as any) };
}

/** A phone: its own database, the shared routes, and a queue of changes made offline. */
class Phone {
  db = new Db(':memory:');
  engine = new MiniApp();
  outbox: { id: string; method: 'POST' | 'PUT' | 'DELETE'; path: string; body?: unknown }[] = [];
  n = 0;
  constructor(
    private token: string,
    private auth: any,
  ) {
    registerRoutes(this.engine, this.db);
  }
  async pull() {
    const r = await call(this.token, 'GET', '/sync/pull');
    applySnapshot(this.db, r.body as Snapshot);
    // changes still waiting are re-applied on top of the fresh copy
    for (const op of this.outbox) withIdSeed(op.id, () => this.engine.handle(op.method, op.path, op.body, this.auth));
    return r;
  }
  /** What the screens do: answer from the local database, and queue writes. */
  request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) {
    if (method === 'GET') return this.engine.handle(method, path, undefined, this.auth);
    const op = { id: `op-${this.auth.userId.slice(0, 8)}-${++this.n}-${Math.random().toString(36).slice(2, 8)}`, method, path, body };
    const res = withIdSeed(op.id, () => this.engine.handle(method, path, body, this.auth));
    if (res.status < 400) this.outbox.push(op);
    return res;
  }
  async push() {
    const r = await call(this.token, 'POST', '/sync/push', { ops: this.outbox });
    this.outbox = [];
    return r.body.results as { id: string; status: number; body: any; replayed: boolean }[];
  }
}

async function setup(email: string) {
  const r = await call('', 'POST', '/auth/register', { businessName: 'Sync Co', name: 'Owner', email, password: 'test-pass-123' });
  const me = r.body.user;
  const businessId = (await call(r.body.accessToken, 'GET', '/businesses')).body[0].id;
  const tenantId = (await call(r.body.accessToken, 'GET', '/sync/pull')).body.tenantId;
  return { token: r.body.accessToken as string, businessId, auth: { userId: me.id, tenantId, role: me.role, sessionId: 'phone', name: me.name } };
}
const line = { serviceId: null, name: 'Work', description: '', qty: 1000, unit: '', unitPrice: 1_000_000, discountType: 'percent', discountValue: 0, taxRateBp: 0 };

test('offline changes sync to the server with the same ids, exactly once', async () => {
  const { token, businessId, auth } = await setup('sync1@test.dev');
  const phone = new Phone(token, auth);
  await phone.pull();
  assert.equal(phone.request('GET', '/businesses').body[0].id, businessId);

  // offline: new client, final invoice with a payment, an expense
  const client = phone.request('POST', '/clients', { name: 'Offline Client' }).body;
  const inv = phone.request('POST', '/invoices', {
    businessId, clientId: client.id, issueDate: '2026-04-01', dueDate: '2026-04-15', reference: '', billingAddress: '', lines: [line],
    overallDiscountType: 'percent', overallDiscountValue: 0, charges: [], notes: '', paymentTerms: '', installments: [], finalize: true,
    initialPayment: { amount: 400_000, date: '2026-04-01', method: 'cash', reference: '', notes: '' },
  }).body;
  phone.request('POST', '/finance/entries', { businessId, type: 'expense', category: 'Fuel & transport', amount: 50_000, date: '2026-04-01', method: 'cash' });
  assert.equal(inv.balance, 600_000);
  assert.equal(phone.request('GET', '/accounts').body.find((a: any) => a.type === 'cash').balance, 350_000);
  // the server knows nothing yet
  assert.equal((await call(token, 'GET', '/clients')).body.length, 0);

  const results = await phone.push();
  assert.deepEqual(results.map((r) => r.status), [201, 201, 201]);
  const serverInv = (await call(token, 'GET', `/invoices/${inv.id}`)).body; // same id on the server
  assert.equal(serverInv.invoice.clientId, client.id);
  assert.equal(serverInv.invoice.balance, 600_000);
  assert.equal(serverInv.payments.length, 1);

  // the same push again (connection dropped before the phone saw the answer) changes nothing
  phone.outbox = results.map((r, i) => ({ id: r.id, method: 'POST', path: ['/clients', '/invoices', '/finance/entries'][i] }));
  const again = await phone.push();
  assert.ok(again.every((r) => r.replayed));
  assert.equal((await call(token, 'GET', '/clients')).body.length, 1);
  assert.equal((await call(token, 'GET', '/payments')).body.length, 1);

  // after pulling, the phone matches the server exactly
  await phone.pull();
  assert.equal(phone.request('GET', '/clients').body.length, 1);
  assert.equal(phone.request('GET', `/invoices/${inv.id}`).body.invoice.number, serverInv.invoice.number);
});

test('pull answers 304 when nothing changed, and changes from other devices arrive', async () => {
  const { token, businessId, auth } = await setup('sync2@test.dev');
  const first = await call(token, 'GET', '/sync/pull');
  assert.equal((await call(token, 'GET', '/sync/pull', undefined, { 'if-none-match': first.etag! })).status, 304);
  await call(token, 'POST', '/clients', { name: 'Added on the web' });
  const second = await call(token, 'GET', '/sync/pull', undefined, { 'if-none-match': first.etag! });
  assert.equal(second.status, 200);
  assert.notEqual(second.etag, first.etag);
  const phone = new Phone(token, auth);
  await phone.pull();
  assert.equal(phone.request('GET', '/clients').body[0].name, 'Added on the web');
  assert.ok(businessId);
});

test('conflicts: an offline edit to an invoice finalized elsewhere is refused and reported', async () => {
  const { token, businessId, auth } = await setup('sync3@test.dev');
  const clientId = (await call(token, 'POST', '/clients', { name: 'Shared Client' })).body.id;
  const draftBody = { businessId, clientId, issueDate: '2026-05-01', dueDate: '2026-05-10', reference: '', billingAddress: '', lines: [line], overallDiscountType: 'percent', overallDiscountValue: 0, charges: [], notes: '', paymentTerms: '', installments: [], finalize: false };
  const draft = (await call(token, 'POST', '/invoices', draftBody)).body;

  const phone = new Phone(token, auth);
  await phone.pull();
  // offline the phone edits the draft, while someone online finalizes it
  assert.equal(phone.request('PUT', `/invoices/${draft.id}`, { ...draftBody, notes: 'changed offline' }).status, 200);
  await call(token, 'POST', `/invoices/${draft.id}/finalize`, {});

  const [r] = await phone.push();
  assert.equal(r.status, 409);
  assert.match(r.body.error, /draft/i);
  await phone.pull(); // the phone goes back to the server's version
  const inv = phone.request('GET', `/invoices/${draft.id}`).body.invoice;
  assert.equal(inv.status, 'final');
  assert.equal(inv.notes, '');
});

test('two phones offline: both payments arrive once each and the invoice balance adds up', async () => {
  const { token, businessId, auth } = await setup('sync4@test.dev');
  const clientId = (await call(token, 'POST', '/clients', { name: 'Busy Client' })).body.id;
  const inv = (
    await call(token, 'POST', '/invoices', { businessId, clientId, issueDate: '2026-06-01', dueDate: '2026-06-10', reference: '', billingAddress: '', lines: [line], overallDiscountType: 'percent', overallDiscountValue: 0, charges: [], notes: '', paymentTerms: '', installments: [], finalize: true })
  ).body;
  const a = new Phone(token, auth);
  const b = new Phone(token, { ...auth, sessionId: 'phone-b' });
  await a.pull();
  await b.pull();
  a.request('POST', '/payments', { clientId, businessId, invoiceId: inv.id, amount: 700_000, date: '2026-06-02', method: 'cash' });
  b.request('POST', '/payments', { clientId, businessId, invoiceId: inv.id, amount: 700_000, date: '2026-06-02', method: 'bank_transfer' });
  await a.push();
  await b.push();
  const server = (await call(token, 'GET', `/invoices/${inv.id}`)).body;
  assert.equal(server.payments.length, 2);
  assert.equal(server.invoice.paid, 1_000_000); // never more than the total
  const client = (await call(token, 'GET', `/clients/${clientId}`)).body;
  assert.equal(client.credit, 400_000); // the overlap became advance, nothing was lost
  // receipt numbers come from the server, so the two phones cannot clash
  const numbers = server.payments.map((p: any) => p.number);
  assert.equal(new Set(numbers).size, 2);
});
