import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type Theme } from '@/lib/app-context';
import { formatMoney, type InvoiceDisplayStatus } from '@/lib/shared';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export const MAX_WIDTH = 720;

export const fm = (minor: number, c?: { currency?: string; currencyPrecision?: number } | null) =>
  formatMoney(minor, c?.currency ?? 'PKR', c?.currencyPrecision ?? 2);

/** Today's date on this device's calendar, as YYYY-MM-DD. */
export const todayStr = () => (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const addMonths = (date: string, months: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fd = (date: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
};
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Yes/no confirmation that works on devices and in a browser. */
export function confirm(title: string, message: string, okLabel = 'Confirm'): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, onPress: () => resolve(true) },
    ]),
  );
}

// ---------------------------------------------------------------- text

type Variant = 'title' | 'h' | 'body' | 'sub' | 'small' | 'label' | 'big';
const variants: Record<Variant, TextStyle> = {
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.4 },
  big: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  h: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 16 },
  sub: { fontSize: 14 },
  small: { fontSize: 12.5 },
  label: { fontSize: 13, fontWeight: '600' },
};

export function Txt({ v = 'body', color, style, ...rest }: ComponentProps<typeof Text> & { v?: Variant; color?: string }) {
  const t = useTheme();
  const muted = v === 'sub' || v === 'small' || v === 'label';
  return <Text {...rest} style={[variants[v], { color: color ?? (muted ? t.sub : t.text) }, style]} />;
}

// ---------------------------------------------------------------- layout

export function Screen({
  children,
  footer,
  scroll = true,
  onRefresh,
  refreshing = false,
  padBottom = 24,
  scrollKey,
}: {
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  padBottom?: number;
  /** change this to jump back to the top, e.g. when a wizard step changes */
  scrollKey?: string | number;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardScroll();
  const body = scroll ? (
    <View ref={kb.boxRef} style={{ flex: 1 }}>
      <ScrollView
        key={scrollKey}
        ref={kb.scrollRef}
        onScroll={kb.onScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: padBottom }]}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} /> : undefined}>
        {children}
      </ScrollView>
    </View>
  ) : (
    <View style={{ flex: 1 }}>{children}</View>
  );
  return (
    <RevealContext.Provider value={kb.reveal}>
      <View ref={kb.containerRef} style={{ flex: 1, backgroundColor: t.bg, paddingBottom: kb.overlap }}>
        {body}
        {footer && (
          <View style={[styles.footer, { backgroundColor: t.card, borderTopColor: t.border, paddingBottom: kb.overlap ? 10 : Math.max(insets.bottom, 12) }]}>
            <View style={styles.footerInner}>{footer}</View>
          </View>
        )}
      </View>
    </RevealContext.Provider>
  );
}

/** Lets a focused field ask the screen around it to scroll it above the keyboard. */
const RevealContext = createContext<() => void>(() => {});

/**
 * Keeps forms usable while the on-screen keyboard is open: `overlap` is how much of the container the
 * keyboard covers (used as bottom padding, so the scroll area ends at the keyboard), and `reveal` scrolls
 * the focused input into the visible part. Works the same on Android (edge-to-edge) and iOS.
 */
function useKeyboardScroll() {
  const containerRef = useRef<ComponentRef<typeof View>>(null);
  const boxRef = useRef<ComponentRef<typeof View>>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollY = useRef(0);
  const [overlap, setOverlap] = useState(0);

  const reveal = useCallback(() => {
    if (Platform.OS === 'web') return;
    setTimeout(() => {
      const input = TextInput.State.currentlyFocusedInput?.() as unknown as ComponentRef<typeof View> | null;
      const box = boxRef.current;
      if (!input?.measureInWindow || !box) return;
      box.measureInWindow((_bx, by, _bw, bh) =>
        input.measureInWindow((_ix, iy, _iw, ih) => {
          const top = by + 12;
          const bottom = by + bh - 28;
          const shift = iy + ih > bottom ? iy + ih - bottom : iy < top ? iy - top : 0;
          if (shift) scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current + shift), animated: true });
        }),
      );
    }, 80);
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      const kbTop = e.endCoordinates.screenY;
      containerRef.current?.measureInWindow((_x, y, _w, h) => {
        const covered = Math.max(0, Math.min(e.endCoordinates.height, Math.round(y + h - kbTop)));
        setOverlap(covered);
        reveal();
      });
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [reveal]);

  const onScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  return { containerRef, boxRef, scrollRef, overlap, reveal, onScroll };
}

export function Card({ children, style, onPress, label }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string }) {
  const t = useTheme();
  const base = [styles.card, { backgroundColor: t.card, borderColor: t.border }, style];
  const press = usePressScale(0.975);
  if (!onPress) return <View style={base}>{children}</View>;
  const [outer, inner] = splitLayout(style);
  return (
    <Animated.View style={[outer, { transform: [{ scale: press.scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, inner]}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

const NATIVE = Platform.OS !== 'web';
export const GRADIENT = ['#0B46D6', '#0A6FD0', '#0E9E8A'] as const;

/** Springy press feedback shared by cards and buttons. */
export function usePressScale(to = 0.96) {
  const scale = useRef(new Animated.Value(1)).current;
  const go = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: NATIVE, speed: 40, bounciness: 6 }).start();
  return { scale, onPressIn: () => go(to), onPressOut: () => go(1) };
}

/** Split a style into the part that positions an element in its parent and the rest. */
function splitLayout(style: StyleProp<ViewStyle>): [ViewStyle, ViewStyle] {
  const s = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  const layout = ['flex', 'flexBasis', 'flexGrow', 'flexShrink', 'alignSelf', 'width', 'minWidth', 'maxWidth', 'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'opacity'];
  for (const k of Object.keys(s)) (layout.includes(k) ? outer : inner)[k] = s[k];
  return [outer as ViewStyle, inner as ViewStyle];
}

/** Fade and slide content in; stagger lists with `delay`. */
export function FadeIn({ children, delay = 0, from = 14, style }: { children: ReactNode; delay?: number; from?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
  }, [v, delay]);
  return <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] }, style]}>{children}</Animated.View>;
}

/** Number that counts up to its value whenever the value changes. */
export function CountUp({ value, format, style }: { value: number; format: (v: number) => string; style?: StyleProp<TextStyle> }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / 700);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value]);
  return (
    <Text accessibilityLabel={format(value)} style={style}>
      {format(shown)}
    </Text>
  );
}

/** Brand gradient panel for hero areas. Text inside should be white. */
export function Gradient({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: 22, padding: 18, overflow: 'hidden' }, style]}>
      <View pointerEvents="none" style={{ position: 'absolute', right: -40, top: -50, width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.10)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', right: 60, bottom: -70, width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.07)' }} />
      {children}
    </LinearGradient>
  );
}

export const Row = ({ children, style, gap = 8 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>
);

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Row style={{ justifyContent: 'space-between', minHeight: 28 }}>
        <Txt v="h">{title}</Txt>
        {action}
      </Row>
      {children}
    </View>
  );
}

/** Label on the left, value on the right. */
export function KV({ k, v, bold, color }: { k: string; v: string; bold?: boolean; color?: string }) {
  const t = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 3 }}>
      <Txt v="sub" style={bold && { fontWeight: '700' }}>
        {k}
      </Txt>
      <Txt v="sub" color={color ?? t.text} style={[{ flexShrink: 1, textAlign: 'right' }, bold && { fontWeight: '700', fontSize: 16 }]}>
        {v}
      </Txt>
    </Row>
  );
}

// ---------------------------------------------------------------- buttons

export function Btn({
  title,
  onPress,
  kind = 'primary',
  icon,
  loading,
  disabled,
  style,
  small,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const t = useTheme();
  const bg = { primary: t.primary, secondary: t.neutralSoft, danger: t.dangerSoft, ghost: 'transparent' }[kind];
  const fg = { primary: t.onPrimary, secondary: t.text, danger: t.danger, ghost: t.primary }[kind];
  const off = disabled || loading;
  const press = usePressScale();
  const primary = kind === 'primary';
  const ink = primary ? '#FFFFFF' : fg;
  return (
    <Animated.View style={[{ transform: [{ scale: press.scale }], opacity: off ? 0.5 : 1 }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!off, busy: !!loading }}
        disabled={off}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.btn, small && styles.btnSmall, { backgroundColor: primary ? GRADIENT[1] : bg, overflow: 'hidden' }]}>
        {primary && <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />}
        {loading ? <ActivityIndicator color={ink} /> : icon ? <Ionicons name={icon} size={small ? 16 : 19} color={ink} /> : null}
        <Text style={{ color: ink, fontSize: small ? 14 : 16, fontWeight: '700' }} numberOfLines={1}>
          {title}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function IconBtn({ icon, onPress, label, color, bg }: { icon: IconName; onPress: () => void; label: string; color?: string; bg?: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, { backgroundColor: bg ?? t.neutralSoft, opacity: pressed ? 0.6 : 1 }]}>
      <Ionicons name={icon} size={20} color={color ?? t.text} />
    </Pressable>
  );
}

export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }} style={{ flexGrow: 0 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.chip, { backgroundColor: on ? t.primary : t.card, borderColor: on ? t.primary : t.border }]}>
            <Text style={{ color: on ? t.onPrimary : t.text, fontSize: 14, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- inputs

export function Field({
  label,
  error,
  hint,
  money,
  style,
  right,
  ...rest
}: TextInputProps & { label: string; error?: string; hint?: string; money?: boolean; style?: StyleProp<ViewStyle>; right?: ReactNode }) {
  const t = useTheme();
  const reveal = useContext(RevealContext);
  const [focus, setFocus] = useState(false);
  return (
    <View style={[{ gap: 5, minWidth: 0 }, style]}>
      <Txt v="label">{label}</Txt>
      <Row gap={6}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={t.sub}
          keyboardType={money ? 'decimal-pad' : rest.keyboardType}
          inputMode={money ? 'decimal' : rest.inputMode}
          selectTextOnFocus={money}
          {...rest}
          onFocus={(e) => {
            setFocus(true);
            reveal();
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            rest.onBlur?.(e);
          }}
          style={[
            styles.input,
            { backgroundColor: t.input, color: t.text, borderColor: error ? t.danger : focus ? t.primary : t.border },
            rest.multiline && { minHeight: 84, textAlignVertical: 'top', paddingTop: 12 },
          ]}
        />
        {right}
      </Row>
      {!!(error || hint) && (
        <Txt v="small" color={error ? t.danger : undefined}>
          {error || hint}
        </Txt>
      )}
    </View>
  );
}

/** Date input that opens a calendar. Value is YYYY-MM-DD ('' when empty). */
export function DateField({ label, value, onChange, quick, error }: { label: string; value: string; onChange: (v: string) => void; quick?: { label: string; value: string }[]; error?: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const shown = isDate(value) ? fd(value) : value;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ gap: 5 }}>
        <Txt v="label">{label}</Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${shown || 'not set'}. Opens a calendar`}
          onPress={() => {
            Keyboard.dismiss();
            setOpen(true);
          }}
          style={[styles.input, styles.selectBox, { backgroundColor: t.input, borderColor: error ? t.danger : t.border }]}>
          <Ionicons name="calendar-outline" size={19} color={t.primary} />
          <Text style={{ color: shown ? t.text : t.sub, fontSize: 16, flex: 1 }} numberOfLines={1}>
            {shown || 'Choose date'}
          </Text>
          <Ionicons name="chevron-down" size={18} color={t.sub} />
        </Pressable>
        {!!error && (
          <Txt v="small" color={t.danger}>
            {error}
          </Txt>
        )}
      </View>
      <CalendarPicker
        visible={open}
        title={label}
        value={value}
        onClose={() => setOpen(false)}
        onPick={(v) => {
          onChange(v);
          setOpen(false);
        }}
      />
      {quick && (
        <Row style={{ flexWrap: 'wrap' }}>
          {quick.map((q) => (
            <Pressable key={q.label} accessibilityRole="button" onPress={() => onChange(q.value)} style={[styles.quick, { backgroundColor: value === q.value ? t.primarySoft : t.neutralSoft }]}>
              <Text style={{ color: value === q.value ? t.primary : t.text, fontSize: 13, fontWeight: '600' }}>{q.label}</Text>
            </Pressable>
          ))}
        </Row>
      )}
    </View>
  );
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Month calendar in a dialog. Calls onPick with YYYY-MM-DD. */
export function CalendarPicker({ visible, title, value, onPick, onClose }: { visible: boolean; title: string; value: string; onPick: (v: string) => void; onClose: () => void }) {
  const t = useTheme();
  const today = todayStr();
  const start = isDate(value) ? value : today;
  const [ym, setYm] = useState({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 });
  useEffect(() => {
    if (visible) setYm({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const move = (months: number) =>
    setYm(({ y, m }) => {
      const n = y * 12 + m + months;
      return { y: Math.floor(n / 12), m: ((n % 12) + 12) % 12 };
    });
  const first = (new Date(Date.UTC(ym.y, ym.m, 1)).getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const iso = (d: number) => `${ym.y}-${pad2(ym.m + 1)}-${pad2(d)}`;

  const nav = (icon: IconName, label: string, by: number) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={4} onPress={() => move(by)} style={({ pressed }) => [styles.calNav, { backgroundColor: t.neutralSoft, opacity: pressed ? 0.6 : 1 }]}>
      <Ionicons name={icon} size={18} color={t.text} />
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.calWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close calendar" />
        <View style={[styles.calCard, { backgroundColor: t.card, borderColor: t.border }]}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="label">{title}</Txt>
            <IconBtn icon="close" label="Close" onPress={onClose} />
          </Row>
          <Row style={{ justifyContent: 'space-between' }} gap={4}>
            {nav('play-back-outline', 'Previous year', -12)}
            {nav('chevron-back', 'Previous month', -1)}
            <Txt v="h" style={{ flex: 1, textAlign: 'center' }} accessibilityRole="header">
              {FULL_MONTHS[ym.m]} {ym.y}
            </Txt>
            {nav('chevron-forward', 'Next month', 1)}
            {nav('play-forward-outline', 'Next year', 12)}
          </Row>
          <View style={styles.calGrid}>
            {WEEKDAYS.map((w) => (
              <View key={w} style={styles.calCell}>
                <Txt v="small" style={{ fontWeight: '700' }}>
                  {w}
                </Txt>
              </View>
            ))}
            {cells.map((d, n) => {
              if (!d) return <View key={`e${n}`} style={styles.calCell} />;
              const v = iso(d);
              const on = v === value;
              const isToday = v === today;
              return (
                <Pressable
                  key={v}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={fd(v)}
                  onPress={() => onPick(v)}
                  style={({ pressed }) => [styles.calCell, { opacity: pressed ? 0.6 : 1 }]}>
                  <View style={[styles.calDay, on ? { backgroundColor: t.primary } : isToday ? { borderWidth: 1.5, borderColor: t.primary } : null]}>
                    <Text style={{ color: on ? t.onPrimary : t.text, fontSize: 15, fontWeight: on || isToday ? '700' : '400' }}>{d}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Row style={{ justifyContent: 'space-between' }}>
            <Btn small kind="secondary" icon="today-outline" title="Today" onPress={() => onPick(today)} />
            <Btn small kind="ghost" title="Cancel" onPress={onClose} />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const t = useTheme();
  return (
    <Row style={[styles.search, { backgroundColor: t.card, borderColor: t.border }]}>
      <Ionicons name="search" size={18} color={t.sub} />
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.sub}
        autoCorrect={false}
        autoCapitalize="none"
        style={{ flex: 1, color: t.text, fontSize: 16, paddingVertical: 0, minHeight: 44, outlineStyle: 'none' } as any}
      />
      {!!value && (
        <Pressable accessibilityLabel="Clear search" hitSlop={10} onPress={() => onChange('')}>
          <Ionicons name="close-circle" size={18} color={t.sub} />
        </Pressable>
      )}
    </Row>
  );
}

/** Searchable dropdown shown as a bottom sheet. */
export function Select<T>({
  label,
  value,
  placeholder,
  items,
  getKey,
  getLabel,
  getSub,
  onSelect,
  onAdd,
  addLabel,
  error,
}: {
  label: string;
  value: string;
  placeholder: string;
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getSub?: (item: T) => string;
  onSelect: (item: T) => void;
  onAdd?: (typed: string) => void;
  addLabel?: string;
  error?: string;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? items.filter((i) => `${getLabel(i)} ${getSub?.(i) ?? ''}`.toLowerCase().includes(needle)) : items;
  }, [q, items, getLabel, getSub]);
  const close = () => {
    setOpen(false);
    setQ('');
  };
  return (
    <View style={{ gap: 5 }}>
      <Txt v="label">{label}</Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || placeholder}`}
        onPress={() => setOpen(true)}
        style={[styles.input, styles.selectBox, { backgroundColor: t.input, borderColor: error ? t.danger : t.border }]}>
        <Text style={{ color: value ? t.text : t.sub, fontSize: 16, flex: 1 }} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={t.sub} />
      </Pressable>
      {!!error && (
        <Txt v="small" color={t.danger}>
          {error}
        </Txt>
      )}
      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: t.bg, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="h">{label}</Txt>
            <IconBtn icon="close" label="Close" onPress={close} />
          </Row>
          <SearchBar value={q} onChange={setQ} placeholder="Search" />
          {onAdd && (
            <Btn
              kind="secondary"
              icon="add"
              title={q.trim() ? `${addLabel ?? 'Add'} "${q.trim()}"` : (addLabel ?? 'Add new')}
              onPress={() => {
                const typed = q.trim();
                close();
                onAdd(typed);
              }}
            />
          )}
          <FlatList
            data={filtered}
            keyExtractor={getKey}
            keyboardShouldPersistTaps="handled"
            style={{ flexGrow: 0 }}
            ListEmptyComponent={<Txt v="sub" style={{ padding: 16, textAlign: 'center' }}>Nothing found.</Txt>}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  close();
                  onSelect(item);
                }}
                style={({ pressed }) => [styles.option, { borderBottomColor: t.border, opacity: pressed ? 0.6 : 1 }]}>
                <Txt>{getLabel(item)}</Txt>
                {!!getSub?.(item) && <Txt v="small">{getSub(item)}</Txt>}
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

/** Generic bottom sheet for short forms. */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardScroll();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <RevealContext.Provider value={kb.reveal}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View ref={kb.containerRef} style={[styles.sheet, { backgroundColor: t.bg, paddingBottom: kb.overlap ? kb.overlap + 8 : Math.max(insets.bottom, 12) }]}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="h">{title}</Txt>
            <IconBtn icon="close" label="Close" onPress={onClose} />
          </Row>
          <View ref={kb.boxRef} style={{ flexShrink: 1 }}>
            <ScrollView ref={kb.scrollRef} onScroll={kb.onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
              {children}
            </ScrollView>
          </View>
        </View>
      </RevealContext.Provider>
    </Modal>
  );
}

const INSTALLMENT_LABELS: Record<string, string> = { paid: 'Paid', partial: 'Partly paid', pending: 'Unpaid', overdue: 'Overdue · unpaid' };
/** Paid / Unpaid badge for an installment. */
export function InstallmentBadge({ status }: { status?: string }) {
  const s = status ?? 'pending';
  return <Badge status={s} label={INSTALLMENT_LABELS[s] ?? s} />;
}
export const installmentLabel = (s?: string) => INSTALLMENT_LABELS[s ?? 'pending'] ?? s ?? '';

// ---------------------------------------------------------------- status

const STATUS: Record<string, { label: string; tone: 'success' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  unpaid: { label: 'Unpaid', tone: 'info' },
  partially_paid: { label: 'Partially Paid', tone: 'warn' },
  paid: { label: 'Paid', tone: 'success' },
  overdue: { label: 'Overdue', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'info' },
  partial: { label: 'Part Paid', tone: 'warn' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  active: { label: 'Active', tone: 'success' },
  sent: { label: 'Sent', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'success' },
  expired: { label: 'Expired', tone: 'danger' },
  converted: { label: 'Invoiced', tone: 'success' },
  paused: { label: 'Paused', tone: 'warn' },
  ended: { label: 'Ended', tone: 'neutral' },
  inactive: { label: 'Inactive', tone: 'neutral' },
};
export const statusLabel = (s: InvoiceDisplayStatus | string) => STATUS[s]?.label ?? s;

function tone(t: Theme, k: 'success' | 'warn' | 'danger' | 'info' | 'neutral') {
  return {
    success: [t.successSoft, t.success],
    warn: [t.warnSoft, t.warn],
    danger: [t.dangerSoft, t.danger],
    info: [t.infoSoft, t.info],
    neutral: [t.neutralSoft, t.sub],
  }[k];
}

export function Badge({ status, label }: { status: string; label?: string }) {
  const t = useTheme();
  const s = STATUS[status] ?? { label: status, tone: 'neutral' as const };
  const [bg, fg] = tone(t, s.tone);
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{label ?? s.label}</Text>
    </View>
  );
}

export function Progress({ value, total }: { value: number; total: number }) {
  const t = useTheme();
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((value / total) * 100))) : 0;
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }} style={{ gap: 4 }}>
      <View style={[styles.track, { backgroundColor: t.neutralSoft }]}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: pct >= 100 ? t.success : t.primary, borderRadius: 6 }} />
      </View>
      <Txt v="small">{pct}% paid</Txt>
    </View>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'danger' | 'success'; children: ReactNode }) {
  const t = useTheme();
  const [bg, fg] = tone(t, kind);
  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 14, fontWeight: '600' }}>{children}</Text>
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <ActivityIndicator size="large" color={t.primary} />
    </View>
  );
}

export function Empty({ icon, title, hint, action }: { icon: IconName; title: string; hint?: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ padding: 32, alignItems: 'center', gap: 8 }}>
      <Ionicons name={icon} size={40} color={t.sub} />
      <Txt v="h" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      {!!hint && (
        <Txt v="sub" style={{ textAlign: 'center' }}>
          {hint}
        </Txt>
      )}
      {action}
    </View>
  );
}

/** Loading / error / content switch for a data-backed screen. */
export function Loader({ loading, error, onRetry, children }: { loading: boolean; error: string; onRetry: () => void; children: ReactNode }) {
  if (loading) return <Loading />;
  if (error) return <Empty icon="cloud-offline-outline" title="Could not load" hint={error} action={<Btn small kind="secondary" title="Try again" onPress={onRetry} />} />;
  return <>{children}</>;
}

export const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12 },
  footerInner: { width: '100%', maxWidth: MAX_WIDTH - 32, alignSelf: 'center', gap: 10 },
  card: { borderRadius: 18, padding: 14, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  btn: { minHeight: 52, borderRadius: 16, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnSmall: { minHeight: 40, paddingHorizontal: 14, borderRadius: 10 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, justifyContent: 'center' },
  input: { flex: 1, minWidth: 0, minHeight: 50, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  selectBox: { flex: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  quick: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center' },
  search: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 48 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { maxHeight: '85%', padding: 16, gap: 12, borderTopLeftRadius: 20, borderTopRightRadius: 20, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  option: { paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 52, justifyContent: 'center', gap: 2 },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  track: { height: 10, borderRadius: 6, overflow: 'hidden' },
  notice: { padding: 12, borderRadius: 12 },
  calWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  calCard: { width: '100%', maxWidth: 380, borderRadius: 20, padding: 16, gap: 12, borderWidth: StyleSheet.hairlineWidth },
  calNav: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' },
  calDay: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
