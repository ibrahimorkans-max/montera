import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { LinearGradient } from 'expo-linear-gradient';
import * as LocalAuthentication from 'expo-local-authentication';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, AppState, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from './api';
import { useAuth, useTheme, useToast } from './app-context';
import { LogoMark } from '../components/logo';
import { secure } from './storage';

const KEY = 'millnexa.lock';
export const PIN_LENGTH = 4;
const MAX_TRIES = 5;
const RELOCK_AFTER_MS = 60_000;
export const GRADIENT = ['#060F2E', '#0B1B4D', '#0E2C72'] as const;

interface LockConfig {
  salt: string;
  hash: string;
  biometric: boolean;
}

const digest = (salt: string, pin: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);

async function biometricsReady(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

interface LockState {
  enabled: boolean;
  biometric: boolean;
  biometricAvailable: boolean;
  setPin: (pin: string) => Promise<void>;
  checkPin: (pin: string) => Promise<boolean>;
  disable: () => Promise<void>;
  setBiometric: (on: boolean) => Promise<void>;
  lockNow: () => void;
}
const LockCtx = createContext<LockState>(null as any);
export const useLock = () => useContext(LockCtx);

function Key({ children, onPress, label, bg }: { children: ReactNode; onPress: () => void; label: string; bg: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, opacity: pressed ? 0.55 : 1, transform: [{ scale: pressed ? 0.92 : 1 }] })}>
      {children}
    </Pressable>
  );
}

/** Number pad with PIN dots. Calls onComplete when the last digit is entered. */
export function PinPad({ onComplete, error, light, extraKey }: { onComplete: (pin: string) => void; error?: number; light?: boolean; extraKey?: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void } }) {
  const t = useTheme();
  const [pin, setPin] = useState('');
  const shake = useRef(new Animated.Value(0)).current;
  const fg = light ? '#FFFFFF' : t.text;
  const keyBg = light ? 'rgba(255,255,255,0.14)' : t.neutralSoft;

  // `error` is a counter: each increment clears the entry and shakes the dots
  useEffect(() => {
    if (!error) return;
    setPin('');
    Animated.sequence(
      [10, -10, 8, -8, 4, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 55, useNativeDriver: Platform.OS !== 'web' })),
    ).start();
  }, [error, shake]);

  const press = (d: string) => {
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + d;
    setPin(next);
    if (next.length === PIN_LENGTH) setTimeout(() => onComplete(next), 120);
  };
  const digit = (d: string) => (
    <Key key={d} bg={keyBg} label={`Digit ${d}`} onPress={() => press(d)}>
      <Text style={{ color: fg, fontSize: 28, fontWeight: '600' }}>{d}</Text>
    </Key>
  );

  return (
    <View style={{ alignItems: 'center', gap: 26 }}>
      <Animated.View accessibilityLabel={`${pin.length} of ${PIN_LENGTH} digits entered`} style={{ flexDirection: 'row', gap: 18, transform: [{ translateX: shake }] }}>
        {Array.from({ length: PIN_LENGTH }, (_, n) => (
          <View key={n} style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: fg, backgroundColor: n < pin.length ? fg : 'transparent' }} />
        ))}
      </Animated.View>
      <View style={{ gap: 16 }}>
        {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']].map((row) => (
          <View key={row[0]} style={{ flexDirection: 'row', gap: 24 }}>
            {row.map(digit)}
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 24 }}>
          {extraKey ? (
            <Key bg={keyBg} label={extraKey.label} onPress={extraKey.onPress}>
              <Ionicons name={extraKey.icon} size={30} color={fg} />
            </Key>
          ) : (
            <View style={{ width: 72 }} />
          )}
          {digit('0')}
          <Key bg={keyBg} label="Delete digit" onPress={() => setPin((p) => p.slice(0, -1))}>
            <Ionicons name="backspace-outline" size={28} color={fg} />
          </Key>
        </View>
      </View>
    </View>
  );
}

function LockScreen({ config, onUnlock, onPasswordReset }: { config: LockConfig; onUnlock: () => void; onPasswordReset: () => void }) {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [errors, setErrors] = useState(0);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'pin' | 'password'>('pin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [bioReady, setBioReady] = useState(false);

  const fingerprint = useCallback(async () => {
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Kaarobarly', cancelLabel: 'Use PIN', disableDeviceFallback: true });
      if (r.success) onUnlock();
    } catch {
      setMessage('Fingerprint is not available right now. Enter your PIN.');
    }
  }, [onUnlock]);

  useEffect(() => {
    if (!config.biometric) return;
    biometricsReady().then((ok) => {
      setBioReady(ok);
      if (ok) fingerprint();
    });
  }, [config.biometric, fingerprint]);

  async function tryPin(pin: string) {
    if ((await digest(config.salt, pin)) === config.hash) return onUnlock();
    const n = errors + 1;
    setErrors(n);
    if (n >= MAX_TRIES) {
      setMode('password');
      setMessage('Too many wrong attempts. Enter your account password.');
    } else setMessage(`Wrong PIN. ${MAX_TRIES - n} ${MAX_TRIES - n === 1 ? 'try' : 'tries'} left.`);
  }

  async function tryPassword() {
    if (!password) return;
    setBusy(true);
    try {
      await api('/auth/verify-password', { body: { password } });
      onPasswordReset();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 500, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: 24, gap: 22 }}>
      <View style={{ alignItems: 'center' }}>
        <LogoMark size={76} />
        <View style={{ position: 'absolute', right: -14, bottom: -8, width: 30, height: 30, borderRadius: 15, backgroundColor: '#1DC87C', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="lock-closed" size={16} color="#06122E" />
        </View>
      </View>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>Kaarobarly is locked</Text>
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15 }}>{user?.name}</Text>
      </View>
      <Text accessibilityLiveRegion="polite" style={{ color: '#FFD98A', fontSize: 14, fontWeight: '600', minHeight: 20, textAlign: 'center' }}>
        {message}
      </Text>

      {mode === 'pin' ? (
        <>
          <PinPad light onComplete={tryPin} error={errors} extraKey={bioReady ? { icon: 'finger-print', label: 'Unlock with fingerprint', onPress: fingerprint } : undefined} />
          <Pressable accessibilityRole="button" onPress={() => (setMode('password'), setMessage(''))} hitSlop={10}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' }}>Forgot PIN? Use account password</Text>
          </Pressable>
        </>
      ) : (
        <View style={{ width: '100%', maxWidth: 360, gap: 12 }}>
          <TextInput
            accessibilityLabel="Account password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
            placeholder="Account password"
            placeholderTextColor="rgba(255,255,255,0.6)"
            onSubmitEditing={tryPassword}
            style={{ minHeight: 52, borderRadius: 14, paddingHorizontal: 16, fontSize: 16, color: '#fff', backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' }}
          />
          <Pressable accessibilityRole="button" disabled={busy} onPress={tryPassword} style={{ minHeight: 52, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: '#0B1B4D', fontSize: 16, fontWeight: '800' }}>{busy ? 'Checking…' : 'Unlock with password'}</Text>
          </Pressable>
          {errors < MAX_TRIES && (
            <Pressable accessibilityRole="button" onPress={() => (setMode('pin'), setMessage(''))} hitSlop={10} style={{ alignSelf: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' }}>Back to PIN</Text>
            </Pressable>
          )}
        </View>
      )}
      <Pressable accessibilityRole="button" onPress={() => signOut()} hitSlop={10}>
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>Sign out</Text>
      </Pressable>
    </LinearGradient>
  );
}

/** Wrap the signed-in app: shows the lock screen on launch and after the app has been in the background. */
export function LockProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const [config, setConfig] = useState<LockConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const leftAt = useRef(0);

  useEffect(() => {
    biometricsReady().then(setBioAvailable);
    secure
      .get(KEY)
      .then((raw) => {
        const c = raw ? (JSON.parse(raw) as LockConfig) : null;
        setConfig(c);
        setLocked(!!c);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (config && leftAt.current && Date.now() - leftAt.current > RELOCK_AFTER_MS) setLocked(true);
        leftAt.current = 0;
      } else if (!leftAt.current) leftAt.current = Date.now();
    });
    return () => sub.remove();
  }, [config]);

  const persist = useCallback(async (c: LockConfig | null) => {
    setConfig(c);
    if (c) await secure.set(KEY, JSON.stringify(c));
    else await secure.remove(KEY);
  }, []);

  const value = useMemo<LockState>(
    () => ({
      enabled: !!config,
      biometric: !!config?.biometric,
      biometricAvailable: bioAvailable,
      async setPin(pin) {
        const salt = Crypto.randomUUID();
        await persist({ salt, hash: await digest(salt, pin), biometric: config?.biometric ?? false });
      },
      checkPin: async (pin) => !!config && (await digest(config.salt, pin)) === config.hash,
      disable: () => persist(null),
      async setBiometric(on) {
        if (!config) return;
        if (on) {
          const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm your fingerprint', disableDeviceFallback: true });
          if (!r.success) return;
        }
        await persist({ ...config, biometric: on });
      },
      lockNow: () => config && setLocked(true),
    }),
    [config, bioAvailable, persist],
  );

  return (
    <LockCtx.Provider value={value}>
      {children}
      {loaded && user && locked && config && (
        <LockScreen
          config={config}
          onUnlock={() => setLocked(false)}
          onPasswordReset={() => {
            // the PIN was forgotten: remove it so a new one can be set in Settings
            persist(null);
            setLocked(false);
            toast('Unlocked with your password. PIN lock is now off — set a new PIN in Settings.');
          }}
        />
      )}
    </LockCtx.Provider>
  );
}
