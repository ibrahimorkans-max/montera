import { resolve } from 'node:path';
import { createApp } from './app';
import { Db } from './db';
import { runDue } from './recurring';
import { ensureAccounts } from './accounts';

const port = Number(process.env.PORT || 4000);
const db = new Db(process.env.DB_PATH || resolve(import.meta.dirname, '../data/millnexa.db'));
if (!process.env.JWT_SECRET) console.warn('JWT_SECRET is not set: using a temporary secret for this run. Set it before deploying.');

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

createApp(db).listen(port, '0.0.0.0', () => console.log(`Monetra API listening on http://localhost:${port}`));
