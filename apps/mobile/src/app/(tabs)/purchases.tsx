import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Bars, monthLabel } from '@/components/charts';
import { DocumentViewer } from '@/components/doc-viewer';
import { purchasesListHtml, type Paper } from '@/lib/pdf';
import { useDebounced } from '@/components/rows';
import { Hero, HeroStylePicker, useScreenStyle } from '@/components/styles-kit';
import { Btn, Card, Chips, Empty, FadeIn, IconBtn, InstallmentBadge, Loader, Row, Screen, SearchBar, Section, Txt, addDays, fd, fm, todayStr } from '@/components/ui';
import { qs, useApi } from '@/lib/api';
import { useAuth, useTheme } from '@/lib/app-context';
import { qtyToString, type BusinessProfile, type Purchase, type PurchaseSummary } from '@/lib/shared';

const RANGE_LABELS: Record<string, string> = { month: 'This month', '30d': 'Last 30 days', year: 'This year', all: 'All time' };

type Range = 'month' | '30d' | 'year' | 'all';
function rangeDates(r: Range): { from?: string; to?: string } {
  const today = todayStr();
  if (r === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (r === '30d') return { from: addDays(today, -30), to: today };
  if (r === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return {};
}

function PurchaseRow({ p }: { p: Purchase }) {
  const t = useTheme();
  const items = p.lines.map((l) => l.name).join(', ');
  return (
    <Card onPress={() => router.push({ pathname: '/purchase/[id]', params: { id: p.id } })} label={`${p.supplier} ${fm(p.total, p)}`}>
      <Row gap={12}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="bag-handle-outline" size={19} color={t.danger} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
            {p.supplier}
          </Txt>
          <Txt v="small" numberOfLines={1}>
            {[p.number, fd(p.date), items].filter(Boolean).join(' · ')}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Txt style={{ fontWeight: '800' }} color={t.danger}>
            − {fm(p.total, p)}
          </Txt>
          {(p.balance ?? 0) > 0 && <InstallmentBadge status={(p.paid ?? 0) > 0 ? 'partial' : 'pending'} />}
        </View>
      </Row>
    </Card>
  );
}

function Ranked({ title, rows, color, money, empty }: { title: string; rows: { name: string; amount: number; sub: string }[]; color: string; money: (v: number) => string; empty: string }) {
  const t = useTheme();
  const top = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <Card>
      <Txt v="h">{title}</Txt>
      {rows.length === 0 && <Txt v="sub">{empty}</Txt>}
      {rows.map((r) => (
        <View key={r.name} style={{ gap: 4, paddingVertical: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Txt v="sub" color={t.text} style={{ fontWeight: '600' }} numberOfLines={1}>
                {r.name}
              </Txt>
              <Txt v="small">{r.sub}</Txt>
            </View>
            <Txt v="sub" color={t.text} style={{ fontWeight: '700' }}>
              {money(r.amount)}
            </Txt>
          </Row>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.neutralSoft, overflow: 'hidden' }}>
            <View style={{ width: `${Math.max(2, Math.round((r.amount / top) * 100))}%`, height: '100%', borderRadius: 4, backgroundColor: color }} />
          </View>
        </View>
      ))}
    </Card>
  );
}

export default function Purchases() {
  const t = useTheme();
  const { can } = useAuth();
  const [range, setRange] = useState<Range>('month');
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const dates = rangeDates(range);
  const summary = useApi<PurchaseSummary>(`/purchases/summary${qs(dates)}`);
  const list = useApi<Purchase[]>(`/purchases${qs({ ...dates, q: query, limit: 100 })}`);
  const s = summary.data;
  const money = (v: number) => fm(v, s);
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const [viewer, setViewer] = useState(false);
  const [look, setLook] = useScreenStyle('purchases');
  const [picker, setPicker] = useState(false);
  const biz = businesses.data?.[0];
  const period = `${RANGE_LABELS[range]}${dates.from ? ` · ${fd(dates.from)} – ${fd(dates.to!)}` : ''}${query ? ` · “${query}”` : ''}`;
  const buildList = useCallback((paper: Paper) => (biz ? purchasesListHtml(list.data ?? [], biz, period, paper) : ''), [biz, list.data, period]);
  const reload = () => {
    summary.reload();
    list.reload();
  };

  const change = s && s.lastMonth > 0 ? Math.round(((s.thisMonth - s.lastMonth) / s.lastMonth) * 100) : null;

  return (
    <Screen onRefresh={reload} refreshing={summary.refreshing}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Txt v="title">Purchases</Txt>
          <Txt v="sub">What you bought, from whom, and how much it cost. Paid amounts are recorded as money out.</Txt>
        </View>
        <IconBtn icon="color-palette-outline" label="Change purchases dashboard style" onPress={() => setPicker(true)} />
      </Row>
      {can('finance.manage') && <Btn icon="add" title="New purchase" onPress={() => router.push('/purchase/new')} />}
      <Chips
        value={range}
        onChange={setRange}
        options={[
          { value: 'month', label: 'This month' },
          { value: '30d', label: 'Last 30 days' },
          { value: 'year', label: 'This year' },
          { value: 'all', label: 'All time' },
        ]}
      />

      <Loader loading={summary.loading && !s} error={s ? '' : summary.error} onRetry={reload}>
        {s && (
          <>
            <FadeIn>
              <Hero
                variant={look}
                label="TOTAL PURCHASES"
                value={s.total}
                format={money}
                stats={[
                  { label: 'Bills', value: s.count, format: String, icon: 'receipt-outline' },
                  { label: 'Average', value: s.average, format: money, icon: 'analytics-outline' },
                  { label: 'Unpaid', value: s.unpaid ?? 0, format: money, icon: 'time-outline' },
                ]}
              />
            </FadeIn>

            <FadeIn delay={80}>
              <Row gap={10}>
                <Card style={{ flex: 1 }}>
                  <Txt v="small">This month</Txt>
                  <Txt style={{ fontWeight: '800', fontSize: 17 }} numberOfLines={1}>
                    {money(s.thisMonth)}
                  </Txt>
                  {change !== null && (
                    <Row gap={4}>
                      <Ionicons name={change > 0 ? 'trending-up' : 'trending-down'} size={15} color={change > 0 ? t.danger : t.success} />
                      <Txt v="small" color={change > 0 ? t.danger : t.success}>
                        {change > 0 ? '+' : ''}
                        {change}% vs last month
                      </Txt>
                    </Row>
                  )}
                </Card>
                <Card style={{ flex: 1 }}>
                  <Txt v="small">Last month</Txt>
                  <Txt style={{ fontWeight: '800', fontSize: 17 }} numberOfLines={1}>
                    {money(s.lastMonth)}
                  </Txt>
                </Card>
              </Row>
            </FadeIn>

            <FadeIn delay={120}>
              <Card>
                <Txt v="h">Last 6 months</Txt>
                <Bars values={s.monthly.map((m) => m.amount)} labels={s.monthly.map((m) => monthLabel(m.month))} color={t.danger} soft={t.dangerSoft} labelColor={t.sub} />
              </Card>
            </FadeIn>

            <FadeIn delay={160}>
              <Ranked
                title="Top suppliers"
                color={t.primary}
                money={money}
                empty="No purchases in this period."
                rows={s.bySupplier.map((x) => ({ name: x.name, amount: x.amount, sub: `${x.count} bill${x.count === 1 ? '' : 's'}` }))}
              />
            </FadeIn>
            <FadeIn delay={200}>
              <Ranked
                title="Most bought items"
                color={t.warn}
                money={money}
                empty="No items in this period."
                rows={s.byItem.map((x) => ({ name: x.name, amount: x.amount, sub: `${qtyToString(x.qty)}${x.unit ? ` ${x.unit}` : ''} bought` }))}
              />
            </FadeIn>
          </>
        )}
      </Loader>

      <Section title="Purchase bills" action={(list.data ?? []).length > 0 && biz ? <Btn small kind="secondary" icon="print-outline" title="Print all" onPress={() => setViewer(true)} /> : undefined}>
        <SearchBar value={q} onChange={setQ} placeholder="Search supplier, item or bill no." />
        {(list.data ?? []).length === 0 && !list.loading && (
          <Empty icon="bag-handle-outline" title={q ? 'No purchases match' : 'No purchases in this period'} hint="Add a bill for anything you buy. Its total is taken from your cash or bank as money out." />
        )}
        {(list.data ?? []).map((p) => (
          <PurchaseRow key={p.id} p={p} />
        ))}
      </Section>
      <HeroStylePicker visible={picker} onClose={() => setPicker(false)} value={look} onChange={setLook} title="Purchases dashboard style" />
      {biz && <DocumentViewer visible={viewer} onClose={() => setViewer(false)} title="Purchases" fileName={`purchases-${dates.from ?? 'all'}`} build={buildList} defaultPaper="A4" />}
    </Screen>
  );
}
