import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import * as SQLite from 'expo-sqlite';
import { AppState, Platform } from 'react-native';
import { BaseDb, setRandomId, withIdSeed, type Row } from '../../../api/src/core';
import { MiniApp } from '../../../api/src/mini';
import type { AuthContext } from '../../../api/src/perm';
import { registerRoutes } from '../../../api/src/routes';
import { applySnapshot, type Snapshot } from '../../../api/src/sync';
import type { User } from './shared';

setRandomId(() => Crypto.randomUUID());

/** The phone's database: the same tables as the server, through expo-sqlite. */
class PhoneDb extends BaseDb {
  readonly raw: SQLite.SQLiteDatabase;
  constructor(name: string) {
    super();
    this.raw = SQLite.openDatabaseSync(name);
    this.init();
    this.exec(`create table if not exists _outbox (
      id text primary key, seq integer not null, method text not null, path text not null, body text,
      status text not null default 'pending', error text, entity_ids text not null default '[]', label text not null default '', created_at text not null);
      create table if not exists _meta (key text primary key, value text);`);
  }
  exec(sql: string) {
    this.raw.execSync(sql);
  }
  all(sql: string, ...params: any[]): Row[] {
    return this.raw.getAllSync<Row>(sql, params.map((p) => (p === undefined ? null : p)));
  }
  get(sql: string, ...params: any[]): Row | undefined {
    return this.raw.getFirstSync<Row>(sql, params.map((p) => (p === undefined ? null : p))) ?? undefined;
  }
  run(sql: string, ...params: any[]) {
    return this.raw.runSync(sql, params.map((p) => (p === undefined ? null : p)));
  }
  meta(key: string): string | null {
    return this.get('select value from _meta where key = ?', key)?.value ?? null;
  }
  setMeta(key: string, value: string | null) {
    if (value === null) this.run('delete from _meta where key = ?', key);
    else this.run('insert into _meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value', key, value);
  }
}

export interface QueuedChange {
  id: string;
  method: string;
  path: string;
  label: string;
  status: 'pending' | 'failed';
  error: string | null;
  createdAt: string;
}

export interface SyncState {
  /** a local copy exists, so screens can be answered without the server */
  ready: boolean;
  online: boolean;
  syncing: boolean;
  pending: number;
  failed: number;
  lastSync: string | null;
  lastError: string | null;
}

type Remote = (path: string, init: { method: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ status: number; body: any; headers: Headers }>;

/** Paths only the server can answer (accounts, team, files). Everything else works offline. */
const REMOTE_ONLY = [/^\/auth\//, /^\/me$/, /^\/users/, /^\/audit/, /^\/reports\/export\.xlsx/, /^\/sync\//];

const LABELS: [RegExp, string][] = [
  [/^POST \/invoices$/, 'New invoice'],
  [/^PUT \/invoices\/[^/]+$/, 'Invoice edited'],
  [/^POST \/invoices\/[^/]+\/finalize$/, 'Invoice finalized'],
  [/^POST \/invoices\/[^/]+\/cancel$/, 'Invoice cancelled'],
  [/^POST \/payments$/, 'Payment recorded'],
  [/^POST \/clients$/, 'New client'],
  [/^PUT \/clients\//, 'Client edited'],
  [/^POST \/finance\/entries$/, 'Money in / out'],
  [/^POST \/quotations$/, 'New quotation'],
  [/^POST \/transfers$/, 'Transfer'],
  [/^POST \/services$/, 'New service'],
];
const labelFor = (method: string, path: string) => LABELS.find(([re]) => re.test(`${method} ${path.split('?')[0]}`))?.[1] ?? `${method} ${path.split('?')[0]}`;

/**
 * Offline-first engine. Screens are answered from a copy of the business's data on the phone,
 * using the same code the server runs. Changes are applied locally at once and queued; when a
 * connection is available the queue is sent in order, then a fresh copy is pulled.
 */
class Engine {
  private db: PhoneDb | null = null;
  private app = new MiniApp();
  private auth: AuthContext | null = null;
  private remote: Remote | null = null;
  private listeners = new Set<() => void>();
  private dataListeners = new Set<() => void>();
  private subs: { remove(): void }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  state: SyncState = { ready: false, online: true, syncing: false, pending: 0, failed: 0, lastSync: null, lastError: null };
  /** ids of records created or changed by changes not yet confirmed by the server */
  private pendingIds = new Set<string>();

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  /** Called after a sync brought new data from the server, so screens can reload. */
  onData(fn: () => void) {
    this.dataListeners.add(fn);
    return () => void this.dataListeners.delete(fn);
  }

  private emit(patch: Partial<SyncState> = {}) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Open (or create) the local copy for this user's business account. */
  async start(user: User, remote: Remote) {
    if (this.db && this.auth?.tenantId === user.tenantId) return;
    this.stop();
    this.remote = remote;
    const name = `monetra-${user.tenantId}.db`;
    // In a browser SQLite runs in a worker that must finish loading before synchronous queries;
    // one asynchronous open waits for it. On phones this returns at once.
    if (Platform.OS === 'web') await SQLite.openDatabaseAsync(name);
    this.db = new PhoneDb(name);
    this.app = new MiniApp();
    registerRoutes(this.app, this.db);
    this.auth = { userId: user.id, tenantId: user.tenantId, role: user.role, sessionId: 'phone', name: user.name };
    this.seq = Number(this.db.get('select coalesce(max(seq), 0) as s from _outbox')?.s ?? 0);
    this.refreshCounts();
    this.emit({ ready: !!this.db.meta('etag'), lastSync: this.db.meta('lastSync') });

    const net = await Network.getNetworkStateAsync().catch(() => null);
    this.emit({ online: net ? net.isInternetReachable !== false && net.isConnected !== false : true });
    this.subs.push(
      Network.addNetworkStateListener((s) => {
        const online = s.isInternetReachable !== false && s.isConnected !== false;
        this.emit({ online });
        if (online) this.sync();
      }),
      AppState.addEventListener('change', (s) => s === 'active' && void this.sync()),
    );
    this.timer = setInterval(() => this.sync(), 30_000);
    await this.sync();
  }

  stop() {
    for (const s of this.subs) s.remove();
    this.subs = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.db = null;
    this.auth = null;
    this.pendingIds.clear();
    this.state = { ready: false, online: this.state.online, syncing: false, pending: 0, failed: 0, lastSync: null, lastError: null };
  }

  /** Delete the local copy (on sign-out). */
  wipe() {
    const name = this.auth ? `monetra-${this.auth.tenantId}.db` : null;
    try {
      this.db?.raw.closeSync();
    } catch {}
    this.stop();
    if (name) SQLite.deleteDatabaseSync(name);
    this.emit();
  }

  canHandle(method: string, path: string) {
    return !!this.db && this.state.ready && !REMOTE_ONLY.some((re) => re.test(path.split('?')[0])) && this.app.has(method, path);
  }

  isPending(id: string | null | undefined) {
    return !!id && this.pendingIds.has(id);
  }

  /** Answer a request from the phone. Writes are applied now and queued for the server. */
  request(method: string, path: string, body?: unknown): { status: number; body: any } {
    if (!this.db || !this.auth) throw new Error('Offline data is not ready.');
    if (method === 'GET') return this.app.handle(method, path, undefined, this.auth);
    const id = Crypto.randomUUID();
    const created: string[] = [];
    const res = withIdSeed(id, () => this.app.handle(method, path, body, this.auth!), created);
    if (res.status < 400) {
      const pathIds = path.split('?')[0].split('/').filter((p) => /^[0-9a-f-]{36}$/i.test(p));
      this.db.run(
        'insert into _outbox (id, seq, method, path, body, entity_ids, label, created_at) values (?,?,?,?,?,?,?,?)',
        id, ++this.seq, method, path, JSON.stringify(body ?? null), JSON.stringify([...created, ...pathIds]), labelFor(method, path), new Date().toISOString(),
      );
      this.refreshCounts();
      this.emit();
      setTimeout(() => this.sync(), 50);
    }
    return res;
  }

  queue(): QueuedChange[] {
    if (!this.db) return [];
    return this.db.all('select * from _outbox order by seq').map((r) => ({ id: r.id, method: r.method, path: r.path, label: r.label, status: r.status, error: r.error, createdAt: r.created_at }));
  }

  /** Give up on a change the server refused; the next sync restores the server's version. */
  discard(id: string) {
    this.db?.run('delete from _outbox where id = ?', id);
    this.db?.setMeta('etag', null);
    this.refreshCounts();
    this.emit();
    this.sync();
  }

  /** Try a refused change again (e.g. after fixing the problem elsewhere). */
  retry(id: string) {
    this.db?.run("update _outbox set status = 'pending', error = null where id = ?", id);
    this.refreshCounts();
    this.emit();
    this.sync();
  }

  private refreshCounts() {
    if (!this.db) return;
    const rows = this.db.all("select status, entity_ids from _outbox");
    this.pendingIds = new Set(rows.filter((r) => r.status === 'pending').flatMap((r) => JSON.parse(r.entity_ids) as string[]));
    this.state = { ...this.state, pending: rows.filter((r) => r.status === 'pending').length, failed: rows.filter((r) => r.status === 'failed').length };
  }

  private running: Promise<void> | null = null;
  sync(): Promise<void> {
    this.running ??= this.doSync().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doSync() {
    const db = this.db;
    const remote = this.remote;
    if (!db || !remote || !this.auth) return;
    this.emit({ syncing: true });
    try {
      // 1. send queued changes, oldest first
      let refused = false;
      for (;;) {
        const batch = db.all("select * from _outbox where status = 'pending' order by seq limit 50");
        if (!batch.length) break;
        const r = await remote('/sync/push', { method: 'POST', body: { ops: batch.map((o) => ({ id: o.id, method: o.method, path: o.path, body: JSON.parse(o.body) })) } });
        if (r.status >= 400) throw new Error(r.body?.error ?? 'Sync failed.');
        for (const res of r.body.results as { id: string; status: number; body: any }[]) {
          if (res.status < 400) db.run('delete from _outbox where id = ?', res.id);
          else {
            refused = true;
            db.run("update _outbox set status = 'failed', error = ? where id = ?", res.body?.error ?? `Refused (${res.status})`, res.id);
          }
        }
      }
      // 2. pull the server's copy (skipped when nothing changed since last time)
      const etag = refused ? null : db.meta('etag');
      const p = await remote('/sync/pull', { method: 'GET', headers: etag ? { 'if-none-match': etag } : {} });
      if (p.status === 200) {
        applySnapshot(db, p.body as Snapshot);
        db.setMeta('etag', p.headers.get('etag'));
        // 3. changes made while syncing are applied again on top of the fresh copy
        for (const o of db.all("select * from _outbox where status = 'pending' order by seq")) {
          withIdSeed(o.id, () => this.app.handle(o.method, o.path, JSON.parse(o.body), this.auth!));
        }
        for (const l of this.dataListeners) l();
      } else if (p.status !== 304) throw new Error(p.body?.error ?? 'Could not download the latest data.');
      const at = new Date().toISOString();
      db.setMeta('lastSync', at);
      this.refreshCounts();
      this.emit({ ready: true, online: true, syncing: false, lastSync: at, lastError: null });
    } catch (e: any) {
      this.refreshCounts();
      const offline = e?.status === 0 || /reach the server|network|fetch/i.test(String(e?.message));
      this.emit({ syncing: false, online: offline ? false : this.state.online, lastError: offline ? null : String(e?.message ?? e) });
    }
  }
}

export const engine = new Engine();

