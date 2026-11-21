import type { ChargeInput, DiscountType, RoundingRule } from './calc';
import type { Frequency } from './schedule';

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'easypaisa', 'jazzcash', 'online', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  easypaisa: 'Easypaisa',
  jazzcash: 'JazzCash',
  online: 'Online Payment',
  card: 'Card',
  other: 'Other',
};

export const PERMISSIONS = [
  'invoices.view',
  'invoices.create',
  'invoices.edit_draft',
  'invoices.finalize',
  'invoices.approve',
  'invoices.cancel',
  'payments.record',
  'payments.verify',
  'payments.refund',
  'reports.view',
  'finance.manage',
  'clients.manage',
  'businesses.manage',
  'users.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['owner', 'manager', 'accountant', 'staff', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => p !== 'businesses.manage' && p !== 'users.manage'),
  accountant: ['invoices.view', 'invoices.create', 'invoices.edit_draft', 'invoices.finalize', 'payments.record', 'payments.verify', 'reports.view', 'finance.manage', 'clients.manage'],
  staff: ['invoices.view', 'invoices.create', 'invoices.edit_draft', 'payments.record', 'clients.manage'],
  viewer: ['invoices.view'],
};

export const INVOICE_TEMPLATES = ['amber', 'ocean', 'violet', 'crimson', 'classic'] as const;
export type InvoiceTemplate = (typeof INVOICE_TEMPLATES)[number];
export const INVOICE_TEMPLATE_LABELS: Record<InvoiceTemplate, string> = { amber: 'Amber Edge', ocean: 'Ocean Shapes', violet: 'Violet Clean', crimson: 'Crimson Corporate', classic: 'Classic Mono' };

export const DASHBOARD_STYLES = ['monetra', 'minimal', 'emerald', 'wallet', 'glass', 'soft', 'midnight'] as const;
export type DashboardStyle = (typeof DASHBOARD_STYLES)[number];
export const DASHBOARD_STYLE_LABELS: Record<DashboardStyle, { name: string; hint: string }> = {
  monetra: { name: 'Monetra', hint: 'Blue gradient balance card with stat tiles' },
  minimal: { name: 'Studio', hint: 'Clean white, revenue bars and status tabs' },
  emerald: { name: 'Emerald Report', hint: 'Dark green report card with a trend line' },
  wallet: { name: 'Wallet', hint: 'Money balance, quick actions and spending ring' },
  glass: { name: 'Glass', hint: 'Frosted glass cards over a violet glow' },
  soft: { name: 'Soft (Neumorphism)', hint: 'Raised soft cards with gentle shadows' },
  midnight: { name: 'Midnight', hint: 'Dark card with neon accents' },
};

export const INCOME_CATEGORIES = ['Sales', 'Services', 'Owner investment', 'Loan received', 'Other income'] as const;
export const EXPENSE_CATEGORIES = ['Salaries', 'Rent', 'Utilities', 'Fuel & transport', 'Supplies', 'Maintenance', 'Marketing', 'Taxes & fees', 'Owner withdrawal', 'Other expense'] as const;

export interface FinanceEntry {
  id: string;
  /** 'payment' rows come from client payments and cannot be edited here */
  source: 'manual' | 'payment' | 'refund' | 'purchase';
  /** set when source is 'purchase': the purchase bill this money out belongs to */
  purchaseId?: string | null;
  accountId: string | null;
  accountName: string;
  /** photo of the bill or receipt (data URI), manual entries only */
  hasAttachment?: boolean;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  party: string;
  notes: string;
  businessId: string;
}

/** A bill for things the business bought. Saving it records its total as Money out. */
export interface PurchaseLine {
  name: string;
  /** thousandths: 1000 = 1 */
  qty: number;
  unit: string;
  /** minor units per 1 */
  unitPrice: number;
  amount: number;
}
export interface Purchase {
  id: string;
  number: string;
  businessId: string;
  supplier: string;
  billNo: string;
  date: string;
  lines: PurchaseLine[];
  total: number;
  category: string;
  method: PaymentMethod;
  accountId: string | null;
  accountName: string;
  notes: string;
  /** bank / wallet transaction ID; empty for cash */
  reference: string;
  /** optional payment plan with the supplier; empty = paid in full on the bill date */
  installments: PurchaseInstallment[];
  /** amount paid so far (money out); equals total when there is no plan */
  paid: number;
  /** still owed to the supplier */
  balance: number;
  hasAttachment: boolean;
  financeEntryId: string | null;
  currency: string;
  currencyPrecision: number;
  createdAt: string;
}
export interface PurchaseInstallment {
  dueDate: string;
  amount: number;
  paid: boolean;
  /** date it was marked paid */
  paidDate?: string;
}
export interface PurchaseSummary {
  /** still owed to suppliers on bills with an installment plan */
  unpaid: number;
  total: number;
  count: number;
  average: number;
  thisMonth: number;
  lastMonth: number;
  monthly: { month: string; amount: number }[];
  bySupplier: { name: string; amount: number; count: number }[];
  byItem: { name: string; qty: number; unit: string; amount: number }[];
  recent: Purchase[];
  currency: string;
  currencyPrecision: number;
}

export interface FinanceSummary {
  income: number;
  expense: number;
  net: number;
  /** income that came from client payments on invoices */
  fromClients: number;
  incomeByCategory: { category: string; amount: number }[];
  expenseByCategory: { category: string; amount: number }[];
  monthly: { month: string; income: number; expense: number }[];
  currency: string;
  currencyPrecision: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  permissions: Permission[];
  tenantName: string;
  tenantId: string;
}

export interface BusinessProfile {
  id: string;
  legalName: string;
  tradingName: string;
  ownerName: string;
  logo: string;
  registrationNo: string;
  ntn: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  website: string;
  bankDetails: string;
  iban: string;
  paymentInstructions: string;
  signature: string;
  stamp: string;
  invoiceFooter: string;
  /** printed in the Disclaimer section at the end of every invoice, quotation and purchase slip */
  invoiceDisclaimer: string;
  currency: string;
  currencyPrecision: number;
  invoicePrefix: string;
  taxInclusive: boolean;
  rounding: RoundingRule;
  /** design used for this business's invoices and receipts */
  invoiceTemplate: InvoiceTemplate;
  /** hex colour overriding the template's own accent, or '' */
  accentColor: string;
  /** first month of the financial year, 1–12 (Pakistan: 7 = July) */
  fyStartMonth: number;
  /** 'yearly' restarts invoice and quotation numbers each financial year, e.g. INV-2026-27-00001 */
  numberReset: 'never' | 'yearly';
  /** look of the Home dashboard while this business is selected */
  dashboardStyle: DashboardStyle;
  status: 'active' | 'inactive';
}

export interface Client {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  whatsapp: string;
  email: string;
  cnic: string;
  ntn: string;
  address: string;
  city: string;
  province: string;
  country: string;
  extraAddresses: string[];
  extraContacts: { name: string; phone: string }[];
  category: string;
  /** minor units; positive = client owes */
  openingBalance: number;
  /** maximum amount the client may owe, in the business currency; 0 = no limit */
  creditLimit: number;
  notes: string;
  status: 'active' | 'inactive';
  /** present on list/detail responses */
  outstanding?: number;
  credit?: number;
}

export interface Service {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultPrice: number;
  unit: string;
  taxRateBp: number;
  defaultDiscountBp: number;
  status: 'active' | 'inactive';
}

export interface InvoiceLine {
  serviceId: string | null;
  name: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discountType: DiscountType;
  discountValue: number;
  taxRateBp: number;
  /** server-computed */
  lineTotal?: number;
}

export interface Installment {
  id?: string;
  dueDate: string;
  amount: number;
  paid?: number;
  status?: 'paid' | 'partial' | 'pending' | 'overdue';
}

export type InvoiceStatus = 'draft' | 'final' | 'cancelled';
export type InvoiceDisplayStatus = 'draft' | 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';

export interface InvoiceInput {
  businessId: string;
  clientId: string;
  issueDate: string;
  dueDate: string;
  reference: string;
  billingAddress: string;
  lines: InvoiceLine[];
  overallDiscountType: DiscountType;
  overallDiscountValue: number;
  charges: ChargeInput[];
  notes: string;
  paymentTerms: string;
  installments: Installment[];
  /** idempotency key generated on the device */
  clientRequestId?: string;
  /** currency of this invoice; the business currency when omitted */
  currency?: string;
  /** business-currency units per 1 unit of the invoice currency × 1,000,000 */
  fxRate?: number;
  /** finalize even though the client's credit limit would be exceeded (needs approval permission) */
  overrideCreditLimit?: boolean;
}

export interface Invoice extends InvoiceInput {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  displayStatus: InvoiceDisplayStatus;
  clientName: string;
  businessName: string;
  currency: string;
  currencyPrecision: number;
  taxInclusive: boolean;
  rounding: RoundingRule;
  subtotal: number;
  itemDiscounts: number;
  overallDiscount: number;
  taxableAmount: number;
  taxAmount: number;
  chargesTotal: number;
  roundingAdjustment: number;
  total: number;
  paid: number;
  balance: number;
  createdAt: string;
  finalizedAt: string | null;
}

export interface PaymentAllocation {
  invoiceId: string;
  invoiceNumber?: string | null;
  amount: number;
}

export interface Payment {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  businessId: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  reference: string;
  notes: string;
  receivedBy: string;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  hasProof: boolean;
  proof?: string;
  allocations: PaymentAllocation[];
  /** amount not allocated to any invoice — held as client advance */
  unallocated: number;
  currency: string;
  currencyPrecision: number;
  createdAt: string;
}

export interface PaymentInput {
  clientId: string;
  businessId: string;
  /** when set, the payment is applied to this invoice first; any excess becomes client credit */
  invoiceId?: string | null;
  amount: number;
  date: string;
  method: PaymentMethod;
  reference: string;
  notes: string;
  proof?: string;
  clientRequestId?: string;
  /** spread the payment over several invoices of the same client */
  allocations?: { invoiceId: string; amount: number }[];
  /** allocate to the client's open invoices, oldest due first */
  autoAllocate?: boolean;
  /** cash, bank or wallet account the money went into; the business default for the method when omitted */
  accountId?: string | null;
  /** currency of the payment (an invoice's own currency when paying an invoice) */
  currency?: string;
}

export interface DashboardSummary {
  totalInvoiced: number;
  totalReceived: number;
  outstanding: number;
  overdue: number;
  partiallyPaidCount: number;
  unpaidCount: number;
  monthCollections: number;
  currency: string;
  currencyPrecision: number;
  recentInvoices: Invoice[];
  recentPayments: Payment[];
  upcomingInstallments: InstallmentRow[];
  overdueClients: { clientId: string; clientName: string; amount: number; oldestDueDate: string }[];
  paidCount: number;
  draftCount: number;
  overdueCount: number;
  /** money in all cash, bank and wallet accounts today */
  cashBalance: number;
  monthExpenses: number;
  /** last 12 calendar months, oldest first */
  monthly: { month: string; invoiced: number; collected: number; expenses: number }[];
  /** collections by payment method in the selected range, for spending/income rings */
  methodMix: { method: PaymentMethod; amount: number }[];
  /** expense categories in the selected range */
  expenseMix: { category: string; amount: number }[];
  /** one row per business when no business is selected (amounts in the reporting currency) */
  businesses: { businessId: string; name: string; currency: string; invoiced: number; received: number; outstanding: number; overdue: number }[];
  dashboardStyle: DashboardStyle;
  /** true when amounts in other currencies had no exchange rate and were left out */
  missingRates: boolean;
}

export interface InstallmentRow extends Installment {
  invoiceId: string;
  invoiceNumber: string | null;
  clientId: string;
  clientName: string;
  currency: string;
  currencyPrecision: number;
}

export interface LedgerEntry {
  date: string;
  type: 'opening' | 'invoice' | 'payment';
  refId: string | null;
  label: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface ClientLedger {
  client: Client;
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  credit: number;
  overdue: number;
  entries: LedgerEntry[];
  invoices: Invoice[];
  payments: Payment[];
}


// ---------------------------------------------------------------- quotations

export const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
/** Stored status, plus 'expired' for a sent quotation past its validity date, and 'converted'. */
export type QuotationDisplayStatus = QuotationStatus | 'expired' | 'converted';

export interface QuotationInput {
  businessId: string;
  clientId: string;
  issueDate: string;
  validUntil: string;
  reference: string;
  billingAddress: string;
  lines: InvoiceLine[];
  overallDiscountType: DiscountType;
  overallDiscountValue: number;
  charges: ChargeInput[];
  notes: string;
  terms: string;
  clientRequestId?: string;
}

export interface Quotation extends QuotationInput {
  id: string;
  number: string;
  status: QuotationStatus;
  displayStatus: QuotationDisplayStatus;
  clientName: string;
  businessName: string;
  currency: string;
  currencyPrecision: number;
  taxInclusive: boolean;
  subtotal: number;
  itemDiscounts: number;
  overallDiscount: number;
  taxableAmount: number;
  taxAmount: number;
  chargesTotal: number;
  roundingAdjustment: number;
  total: number;
  convertedInvoiceId: string | null;
  convertedInvoiceNumber: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- recurring invoices

export interface RecurringInput {
  name: string;
  businessId: string;
  clientId: string;
  reference: string;
  billingAddress: string;
  lines: InvoiceLine[];
  overallDiscountType: DiscountType;
  overallDiscountValue: number;
  charges: ChargeInput[];
  notes: string;
  paymentTerms: string;
  frequency: Frequency;
  interval: number;
  startDate: string;
  endDate: string | null;
  /** days between the invoice date and its due date */
  dueDays: number;
  /** true: issue final invoices automatically. false: create drafts that wait for approval. */
  autoIssue: boolean;
}

export interface RecurringInvoice extends RecurringInput {
  id: string;
  status: 'active' | 'paused' | 'ended';
  nextDate: string | null;
  generatedCount: number;
  lastGeneratedAt: string | null;
  clientName: string;
  businessName: string;
  currency: string;
  currencyPrecision: number;
  /** total of one generated invoice at today's settings */
  total: number;
  /** generated drafts still waiting for approval */
  pendingDrafts: number;
}

// ---------------------------------------------------------------- reports

export interface ReportData {
  from: string;
  to: string;
  currency: string;
  currencyPrecision: number;
  totals: { invoiced: number; invoiceCount: number; collected: number; paymentCount: number; outstanding: number; overdue: number; expenses: number };
  collections: {
    daily: { date: string; amount: number; count: number }[];
    weekly: { weekStart: string; amount: number; count: number }[];
    monthly: { month: string; amount: number; count: number }[];
  };
  methods: { method: PaymentMethod; amount: number; count: number }[];
  clients: { clientId: string; clientName: string; invoiced: number; collected: number; outstanding: number; invoiceCount: number }[];
  services: { name: string; serviceId: string | null; qty: number; revenue: number; invoiceCount: number }[];
  aging: { notDue: number; d1to30: number; d31to60: number; d61to90: number; d90plus: number };
  overdueInvoices: { invoiceId: string; number: string; clientName: string; dueDate: string; daysOverdue: number; balance: number }[];
  installments: {
    scheduled: number;
    collected: number;
    outstanding: number;
    overdue: number;
    rows: { invoiceId: string; invoiceNumber: string; clientName: string; dueDate: string; amount: number; paid: number; status: string }[];
  };
}

// ---------------------------------------------------------------- accounts & money movement

export type AccountType = 'cash' | 'bank' | 'wallet';
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = { cash: 'Cash', bank: 'Bank', wallet: 'Mobile wallet' };

export interface MoneyAccount {
  id: string;
  businessId: string;
  businessName: string;
  name: string;
  type: AccountType;
  institution: string;
  accountNumber: string;
  currency: string;
  currencyPrecision: number;
  openingBalance: number;
  openingDate: string;
  isDefault: boolean;
  status: 'active' | 'archived';
  balance: number;
}

export interface Transfer {
  id: string;
  businessId: string;
  fromAccountId: string;
  fromAccountName: string;
  toAccountId: string;
  toAccountName: string;
  /** in the source account's currency */
  amount: number;
  /** in the destination account's currency */
  toAmount: number;
  date: string;
  reference: string;
  notes: string;
  createdAt: string;
}

export interface Movement {
  id: string;
  date: string;
  kind: 'opening' | 'payment' | 'income' | 'expense' | 'transfer_in' | 'transfer_out' | 'refund';
  accountId: string;
  accountName: string;
  label: string;
  party: string;
  moneyIn: number;
  moneyOut: number;
  /** running balance of the account(s) shown, after this line */
  balance: number;
  refId: string | null;
}

export interface CashbookDay {
  date: string;
  opening: number;
  moneyIn: number;
  moneyOut: number;
  closing: number;
  lines: Movement[];
}

export interface Cashbook {
  from: string;
  to: string;
  currency: string;
  currencyPrecision: number;
  accounts: MoneyAccount[];
  opening: number;
  closing: number;
  moneyIn: number;
  moneyOut: number;
  days: CashbookDay[];
}

export interface ProfitLoss {
  from: string;
  to: string;
  basis: 'accrual' | 'cash';
  currency: string;
  currencyPrecision: number;
  income: { label: string; amount: number }[];
  totalIncome: number;
  expenses: { label: string; amount: number }[];
  totalExpenses: number;
  netProfit: number;
  /** net profit as a share of income, in basis points */
  marginBp: number;
  /** tax collected on invoices: owed to the government, not income */
  taxCollected: number;
  monthly: { month: string; income: number; expenses: number; profit: number }[];
}

export interface CashFlow {
  from: string;
  to: string;
  currency: string;
  currencyPrecision: number;
  opening: number;
  closing: number;
  inflows: { label: string; amount: number }[];
  outflows: { label: string; amount: number }[];
  totalIn: number;
  totalOut: number;
  monthly: { month: string; opening: number; moneyIn: number; moneyOut: number; closing: number }[];
  accounts: { accountId: string; name: string; type: AccountType; opening: number; closing: number }[];
}

export interface ExchangeRate {
  id: string;
  currency: string;
  baseCurrency: string;
  /** base units per 1 unit of currency × 1,000,000 */
  rate: number;
  date: string;
  note: string;
}

export interface Refund {
  id: string;
  clientId: string;
  businessId: string;
  accountId: string;
  accountName: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  notes: string;
}
