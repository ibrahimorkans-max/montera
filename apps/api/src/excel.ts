import ExcelJS from 'exceljs';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../../../packages/shared/src/index';
import { today, type Db, type Row } from './core';
import { INVOICE_SELECT } from './domain';
import { buildReport, type ReportFilter } from './reports';

// ---------------------------------------------------------------- Excel

const NAVY = 'FF0B1B4D';
const STRIPE = 'FFF3F6FC';

/** Workbook with one sheet per report section, amounts as real numbers so they can be summed in Excel. */
export async function reportWorkbook(db: Db, tenantId: string, f: ReportFilter, tenantName: string): Promise<Buffer> {
  const r = buildReport(db, tenantId, f);
  const scale = 10 ** r.currencyPrecision;
  const money = (v: number) => v / scale;
  const qty = (v: number) => v / 1000;
  const fmt = r.currencyPrecision > 0 ? `#,##0.${'0'.repeat(r.currencyPrecision)}` : '#,##0';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Monetra';
  wb.created = new Date();

  function sheet(name: string, columns: { header: string; key: string; width: number; money?: boolean; date?: boolean }[], rows: Record<string, unknown>[], totals?: Record<string, unknown>) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: fmt } : {} }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    head.height = 22;
    head.alignment = { vertical: 'middle' };
    rows.forEach((row, n) => {
      const added = ws.addRow(row);
      if (n % 2) added.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE } };
    });
    if (totals && rows.length) {
      const tr = ws.addRow(totals);
      tr.font = { bold: true };
      tr.border = { top: { style: 'thin' } };
    }
    if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    return ws;
  }
  const sum = <T>(rows: T[], pick: (x: T) => number) => rows.reduce((a, x) => a + pick(x), 0);

  // Summary
  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 34 }, { width: 22 }];
  s.addRow([`${tenantName} — Financial report`]).font = { bold: true, size: 15, color: { argb: NAVY } };
  s.addRow([`Period: ${f.from} to ${f.to}`]);
  s.addRow([`Currency: ${r.currency}. Outstanding, overdue and aging are as of ${today()}.`]);
  s.addRow([]);
  const lines: [string, number, boolean][] = [
    ['Total invoiced', r.totals.invoiced, true],
    ['Invoices issued', r.totals.invoiceCount, false],
    ['Total collected', r.totals.collected, true],
    ['Payments received', r.totals.paymentCount, false],
    ['Expenses recorded', r.totals.expenses, true],
    ['Total outstanding', r.totals.outstanding, true],
    ['Overdue balances', r.totals.overdue, true],
    ['Not yet due', r.aging.notDue, true],
    ['1–30 days overdue', r.aging.d1to30, true],
    ['31–60 days overdue', r.aging.d31to60, true],
    ['61–90 days overdue', r.aging.d61to90, true],
    ['Over 90 days overdue', r.aging.d90plus, true],
  ];
  for (const [label, v, isMoney] of lines) {
    const row = s.addRow([label, isMoney ? money(v) : v]);
    row.getCell(1).font = { bold: true };
    if (isMoney) row.getCell(2).numFmt = fmt;
  }

  sheet(
    'Daily collections',
    [{ header: 'Date', key: 'date', width: 14 }, { header: 'Payments', key: 'count', width: 11 }, { header: 'Amount', key: 'amount', width: 18, money: true }],
    r.collections.daily.map((d) => ({ date: d.date, count: d.count, amount: money(d.amount) })),
    { date: 'Total', count: sum(r.collections.daily, (d) => d.count), amount: money(sum(r.collections.daily, (d) => d.amount)) },
  );
  sheet(
    'Weekly collections',
    [{ header: 'Week starting', key: 'week', width: 16 }, { header: 'Payments', key: 'count', width: 11 }, { header: 'Amount', key: 'amount', width: 18, money: true }],
    r.collections.weekly.map((d) => ({ week: d.weekStart, count: d.count, amount: money(d.amount) })),
    { week: 'Total', count: sum(r.collections.weekly, (d) => d.count), amount: money(sum(r.collections.weekly, (d) => d.amount)) },
  );
  sheet(
    'Monthly collections',
    [{ header: 'Month', key: 'month', width: 12 }, { header: 'Payments', key: 'count', width: 11 }, { header: 'Amount', key: 'amount', width: 18, money: true }],
    r.collections.monthly.map((d) => ({ month: d.month, count: d.count, amount: money(d.amount) })),
    { month: 'Total', count: sum(r.collections.monthly, (d) => d.count), amount: money(sum(r.collections.monthly, (d) => d.amount)) },
  );
  sheet(
    'Payment methods',
    [{ header: 'Method', key: 'method', width: 18 }, { header: 'Payments', key: 'count', width: 11 }, { header: 'Amount', key: 'amount', width: 18, money: true }, { header: 'Share', key: 'share', width: 10 }],
    r.methods.map((m) => ({ method: PAYMENT_METHOD_LABELS[m.method], count: m.count, amount: money(m.amount), share: r.totals.collected ? `${Math.round((m.amount / r.totals.collected) * 100)}%` : '' })),
    { method: 'Total', count: sum(r.methods, (m) => m.count), amount: money(r.totals.collected) },
  );
  sheet(
    'Client revenue',
    [
      { header: 'Client', key: 'client', width: 30 },
      { header: 'Invoices', key: 'count', width: 10 },
      { header: 'Invoiced', key: 'invoiced', width: 18, money: true },
      { header: 'Collected', key: 'collected', width: 18, money: true },
      { header: 'Outstanding now', key: 'outstanding', width: 18, money: true },
    ],
    r.clients.map((c) => ({ client: c.clientName, count: c.invoiceCount, invoiced: money(c.invoiced), collected: money(c.collected), outstanding: money(c.outstanding) })),
    { client: 'Total', count: sum(r.clients, (c) => c.invoiceCount), invoiced: money(sum(r.clients, (c) => c.invoiced)), collected: money(sum(r.clients, (c) => c.collected)), outstanding: money(sum(r.clients, (c) => c.outstanding)) },
  );
  const svc = sheet(
    'Service revenue',
    [
      { header: 'Service / product', key: 'name', width: 32 },
      { header: 'Quantity', key: 'qty', width: 12 },
      { header: 'Invoices', key: 'count', width: 10 },
      { header: 'Revenue', key: 'revenue', width: 18, money: true },
    ],
    r.services.map((x) => ({ name: x.name, qty: qty(x.qty), count: x.invoiceCount, revenue: money(x.revenue) })),
    { name: 'Total', revenue: money(sum(r.services, (x) => x.revenue)) },
  );
  svc.addRow([]);
  svc.addRow(['Revenue is each line after item discounts, before the overall discount, tax and charges.']).font = { italic: true, color: { argb: 'FF666666' } };
  sheet(
    'Overdue invoices',
    [
      { header: 'Invoice', key: 'number', width: 14 },
      { header: 'Client', key: 'client', width: 30 },
      { header: 'Due date', key: 'due', width: 13 },
      { header: 'Days overdue', key: 'days', width: 13 },
      { header: 'Balance', key: 'balance', width: 18, money: true },
    ],
    r.overdueInvoices.map((o) => ({ number: o.number, client: o.clientName, due: o.dueDate, days: o.daysOverdue, balance: money(o.balance) })),
    { number: 'Total', balance: money(sum(r.overdueInvoices, (o) => o.balance)) },
  );
  sheet(
    'Installments',
    [
      { header: 'Due date', key: 'due', width: 13 },
      { header: 'Invoice', key: 'number', width: 14 },
      { header: 'Client', key: 'client', width: 30 },
      { header: 'Amount', key: 'amount', width: 16, money: true },
      { header: 'Collected', key: 'paid', width: 16, money: true },
      { header: 'Remaining', key: 'left', width: 16, money: true },
      { header: 'Status', key: 'status', width: 12 },
    ],
    r.installments.rows.map((x) => ({ due: x.dueDate, number: x.invoiceNumber, client: x.clientName, amount: money(x.amount), paid: money(x.paid), left: money(x.amount - x.paid), status: x.status })),
    { due: 'Total', amount: money(r.installments.scheduled), paid: money(r.installments.collected), left: money(r.installments.outstanding) },
  );

  // raw registers for the period
  const bi = f.businessId ? 'and i.business_id = ?' : '';
  const bArgs = f.businessId ? [f.businessId] : [];
  const invoices = db.all(`${INVOICE_SELECT} where i.tenant_id = ? and i.status = 'final' and i.issue_date between ? and ? ${bi} order by i.issue_date`, tenantId, f.from, f.to, ...bArgs);
  sheet(
    'Invoices',
    [
      { header: 'Invoice', key: 'number', width: 14 },
      { header: 'Date', key: 'date', width: 13 },
      { header: 'Due', key: 'due', width: 13 },
      { header: 'Client', key: 'client', width: 28 },
      { header: 'Business', key: 'business', width: 22 },
      { header: 'Subtotal', key: 'subtotal', width: 15, money: true },
      { header: 'Discounts', key: 'disc', width: 14, money: true },
      { header: 'Tax', key: 'tax', width: 13, money: true },
      { header: 'Charges', key: 'charges', width: 13, money: true },
      { header: 'Total', key: 'total', width: 15, money: true },
      { header: 'Paid', key: 'paid', width: 15, money: true },
      { header: 'Balance', key: 'balance', width: 15, money: true },
    ],
    invoices.map((i: Row) => ({
      number: i.number, date: i.issue_date, due: i.due_date, client: i.client_name, business: i.business_name,
      subtotal: money(i.subtotal), disc: money(i.item_discounts + i.overall_discount), tax: money(i.tax_amount), charges: money(i.charges_total),
      total: money(i.total), paid: money(i.paid), balance: money(i.total - i.paid),
    })),
    { number: 'Total', total: money(sum(invoices, (i: Row) => i.total)), paid: money(sum(invoices, (i: Row) => i.paid)), balance: money(sum(invoices, (i: Row) => i.total - i.paid)) },
  );
  const bp = f.businessId ? 'and p.business_id = ?' : '';
  const pays = db.all(
    `select p.*, c.name as client_name from payment p join client c on c.id = p.client_id where p.tenant_id = ? and p.verification_status <> 'rejected' and p.date between ? and ? ${bp} order by p.date`,
    tenantId, f.from, f.to, ...bArgs,
  );
  sheet(
    'Payments',
    [
      { header: 'Receipt', key: 'number', width: 14 },
      { header: 'Date', key: 'date', width: 13 },
      { header: 'Client', key: 'client', width: 28 },
      { header: 'Method', key: 'method', width: 16 },
      { header: 'Reference', key: 'ref', width: 18 },
      { header: 'Status', key: 'status', width: 11 },
      { header: 'Amount', key: 'amount', width: 15, money: true },
    ],
    pays.map((p: Row) => ({ number: p.number, date: p.date, client: p.client_name, method: PAYMENT_METHOD_LABELS[p.method as PaymentMethod], ref: p.reference, status: p.verification_status, amount: money(p.amount) })),
    { number: 'Total', amount: money(sum(pays, (p: Row) => p.amount)) },
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Plain-text filename-safe label, e.g. "monetra-report-2026-11-01-to-2026-11-30". */
export const reportFileName = (f: ReportFilter) => `monetra-report-${f.from}-to-${f.to}.xlsx`;
