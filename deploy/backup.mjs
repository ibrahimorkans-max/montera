// Consistent copy of the live SQLite database, safe while the API is running.
// Usage: node deploy/backup.mjs        (reads DB_PATH from apps/api/.env)
// Keeps the newest 14 copies in ./backups.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const envFile = join(root, 'apps/api/.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const dbPath = resolve(process.env.DB_PATH || join(root, 'apps/api/data/millnexa.db'));
if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  process.exit(1);
}
const dir = join(root, 'backups');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = join(dir, `monetra-${stamp}.db`);

const db = new DatabaseSync(dbPath);
db.exec(`vacuum into '${target.replace(/'/g, "''")}'`);
db.close();
console.log(`Backup written: ${target}`);

const old = readdirSync(dir).filter((f) => /^monetra-.*\.db$/.test(f)).sort().slice(0, -14);
for (const f of old) rmSync(join(dir, f));
