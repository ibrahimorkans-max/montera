import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { PaymentRow, useDebounced } from '@/components/rows';
import { Btn, Empty, Loading, SearchBar, styles } from '@/components/ui';
import { qs, usePaged } from '@/lib/api';
import { useAuth, useTheme } from '@/lib/app-context';
import type { Payment } from '@/lib/shared';

export default function Payments() {
  const t = useTheme();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const list = usePaged<Payment>(`/payments${qs({ q: query })}`);
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.content, { paddingBottom: 10 }]}>
        <SearchBar value={q} onChange={setQ} placeholder="Search receipt, client or reference" />
        {can('payments.record') && <Btn icon="add" title="Record Payment" onPress={() => router.push('/payment/new')} />}
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PaymentRow payment={item} />}
        contentContainerStyle={[styles.content, { paddingTop: 4, gap: 10 }]}
        onEndReached={list.more}
        onEndReachedThreshold={0.4}
        onRefresh={list.reload}
        refreshing={false}
        ListFooterComponent={list.loading || (!list.done && list.items.length > 0) ? <Loading /> : undefined}
        ListEmptyComponent={
          list.loading ? undefined : list.error ? (
            <Empty icon="cloud-offline-outline" title="Could not load payments" hint={list.error} action={<Btn small kind="secondary" title="Try again" onPress={list.reload} />} />
          ) : (
            <Empty icon="cash-outline" title={q ? 'No payments match' : 'No payments yet'} hint="Every saved payment gets its own receipt, which you can reprint or share from here." />
          )
        }
      />
    </View>
  );
}
