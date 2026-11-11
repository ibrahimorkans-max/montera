import { errorResponse, type AuthContext, type Next, type Req, type Res } from './perm';

type Handler = (req: Req, res: Res, next: Next) => unknown;

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handlers: Handler[];
}

export interface MiniResponse {
  status: number;
  body: any;
}

function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of qs.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}

/**
 * A tiny in-process router with the same shape as Express (get/post/put/delete/use).
 * The phone registers the server's routes on it and answers requests from its local
 * database; the server uses it to replay operations queued on phones. Handlers are synchronous.
 */
export class MiniApp {
  private routes: Route[] = [];
  private globals: Handler[] = [];

  use(handler: Handler) {
    this.globals.push(handler);
  }
  private add(method: string, path: string, handlers: Handler[]) {
    const keys: string[] = [];
    const re = new RegExp(`^${path.replace(/:([A-Za-z]+)/g, (_m, k) => (keys.push(k), '([^/]+)'))}/?$`);
    this.routes.push({ method, re, keys, handlers });
  }
  get(path: string, ...h: Handler[]) {
    this.add('GET', path, h);
  }
  post(path: string, ...h: Handler[]) {
    this.add('POST', path, h);
  }
  put(path: string, ...h: Handler[]) {
    this.add('PUT', path, h);
  }
  delete(path: string, ...h: Handler[]) {
    this.add('DELETE', path, h);
  }

  /** True when a request with this method and path would reach a route. */
  has(method: string, url: string): boolean {
    const path = url.split('?')[0];
    return this.routes.some((r) => r.method === method && r.re.test(path));
  }

  handle(method: string, url: string, body: unknown, auth: AuthContext): MiniResponse {
    const [path, qs = ''] = url.split('?');
    let route: Route | undefined;
    let match: RegExpExecArray | null = null;
    for (const r of this.routes) {
      if (r.method !== method) continue;
      match = r.re.exec(path);
      if (match) {
        route = r;
        break;
      }
    }
    if (!route || !match) return { status: 404, body: { error: 'Not found.' } };
    const params: Record<string, string> = {};
    route.keys.forEach((k, i) => (params[k] = decodeURIComponent(match![i + 1])));
    const req: Req = { method, params, query: parseQuery(qs), body: body ?? {}, auth };
    const out: MiniResponse = { status: 200, body: undefined };
    let done = false;
    const res: Res = {
      status(code: number) {
        out.status = code;
        return res;
      },
      json(b: unknown) {
        out.body = b;
        done = true;
      },
    };
    const chain = [...this.globals, ...route.handlers];
    let failure: unknown = null;
    const run = (i: number) => {
      if (done || failure || i >= chain.length) return;
      let called = false;
      chain[i](req, res, (err?: unknown) => {
        called = true;
        if (err) failure = err;
        else run(i + 1);
      });
      if (!called && !done && !failure) return; // handler finished without responding or calling next
    };
    try {
      run(0);
    } catch (e) {
      failure = e;
    }
    if (failure) return errorResponse(failure);
    if (!done) return { status: 500, body: { error: 'No response.' } };
    return out;
  }
}
