import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { financialYear, minorFactor, toBase } from '../../../packages/shared/src/index';

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

async function setup(email: string) {
  const r = await call('', 'POST', '/auth/register', { businessName: 'Core Co', name: 'Owner', email, password: 'test-pass-123' });
  const token = r.body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  const clientId = (await call(token, 'POST', '/clients', { name: 'Client One' })).body.id as string;
  return { token, businessId, clientId };
}
const line = (price: number) => ({ serviceId: null, name: 'Work', description: '', qty: 1000, unit: '', unitPrice: price, discountType: 'percent', discountValue: 0, taxRateBp: 0 });
const inv = (businessId: string, clientId: string, extra: object = {}) => ({
  businessId, clientId, issueDate: '2026-03-01', dueDate: '2026-03-10', reference: '', billingAddress: '', lines: [line(1_000_000)],
  overallDiscountType: 'percent', overallDiscountValue: 0, charges: [], notes: '', paymentTerms: '', installments: [], finalize: true, ...extra,
});

test('currency maths and financial years', () => {
  assert.equal(toBase(10_000, 278_500_000, 2, 2), 2_785_000); // $100 at 278.5 = Rs. 27,850
  assert.equal(toBase(1_000, 1_900_000, 0, 2), 190_000); // ¥1,000 at 1.9 = Rs. 1,900
  assert.equal(toBase(1_000, 900_000_000, 3, 2), 90_000); // 1 KWD at 900 = Rs. 900
  assert.equal(minorFactor(278_500_000, 2, 2), 278_500_000);
  assert.equal(financialYear('2026-06-30', 7), '2025-26');
  assert.equal(financialYear('2026-07-01', 7), '2026-27');
  assert.equal(financialYear('2026-07-01', 1), '2026');
});

test('accounts: defaults, payments land in the right account, transfers, cashbook', async () => {
  const { token, businessId, clientId } = await setup('acc@test.dev');
  const accounts = (await call(token, 'GET', '/accounts')).body;
  assert.deepEqual(accounts.map((a: any) => a.type).sort(), ['bank', 'cash', 'wallet']);
  const cash = accounts.find((a: any) => a.type === 'cash');
  const bank = accounts.find((a: any) => a.type === 'bank');
  const wallet = accounts.find((a: any) => a.type === 'wallet');

  const a = (await call(token, 'POST', '/invoices', inv(businessId, clientId))).body;
  await call(token, 'POST', '/payments', { clientId, businessId, invoiceId: a.id, amount: 300_000, date: '2026-03-02', method: 'cash' });
  await call(token, 'POST', '/payments', { clientId, businessId, invoiceId: a.id, amount: 200_000, date: '2026-03-03', method: 'jazzcash' });
  await call(token, 'POST', '/payments', { clientId, businessId, invoiceId: a.id, amount: 100_000, date: '2026-03-03', method: 'cheque', accountId: cash.id });
  await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Fuel & transport', amount: 50_000, date: '2026-03-03', method: 'cash' });
  const tr = await call(token, 'POST', '/transfers', { fromAccountId: cash.id, toAccountId: bank.id, amount: 150_000, date: '2026-03-04', reference: 'Deposit slip 9' });
  assert.equal(tr.status, 201);
  assert.equal((await call(token, 'POST', '/transfers', { fromAccountId: cash.id, toAccountId: cash.id, amount: 1, date: '2026-03-04' })).status, 422);

  const byId = async (id: string) => (await call(token, 'GET', `/accounts/${id}`)).body.balance;
  assert.equal(await byId(cash.id), 300_000 + 100_000 - 50_000 - 150_000);
  assert.equal(await byId(bank.id), 150_000);
  assert.equal(await byId(wallet.id), 200_000);

  const book = (await call(token, 'GET', `/cashbook?businessId=${businessId}&from=2026-03-03&to=2026-03-04`)).body;
  assert.equal(book.opening, 300_000); // cash received on the 2nd
  assert.equal(book.closing, 600_000 - 50_000);
  assert.equal(book.days.length, 2);
  assert.equal(book.days[0].date, '2026-03-04'); // newest day first
  // a transfer inside the same book moves money out of one account and into another
  assert.equal(book.days[0].moneyIn, 150_000);
  assert.equal(book.days[0].moneyOut, 150_000);

  const cashOnly = (await call(token, 'GET', `/cashbook?accountId=${cash.id}&from=2026-03-01&to=2026-03-31`)).body;
  assert.equal(cashOnly.closing, 200_000);
});

test('one payment across several invoices, oldest first, with the rest kept as advance; refunds and credit', async () => {
  const { token, businessId, clientId } = await setup('alloc@test.dev');
  const i1 = (await call(token, 'POST', '/invoices', inv(businessId, clientId, { issueDate: '2026-01-01', dueDate: '2026-01-15' }))).body;
  const i2 = (await call(token, 'POST', '/invoices', inv(businessId, clientId, { issueDate: '2026-02-01', dueDate: '2026-02-15', lines: [line(500_000)] }))).body;

  const auto = (await call(token, 'POST', '/payments', { clientId, businessId, amount: 1_700_000, date: '2026-03-01', method: 'bank_transfer', autoAllocate: true })).body;
  assert.deepEqual(auto.allocations.map((x: any) => [x.invoiceId, x.amount]), [[i1.id, 1_000_000], [i2.id, 500_000]]);
  assert.equal(auto.unallocated, 200_000);

  // explicit split, and an amount above an invoice's balance is refused
  const i3 = (await call(token, 'POST', '/invoices', inv(businessId, clientId))).body;
  const i4 = (await call(token, 'POST', '/invoices', inv(businessId, clientId))).body;
  assert.equal((await call(token, 'POST', '/payments', { clientId, businessId, amount: 2_000_000, date: '2026-03-02', method: 'cash', allocations: [{ invoiceId: i3.id, amount: 1_000_001 }] })).status, 422);
  const split = (await call(token, 'POST', '/payments', { clientId, businessId, amount: 900_000, date: '2026-03-02', method: 'cash', allocations: [{ invoiceId: i3.id, amount: 400_000 }, { invoiceId: i4.id, amount: 500_000 }] })).body;
  assert.equal(split.unallocated, 0);

  let client = (await call(token, 'GET', `/clients/${clientId}`)).body;
  assert.deepEqual([client.outstanding, client.credit], [1_100_000, 200_000]);

  // refund part of the advance, then apply the rest to open invoices
  assert.equal((await call(token, 'POST', `/clients/${clientId}/refunds`, { businessId, amount: 300_000, date: '2026-03-05', method: 'cash' })).status, 422);
  assert.equal((await call(token, 'POST', `/clients/${clientId}/refunds`, { businessId, amount: 50_000, date: '2026-03-05', method: 'cash' })).status, 201);
  const applied = (await call(token, 'POST', `/clients/${clientId}/apply-credit`)).body.applied;
  assert.equal(applied, 150_000);
  client = (await call(token, 'GET', `/clients/${clientId}`)).body;
  assert.deepEqual([client.outstanding, client.credit], [950_000, 0]);
  const ledger = (await call(token, 'GET', `/clients/${clientId}/ledger`)).body;
  assert.equal(ledger.entries.at(-1).balance, 950_000);
});

test('credit limits block finalizing unless a manager approves', async () => {
  const { token, businessId } = await setup('limit@test.dev');
  const clientId = (await call(token, 'POST', '/clients', { name: 'Limited', creditLimit: 1_500_000 })).body.id;
  assert.equal((await call(token, 'POST', '/invoices', inv(businessId, clientId))).status, 201);
  const over = await call(token, 'POST', '/invoices', inv(businessId, clientId));
  assert.equal(over.status, 422);
  assert.match(over.body.error, /credit limit/);
  // paying part on the spot keeps it within the limit
  const withPay = await call(token, 'POST', '/invoices', inv(businessId, clientId, { initialPayment: { amount: 600_000, date: '2026-03-01', method: 'cash', reference: '', notes: '' } }));
  assert.equal(withPay.status, 201);
  // drafts are allowed; finalizing needs approval
  const draft = (await call(token, 'POST', '/invoices', inv(businessId, clientId, { finalize: false }))).body;
  assert.equal((await call(token, 'POST', `/invoices/${draft.id}/finalize`, {})).status, 422);
  assert.equal((await call(token, 'POST', `/invoices/${draft.id}/finalize`, { overrideCreditLimit: true })).status, 200);

  await call(token, 'POST', '/users', { name: 'Staff', email: 'staff2@test.dev', password: 'test-pass-123', role: 'accountant' });
  const staff = (await call('', 'POST', '/auth/login', { email: 'staff2@test.dev', password: 'test-pass-123' })).body.accessToken;
  assert.equal((await call(staff, 'POST', '/invoices', inv(businessId, clientId, { overrideCreditLimit: true }))).status, 403);
});

test('financial-year numbering restarts each year', async () => {
  const { token, businessId, clientId } = await setup('fy@test.dev');
  const biz = (await call(token, 'GET', '/businesses')).body[0];
  await call(token, 'PUT', `/businesses/${businessId}`, { ...biz, invoicePrefix: 'INV-', numberReset: 'yearly', fyStartMonth: 7 });
  const n = async (date: string) => (await call(token, 'POST', '/invoices', inv(businessId, clientId, { issueDate: date, dueDate: date }))).body.number;
  assert.equal(await n('2026-06-30'), 'INV-2025-26-00001');
  assert.equal(await n('2026-07-01'), 'INV-2026-27-00001');
  assert.equal(await n('2026-08-15'), 'INV-2026-27-00002');
  const q = (await call(token, 'POST', '/quotations', { businessId, clientId, issueDate: '2026-07-02', validUntil: '2026-07-20', reference: '', billingAddress: '', lines: [line(100)], charges: [], notes: '', terms: '' })).body;
  assert.equal(q.number, 'QT-2026-27-00001');
});

test('multi-currency invoices, payments, rates and the all-business dashboard', async () => {
  const { token, businessId, clientId } = await setup('fx@test.dev');
  // no rate recorded yet
  assert.equal((await call(token, 'POST', '/invoices', inv(businessId, clientId, { currency: 'USD' }))).status, 422);
  assert.equal((await call(token, 'POST', '/exchange-rates', { currency: 'USD', baseCurrency: 'PKR', rate: 280_000_000, date: '2026-01-01' })).status, 201);

  // $1,000 invoice at 280 = Rs. 280,000
  const usd = (await call(token, 'POST', '/invoices', inv(businessId, clientId, { currency: 'USD', lines: [line(100_000)] }))).body;
  assert.deepEqual([usd.currency, usd.total, usd.fxRate], ['USD', 100_000, 280_000_000]);
  // explicit rate on the invoice wins over the table
  const usd2 = (await call(token, 'POST', '/invoices', inv(businessId, clientId, { currency: 'USD', fxRate: 279_000_000, lines: [line(10_000)] }))).body;
  assert.equal(usd2.fxRate, 279_000_000);

  // paying in dollars into the rupee bank account converts at the invoice rate
  const pay = (await call(token, 'POST', '/payments', { clientId, businessId, invoiceId: usd.id, amount: 40_000, date: '2026-03-02', method: 'bank_transfer' })).body;
  assert.equal(pay.currency, 'USD');
  const bank = (await call(token, 'GET', '/accounts')).body.find((a: any) => a.type === 'bank');
  assert.equal(bank.balance, 11_200_000); // $400 × 280
  // a payment in another currency cannot be spread over a dollar invoice
  assert.equal((await call(token, 'POST', '/payments', { clientId, businessId, invoiceId: usd.id, amount: 100, date: '2026-03-02', method: 'cash', currency: 'PKR' })).status, 422);

  const client = (await call(token, 'GET', `/clients/${clientId}`)).body;
  assert.equal(client.outstanding, 28_000_000 - 11_200_000 + 2_790_000);

  const dash = (await call(token, 'GET', `/dashboard?businessId=${businessId}`)).body;
  assert.equal(dash.currency, 'PKR');
  assert.equal(dash.totalInvoiced, 28_000_000 + 2_790_000);
  assert.equal(dash.totalReceived, 11_200_000);
  assert.equal(dash.cashBalance, 11_200_000);
  assert.equal(dash.monthly.length, 12);
  assert.equal(dash.monthly[11].month, new Date().toISOString().slice(0, 7)); // ends with the current month

  // a second business in dirhams appears in the all-business view, converted
  const aed = (await call(token, 'POST', '/businesses', { legalName: 'Gulf Branch', currency: 'AED' })).body;
  const aedClient = (await call(token, 'POST', '/clients', { name: 'Dubai Client' })).body.id;
  await call(token, 'POST', '/invoices', inv(aed.id, aedClient, { lines: [line(100_000)] })); // AED 1,000
  let all = (await call(token, 'GET', '/dashboard')).body;
  assert.equal(all.missingRates, true); // no AED rate yet: left out and flagged
  assert.equal(all.businesses.length, 2);
  await call(token, 'POST', '/exchange-rates', { currency: 'AED', baseCurrency: 'PKR', rate: 76_000_000, date: '2026-01-01' });
  all = (await call(token, 'GET', '/dashboard')).body;
  assert.equal(all.missingRates, false);
  assert.equal(all.totalInvoiced, 28_000_000 + 2_790_000 + 7_600_000);
  assert.equal(all.businesses.find((b: any) => b.name === 'Gulf Branch').invoiced, 7_600_000);
});

test('profit and loss on both bases, and cash flow', async () => {
  const { token, businessId, clientId } = await setup('pnl@test.dev');
  // Rs. 10,000 + 16% tax
  const a = (await call(token, 'POST', '/invoices', inv(businessId, clientId, { lines: [{ ...line(1_000_000), taxRateBp: 1600 }] }))).body;
  await call(token, 'POST', '/payments', { clientId, businessId, invoiceId: a.id, amount: 600_000, date: '2026-03-05', method: 'cash' });
  await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Rent', amount: 300_000, date: '2026-03-06', method: 'cash' });
  await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Owner withdrawal', amount: 100_000, date: '2026-03-07', method: 'cash' });
  await call(token, 'POST', '/finance/entries', { businessId, type: 'income', category: 'Other income', amount: 50_000, date: '2026-03-08', method: 'cash' });

  const accrual = (await call(token, 'GET', `/reports/pnl?businessId=${businessId}&from=2026-03-01&to=2026-03-31`)).body;
  assert.deepEqual([accrual.totalIncome, accrual.totalExpenses, accrual.netProfit, accrual.taxCollected], [1_050_000, 300_000, 750_000, 160_000]);
  assert.equal(accrual.marginBp, 7143);
  const cash = (await call(token, 'GET', `/reports/pnl?businessId=${businessId}&from=2026-03-01&to=2026-03-31&basis=cash`)).body;
  assert.equal(cash.totalIncome, 650_000);

  const accounts = (await call(token, 'GET', '/accounts')).body;
  const cashAcc = accounts.find((x: any) => x.type === 'cash');
  const bankAcc = accounts.find((x: any) => x.type === 'bank');
  await call(token, 'POST', '/transfers', { fromAccountId: cashAcc.id, toAccountId: bankAcc.id, amount: 100_000, date: '2026-03-09' });
  const flow = (await call(token, 'GET', `/reports/cashflow?businessId=${businessId}&from=2026-03-01&to=2026-03-31`)).body;
  assert.equal(flow.opening, 0);
  assert.equal(flow.totalIn, 650_000);
  assert.equal(flow.totalOut, 400_000); // rent + owner withdrawal; the transfer between own accounts is not a flow
  assert.equal(flow.closing, 250_000);
  assert.equal(flow.accounts.find((x: any) => x.accountId === bankAcc.id).closing, 100_000);
});
