import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SplashReveal } from '@/components/splash';
import { NavBar, NavTracker } from '@/components/nav-bar';
import { SyncBanner } from '@/components/sync-ui';
import { Loading } from '@/components/ui';
import { AppProviders, useAuth, useTheme } from '@/lib/app-context';
import { LockProvider } from '@/lib/lock';

function Navigation() {
  const { user, ready } = useAuth();
  const t = useTheme();
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, justifyContent: 'center' }}>
        <Loading />
      </View>
    );
  }
  const base = t.dark ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, background: t.bg, card: t.card, text: t.text, border: t.border, primary: t.primary } }}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      {!user && <SyncBanner />}
      <NavTracker />
      <Stack
        screenOptions={{
          header: ({ options }) => <NavBar title={typeof options.title === 'string' ? options.title : undefined} />,
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.text,
          headerTitleStyle: { fontWeight: '700' },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: t.bg },
        }}>
        <Stack.Protected guard={!!user}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="invoice/new" options={{ title: 'Create Invoice' }} />
          <Stack.Screen name="invoice/[id]" options={{ title: 'Invoice' }} />
          <Stack.Screen name="client/[id]" options={{ title: 'Client' }} />
          <Stack.Screen name="client/edit" options={{ title: 'Client' }} />
          <Stack.Screen name="payment/new" options={{ title: 'Record Payment' }} />
          <Stack.Screen name="payment/[id]" options={{ title: 'Receipt' }} />
          <Stack.Screen name="business/edit" options={{ title: 'Business Profile' }} />
          <Stack.Screen name="businesses" options={{ title: 'Business Profiles' }} />
          <Stack.Screen name="services" options={{ title: 'Services & Products' }} />
          <Stack.Screen name="payments" options={{ title: 'Payments & Receipts' }} />
          <Stack.Screen name="installments" options={{ title: 'Installments' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="clients" options={{ title: 'Clients' }} />
          <Stack.Screen name="quotations" options={{ title: 'Quotations' }} />
          <Stack.Screen name="quotation/new" options={{ title: 'New Quotation' }} />
          <Stack.Screen name="quotation/[id]" options={{ title: 'Quotation' }} />
          <Stack.Screen name="recurring/index" options={{ title: 'Recurring Invoices' }} />
          <Stack.Screen name="recurring/new" options={{ title: 'New Recurring Invoice' }} />
          <Stack.Screen name="recurring/[id]" options={{ title: 'Recurring Invoice' }} />
          <Stack.Screen name="reports" options={{ title: 'Reports' }} />
          <Stack.Screen name="accounts" options={{ title: 'Cash & Bank Accounts' }} />
          <Stack.Screen name="cashbook" options={{ title: 'Daily Cashbook' }} />
          <Stack.Screen name="statements" options={{ title: 'Profit & Loss · Cash Flow' }} />
          <Stack.Screen name="rates" options={{ title: 'Exchange Rates' }} />
          <Stack.Screen name="sync" options={{ title: 'Sync & Offline' }} />
        </Stack.Protected>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [splash, setSplash] = useState(true);
  return (
    <SafeAreaProvider>
      <AppProviders>
        <LockProvider>
          <Navigation />
        </LockProvider>
      </AppProviders>
      {splash && <SplashReveal onDone={() => setSplash(false)} />}
    </SafeAreaProvider>
  );
}
