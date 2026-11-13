/**
 * Loads apps/api/.env (when it exists) before any other module reads process.env.
 * server.ts imports this first; values already set in the real environment win.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(import.meta.dirname, '../.env');
if (existsSync(file)) process.loadEnvFile(file);

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('JWT_SECRET is not set. Add it to apps/api/.env (generate one with: openssl rand -hex 48).');
    process.exit(1);
  }
  console.warn('JWT_SECRET is not set: using a temporary secret for this run. Set it before deploying.');
}
