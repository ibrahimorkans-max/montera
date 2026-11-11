/**
 * Database base class and helpers shared by the server (Node SQLite) and the phone (expo-sqlite).
 * Nothing in this file may import Node-only modules.
 */

export type Row = Record<string, any>;

export const SCHEMA = `
create table if not exists tenant (
  id text primary key, name text not null, created_at text not null
);
create table if not exists app_user (
  id text primary key, tenant_id text not null references tenant,
  email text not null unique collate nocase, name text not null, password_hash text not null,
  role text not null, status text not null default 'active',
  failed_logins integer not null default 0, locked_until text, created_at text not null
);
create table if not exists auth_session (
  id text primary key, tenant_id text not null references tenant, user_id text not null references app_user,
  refresh_hash text not null, device_name text not null default '', expires_at text not null,
  revoked_at text, created_at text not null, last_used_at text not null
);
create table if not exists counter (
  tenant_id text not null references tenant, key text not null, value integer not null,
  primary key (tenant_id, key)
);
create table if not exists business (
  id text primary key, tenant_id text not null references tenant,
  legal_name text not null, trading_name text not null default '', owner_name text not null default '',
  logo text not null default '', registration_no text not null default '', ntn text not null default '',
  phone text not null default '', whatsapp text not null default '', email text not null default '',
  address text not null default '', website text not null default '', bank_details text not null default '',
  iban text not null default '', payment_instructions text not null default '',
  signature text not null default '', stamp text not null default '', invoice_footer text not null default '',
  currency text not null default 'PKR', currency_precision integer not null default 2,
  invoice_prefix text not null default 'INV-', tax_inclusive integer not null default 0,
  rounding text not null default 'none', status text not null default 'active', created_at text not null
);
create table if not exists client (
  id text primary key, tenant_id text not null references tenant,
  name text not null, contact_person text not null default '', phone text not null default '',
  whatsapp text not null default '', email text not null default '', cnic text not null default '',
  ntn text not null default '', address text not null default '', city text not null default '',
  province text not null default '', country text not null default '',
  extra_addresses text not null default '[]', extra_contacts text not null default '[]',
  category text not null default '', opening_balance integer not null default 0,
  notes text not null default '', status text not null default 'active', created_at text not null
);
create index if not exists client_tenant on client (tenant_id, name);
create table if not exists service (
  id text primary key, tenant_id text not null references tenant,
  name text not null, category text not null default '', description text not null default '',
  default_price integer not null default 0, unit text not null default '',
  tax_rate_bp integer not null default 0, default_discount_bp integer not null default 0,
  status text not null default 'active', created_at text not null
);
create index if not exists service_tenant on service (tenant_id, name);
create table if not exists invoice (
  id text primary key, tenant_id text not null references tenant,
  business_id text not null references business, client_id text not null references client,
  number text, status text not null check (status in ('draft','final','cancelled')),
  issue_date text not null, due_date text not null, reference text not null default '',
  billing_address text not null default '', lines text not null, charges text not null default '[]',
  overall_discount_type text not null default 'percent', overall_discount_value integer not null default 0,
  notes text not null default '', payment_terms text not null default '',
  currency text not null, currency_precision integer not null, tax_inclusive integer not null, rounding text not null,
  subtotal integer not null, item_discounts integer not null, overall_discount integer not null,
  taxable_amount integer not null, tax_amount integer not null, charges_total integer not null,
  rounding_adjustment integer not null, total integer not null,
  client_request_id text, created_by text not null, created_at text not null, updated_at text not null,
  finalized_at text, cancelled_at text, cancel_reason text,
  unique (tenant_id, client_request_id),
  unique (business_id, number)
);
create index if not exists invoice_tenant on invoice (tenant_id, issue_date);
create index if not exists invoice_client on invoice (tenant_id, client_id);
create table if not exists installment (
  id text primary key, tenant_id text not null references tenant, invoice_id text not null references invoice,
  seq integer not null, due_date text not null, amount integer not null check (amount > 0)
);
create index if not exists installment_invoice on installment (invoice_id, seq);
create table if not exists payment (
  id text primary key, tenant_id text not null references tenant,
  number text not null, client_id text not null references client, business_id text not null references business,
  amount integer not null check (amount > 0), date text not null, method text not null,
  reference text not null default '', notes text not null default '', proof text not null default '',
  received_by text not null, received_by_name text not null,
  verification_status text not null check (verification_status in ('pending','verified','rejected')),
  client_request_id text, created_at text not null,
  unique (tenant_id, number), unique (tenant_id, client_request_id)
);
create index if not exists payment_client on payment (tenant_id, client_id);
create table if not exists payment_allocation (
  id text primary key, tenant_id text not null references tenant,
  payment_id text not null references payment, invoice_id text not null references invoice,
  amount integer not null check (amount > 0), created_at text not null
);
create index if not exists alloc_invoice on payment_allocation (invoice_id);
create index if not exists alloc_payment on payment_allocation (payment_id);
create table if not exists finance_entry (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  type text not null check (type in ('income','expense')), category text not null,
  amount integer not null check (amount > 0), date text not null, method text not null default 'cash',
  party text not null default '', notes text not null default '', created_by text not null, created_at text not null
);
create index if not exists finance_tenant on finance_entry (tenant_id, date);
create table if not exists quotation (
  id text primary key, tenant_id text not null references tenant,
  business_id text not null references business, client_id text not null references client,
  number text not null, status text not null check (status in ('draft','sent','accepted','rejected')),
  issue_date text not null, valid_until text not null, reference text not null default '',
  billing_address text not null default '', lines text not null, charges text not null default '[]',
  overall_discount_type text not null default 'percent', overall_discount_value integer not null default 0,
  notes text not null default '', terms text not null default '',
  currency text not null, currency_precision integer not null, tax_inclusive integer not null, rounding text not null,
  subtotal integer not null, item_discounts integer not null, overall_discount integer not null,
  taxable_amount integer not null, tax_amount integer not null, charges_total integer not null,
  rounding_adjustment integer not null, total integer not null,
  converted_invoice_id text references invoice, client_request_id text,
  created_by text not null, created_at text not null, updated_at text not null,
  unique (tenant_id, client_request_id), unique (business_id, number)
);
create index if not exists quotation_tenant on quotation (tenant_id, issue_date);
create table if not exists recurring_invoice (
  id text primary key, tenant_id text not null references tenant, name text not null,
  business_id text not null references business, client_id text not null references client,
  reference text not null default '', billing_address text not null default '',
  lines text not null, charges text not null default '[]',
  overall_discount_type text not null default 'percent', overall_discount_value integer not null default 0,
  notes text not null default '', payment_terms text not null default '',
  frequency text not null check (frequency in ('weekly','monthly','yearly','custom')),
  interval_count integer not null default 1, start_date text not null, end_date text,
  due_days integer not null default 0, auto_issue integer not null default 0,
  status text not null default 'active' check (status in ('active','paused','ended')),
  generated_count integer not null default 0, last_generated_at text,
  created_by text not null, created_at text not null, updated_at text not null
);
create index if not exists recurring_tenant on recurring_invoice (tenant_id, status);
create table if not exists money_account (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  name text not null, type text not null check (type in ('cash','bank','wallet')),
  institution text not null default '', account_number text not null default '', currency text not null,
  opening_balance integer not null default 0, opening_date text not null, is_default integer not null default 0,
  status text not null default 'active' check (status in ('active','archived')), created_at text not null
);
create index if not exists account_business on money_account (tenant_id, business_id);
create table if not exists transfer (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  from_account_id text not null references money_account, to_account_id text not null references money_account,
  amount integer not null check (amount > 0), to_amount integer not null check (to_amount > 0), date text not null,
  reference text not null default '', notes text not null default '', client_request_id text,
  created_by text not null, created_at text not null, unique (tenant_id, client_request_id)
);
create table if not exists client_refund (
  id text primary key, tenant_id text not null references tenant, business_id text not null references business,
  client_id text not null references client, account_id text not null references money_account,
  amount integer not null check (amount > 0), date text not null, method text not null, notes text not null default '',
  created_by text not null, created_at text not null
);
create table if not exists exchange_rate (
  id text primary key, tenant_id text not null references tenant, currency text not null, base_currency text not null,
  rate integer not null check (rate > 0), date text not null, note text not null default '',
  created_by text not null, created_at text not null
);
create index if not exists rate_lookup on exchange_rate (tenant_id, currency, base_currency, date);
create table if not exists audit_log (
  id text primary key, tenant_id text not null references tenant, user_id text,
  action text not null, entity text not null, entity_id text, detail text not null default '{}', at text not null
);
create index if not exists audit_tenant on audit_log (tenant_id, at);
`;

/** Columns added after the first release, applied to older databases on start. */
export const MIGRATIONS: [table: string, column: string, definition: string][] = [
  [
    "business",
    "invoice_template",
    "text not null default 'amber'"
  ],
  [
    "business",
    "accent_color",
    "text not null default ''"
  ],
  [
    "invoice",
    "recurring_id",
    "text"
  ],
  [
    "business",
    "fy_start_month",
    "integer not null default 7"
  ],
  [
    "business",
    "number_reset",
    "text not null default 'never'"
  ],
  [
    "business",
    "dashboard_style",
    "text not null default 'monetra'"
  ],
  [
    "client",
    "credit_limit",
    "integer not null default 0"
  ],
  [
    "invoice",
    "fx_rate",
    "integer not null default 1000000"
  ],
  [
    "invoice",
    "fx_factor",
    "integer not null default 1000000"
  ],
  [
    "quotation",
    "fx_rate",
    "integer not null default 1000000"
  ],
  [
    "quotation",
    "fx_factor",
    "integer not null default 1000000"
  ],
  [
    "payment",
    "account_id",
    "text"
  ],
  [
    "payment",
    "account_amount",
    "integer"
  ],
  [
    "payment",
    "currency",
    "text"
  ],
  [
    "payment",
    "currency_precision",
    "integer"
  ],
  [
    "payment",
    "fx_factor",
    "integer not null default 1000000"
  ],
  [
    "finance_entry",
    "account_id",
    "text"
  ],
  [
    "finance_entry",
    "attachment",
    "text not null default ''"
  ],
  [
    "finance_entry",
    "client_request_id",
    "text"
  ],
  [
    "tenant",
    "reporting_currency",
    "text not null default ''"
  ],
  [
    "tenant",
    "sync_seq",
    "integer not null default 0"
  ]
];

export abstract class BaseDb {
  private depth = 0;

  abstract exec(sql: string): void;
  abstract all(sql: string, ...params: any[]): Row[];
  abstract get(sql: string, ...params: any[]): Row | undefined;
  abstract run(sql: string, ...params: any[]): { changes: number | bigint };

  /** Create tables and apply additive migrations. Call once from the subclass constructor. */
  protected init() {
    this.exec(SCHEMA);
    for (const [table, column, definition] of MIGRATIONS) {
      const cols = this.all(`pragma table_info(${table})`);
      if (!cols.some((c) => c.name === column)) this.exec(`alter table ${table} add column ${column} ${definition}`);
    }
    this.exec('create table if not exists sync_op (id text primary key, tenant_id text not null, method text not null, path text not null, status integer not null, response text not null, created_at text not null)');
  }

  /** Run fn atomically; nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.exec('begin immediate');
    this.depth++;
    try {
      const out = fn();
      this.exec('commit');
      return out;
    } catch (e) {
      this.exec('rollback');
      throw e;
    } finally {
      this.depth--;
    }
  }

  /** Next value of a per-tenant sequence. Call inside a transaction. */
  nextCounter(tenantId: string, key: string): number {
    this.run(
      'insert into counter (tenant_id, key, value) values (?, ?, 1) on conflict (tenant_id, key) do update set value = value + 1',
      tenantId,
      key,
    );
    return this.get('select value from counter where tenant_id = ? and key = ?', tenantId, key)!.value;
  }

  audit(tenantId: string, userId: string | null, action: string, entity: string, entityId: string | null, detail: unknown = {}) {
    this.run(
      'insert into audit_log (id, tenant_id, user_id, action, entity, entity_id, detail, at) values (?,?,?,?,?,?,?,?)',
      randomId(),
      tenantId,
      userId,
      action,
      entity,
      entityId,
      JSON.stringify(detail),
      new Date().toISOString(),
    );
  }
}
export type Db = BaseDb;

export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- ids

let makeRandomId: () => string = () => {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return deterministicId(String(Math.random()) + Date.now(), 0);
};
/** The phone supplies its own secure random UUID function. */
export function setRandomId(fn: () => string) {
  makeRandomId = fn;
}
export const randomId = () => makeRandomId();

let seed: { base: string; n: number; out?: string[] } | null = null;

/**
 * Run `fn` so that every id it creates is derived from `base` (an operation id).
 * The phone and the server run the same queued operation with the same base, so both
 * create rows with identical ids and a later sync matches them up instead of duplicating.
 */
export function withIdSeed<T>(base: string, fn: () => T, collect?: string[]): T {
  const outer = seed;
  seed = { base, n: 0, out: collect };
  try {
    return fn();
  } finally {
    seed = outer;
  }
}

export function uid(): string {
  if (!seed) return makeRandomId();
  const id = deterministicId(seed.base, seed.n++);
  seed.out?.push(id);
  return id;
}

/** 53-bit string hash (cyrb53). */
function hash53(str: string, s: number): number {
  let h1 = 0xdeadbeef ^ s;
  let h2 = 0x41c6ce57 ^ s;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** UUID-shaped id (version 8) derived from a base string and a counter. */
export function deterministicId(base: string, n: number): string {
  const key = `${base}#${n}`;
  const hex = [1, 2, 3].map((s) => hash53(key, s).toString(16).padStart(14, '0')).join('').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
