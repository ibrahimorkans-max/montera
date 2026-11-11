import { ZodError } from 'zod';
import { ROLE_PERMISSIONS, type Permission, type Role } from '../../../packages/shared/src/index';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: Role;
  sessionId: string;
  name: string;
}

/** The parts of a request the route handlers use, on the server and on the phone alike. */
export interface Req {
  method: string;
  params: Record<string, string>;
  query: Record<string, any>;
  body: any;
  auth: AuthContext;
}
export interface Res {
  status(code: number): Res;
  json(body: unknown): void;
}
export type Next = (err?: unknown) => void;

export const permissionsFor = (role: Role): Permission[] => [...(ROLE_PERMISSIONS[role] ?? [])];

export function can(req: { auth: AuthContext }, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[req.auth.role] ?? []).includes(permission);
}

export function need(permission: Permission) {
  return (req: any, _res: any, next: Next) => (can(req, permission) ? next() : next(new HttpError(403, 'You do not have permission to do this.')));
}

/** Turn a thrown error into the HTTP response body clients expect. */
export function errorResponse(err: unknown): { status: number; body: { error: string; issues?: unknown } } {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return { status: 422, body: { error: first ? `${first.message}${first.path.length ? ` (${first.path.join('.')})` : ''}` : 'Invalid input', issues: err.issues } };
  }
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
  if ((err as any)?.type === 'entity.too.large') return { status: 413, body: { error: 'Attachment is too large.' } };
  console.error(err);
  return { status: 500, body: { error: 'Something went wrong on the server.' } };
}
