import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Animated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/app-context';
import { softInset, softShadow, useNavStyle } from './styles-kit';
import { GRADIENT, usePressScale, type IconName } from './ui';

/** Icons for each tab: [outline, filled]. */
const ICONS: Record<string, [IconName, IconName]> = {
  index: ['grid-outline', 'grid'],
  invoices: ['document-text-outline', 'document-text'],
  purchases: ['bag-handle-outline', 'bag-handle'],
  finance: ['stats-chart-outline', 'stats-chart'],
  more: ['menu-outline', 'menu'],
};

function Fab({ size, raised, disabled, ring }: { size: number; raised: boolean; disabled: boolean; ring: string }) {
  const press = usePressScale(0.88);
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }], marginTop: raised ? -26 : 0, opacity: disabled ? 0.4 : 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create invoice"
        disabled={disabled}
        onPress={() => router.push('/invoice/new')}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: raised ? 4 : 0, borderColor: ring, backgroundColor: GRADIENT[1], boxShadow: '0 6px 16px rgba(18,87,230,0.35)' } as any}>
        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <Ionicons name="add" size={size * 0.5} color="#fff" />
      </Pressable>
    </Animated.View>
  );
}

/**
 * The bottom navigation bar in the style chosen in Settings (or matching the Home dashboard):
 * Classic, Dock, Floating, Glassmorphism or Neumorphism.
 */
export function StyledTabBar({ state, descriptors, emitter, navigateToTab, canCreate }: any) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [, style] = useNavStyle();
  const floating = style !== 'classic';

  const glass = style === 'glass';
  const active = glass ? '#fff' : t.primary;
  const idle = glass ? 'rgba(255,255,255,0.72)' : t.sub;

  const items = state.routes.map((route: any, index: number) => {
    const focused = state.index === index;
    const { options } = descriptors[route.key];
    if (route.name === 'create') {
      return (
        <View key={route.key} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Fab size={style === 'classic' ? 60 : 50} raised={style === 'classic'} disabled={!canCreate} ring={t.card} />
        </View>
      );
    }
    const [outline, filled] = ICONS[route.name] ?? ['ellipse-outline', 'ellipse'];
    const label = options.title ?? route.name;
    const onPress = () => {
      const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigateToTab(route.key);
    };
    const color = focused ? active : idle;
    // the highlight behind the active item, per style
    const pill =
      focused &&
      (style === 'dock'
        ? { backgroundColor: t.primarySoft }
        : style === 'neumorph'
          ? { backgroundColor: t.bg, boxShadow: softInset(t) }
          : glass
            ? { backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' }
            : null);
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        onPress={onPress}
        onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 52 }}>
        <View style={[{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 16, minWidth: 54 }, pill as any]}>
          <Ionicons name={focused ? filled : outline} size={22} color={color} />
          <Text numberOfLines={1} style={{ color, fontSize: 10.5, fontWeight: focused ? '800' : '600', marginTop: 2 }}>
            {label}
          </Text>
        </View>
        {focused && style === 'classic' && <View style={{ position: 'absolute', bottom: 2, width: 5, height: 5, borderRadius: 3, backgroundColor: active }} />}
      </Pressable>
    );
  });

  if (!floating) {
    return (
      <View style={{ flexDirection: 'row', backgroundColor: t.card, borderTopWidth: 1, borderTopColor: t.border, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 6), minHeight: 66 }}>
        {items}
      </View>
    );
  }

  const bar: any = {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: style === 'dock' ? 30 : 26,
    overflow: 'hidden',
  };
  if (style === 'dock') Object.assign(bar, { backgroundColor: t.card, borderWidth: 1, borderColor: t.border, boxShadow: t.dark ? '0 10px 30px rgba(0,0,0,0.6)' : '0 10px 30px rgba(16,32,80,0.16)' });
  if (style === 'floating') Object.assign(bar, { backgroundColor: t.card, boxShadow: t.dark ? '0 8px 24px rgba(0,0,0,0.7)' : '0 8px 24px rgba(16,32,80,0.20)', overflow: 'visible' });
  if (style === 'neumorph') Object.assign(bar, { backgroundColor: t.bg, boxShadow: softShadow(t, 7), overflow: 'visible' });

  return (
    <View style={{ backgroundColor: t.bg, paddingHorizontal: 14, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 10) }}>
      {glass ? (
        <View style={{ borderRadius: 28, boxShadow: '0 10px 28px rgba(109,93,252,0.35)' } as any}>
          <LinearGradient colors={['rgba(109,93,252,0.92)', 'rgba(168,85,247,0.88)', 'rgba(236,72,153,0.85)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[bar, { borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)', borderRadius: 28 }]}>
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '50%', backgroundColor: 'rgba(255,255,255,0.12)' }} />
            {items}
          </LinearGradient>
        </View>
      ) : (
        <View style={bar}>{items}</View>
      )}
    </View>
  );
}
