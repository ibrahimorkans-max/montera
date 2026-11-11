import { z } from 'zod';
import { RATE_SCALE, precisionOf, toBase, type ExchangeRate } from '../../../packages/shared/src/index';
import { HttpError, type AuthContext } from './perm';
import { now, uid, type Db, type Row } from './core';

export const rateSchema = z.object({
  currency: z.string().trim().length(3).toUpperCase(),
  baseCurrency: z.string().trim().length(3).toUpperCase(),
  rate: z.number().int().min(1).max(1e15),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(200).default(''),
});

const map = (r: Row): ExchangeRate => ({ id: r.id, currency: r.currency, baseCurrency: r.base_currency, rate: r.rate, date: r.date, note: r.note });

export function listRates(db: Db, tenantId: string): ExchangeRate[] {
  return db.all('select * from exchange_rate where tenant_id = ? order by date desc, created_at desc limit 300', tenantId).map(map);
}

export function saveRate(db: Db, auth: AuthContext, body: z.infer<typeof rateSchema>): ExchangeRate {
  if (body.currency === body.baseCurrency) throw new HttpError(422, 'Choose two different currencies.');
  const id = uid();
  db.run(
    'insert into exchange_rate (id, tenant_id, currency, base_currency, rate, date, note, created_by, created_at) values (?,?,?,?,?,?,?,?,?)',
    id, auth.tenantId, body.currency, body.baseCurrency, body.rate, body.date, body.note, auth.userId, now(),
  );
  db.audit(auth.tenantId, auth.userId, 'fx.rate', 'exchange_rate', id, { pair: `${body.currency}/${body.baseCurrency}`, rate: body.rate });
  return map(db.get('select * from exchange_rate where id = ?', id)!);
}

export function deleteRate(db: Db, auth: AuthContext, id: string) {
  const r = db.run('delete from exchange_rate where id = ? and tenant_id = ?', id, auth.tenantId);
  if (!r.changes) throw new HttpError(404, 'Rate not found.');
}

/**
 * Units of `base` per 1 unit of `currency` (× RATE_SCALE) on or before `date` (latest when omitted).
 * A rate recorded the other way round is inverted. Null when nothing is recorded.
 */
export function findRate(db: Db, tenantId: string, currency: string, base: string, date?: string): number | null {
  if (currency === base) return RATE_SCALE;
  const d = date ?? '9999-12-31';
  const direct = db.get(
    'select rate from exchange_rate where tenant_id = ? and currency = ? and base_currency = ? and date <= ? order by date desc, created_at desc limit 1',
    tenantId, currency, base, d,
  );
  if (direct) return direct.rate;
  const inverse = db.get(
    'select rate from exchange_rate where tenant_id = ? and currency = ? and base_currency = ? and date <= ? order by date desc, created_at desc limit 1',
    tenantId, base, currency, d,
  );
  if (inverse) return Math.round((RATE_SCALE * RATE_SCALE) / inverse.rate);
  return null;
}

/**
 * Converts amounts in any currency to one target currency using the latest recorded rates.
 * Amounts with no rate are skipped and `missing` is set, so screens can say so.
 */
export class Converter {
  missing = false;
  private cache = new Map<string, number | null>();
  readonly precision: number;
  constructor(
    private db: Db,
    private tenantId: string,
    readonly currency: string,
  ) {
    this.precision = precisionOf(currency);
  }
  rate(from: string): number | null {
    if (!this.cache.has(from)) this.cache.set(from, findRate(this.db, this.tenantId, from, this.currency));
    return this.cache.get(from)!;
  }
  /** minor units of `from` → minor units of the target, or 0 (and missing = true) without a rate */
  convert(minor: number, from: string, fromPrecision = precisionOf(from)): number {
    if (!minor) return 0;
    const rate = this.rate(from);
    if (rate === null) {
      this.missing = true;
      return 0;
    }
    return toBase(minor, rate, fromPrecision, this.precision);
  }
}

/** Currency used when several businesses are shown together. */
export function reportingCurrency(db: Db, tenantId: string): string {
  const t = db.get('select reporting_currency from tenant where id = ?', tenantId);
  if (t?.reporting_currency) return t.reporting_currency;
  return db.get('select currency from business where tenant_id = ? order by created_at limit 1', tenantId)?.currency ?? 'PKR';
}

/** Amount of a document in its business currency, using the factor stored on the document. */
export function inBase(minor: number, factor: number | null | undefined): number {
  if (!factor || factor === RATE_SCALE || !minor) return minor;
  const n = BigInt(minor) * BigInt(factor);
  const d = BigInt(RATE_SCALE);
  const neg = n < 0n;
  const q = ((neg ? -n : n) * 2n + d) / (d * 2n);
  return Number(neg ? -q : q);
}
