/**
 * Demo data for local development. Run: npm run seed
 * Sign in with DEMO_EMAIL / DEMO_PASSWORD below (override with env vars of the same name).
 */
import { resolve } from 'node:path';
import { createApp } from './app';
import { Db } from './db';

export const DEMO_EMAIL = process.env.DEMO_EMAIL || 'owner@demo.test';
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo-pass-1234';

const db = new Db(process.env.DB_PATH || resolve(import.meta.dirname, '../data/millnexa.db'));
const server = createApp(db).listen(0);
const base = `http://127.0.0.1:${(server.address() as any).port}`;

let token = '';
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error}`);
  return json;
}
const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

try {
  if (db.get('select 1 from app_user where email = ?', DEMO_EMAIL)) {
    console.log('Demo account already exists, nothing to do.');
  } else {
    const reg = await call('POST', '/auth/register', { businessName: 'Al-Noor Technical Services', name: 'Demo Owner', email: DEMO_EMAIL, password: DEMO_PASSWORD });
    token = reg.accessToken;
    const [biz] = await call('GET', '/businesses');
    await call('PUT', `/businesses/${biz.id}`, {
      ...biz,
      tradingName: 'Al-Noor Tech',
      phone: '+92 300 1234567',
      whatsapp: '+92 300 1234567',
      address: 'Office 12, Main Boulevard, Lahore',
      ntn: '1234567-8',
      bankDetails: 'Meezan Bank, Main Boulevard Branch',
      iban: 'PK00MEZN0000000000000000',
      paymentInstructions: 'Please mention the invoice number with your transfer.',
      invoiceFooter: 'Thank you for your business.',
      invoicePrefix: 'ANT-',
    });
    const services: any[] = [];
    for (const s of [
      { name: 'Software Development', category: 'IT', unit: 'hour', defaultPrice: 500000 },
      { name: 'Consultancy', category: 'Advisory', unit: 'session', defaultPrice: 1500000 },
      { name: 'Laboratory Testing', category: 'Lab', unit: 'sample', defaultPrice: 250000, taxRateBp: 1600 },
      { name: 'Weighbridge Service', category: 'Weighbridge', unit: 'truck', defaultPrice: 50000 },
      { name: 'Transportation', category: 'Logistics', unit: 'trip', defaultPrice: 800000 },
      { name: 'Maintenance', category: 'Support', unit: 'visit', defaultPrice: 350000 },
    ])
      services.push(await call('POST', '/services', s));
    const clients: any[] = [];
    for (const c of [
      { name: 'Rehman Rice Mills', contactPerson: 'Abdul Rehman', phone: '+92 301 5550101', whatsapp: '+92 301 5550101', city: 'Gujranwala', province: 'Punjab', country: 'Pakistan', category: 'Mill' },
      { name: 'City Diagnostics', contactPerson: 'Dr. Sana', phone: '+92 321 5550102', email: 'accounts@citydiag.test', city: 'Lahore', province: 'Punjab', country: 'Pakistan', category: 'Lab' },
      { name: 'Indus Traders', contactPerson: 'Bilal Ahmed', phone: '+92 333 5550103', city: 'Karachi', province: 'Sindh', country: 'Pakistan', category: 'Trading', openingBalance: 2500000 },
    ])
      clients.push(await call('POST', '/clients', c));

    const line = (s: any, qty: number) => ({ serviceId: s.id, name: s.name, description: '', qty: qty * 1000, unit: s.unit, unitPrice: s.defaultPrice, discountType: 'percent', discountValue: 0, taxRateBp: s.taxRateBp });
    const inv = (clientId: string, lines: any[], extra: object = {}) => ({
      businessId: biz.id, clientId, issueDate: day(-10), dueDate: day(20), reference: '', billingAddress: '', lines,
      overallDiscountType: 'percent', overallDiscountValue: 0, charges: [], notes: '', paymentTerms: 'Net 30', installments: [], finalize: true, ...extra,
    });

    // Rs. 100,000 invoice: paid 30,000 + 20,000, with 50,000 still pending
    const a = await call('POST', '/invoices', inv(clients[0].id, [line(services[0], 20)], {
      installments: [{ dueDate: day(-10), amount: 3000000 }, { dueDate: day(-2), amount: 2000000 }, { dueDate: day(15), amount: 5000000 }],
      initialPayment: { amount: 3000000, date: day(-10), method: 'cash', reference: '', notes: 'First payment' },
    }));
    await call('POST', '/payments', { clientId: clients[0].id, businessId: biz.id, invoiceId: a.id, amount: 2000000, date: day(-2), method: 'bank_transfer', reference: 'TXN-88213', notes: 'Second payment' });
    await call('POST', '/invoices', inv(clients[1].id, [line(services[2], 8), line(services[1], 1)], { issueDate: day(-45), dueDate: day(-15) }));
    await call('POST', '/invoices', inv(clients[2].id, [line(services[4], 2)], { initialPayment: { amount: 1600000, date: day(-1), method: 'jazzcash', reference: 'JC-4471', notes: '' } }));
    await call('POST', '/invoices', inv(clients[1].id, [line(services[5], 1)], { finalize: false }));
    console.log(`Seeded demo data. Sign in as ${DEMO_EMAIL} (password is in src/seed.ts).`);
  }
} finally {
  server.close();
}
