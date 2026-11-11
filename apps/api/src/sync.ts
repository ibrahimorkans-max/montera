import { z } from 'zod';
import type { BaseDb, Row } from './core';
import { withIdSeed } from './core';
import type { MiniApp } from './mini';
import { HttpError, type AuthContext } from './perm';

/** Tables copied to phones, in an order that respects foreign keys. */
export const SYNC_TABLES = [
  'tenant',
  'business',
  'client',
  'service',
  'money_account',
  'invoice',
  'installment',
  'quotation',
  'recurring_invoice',
  'payment',
  'payment_allocation',
  'transfer',
  'client_refund',
  'exchange_rate',
  'finance_entry',
  'counter',
] as const;
type SyncTable = (typeof SYNC_TABLES)[number];

/** Large columns left out of the snapshot; phones fetch them when online. */
const HEAVY: Partial<Record<SyncTable, string[]>> = { payment: ['proof'], finance_entry: ['attachment'] };

export interface Snapshot {
  seq: number;
  tenantId: string;
  at: string;
  tables: Record<string, Row[]>;
}

export function syncSeq(db: BaseDb, tenantId: string): number {
  return db.get('select sync_seq from tenant where id = ?', tenantId)?.sync_seq ?? 0;
}

/** Record that the tenant's data changed, so phones know to pull again. */
export function bumpSeq(db: BaseDb, tenantId: string) {
  db.run('update tenant set sync_seq = sync_seq + 1 where id = ?', tenantId);
}

export function snapshot(db: BaseDb, tenantId: string): Snapshot {
  const tables: Record<string, Row[]> = {};
  for (const t of SYNC_TABLES) {
    const rows = t === 'tenant' ? db.all('select * from tenant where id = ?', tenantId) : db.all(`select * from ${t} where tenant_id = ?`, tenantId);
    const heavy = HEAVY[t] ?? [];
    tables[t] = heavy.length ? rows.map((r) => ({ ...r, ...Object.fromEntries(heavy.map((c) => [c, ''])) })) : rows;
  }
  return { seq: syncSeq(db, tenantId), tenantId, at: new Date().toISOString(), tables };
}

/** Replace the phone's copy of the tenant's data with a snapshot from the server. */
export function applySnapshot(db: BaseDb, snap: Snapshot) {
  db.tx(() => {
    // children first; the tenant row stays (local tables point at it) and is updated in place
    for (const t of [...SYNC_TABLES].reverse()) if (t !== 'tenant') db.run(`delete from ${t}`);
    db.run('delete from tenant where id <> ?', snap.tenantId);
    for (const t of SYNC_TABLES) {
      const rows = snap.tables[t] ?? [];
      if (t === 'tenant' && rows[0]) {
        const r = rows[0];
        const known = new Set(db.all('pragma table_info(tenant)').map((c) => c.name as string));
        const cols = Object.keys(r).filter((c) => known.has(c));
        if (db.get('select 1 from tenant where id = ?', r.id)) db.run(`update tenant set ${cols.map((c) => `${c} = ?`).join(', ')} where id = ?`, ...cols.map((c) => r[c]), r.id);
        else db.run(`insert into tenant (${cols.join(', ')}) values (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => r[c]));
        continue;
      }
      if (!rows.length) continue;
      const known = new Set(db.all(`pragma table_info(${t})`).map((c) => c.name as string));
      for (const r of rows) {
        const cols = Object.keys(r).filter((c) => known.has(c));
        db.run(`insert into ${t} (${cols.join(', ')}) values (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => r[c]));
      }
    }
  });
}

export const pushSchema = z.object({
  ops: z
    .array(
      z.object({
        id: z.string().min(8).max(80),
        method: z.enum(['POST', 'PUT', 'DELETE']),
        path: z.string().min(1).max(300),
        body: z.any().optional(),
      }),
    )
    .max(200),
});

export interface OpResult {
  id: string;
  status: number;
  body: unknown;
  /** true when this op had already been applied by an earlier push */
  replayed: boolean;
}

/**
 * Apply operations queued on a phone, in order. Each op runs with ids derived from its own id
 * (so the server creates exactly the rows the phone created) and its result is stored, so a
 * repeated push — after a dropped connection, say — returns the same answer instead of
 * applying the change twice.
 */
export function applyOps(db: BaseDb, engine: MiniApp, auth: AuthContext, ops: z.infer<typeof pushSchema>['ops']): OpResult[] {
  const results: OpResult[] = [];
  for (const op of ops) {
    const done = db.get('select * from sync_op where id = ?', op.id);
    if (done) {
      if (done.tenant_id !== auth.tenantId) throw new HttpError(409, 'Operation id already used.');
      results.push({ id: op.id, status: done.status, body: JSON.parse(done.response), replayed: true });
      continue;
    }
    if (!engine.has(op.method, op.path)) {
      results.push({ id: op.id, status: 404, body: { error: 'This change cannot be synced.' }, replayed: false });
      continue;
    }
    const res = withIdSeed(op.id, () => engine.handle(op.method, op.path, op.body, auth));
    db.run(
      'insert into sync_op (id, tenant_id, method, path, status, response, created_at) values (?,?,?,?,?,?,?)',
      op.id, auth.tenantId, op.method, op.path, res.status, JSON.stringify(res.body ?? null), new Date().toISOString(),
    );
    results.push({ id: op.id, status: res.status, body: res.body, replayed: false });
  }
  if (results.some((r) => r.status < 400 && !r.replayed)) bumpSeq(db, auth.tenantId);
  return results;
}
