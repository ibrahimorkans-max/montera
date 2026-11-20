import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Animated, Pressable, View } from 'react-native';
import { NavBar } from '@/components/nav-bar';
import { GRADIENT, usePressScale } from '@/components/ui';
import { useAuth, useTheme } from '@/lib/app-context';

function CreateButton({ disabled }: { disabled: boolean }) {
  const t = useTheme();
  const press = usePressScale(0.88);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ transform: [{ scale: press.scale }], marginTop: -22, opacity: disabled ? 0.4 : 1 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create invoice"
          disabled={disabled}
          onPress={() => router.push('/invoice/new')}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          style={{ width: 60, height: 60, borderRadius: 30, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: t.card, backgroundColor: GRADIENT[1] }}>
          <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          <Ionicons name="add" size={30} color="#fff" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

export default function TabsLayout() {
  const t = useTheme();
  const { can } = useAuth();
  const icon = (name: React.ComponentProps<typeof Ionicons>['name'], active: React.ComponentProps<typeof Ionicons>['name']) =>
    function TabIcon({ color, size, focused }: { color: unknown; size: number; focused: boolean }) {
      return <Ionicons name={focused ? active : name} size={size} color={color as string} />;
    };
  return (
    <Tabs
      screenOptions={{
        header: () => <NavBar />,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.sub,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border, height: 66, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        sceneStyle: { backgroundColor: t.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('grid-outline', 'grid') }} />
      <Tabs.Screen name="invoices" options={{ title: 'Invoices', tabBarIcon: icon('document-text-outline', 'document-text') }} />
      <Tabs.Screen name="create" options={{ title: 'Create Invoice', tabBarButton: () => <CreateButton disabled={!can('invoices.create')} /> }} />
      <Tabs.Screen name="purchases" options={{ title: 'Purchases', tabBarIcon: icon('bag-handle-outline', 'bag-handle') }} />
      <Tabs.Screen name="finance" options={{ title: 'Finance', tabBarIcon: icon('stats-chart-outline', 'stats-chart') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('menu-outline', 'menu') }} />
    </Tabs>
  );
}
