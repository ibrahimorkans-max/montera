import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Hero, HeroStylePicker, heroInk, useScreenStyle } from '@/components/styles-kit';
import { InvoiceRow, useDebounced } from '@/components/rows';
import { Btn, Chips, Empty, FadeIn, IconBtn, Loading, Row, SearchBar, Txt, fm, styles } from '@/components/ui';
import { qs, useApi, usePaged } from '@/lib/api';
import { useAuth, useTheme } from '@/lib/app-context';
import type { DashboardSummary, Invoice } from '@/lib/shared';

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
  const summary = useApi<DashboardSummary>('/dashboard');
  const d = summary.data;
  const money = (v: number) => fm(v, d);
  const [look, setLook] = useScreenStyle('invoices');
  const [picker, setPicker] = useState(false);
  const collected = d && d.totalInvoiced > 0 ? Math.min(100, Math.round((d.totalReceived / d.totalInvoiced) * 100)) : 0;
  const ink = heroInk(look, t);
  const counts = d
    ? [
        { label: 'Unpaid', n: d.unpaidCount, go: 'unpaid', c: t.info },
        { label: 'Part paid', n: d.partiallyPaidCount, go: 'partially_paid', c: t.warn },
        { label: 'Overdue', n: d.overdueCount, go: 'overdue', c: t.danger },
        { label: 'Paid', n: d.paidCount, go: 'paid', c: t.success },
        { label: 'Draft', n: d.draftCount, go: 'draft', c: t.sub },
      ]
    : [];

  const header = (
    <View style={{ gap: 12, paddingBottom: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt v="title">Invoices</Txt>
        <IconBtn icon="color-palette-outline" label="Change invoices dashboard style" onPress={() => setPicker(true)} />
      </Row>
      {d && (
        <FadeIn>
          <Hero
            variant={look}
            label="OUTSTANDING"
            value={d.outstanding}
            format={money}
            stats={[
              { label: 'Invoiced', value: d.totalInvoiced, format: money, icon: 'document-text' },
              { label: 'Received', value: d.totalReceived, format: money, icon: 'checkmark-circle', tone: '#86EFAC' },
              { label: 'Overdue', value: d.overdue, format: money, icon: 'alert-circle', tone: '#FDA4AF' },
            ]}>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: ink.track, marginTop: 14, overflow: 'hidden' }}>
              <View style={{ width: `${collected}%`, height: '100%', borderRadius: 4, backgroundColor: look === 'soft' || look === 'minimal' ? t.success : '#86EFAC' }} />
            </View>
            <Txt v="small" color={ink.sub} style={{ marginTop: 6 }}>
              {collected}% of everything invoiced is collected
            </Txt>
          </Hero>
        </FadeIn>
      )}
      {d && (
        <Row gap={8}>
          {counts.map((x) => (
            <Pressable
              key={x.go}
              accessibilityRole="button"
              accessibilityLabel={`${x.n} ${x.label}`}
              onPress={() => setStatus(status === x.go ? '' : x.go)}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 14, backgroundColor: status === x.go ? t.primarySoft : t.card, borderWidth: 1, borderColor: status === x.go ? t.primary : t.border }}>
              <Txt style={{ fontWeight: '800', fontSize: 17 }} color={x.c}>
                {x.n}
              </Txt>
              <Txt v="small" numberOfLines={1}>
                {x.label}
              </Txt>
            </Pressable>
          ))}
        </Row>
      )}
      <SearchBar value={q} onChange={setQ} placeholder="Search number, client or reference" />
      <Chips value={status} onChange={setStatus} options={FILTERS} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <HeroStylePicker visible={picker} onClose={() => setPicker(false)} value={look} onChange={setLook} title="Invoices dashboard style" />
      <FlatList
        ListHeaderComponent={header}
        data={list.items}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <InvoiceRow invoice={item} />}
        contentContainerStyle={[styles.content, { paddingTop: 16, gap: 10 }]}
        onEndReached={list.more}
        onEndReachedThreshold={0.4}
        onRefresh={() => (list.reload(), summary.reload())}
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
