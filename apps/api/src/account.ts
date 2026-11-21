import ExcelJS from 'exceljs';
import { HttpError } from './perm';
import { type Db, type Row } from './core';

/**
 * Whole-account export and deletion (owner only, server only).
 * Tables are listed children first, so deleting in this order never breaks a reference.
 */
const DATA_TABLES: { table: string; sheet: string; omit?: string[] }[] = [
  { table: 'payment_allocation', sheet: 'Payment allocations' },
  { table: 'installment', sheet: 'Installments' },
  { table: 'finance_entry', sheet: 'Money in & out' },
  { table: 'purchase', sheet: 'Purchases' },
  { table: 'client_refund', sheet: 'Advance refunds' },
  { table: 'transfer', sheet: 'Transfers' },
  { table: 'payment', sheet: 'Payments' },
  { table: 'invoice', sheet: 'Invoices' },
  { table: 'quotation', sheet: 'Quotations' },
  { table: 'recurring_invoice', sheet: 'Recurring invoices' },
  { table: 'money_account', sheet: 'Accounts' },
  { table: 'exchange_rate', sheet: 'Exchange rates' },
  { table: 'service', sheet: 'Services' },
  { table: 'client', sheet: 'Clients' },
  { table: 'business', sheet: 'Businesses' },
  { table: 'app_user', sheet: 'Team', omit: ['password_hash', 'failed_logins', 'locked_until'] },
  { table: 'audit_log', sheet: 'Activity log' },
];
/** sheets in the order a person would look for them */
const SHEET_ORDER = ['Businesses', 'Clients', 'Services', 'Invoices', 'Installments', 'Payments', 'Payment allocations', 'Quotations', 'Recurring invoices', 'Money in & out', 'Purchases', 'Accounts', 'Transfers', 'Advance refunds', 'Exchange rates', 'Team', 'Activity log'];

/** stored as whole minor units (paisa, cents); exported as normal amounts */
const MONEY = /^(amount|total|subtotal|paid|balance|unit_price|opening_balance|credit_limit|account_amount|item_discounts|overall_discount|taxable_amount|tax_amount|charges_total|rounding_adjustment)$/;
const MAX_CELL = 32_000; // Excel's limit per cell is 32,767 characters

function cell(column: string, v: unknown, precision: number | undefined) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && precision !== undefined && MONEY.test(column)) return v / 10 ** precision;
  if (typeof v === 'string' && v.length > MAX_CELL) return v.startsWith('data:') ? '(photo not included)' : `${v.slice(0, MAX_CELL)}…`;
  return v as ExcelJS.CellValue;
}

/** One workbook with every record of the business account, a sheet per kind of record. */
export async function exportAllData(db: Db, tenantId: string): Promise<Buffer> {
  const tenant = db.get('select * from tenant where id = ?', tenantId);
  if (!tenant) throw new HttpError(404, 'Account not found.');
  const precisionOf = new Map(db.all('select id, currency_precision from business where tenant_id = ?', tenantId).map((b) => [b.id as string, b.currency_precision as number]));
  const invoicePrecision = new Map(db.all('select id, currency_precision from invoice where tenant_id = ?', tenantId).map((r) => [r.id as string, r.currency_precision as number]));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Monetra';
  wb.created = new Date();
  const about = wb.addWorksheet('About');
  about.columns = [{ width: 28 }, { width: 60 }];
  about.addRows([
    ['Monetra data export'],
    ['Account', tenant.name],
    ['Exported at', new Date().toISOString()],
    [],
    ['Each sheet holds one kind of record.'],
    ['Amounts are in the currency of their business or document.'],
    ['Photos of bills and payment proofs are not included.'],
  ]);
  about.getRow(1).font = { bold: true, size: 14 };

  const sheets = new Map<string, { rows: Row[]; omit: string[] }>();
  for (const t of DATA_TABLES) sheets.set(t.sheet, { rows: db.all(`select * from ${t.table} where tenant_id = ?`, tenantId), omit: ['tenant_id', ...(t.omit ?? [])] });

  for (const name of SHEET_ORDER) {
    const { rows, omit } = sheets.get(name)!;
    const ws = wb.addWorksheet(name);
    if (!rows.length) {
      ws.addRow(['No records']);
      continue;
    }
    const columns = Object.keys(rows[0]).filter((c) => !omit.includes(c));
    ws.columns = columns.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(12, c.length + 2)) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of rows) {
      const precision = r.currency_precision ?? (r.invoice_id ? invoicePrecision.get(r.invoice_id) : undefined) ?? (r.business_id ? precisionOf.get(r.business_id) : undefined);
      ws.addRow(columns.map((c) => cell(c, r[c], precision ?? undefined)));
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Permanently removes the business account: every record, user and session. */
export function deleteAccount(db: Db, tenantId: string) {
  db.tx(() => {
    db.exec('pragma defer_foreign_keys = on');
    for (const t of DATA_TABLES.filter((x) => x.table !== 'app_user')) db.run(`delete from ${t.table} where tenant_id = ?`, tenantId);
    for (const table of ['counter', 'sync_op', 'auth_session', 'app_user']) db.run(`delete from ${table} where tenant_id = ?`, tenantId);
    db.run('delete from tenant where id = ?', tenantId);
  });
}
