import { Tabs } from 'expo-router/js-tabs';
import { NavBar } from '@/components/nav-bar';
import { StyledTabBar } from '@/components/tab-bar';
import { useAuth, useTheme } from '@/lib/app-context';

export default function TabsLayout() {
  const t = useTheme();
  const { can } = useAuth();
  return (
    <Tabs
      tabBar={(props: any) => <StyledTabBar {...props} canCreate={can('invoices.create')} />}
      screenOptions={{
        header: () => <NavBar />,
        sceneStyle: { backgroundColor: t.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="invoices" options={{ title: 'Invoices' }} />
      <Tabs.Screen name="create" options={{ title: 'Create Invoice' }} />
      <Tabs.Screen name="purchases" options={{ title: 'Purchases' }} />
      <Tabs.Screen name="finance" options={{ title: 'Finance' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
