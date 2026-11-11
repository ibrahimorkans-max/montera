import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ROLES, type User } from '../../../packages/shared/src/index';
import {
  HttpError,
  REFRESH_TTL_DAYS,
  can,
  hashPassword,
  hashToken,
  makeRequireAuth,
  need,
  newRefreshToken,
  permissionsFor,
  signAccess,
  verifyPassword,
} from './auth';
import { now, uid, type Db, type Row } from './db';
import * as d from './domain';
import * as acc from './accounts';
import { reportFileName, reportWorkbook } from './excel';
import { MiniApp } from './mini';
import { errorResponse } from './perm';
import { type ReportFilter } from './reports';
import { registerRoutes, upsert } from './routes';
import { applyOps, bumpSeq, pushSchema, snapshot, syncSeq } from './sync';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;


export function createApp(db: Db) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '6mb' }));

  const requireAuth = makeRequireAuth((sid) => !!db.get("select 1 from auth_session where id = ? and revoked_at is null and expires_at > ?", sid, now()));

  const page = (req: Request) => ({
    limit: Math.min(Math.max(Number(req.query.limit) || 30, 1), 100),
    offset: Math.max(Number(req.query.offset) || 0, 0),
    q: String(req.query.q ?? '').trim(),
  });

  function userDto(u: Row): User {
    const tenant = db.get('select name from tenant where id = ?', u.tenant_id)!;
    return { id: u.id, name: u.name, email: u.email, role: u.role, permissions: permissionsFor(u.role), tenantName: tenant.name, tenantId: u.tenant_id };
  }

  function openSession(u: Row, deviceName: string) {
    const sessionId = uid();
    const refresh = newRefreshToken();
    const expires = new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000).toISOString();
    db.run(
      'insert into auth_session (id, tenant_id, user_id, refresh_hash, device_name, expires_at, created_at, last_used_at) values (?,?,?,?,?,?,?,?)',
      sessionId, u.tenant_id, u.id, hashToken(refresh), deviceName, expires, now(), now(),
    );
    const accessToken = signAccess({ userId: u.id, tenantId: u.tenant_id, role: u.role, sessionId, name: u.name });
    return { accessToken, refreshToken: `${sessionId}.${refresh}`, user: userDto(u) };
  }


  // ------------------------------------------------------------ auth

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.post('/auth/register', (req, res) => {
    const body = z
      .object({
        businessName: z.string().trim().min(2).max(200),
        name: z.string().trim().min(2).max(200),
        email: z.string().trim().email(),
        password: z.string().min(8, 'Password must be at least 8 characters').max(200),
        deviceName: z.string().max(100).default(''),
      })
      .parse(req.body);
    const out = db.tx(() => {
      if (db.get('select 1 from app_user where email = ?', body.email)) throw new HttpError(409, 'An account with this email already exists.');
      const tenantId = uid();
      const userId = uid();
      db.run('insert into tenant (id, name, created_at) values (?,?,?)', tenantId, body.businessName, now());
      db.run('insert into app_user (id, tenant_id, email, name, password_hash, role, created_at) values (?,?,?,?,?,?,?)', userId, tenantId, body.email, body.name, hashPassword(body.password), 'owner', now());
      const bizId = upsert(db, 'business', tenantId, d.businessSchema.parse({ legalName: body.businessName, ownerName: body.name, email: body.email }));
      acc.ensureAccounts(db, { businessId: bizId });
      db.audit(tenantId, userId, 'tenant.register', 'tenant', tenantId);
      return openSession(db.get('select * from app_user where id = ?', userId)!, body.deviceName);
    });
    res.status(201).json(out);
  });

  app.post('/auth/login', (req, res) => {
    const body = z.object({ email: z.string().trim(), password: z.string(), deviceName: z.string().max(100).default('') }).parse(req.body);
    const u = db.get('select * from app_user where email = ?', body.email);
    const fail = new HttpError(401, 'Incorrect email or password.');
    if (!u || u.status !== 'active') throw fail;
    if (u.locked_until && u.locked_until > now()) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    if (!verifyPassword(body.password, u.password_hash)) {
      const fails = u.failed_logins + 1;
      const lock = fails >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
      db.run('update app_user set failed_logins = ?, locked_until = ? where id = ?', lock ? 0 : fails, lock, u.id);
      throw fail;
    }
    db.run('update app_user set failed_logins = 0, locked_until = null where id = ?', u.id);
    db.audit(u.tenant_id, u.id, 'auth.login', 'user', u.id, { device: body.deviceName });
    res.json(openSession(u, body.deviceName));
  });

  app.post('/auth/refresh', (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    const [sessionId, secret] = refreshToken.split('.');
    const s = db.get('select * from auth_session where id = ?', sessionId ?? '');
    if (!s || s.revoked_at || s.expires_at < now() || s.refresh_hash !== hashToken(secret ?? '')) throw new HttpError(401, 'Session expired. Please sign in again.');
    const u = db.get("select * from app_user where id = ? and status = 'active'", s.user_id);
    if (!u) throw new HttpError(401, 'Session expired. Please sign in again.');
    const next = newRefreshToken();
    db.run('update auth_session set refresh_hash = ?, last_used_at = ? where id = ?', hashToken(next), now(), s.id);
    res.json({
      accessToken: signAccess({ userId: u.id, tenantId: u.tenant_id, role: u.role, sessionId: s.id, name: u.name }),
      refreshToken: `${s.id}.${next}`,
      user: userDto(u),
    });
  });

  app.use(requireAuth);
  const T = (req: Request) => req.auth.tenantId;

  app.post('/auth/logout', (req, res) => {
    db.run('update auth_session set revoked_at = ? where id = ? and tenant_id = ?', now(), req.auth.sessionId, T(req));
    res.json({ ok: true });
  });

  app.get('/me', (req, res) => res.json(userDto(db.get('select * from app_user where id = ? and tenant_id = ?', req.auth.userId, T(req))!)));

  app.get('/auth/sessions', (req, res) => {
    const rows = db.all(
      'select id, device_name, created_at, last_used_at from auth_session where tenant_id = ? and user_id = ? and revoked_at is null and expires_at > ? order by last_used_at desc',
      T(req), req.auth.userId, now(),
    );
    res.json(rows.map((r) => ({ id: r.id, deviceName: r.device_name, createdAt: r.created_at, lastUsedAt: r.last_used_at, current: r.id === req.auth.sessionId })));
  });

  app.delete('/auth/sessions/:id', (req, res) => {
    db.run('update auth_session set revoked_at = ? where id = ? and tenant_id = ? and user_id = ?', now(), req.params.id, T(req), req.auth.userId);
    res.json({ ok: true });
  });

  // Re-check the account password, e.g. to unlock the app when the PIN is forgotten.
  app.post('/auth/verify-password', (req, res) => {
    const { password } = z.object({ password: z.string().max(200) }).parse(req.body);
    const u = db.get('select * from app_user where id = ? and tenant_id = ?', req.auth.userId, T(req))!;
    if (u.locked_until && u.locked_until > now()) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    if (!verifyPassword(password, u.password_hash)) {
      const fails = u.failed_logins + 1;
      const lock = fails >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
      db.run('update app_user set failed_logins = ?, locked_until = ? where id = ?', lock ? 0 : fails, lock, u.id);
      throw new HttpError(403, 'Incorrect password.');
    }
    db.run('update app_user set failed_logins = 0, locked_until = null where id = ?', u.id);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ team

  app.get('/users', need('users.manage'), (req, res) => {
    res.json(db.all('select id, name, email, role, status from app_user where tenant_id = ? order by created_at', T(req)));
  });

  app.post('/users', need('users.manage'), (req, res) => {
    const body = z.object({ name: z.string().trim().min(2), email: z.string().trim().email(), password: z.string().min(8), role: z.enum(ROLES) }).parse(req.body);
    if (db.get('select 1 from app_user where email = ?', body.email)) throw new HttpError(409, 'An account with this email already exists.');
    const id = uid();
    db.run('insert into app_user (id, tenant_id, email, name, password_hash, role, created_at) values (?,?,?,?,?,?,?)', id, T(req), body.email, body.name, hashPassword(body.password), body.role, now());
    db.audit(T(req), req.auth.userId, 'user.create', 'user', id, { role: body.role });
    res.status(201).json({ id, name: body.name, email: body.email, role: body.role, status: 'active' });
  });

  // ------------------------------------------------------------ server-only: Excel and sync

  const reportFilter = (req: Request): ReportFilter => {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    const t = new Date().toISOString().slice(0, 10);
    const from = date.safeParse(req.query.from).success ? String(req.query.from) : `${t.slice(0, 7)}-01`;
    const to = date.safeParse(req.query.to).success ? String(req.query.to) : t;
    if (to < from) throw new HttpError(422, 'The end of the period is before its start.');
    return { from, to, businessId: req.query.businessId ? String(req.query.businessId) : undefined };
  };
  app.get('/reports/export.xlsx', need('reports.view'), async (req, res, next) => {
    try {
      const f = reportFilter(req);
      const tenant = db.get('select name from tenant where id = ?', T(req))!;
      const buf = await reportWorkbook(db, T(req), f, tenant.name);
      db.audit(T(req), req.auth.userId, 'report.export', 'report', null, { from: f.from, to: f.to, format: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${reportFileName(f)}"`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      res.send(buf);
    } catch (e) {
      next(e);
    }
  });

  // the same routes, run in-process, replay operations queued on phones
  const engine = new MiniApp();
  registerRoutes(engine, db);

  app.get('/sync/pull', (req, res) => {
    const seq = syncSeq(db, T(req));
    const tag = `"${T(req)}:${seq}"`;
    if (req.headers['if-none-match'] === tag) return void res.status(304).end();
    res.setHeader('ETag', tag);
    res.setHeader('Access-Control-Expose-Headers', 'ETag');
    res.json(snapshot(db, T(req)));
  });
  app.post('/sync/push', (req, res) => {
    const { ops } = pushSchema.parse(req.body);
    res.json({ results: applyOps(db, engine, req.auth, ops), seq: syncSeq(db, T(req)) });
  });

  // phones know data changed elsewhere when this number moves
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') res.on('finish', () => res.statusCode < 400 && bumpSeq(db, T(req)));
    next();
  });

  registerRoutes(app, db);

  // ------------------------------------------------------------ errors

  app.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const r = errorResponse(err);
    res.status(r.status).json(r.body);
  });

  return app;
}
