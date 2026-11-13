import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { useDebounced } from '@/components/rows';
import { Badge, Btn, Card, Chips, Empty, Loading, Row, SearchBar, Txt, fd, fm, styles } from '@/components/ui';
import { qs, usePaged } from '@/lib/api';
import { useAuth, useTheme } from '@/lib/app-context';
import type { Quotation } from '@/lib/shared';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'converted', label: 'Invoiced' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
];

export function QuotationRow({ q }: { q: Quotation }) {
  const t = useTheme();
  return (
    <Card onPress={() => router.push({ pathname: '/quotation/[id]', params: { id: q.id } })} label={`Quotation ${q.number} for ${q.clientName}`}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
            {q.clientName}
          </Txt>
          <Txt v="small">
            {q.number} · {fd(q.issueDate)}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Txt style={{ fontWeight: '700' }}>{fm(q.total, q)}</Txt>
          <Badge status={q.displayStatus} />
        </View>
      </Row>
      {q.displayStatus !== 'converted' && q.displayStatus !== 'rejected' && (
        <Txt v="small" color={q.displayStatus === 'expired' ? t.danger : undefined}>
          {q.displayStatus === 'expired' ? 'Expired' : 'Valid until'} {fd(q.validUntil)}
        </Txt>
      )}
      {q.displayStatus === 'converted' && <Txt v="small">Invoice {q.convertedInvoiceNumber ?? 'draft'}</Txt>}
    </Card>
  );
}

export default function Quotations() {
  const t = useTheme();
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const list = usePaged<Quotation>(`/quotations${qs({ q: query, status })}`);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.content, { paddingBottom: 10 }]}>
        <SearchBar value={q} onChange={setQ} placeholder="Search number, client or reference" />
        <Chips value={status} onChange={setStatus} options={FILTERS} />
        {can('invoices.create') && <Btn icon="add" title="New quotation" onPress={() => router.push('/quotation/new')} />}
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(x) => x.id}
        renderItem={({ item }) => <QuotationRow q={item} />}
        contentContainerStyle={[styles.content, { paddingTop: 4, gap: 10 }]}
        onEndReached={list.more}
        onEndReachedThreshold={0.4}
        onRefresh={list.reload}
        refreshing={false}
        ListFooterComponent={list.loading || (!list.done && list.items.length > 0) ? <Loading /> : undefined}
        ListEmptyComponent={
          list.loading ? undefined : list.error ? (
            <Empty icon="cloud-offline-outline" title="Could not load quotations" hint={list.error} action={<Btn small kind="secondary" title="Try again" onPress={list.reload} />} />
          ) : (
            <Empty icon="document-outline" title={q || status ? 'No quotations match' : 'No quotations yet'} hint="Send a price quote first, then turn it into an invoice with one tap when the client agrees." />
          )
        }
      />
    </View>
  );
}
