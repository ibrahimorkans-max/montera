import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, type Theme } from '@/lib/app-context';
import { local } from '@/lib/storage';
import type { DashboardStyle } from '@/lib/shared';
import { CountUp, GRADIENT, Row, Sheet, Txt, type IconName } from './ui';

// ---------------------------------------------------------------- preferences (this phone only)

/** Bottom bar looks. 'auto' follows the Home dashboard style. */
export const NAV_STYLES = ['auto', 'classic', 'dock', 'floating', 'glass', 'neumorph'] as const;
export type NavStyle = (typeof NAV_STYLES)[number];
export const NAV_STYLE_LABELS: Record<NavStyle, { name: string; hint: string }> = {
  auto: { name: 'Match dashboard', hint: 'Changes with your Home style' },
  classic: { name: 'Classic', hint: 'Full-width bar, raised + button' },
  dock: { name: 'Dock (iOS)', hint: 'Floating rounded dock, soft highlight' },
  floating: { name: 'Floating', hint: 'Detached bar with + inside' },
  glass: { name: 'Glassmorphism', hint: 'Frosted violet glass' },
  neumorph: { name: 'Neumorphism', hint: 'Soft raised and pressed buttons' },
};
/** What 'auto' picks for each Home dashboard style. */
export const NAV_FOR_DASHBOARD: Record<DashboardStyle, Exclude<NavStyle, 'auto'>> = {
  monetra: 'classic',
  minimal: 'dock',
  emerald: 'floating',
  wallet: 'floating',
  glass: 'glass',
  soft: 'neumorph',
  midnight: 'dock',
};

/** Looks for the headline card of the Invoices, Purchases and Finance dashboards. */
export const HERO_STYLES = ['gradient', 'glass', 'soft', 'midnight', 'sunset', 'minimal'] as const;
export type HeroStyle = (typeof HERO_STYLES)[number];
export const HERO_STYLE_LABELS: Record<HeroStyle, { name: string; hint: string }> = {
  gradient: { name: 'Ocean Gradient', hint: 'Blue-to-teal card' },
  glass: { name: 'Glass', hint: 'Frosted panel over a violet glow' },
  soft: { name: 'Soft (Neumorphism)', hint: 'Raised card, pressed tiles' },
  midnight: { name: 'Midnight', hint: 'Dark card with neon accents' },
  sunset: { name: 'Sunset', hint: 'Bold orange-pink-violet' },
  minimal: { name: 'Minimal', hint: 'Clean white with an accent bar' },
};
export type ScreenKey = 'invoices' | 'purchases' | 'finance';
const SCREEN_DEFAULTS: Record<ScreenKey, HeroStyle> = { invoices: 'glass', purchases: 'sunset', finance: 'gradient' };

interface Prefs {
  nav: NavStyle;
  /** the Home dashboard style currently shown, so 'auto' can follow it */
  dash: DashboardStyle;
  screens: Partial<Record<ScreenKey, HeroStyle>>;
}
const KEY = 'monetra.stylePrefs';
let prefs: Prefs = { nav: 'auto', dash: 'monetra', screens: {} };
const listeners = new Set<() => void>();
let loaded = false;
function load() {
  if (loaded) return;
  loaded = true;
  local.get<Partial<Prefs>>(KEY).then((v) => v && update({ ...v, dash: prefs.dash }, false));
}
function update(p: Partial<Prefs>, save = true) {
  prefs = { ...prefs, ...p, screens: { ...prefs.screens, ...(p.screens ?? {}) } };
  if (save) local.set(KEY, { nav: prefs.nav, screens: prefs.screens });
  listeners.forEach((l) => l());
}
function usePrefs(): Prefs {
  useEffect(load, []);
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => prefs,
    () => prefs,
  );
}

export function useNavStyle(): [NavStyle, Exclude<NavStyle, 'auto'>, (s: NavStyle) => void] {
  const p = usePrefs();
  return [p.nav, p.nav === 'auto' ? NAV_FOR_DASHBOARD[p.dash] ?? 'classic' : p.nav, (nav) => update({ nav })];
}
/** Home reports its style here so the bottom bar can follow it. */
export function reportDashboardStyle(dash: DashboardStyle) {
  if (prefs.dash !== dash) update({ dash }, false);
}
export function useScreenStyle(screen: ScreenKey): [HeroStyle, (s: HeroStyle) => void] {
  const p = usePrefs();
  return [p.screens[screen] ?? SCREEN_DEFAULTS[screen], (s) => update({ screens: { [screen]: s } })];
}

// ---------------------------------------------------------------- neumorphism helpers

export const softShadow = (t: Theme, depth = 8) =>
  t.dark
    ? `${depth}px ${depth}px ${depth * 2}px rgba(0,0,0,0.55), -${depth / 2}px -${depth / 2}px ${depth * 1.5}px rgba(255,255,255,0.04)`
    : `${depth}px ${depth}px ${depth * 2}px rgba(16,32,80,0.13), -${depth}px -${depth}px ${depth * 2}px rgba(255,255,255,0.95)`;
export const softInset = (t: Theme) =>
  t.dark ? 'inset 3px 3px 7px rgba(0,0,0,0.6), inset -2px -2px 6px rgba(255,255,255,0.04)' : 'inset 3px 3px 7px rgba(16,32,80,0.12), inset -3px -3px 7px rgba(255,255,255,0.95)';

// ---------------------------------------------------------------- hero card

export interface HeroStat {
  label: string;
  value: number;
  format: (v: number) => string;
  icon?: IconName;
  /** icon colour on dark/coloured cards */
  tone?: string;
}

const PALETTE: Record<Exclude<HeroStyle, 'soft' | 'minimal'>, { colors: readonly [string, string, ...string[]]; accent: string }> = {
  gradient: { colors: GRADIENT, accent: '#86EFAC' },
  glass: { colors: ['#6D5DFC', '#A855F7', '#EC4899'], accent: '#FDE68A' },
  midnight: { colors: ['#070B16', '#111A33', '#1B1440'], accent: '#22D3EE' },
  sunset: { colors: ['#F97316', '#EC4899', '#8B5CF6'], accent: '#FEF08A' },
};

/**
 * The headline card at the top of a dashboard: one big number and a row of smaller ones,
 * drawn in any of the HERO_STYLES.
 */
export function Hero({
  variant,
  label,
  value,
  format,
  stats,
  children,
  compact,
}: {
  variant: HeroStyle;
  label: string;
  value: number;
  format: (v: number) => string;
  stats: HeroStat[];
  children?: ReactNode;
  /** small preview used in the style picker */
  compact?: boolean;
}) {
  const t = useTheme();
  const big = compact ? 20 : 34;
  const pad = compact ? 12 : 18;
  const radius = compact ? 16 : 24;
  const statRow = (onDark: boolean, tile: (i: number) => StyleProp<ViewStyle>, accent: string) => (
    <Row gap={compact ? 6 : 10} style={{ marginTop: compact ? 8 : 14, alignItems: 'stretch' }}>
      {stats.map((s, i) => (
        <View key={s.label} style={[{ flex: 1, borderRadius: compact ? 10 : 16, padding: compact ? 7 : 12, minWidth: 0 }, tile(i)]}>
          <Row gap={5}>
            {!!s.icon && !compact && <Ionicons name={s.icon} size={16} color={s.tone ?? accent} />}
            <Text numberOfLines={1} style={{ flexShrink: 1, color: onDark ? 'rgba(255,255,255,0.88)' : t.sub, fontSize: compact ? 9 : 12.5, fontWeight: '600' }}>
              {s.label}
            </Text>
          </Row>
          <CountUp value={s.value} format={s.format} style={{ color: onDark ? '#fff' : t.text, fontSize: compact ? 11 : 16, fontWeight: '800', marginTop: compact ? 2 : 4 }} />
        </View>
      ))}
    </Row>
  );
  const head = (color: string, sub: string, accent?: string) => (
    <>
      <Row gap={6}>
        {!!accent && <View style={{ width: compact ? 6 : 8, height: compact ? 6 : 8, borderRadius: 4, backgroundColor: accent }} />}
        <Text style={{ color: sub, fontSize: compact ? 9.5 : 13, fontWeight: '700', letterSpacing: 0.6 }}>{label}</Text>
      </Row>
      <CountUp value={value} format={format} style={{ color, fontSize: big, fontWeight: '800', letterSpacing: -0.5, marginTop: 2 }} />
    </>
  );

  if (variant === 'soft') {
    return (
      <View style={{ backgroundColor: t.bg, borderRadius: radius, padding: pad, boxShadow: softShadow(t, compact ? 4 : 8) } as any}>
        {head(t.text, t.sub, t.primary)}
        {statRow(false, () => ({ backgroundColor: t.bg, boxShadow: softInset(t) }) as any, t.primary)}
        {children}
      </View>
    );
  }
  if (variant === 'minimal') {
    return (
      <View style={{ backgroundColor: t.card, borderRadius: radius, padding: pad, borderWidth: 1, borderColor: t.border, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: compact ? 4 : 6, backgroundColor: t.primary }} />
        {head(t.text, t.sub)}
        {statRow(false, () => ({ backgroundColor: t.neutralSoft }), t.primary)}
        {children}
      </View>
    );
  }
  const pal = PALETTE[variant];
  if (variant === 'glass') {
    return (
      <LinearGradient colors={pal.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius, padding: compact ? 6 : 10, overflow: 'hidden' }}>
        <View pointerEvents="none" style={{ position: 'absolute', left: -30, top: -40, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(56,189,248,0.55)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', right: -20, bottom: -50, width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(251,191,36,0.45)' }} />
        <View style={{ borderRadius: radius - 6, padding: pad - 4, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)' }}>
          {head('#fff', 'rgba(255,255,255,0.9)')}
          {statRow(true, () => ({ backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }), pal.accent)}
          {children}
        </View>
      </LinearGradient>
    );
  }
  if (variant === 'midnight') {
    const neon = ['#22D3EE', '#A78BFA', '#F472B6'];
    return (
      <LinearGradient colors={pal.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius, padding: pad, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(34,211,238,0.35)' }}>
        <View pointerEvents="none" style={{ position: 'absolute', right: -50, top: -60, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(167,139,250,0.18)' }} />
        {head('#fff', '#94A3B8', pal.accent)}
        {statRow(true, (i) => ({ backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: neon[i % neon.length] + '88' }), pal.accent)}
        {children}
      </LinearGradient>
    );
  }
  return (
    <LinearGradient colors={pal.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius, padding: pad, overflow: 'hidden' }}>
      <View pointerEvents="none" style={{ position: 'absolute', right: -40, top: -50, width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.10)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', right: 60, bottom: -70, width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.07)' }} />
      {head('#fff', 'rgba(255,255,255,0.85)')}
      {statRow(true, () => ({ backgroundColor: 'rgba(255,255,255,0.16)' }), pal.accent)}
      {children}
    </LinearGradient>
  );
}

/** Text colour for content placed inside a Hero (children). */
export const heroInk = (variant: HeroStyle, t: Theme) => (variant === 'soft' || variant === 'minimal' ? { main: t.text, sub: t.sub, track: t.neutralSoft } : { main: '#fff', sub: 'rgba(255,255,255,0.88)', track: 'rgba(255,255,255,0.22)' });

/** Sheet listing every hero style as a live miniature. */
export function HeroStylePicker({ visible, onClose, value, onChange, title }: { visible: boolean; onClose: () => void; value: HeroStyle; onChange: (s: HeroStyle) => void; title: string }) {
  const t = useTheme();
  const sample = (v: number) => `Rs ${v.toLocaleString()}`;
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <Txt v="sub">Changes the look on this phone only.</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {HERO_STYLES.map((s) => {
          const on = s === value;
          return (
            <Pressable
              key={s}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={HERO_STYLE_LABELS[s].name}
              onPress={() => {
                onChange(s);
                onClose();
              }}
              style={{ flexBasis: '46%', flexGrow: 1, gap: 6, padding: 6, borderRadius: 20, borderWidth: on ? 3 : 1, borderColor: on ? t.primary : t.border, backgroundColor: t.bg }}>
              <View pointerEvents="none">
                <Hero compact variant={s} label="TOTAL" value={125000} format={sample} stats={[{ label: 'Paid', value: 90000, format: sample }, { label: 'Due', value: 35000, format: sample }]} />
              </View>
              <Txt style={{ fontWeight: '700', textAlign: 'center' }} color={on ? t.primary : undefined}>
                {HERO_STYLE_LABELS[s].name}
              </Txt>
              <Txt v="small" style={{ textAlign: 'center' }}>
                {HERO_STYLE_LABELS[s].hint}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}
