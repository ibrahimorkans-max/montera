import { Ionicons } from '@expo/vector-icons';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, useTheme } from '@/lib/app-context';
import { SyncBanner } from './sync-ui';
import { MAX_WIDTH, Sheet, Txt, type IconName } from './ui';

// ------------------------------------------------------------ history
// The app keeps its own list of visited pages so Forward works on phones too, not only in a browser.

let entries: string[] = [];
let index = -1;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

function visit(href: string) {
  if (entries[index] === href) return;
  if (index > 0 && entries[index - 1] === href) index--;
  else if (entries[index + 1] === href) index++;
  else {
    entries = [...entries.slice(0, index + 1), href].slice(-100);
    index = entries.length - 1;
  }
  emit();
}

const HOME = '/';

export const navHistory = {
  canBack: () => index > 0 || router.canGoBack(),
  canForward: () => index < entries.length - 1,
  back() {
    if (router.canGoBack()) router.back();
    else if (index > 0) router.navigate(entries[index - 1] as never);
    else router.navigate(HOME);
  },
  forward() {
    if (index < entries.length - 1) router.push(entries[index + 1] as never);
  },
  reset() {
    entries = [];
    index = -1;
    emit();
  },
};

function useHistoryVersion() {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => version,
  );
}

/** Records every page the user lands on. Mount once, inside the router. */
export function NavTracker() {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const segments = pathname.split('/').map(decodeURIComponent);
  const query = Object.entries(params)
    .filter(([, v]) => typeof v === 'string' && !segments.includes(v))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join('&');
  const href = query ? `${pathname}?${query}` : pathname;
  useEffect(() => visit(href), [href]);
  return null;
}

// ------------------------------------------------------------ bar

const JUMPS: { icon: IconName; title: string; href: string }[] = [
  { icon: 'grid-outline', title: 'Home', href: '/' },
  { icon: 'document-text-outline', title: 'Invoices', href: '/invoices' },
  { icon: 'add-circle-outline', title: 'Create Invoice', href: '/invoice/new' },
  { icon: 'people-outline', title: 'Clients', href: '/clients' },
  { icon: 'cash-outline', title: 'Payments', href: '/payments' },
  { icon: 'document-outline', title: 'Quotations', href: '/quotations' },
  { icon: 'repeat-outline', title: 'Recurring', href: '/recurring' },
  { icon: 'bag-handle-outline', title: 'Purchases', href: '/purchases' },
  { icon: 'stats-chart-outline', title: 'Finance', href: '/finance' },
  { icon: 'wallet-outline', title: 'Accounts', href: '/accounts' },
  { icon: 'book-outline', title: 'Cashbook', href: '/cashbook' },
  { icon: 'trending-up-outline', title: 'Profit & Loss', href: '/statements' },
  { icon: 'bar-chart-outline', title: 'Reports', href: '/reports' },
  { icon: 'pricetags-outline', title: 'Services', href: '/services' },
  { icon: 'business-outline', title: 'Businesses', href: '/businesses' },
  { icon: 'settings-outline', title: 'Settings', href: '/settings' },
  { icon: 'menu-outline', title: 'More', href: '/more' },
];

function NavBtn({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.primarySoft : t.bg,
        borderWidth: 1,
        borderColor: t.border,
        opacity: disabled ? 0.35 : 1,
      })}>
      <Ionicons name={icon} size={20} color={disabled ? t.sub : t.text} />
    </Pressable>
  );
}

/** Top navigation bar shown on every signed-in page: back, forward, title, home and a jump menu. */
export function NavBar({ title }: { title?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { user } = useAuth();
  const [menu, setMenu] = useState(false);
  useHistoryVersion();
  const isHome = pathname === '/';
  const go = (href: string) => {
    setMenu(false);
    if (href !== pathname) router.navigate(href as never);
  };
  return (
    <View style={{ backgroundColor: t.card, borderBottomWidth: 1, borderBottomColor: t.border }}>
      <View style={{ paddingTop: insets.top + 8, paddingBottom: 8, paddingHorizontal: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' }}>
          <NavBtn icon="chevron-back" label="Back" onPress={navHistory.back} disabled={!navHistory.canBack() && isHome} />
          <NavBtn icon="chevron-forward" label="Forward" onPress={navHistory.forward} disabled={!navHistory.canForward()} />
          <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 17, fontWeight: '800', marginLeft: 4 }}>
            {title ?? 'Monetra'}
          </Text>
          <NavBtn icon={isHome ? 'home' : 'home-outline'} label="Home" onPress={() => go('/')} disabled={isHome} />
          <NavBtn icon="apps-outline" label="Go to page" onPress={() => setMenu(true)} />
        </View>
      </View>
      {!!user && <SyncBanner embedded />}
      <Sheet visible={menu} title="Go to" onClose={() => setMenu(false)}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {JUMPS.map((j) => {
            const active = j.href === pathname;
            return (
              <Pressable
                key={j.href}
                accessibilityRole="button"
                accessibilityLabel={j.title}
                onPress={() => go(j.href)}
                style={({ pressed }) => ({
                  width: '30%',
                  flexGrow: 1,
                  alignItems: 'center',
                  gap: 6,
                  paddingVertical: 14,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: active ? t.primary : t.border,
                  backgroundColor: active || pressed ? t.primarySoft : t.card,
                })}>
                <Ionicons name={j.icon} size={22} color={t.primary} />
                <Txt v="small" style={{ fontWeight: '700', color: t.text }} numberOfLines={1}>
                  {j.title}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}
