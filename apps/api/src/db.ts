import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BaseDb, type Row } from './core';

export { now, today, uid, type Row } from './core';

/** Server database: Node's built-in SQLite. */
export class Db extends BaseDb {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    super();
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
    this.init();
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }
  all(sql: string, ...params: any[]): Row[] {
    return this.raw.prepare(sql).all(...params) as Row[];
  }
  get(sql: string, ...params: any[]): Row | undefined {
    return this.raw.prepare(sql).get(...params) as Row | undefined;
  }
  run(sql: string, ...params: any[]) {
    return this.raw.prepare(sql).run(...params);
  }
}
