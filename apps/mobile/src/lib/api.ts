import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { engine } from './engine';
import { local, secure } from './storage';
import type { User } from './shared';

/** Live server used by release builds. */
export const PRODUCTION_API_URL = 'https://monetra.zhtrader.com';
/**
 * Development uses this computer (set EXPO_PUBLIC_API_URL to its LAN address when testing on a phone);
 * release builds use the live server. EXPO_PUBLIC_API_URL always wins when set.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://localhost:4000' : PRODUCTION_API_URL)).replace(/\/$/, '');

const REFRESH_KEY = 'millnexa.refresh';
const USER_KEY = 'millnexa.user';
let accessToken = '';
let restoring: Promise<User | null> | null = null;
let onSignedOut: () => void = () => {};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

async function raw(path: string, method: string, body?: unknown, withAuth = true): Promise<Response> {
  try {
    return await fetch(API_URL + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(withAuth && accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your internet connection.');
  }
}

async function readJson(res: Response) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'Request failed.');
  return json;
}

/** Authorization header for requests made outside api(), such as file downloads. */
export const authHeader = (): Record<string, string> => (accessToken ? { authorization: `Bearer ${accessToken}` } : {});

export async function storeSession(s: { accessToken: string; refreshToken: string; user?: User }) {
  accessToken = s.accessToken;
  await secure.set(REFRESH_KEY, s.refreshToken);
  if (s.user) await local.set(USER_KEY, s.user);
}

export async function clearSession() {
  accessToken = '';
  await secure.remove(REFRESH_KEY);
  await local.remove(USER_KEY);
}

/**
 * Exchange the stored refresh token for a new session. Returns the user, or null if signed out.
 * Refresh tokens are single-use, so concurrent callers share one request instead of racing.
 */
export function restoreSession(): Promise<User | null> {
  restoring ??= doRestore().finally(() => {
    restoring = null;
  });
  return restoring;
}

async function doRestore(): Promise<User | null> {
  const refreshToken = await secure.get(REFRESH_KEY);
  if (!refreshToken) return null;
  let res: Response;
  try {
    res = await raw('/auth/refresh', 'POST', { refreshToken }, false);
  } catch (e) {
    // no connection: keep working offline as the last signed-in user
    if (e instanceof ApiError && e.status === 0) return local.get<User>(USER_KEY);
    throw e;
  }
  if (!res.ok) {
    if (res.status === 401) await clearSession();
    return null;
  }
  const json = await res.json();
  await storeSession(json);
  return json.user;
}

const refreshOnce = (): Promise<boolean> =>
  restoreSession()
    .then((u) => !!u)
    .catch(() => false);

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  // answered from the phone's own copy whenever possible; the change is synced in the background
  if (opts.auth !== false && engine.canHandle(method, path)) {
    const r = engine.request(method, path, opts.body);
    if (r.status >= 400) throw new ApiError(r.status, r.body?.error ?? 'Request failed.');
    return r.body as T;
  }
  let res = await raw(path, method, opts.body, opts.auth !== false);
  if (res.status === 401 && opts.auth !== false) {
    if (await refreshOnce()) res = await raw(path, method, opts.body);
    else {
      await clearSession();
      onSignedOut();
    }
  }
  return readJson(res);
}

/** Server calls made by the sync engine: refreshes the session once on 401 and never throws for HTTP errors. */
export async function remoteForEngine(path: string, init: { method: string; body?: unknown; headers?: Record<string, string> }) {
  const go = () =>
    fetch(API_URL + path, {
      method: init.method,
      headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }).catch(() => {
      throw new ApiError(0, 'Cannot reach the server.');
    });
  let res = await go();
  if (res.status === 401 && (await refreshOnce())) res = await go();
  if (res.status === 401) {
    await clearSession();
    onSignedOut();
  }
  const body = res.status === 304 ? null : await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Load a GET endpoint; reloads whenever the screen regains focus or the path changes. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!!path);
  const [refreshing_, setRefreshing] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (pull = false) => {
      if (!path) return;
      const mine = ++seq.current;
      if (pull) setRefreshing(true);
      try {
        const d = await api<T>(path);
        if (mine === seq.current) {
          setData(d);
          setError('');
        }
      } catch (e: any) {
        if (mine === seq.current) setError(e.message);
      } finally {
        if (mine === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [path],
  );

  useEffect(() => {
    setLoading(!!path);
  }, [path]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => engine.onData(() => load()), [load]);
  return { data, error, loading, refreshing: refreshing_, reload: () => load(true), setData };
}

/** Paged list: appends pages as the user scrolls. */
export function usePaged<T>(basePath: string, pageSize = 30) {
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const seq = useRef(0);
  const busy = useRef(false);

  const fetchPage = useCallback(
    async (offset: number) => {
      const mine = ++seq.current;
      busy.current = true;
      try {
        const sep = basePath.includes('?') ? '&' : '?';
        const page = await api<T[]>(`${basePath}${sep}limit=${pageSize}&offset=${offset}`);
        if (mine !== seq.current) return;
        setItems((prev) => (offset === 0 ? page : [...prev, ...page]));
        setDone(page.length < pageSize);
        setError('');
      } catch (e: any) {
        if (mine === seq.current) setError(e.message);
      } finally {
        if (mine === seq.current) {
          setLoading(false);
          busy.current = false;
        }
      }
    },
    [basePath, pageSize],
  );

  useFocusEffect(
    useCallback(() => {
      fetchPage(0);
    }, [fetchPage]),
  );

  useEffect(() => engine.onData(() => fetchPage(0)), [fetchPage]);
  return {
    items,
    error,
    loading,
    done,
    reload: () => fetchPage(0),
    more: () => {
      if (!busy.current && !done && !loading) fetchPage(items.length);
    },
  };
}
