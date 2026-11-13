import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { InvoiceRow, useDebounced } from '@/components/rows';
import { Btn, Chips, Empty, Loading, SearchBar, Txt, styles } from '@/components/ui';
import { qs, usePaged } from '@/lib/api';
import { useAuth, useTheme } from '@/lib/app-context';
import type { Invoice } from '@/lib/shared';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function Invoices() {
  const t = useTheme();
  const { can } = useAuth();
  const params = useLocalSearchParams<{ status?: string }>();
  const [status, setStatus] = useState(params.status ?? '');
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  useEffect(() => {
    if (params.status !== undefined) setStatus(params.status);
  }, [params.status]);

  const list = usePaged<Invoice>(`/invoices${qs({ q: query, status })}`);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.content, { paddingTop: 16, paddingBottom: 10 }]}>
        <Txt v="title">All Invoices</Txt>
        <SearchBar value={q} onChange={setQ} placeholder="Search number, client or reference" />
        <Chips value={status} onChange={setStatus} options={FILTERS} />
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <InvoiceRow invoice={item} />}
        contentContainerStyle={[styles.content, { paddingTop: 4, gap: 10 }]}
        onEndReached={list.more}
        onEndReachedThreshold={0.4}
        onRefresh={list.reload}
        refreshing={false}
        ListFooterComponent={list.loading || (!list.done && list.items.length > 0) ? <Loading /> : undefined}
        ListEmptyComponent={
          list.loading ? undefined : list.error ? (
            <Empty icon="cloud-offline-outline" title="Could not load invoices" hint={list.error} action={<Btn small kind="secondary" title="Try again" onPress={list.reload} />} />
          ) : (
            <Empty
              icon="document-text-outline"
              title={q || status ? 'No invoices match' : 'No invoices yet'}
              hint={q || status ? 'Try a different search or filter.' : 'Create your first invoice to get started.'}
              action={can('invoices.create') && !q && !status ? <Btn small icon="add" title="Create Invoice" onPress={() => router.push('/invoice/new')} /> : undefined}
            />
          )
        }
      />
    </View>
  );
}
