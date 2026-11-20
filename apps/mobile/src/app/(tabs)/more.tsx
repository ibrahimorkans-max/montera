import { router } from 'expo-router';
import { View } from 'react-native';
import { MenuRow } from '@/components/rows';
import { Screen, Section, Txt } from '@/components/ui';
import { useAuth } from '@/lib/app-context';

export default function More() {
  const { user } = useAuth();
  return (
    <Screen>
      <View style={{ paddingTop: 0 }}>
        <Txt v="title">More</Txt>
        <Txt v="sub">
          {user?.name} · {user?.role}
        </Txt>
      </View>
      <Section title="Accounts">
        <MenuRow icon="people-outline" title="Clients" sub="Profiles, ledgers and statements" onPress={() => router.push('/clients')} />
        <MenuRow icon="stats-chart-outline" title="Finance" sub="Money in, money out and expenses" onPress={() => router.push('/finance')} />
        <MenuRow icon="bag-handle-outline" title="Purchases" sub="Bills for things you buy, paid as money out" onPress={() => router.push('/purchases')} />
        <MenuRow icon="wallet-outline" title="Cash & Bank Accounts" sub="Balances, transfers between accounts" onPress={() => router.push('/accounts')} />
        <MenuRow icon="book-outline" title="Daily Cashbook" sub="Opening, in, out and closing for each day" onPress={() => router.push('/cashbook')} />
        <MenuRow icon="trending-up-outline" title="Profit & Loss · Cash Flow" sub="Is the business making money?" onPress={() => router.push('/statements')} />
        <MenuRow icon="globe-outline" title="Exchange Rates" sub="Multi-currency invoices and accounts" onPress={() => router.push('/rates')} />
        <MenuRow icon="document-outline" title="Quotations" sub="Price quotes you can turn into invoices" onPress={() => router.push('/quotations')} />
        <MenuRow icon="repeat-outline" title="Recurring Invoices" sub="Schedules, and drafts awaiting approval" onPress={() => router.push('/recurring')} />
        <MenuRow icon="bar-chart-outline" title="Reports" sub="Collections, clients, services · PDF & Excel" onPress={() => router.push('/reports')} />
        <MenuRow icon="pricetags-outline" title="Services & Products" sub="Your catalogue and default prices" onPress={() => router.push('/services')} />
        <MenuRow icon="cash-outline" title="Payments" sub="Record and review payments" onPress={() => router.push('/payments')} />
        <MenuRow icon="calendar-outline" title="Installments" sub="Scheduled and overdue installments" onPress={() => router.push('/installments')} />
        <MenuRow icon="receipt-outline" title="Receipts" sub="Reprint or share any receipt" onPress={() => router.push('/payments')} />
      </Section>
      <Section title="Setup">
        <MenuRow icon="business-outline" title="Business Profiles" sub="Invoice design, signature and issuer details" onPress={() => router.push('/businesses')} />
        <MenuRow icon="settings-outline" title="Settings & Security" sub="App lock, fingerprint, theme and devices" onPress={() => router.push('/settings')} />
      </Section>
    </Screen>
  );
}
