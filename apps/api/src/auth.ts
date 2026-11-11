import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export { HttpError, can, need, permissionsFor, type AuthContext } from './perm';
import { HttpError, type AuthContext } from './perm';

declare global {
  namespace Express {
    interface Request {
      auth: AuthContext;
    }
  }
}

// Without JWT_SECRET a random per-process secret is used: access tokens die on restart, refresh tokens still work.
const SECRET = process.env.JWT_SECRET || randomBytes(48).toString('hex');
export const ACCESS_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 900);
export const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

export const newRefreshToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export function signAccess(ctx: AuthContext): string {
  return jwt.sign({ sub: ctx.userId, tid: ctx.tenantId, role: ctx.role, sid: ctx.sessionId, name: ctx.name }, SECRET, {
    expiresIn: ACCESS_TTL_SECONDS,
  });
}

export function makeRequireAuth(isSessionLive: (sessionId: string) => boolean) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    try {
      const p = jwt.verify(token, SECRET) as jwt.JwtPayload;
      if (!isSessionLive(p.sid)) throw new Error('revoked');
      req.auth = { userId: p.sub!, tenantId: p.tid, role: p.role, sessionId: p.sid, name: p.name };
      next();
    } catch {
      next(new HttpError(401, 'Session expired. Please sign in again.'));
    }
  };
}

