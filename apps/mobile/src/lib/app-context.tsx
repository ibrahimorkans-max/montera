import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, StyleSheet, Text, useColorScheme } from 'react-native';
import { Alert, Platform as RNPlatform } from 'react-native';
import { api, clearSession, remoteForEngine, restoreSession, setSignedOutHandler, storeSession } from './api';
import { engine } from './engine';
import { local } from './storage';
import type { Permission, User } from './shared';

// ---------------------------------------------------------------- theme

const light = {
  dark: false,
  bg: '#F3F6FC',
  card: '#FFFFFF',
  text: '#0B1B4D',
  sub: '#5B6472',
  border: '#DCE3F1',
  input: '#FFFFFF',
  primary: '#1257E6',
  onPrimary: '#FFFFFF',
  primarySoft: '#E1EBFF',
  danger: '#B42318',
  dangerSoft: '#FDE8E6',
  warn: '#9A5B00',
  warnSoft: '#FCEFD3',
  success: '#11703A',
  successSoft: '#DCF3E4',
  info: '#1D4ED8',
  infoSoft: '#E0E9FD',
  neutralSoft: '#E9EEF8',
};
export type Theme = typeof light;
const dark: Theme = {
  dark: true,
  bg: '#060C1F',
  card: '#0E1730',
  text: '#F2F4F7',
  sub: '#A3ADBA',
  border: '#21304F',
  input: '#0A1226',
  primary: '#7FB0FF',
  onPrimary: '#06122E',
  primarySoft: '#13264F',
  danger: '#FF8A7E',
  dangerSoft: '#3A1714',
  warn: '#F5B955',
  warnSoft: '#35280F',
  success: '#5FD38D',
  successSoft: '#12301E',
  info: '#8DB0FF',
  infoSoft: '#152445',
  neutralSoft: '#15213D',
};

export type ThemeMode = 'system' | 'light' | 'dark';
const ThemeCtx = createContext<{ theme: Theme; mode: ThemeMode; setMode: (m: ThemeMode) => void }>({ theme: light, mode: 'system', setMode: () => {} });

export const useTheme = () => useContext(ThemeCtx).theme;
export const useThemeMode = () => useContext(ThemeCtx);

// ---------------------------------------------------------------- auth

interface AuthState {
  user: User | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: { businessName: string; name: string; email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  can: (p: Permission) => boolean;
}
const AuthCtx = createContext<AuthState>(null as any);
export const useAuth = () => useContext(AuthCtx);

const deviceName = `${Platform.OS} app`;

// ---------------------------------------------------------------- toast

type ToastKind = 'success' | 'error';
const ToastCtx = createContext<(message: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- provider

/** Open the phone's copy of the data before any screen asks for it. Never blocks sign-in on failure. */
async function startOffline(user: User | null) {
  if (!user?.tenantId) return;
  const timeout = new Promise<void>((r) => setTimeout(r, 8000));
  await Promise.race([engine.start(user, remoteForEngine).catch((e) => console.warn('Offline data could not start:', e?.message ?? e)), timeout]);
}

export function AppProviders({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    local.get<ThemeMode>('millnexa.theme').then((m) => m && setModeState(m));
    setSignedOutHandler(() => setUser(null));
    restoreSession()
      .then(async (u) => {
        await startOffline(u);
        setUser(u);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const theme = (mode === 'system' ? system : mode) === 'dark' ? dark : light;
  const themeValue = useMemo(
    () => ({
      theme,
      mode,
      setMode: (m: ThemeMode) => {
        setModeState(m);
        local.set('millnexa.theme', m);
      },
    }),
    [theme, mode],
  );

  const auth = useMemo<AuthState>(
    () => ({
      user,
      ready,
      async signIn(email, password) {
        const s = await api('/auth/login', { body: { email, password, deviceName }, auth: false });
        await storeSession(s);
        await startOffline(s.user);
        setUser(s.user);
      },
      async register(input) {
        const s = await api('/auth/register', { body: { ...input, deviceName }, auth: false });
        await storeSession(s);
        await startOffline(s.user);
        setUser(s.user);
      },
      async signOut() {
        const waiting = engine.state.pending + engine.state.failed;
        if (waiting > 0) {
          const msg = `${waiting} change${waiting === 1 ? ' has' : 's have'} not reached the server yet and will be lost if you sign out now. Connect to the internet and let them sync first.`;
          const ok = RNPlatform.OS === 'web' ? globalThis.confirm(`Sign out anyway?\n\n${msg}`) : await new Promise<boolean>((r) => Alert.alert('Sign out anyway?', msg, [{ text: 'Cancel', style: 'cancel', onPress: () => r(false) }, { text: 'Sign out', style: 'destructive', onPress: () => r(true) }]));
          if (!ok) return;
        }
        await api('/auth/logout', { method: 'POST' }).catch(() => {});
        await clearSession();
        engine.wipe();
        setUser(null);
      },
      can: (p) => !!user?.permissions.includes(p),
    }),
    [user, ready],
  );

  const show = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, kind });
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      timer.current = setTimeout(
        () => Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setToast(null)),
        kind === 'error' ? 4500 : 2500,
      );
    },
    [opacity],
  );

  return (
    <ThemeCtx.Provider value={themeValue}>
      <AuthCtx.Provider value={auth}>
        <ToastCtx.Provider value={show}>
          {children}
          {toast && (
            <Animated.View
              pointerEvents="none"
              accessibilityLiveRegion="polite"
              style={[styles.toast, { opacity, backgroundColor: toast.kind === 'error' ? theme.danger : theme.success }]}>
              <Text style={[styles.toastText, { color: theme.dark ? '#0A0E13' : '#FFFFFF' }]}>{toast.message}</Text>
            </Animated.View>
          )}
        </ToastCtx.Provider>
      </AuthCtx.Provider>
    </ThemeCtx.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: Platform.select({ web: 16, default: 56 }),
    padding: 14,
    borderRadius: 12,
    alignSelf: 'center',
    maxWidth: 560,
    zIndex: 1000,
    elevation: 10,
  },
  toastText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
