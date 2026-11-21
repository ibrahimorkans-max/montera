import './env'; // must stay first: loads .env before other modules read settings
import { resolve } from 'node:path';
import { createApp } from './app';
import { Db } from './db';
import { runDue } from './recurring';
import { ensureAccounts } from './accounts';

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';
const dbPath = resolve(process.env.DB_PATH || resolve(import.meta.dirname, '../data/millnexa.db'));
const db = new Db(dbPath);

const runRecurring = () => {
  try {
    const n = runDue(db);
    if (n) console.log(`Recurring invoices: created ${n}`);
  } catch (e) {
    console.error('Recurring run failed:', e);
  }
};
ensureAccounts(db);
runRecurring();
setInterval(runRecurring, 60 * 60 * 1000).unref();

const server = createApp(db).listen(port, host, () => console.log(`Kaarobarly API listening on http://${host}:${port} (database: ${dbPath})`));

// Finish open requests and close the database cleanly when PM2 or systemd stops the process.
const shutdown = () => {
  server.close(() => {
    db.raw.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
