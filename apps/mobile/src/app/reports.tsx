import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { Badge, Btn, Card, Chips, CountUp, DateField, Empty, FadeIn, InstallmentBadge, KV, Loader, Row, Screen, Select, Txt, addDays, fd, fm, isDate, todayStr } from '@/components/ui';
import { qs, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { downloadFromApi } from '@/lib/download';
import { reportHtml, type Paper } from '@/lib/pdf';
import { PAYMENT_METHOD_LABELS, qtyToString, type BusinessProfile, type ReportData } from '@/lib/shared';

type Period = 'month' | 'last_month' | 'quarter' | 'year' | 'custom';
type Tab = 'overview' | 'collections' | 'clients' | 'services' | 'methods' | 'overdue' | 'installments';
type Grain = 'daily' | 'weekly' | 'monthly';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function periodRange(p: Period, custom: { from: string; to: string }): { from: string; to: string } {
  const t = todayStr();
  const [y, m] = t.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (p === 'month') return { from: `${y}-${pad(m)}-01`, to: t };
  if (p === 'last_month') {
    const yy = m === 1 ? y - 1 : y;
    const mm = m === 1 ? 12 : m - 1;
    return { from: `${yy}-${pad(mm)}-01`, to: `${yy}-${pad(mm)}-${lastDay(yy, mm)}` };
  }
  if (p === 'quarter') return { from: `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`, to: t };
  if (p === 'year') return { from: `${y}-01-01`, to: t };
  return custom;
}

/** Horizontal bar that grows to its share. */
function ShareBar({ ratio, color }: { ratio: number; color: string }) {
  const t = useTheme();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: Math.max(0, Math.min(1, ratio)), duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [ratio, v]);
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: t.neutralSoft, overflow: 'hidden' }}>
      <Animated.View style={{ height: '100%', borderRadius: 4, backgroundColor: color, width: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
    </View>
  );
}

/** Vertical bar for the collections chart. */
function Column({ ratio, label, value, color }: { ratio: number; label: string; value: string; color: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: ratio, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [ratio, v]);
  return (
    <View style={{ width: 44, alignItems: 'center', gap: 6 }} accessibilityLabel={`${label}: ${value}`}>
      <View style={{ height: 130, justifyContent: 'flex-end' }}>
        <Animated.View style={{ width: 22, borderRadius: 7, backgroundColor: color, height: v.interpolate({ inputRange: [0, 1], outputRange: [3, 130] }) }} />
      </View>
      <Txt v="small" numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

function Kpi({ label, value, format, tone, delay }: { label: string; value: number; format: (v: number) => string; tone?: string; delay: number }) {
  const t = useTheme();
  return (
    <FadeIn delay={delay} style={{ flexBasis: '47%', flexGrow: 1 }}>
      <Card style={{ gap: 4 }}>
        <Txt v="small">{label}</Txt>
        <CountUp value={value} format={format} style={{ fontSize: 18, fontWeight: '800', color: tone ?? t.text }} />
      </Card>
    </FadeIn>
  );
}

export default function Reports() {
  const t = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>('month');
  const [custom, setCustom] = useState({ from: addDays(todayStr(), -30), to: todayStr() });
  const [businessId, setBusinessId] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [grain, setGrain] = useState<Grain>('daily');
  const [viewer, setViewer] = useState(false);
  const [busy, setBusy] = useState(false);

  const range = periodRange(period, custom);
  const valid = isDate(range.from) && isDate(range.to) && range.from <= range.to;
  const query = qs({ ...range, businessId });
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const { data: r, loading, error, reload, refreshing } = useApi<ReportData>(valid ? `/reports${query}` : null);
  const business = businesses.data?.find((b) => b.id === businessId) ?? businesses.data?.[0];
  const money = (v: number) => fm(v, r);
  const buildDoc = useCallback((paper: Paper) => (r && business ? reportHtml(r, business, `${user?.tenantName ?? 'Monetra'} report`, paper) : ''), [r, business, user]);

  async function excel() {
    setBusy(true);
    try {
      await downloadFromApi(`/reports/export.xlsx${query}`, `monetra-report-${range.from}-to-${range.to}.xlsx`);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const series =
    r &&
    (grain === 'daily'
      ? r.collections.daily.map((x) => ({ key: x.date, label: `${Number(x.date.slice(8))} ${MONTHS[Number(x.date.slice(5, 7)) - 1]}`, amount: x.amount, count: x.count }))
      : grain === 'weekly'
        ? r.collections.weekly.map((x) => ({ key: x.weekStart, label: `${Number(x.weekStart.slice(8))} ${MONTHS[Number(x.weekStart.slice(5, 7)) - 1]}`, amount: x.amount, count: x.count }))
        : r.collections.monthly.map((x) => ({ key: x.month, label: `${MONTHS[Number(x.month.slice(5)) - 1]} ${x.month.slice(2, 4)}`, amount: x.amount, count: x.count })));
  const peak = Math.max(1, ...(series ?? []).map((x) => x.amount));
  const agingTotal = r ? r.aging.notDue + r.aging.d1to30 + r.aging.d31to60 + r.aging.d61to90 + r.aging.d90plus : 0;
  const agingRows = r
    ? [
        { label: 'Not yet due', value: r.aging.notDue, color: t.success },
        { label: '1–30 days overdue', value: r.aging.d1to30, color: t.warn },
        { label: '31–60 days overdue', value: r.aging.d31to60, color: '#E8833A' },
        { label: '61–90 days overdue', value: r.aging.d61to90, color: t.danger },
        { label: 'Over 90 days overdue', value: r.aging.d90plus, color: '#8F1D1D' },
      ]
    : [];

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Chips
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'month', label: 'This month' },
          { value: 'last_month', label: 'Last month' },
          { value: 'quarter', label: 'This quarter' },
          { value: 'year', label: 'This year' },
          { value: 'custom', label: 'Custom' },
        ]}
      />
      {period === 'custom' && (
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <DateField label="From" value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="To" value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} error={isDate(custom.to) && isDate(custom.from) && custom.to < custom.from ? 'Before the start' : undefined} />
          </View>
        </Row>
      )}
      {(businesses.data?.length ?? 0) > 1 && (
        <Select
          label="Business"
          value={businessId ? (business?.tradingName || business?.legalName) ?? '' : 'All businesses'}
          placeholder="All businesses"
          items={[{ id: '', legalName: 'All businesses', tradingName: '' } as BusinessProfile, ...(businesses.data ?? [])]}
          getKey={(b) => b.id || 'all'}
          getLabel={(b) => b.tradingName || b.legalName}
          onSelect={(b) => setBusinessId(b.id)}
        />
      )}
      <Txt v="small">
        {valid ? `${fd(range.from)} – ${fd(range.to)}` : 'Choose a valid period'} · outstanding and overdue are as of today
      </Txt>

      <Row gap={10}>
        <Btn style={{ flex: 1 }} kind="secondary" icon="document-text-outline" title="PDF report" onPress={() => setViewer(true)} disabled={!r} />
        <Btn style={{ flex: 1 }} icon="grid-outline" title="Excel" onPress={excel} loading={busy} disabled={!valid} />
      </Row>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
        <Chips
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'collections', label: 'Collections' },
            { value: 'clients', label: 'Clients' },
            { value: 'services', label: 'Services' },
            { value: 'methods', label: 'Payment methods' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'installments', label: 'Installments' },
          ]}
        />
      </ScrollView>

      <Loader loading={loading && !r} error={r ? '' : error} onRetry={reload}>
        {r && (
          <FadeIn key={tab}>
            <View style={{ gap: 12 }}>
              {tab === 'overview' && (
                <>
                  <Row style={{ flexWrap: 'wrap', alignItems: 'stretch' }} gap={10}>
                    <Kpi delay={0} label="Invoiced" value={r.totals.invoiced} format={money} />
                    <Kpi delay={60} label="Collected" value={r.totals.collected} format={money} tone={t.success} />
                    <Kpi delay={120} label="Outstanding today" value={r.totals.outstanding} format={money} />
                    <Kpi delay={180} label="Overdue today" value={r.totals.overdue} format={money} tone={r.totals.overdue ? t.danger : undefined} />
                    <Kpi delay={240} label="Invoices issued" value={r.totals.invoiceCount} format={String} />
                    <Kpi delay={300} label="Payments received" value={r.totals.paymentCount} format={String} />
                    <Kpi delay={360} label="Expenses" value={r.totals.expenses} format={money} tone={t.danger} />
                    <Kpi delay={420} label="Collected − expenses" value={r.totals.collected - r.totals.expenses} format={money} tone={t.primary} />
                  </Row>
                  <Card>
                    <Txt v="h">What clients owe, by age</Txt>
                    <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: t.neutralSoft }}>
                      {agingRows.map((a) => (a.value > 0 ? <View key={a.label} style={{ flex: a.value, backgroundColor: a.color }} /> : null))}
                    </View>
                    {agingRows.map((a) => (
                      <Row key={a.label} style={{ justifyContent: 'space-between' }}>
                        <Row gap={8}>
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: a.color }} />
                          <Txt v="sub">{a.label}</Txt>
                        </Row>
                        <Txt v="sub" color={t.text}>
                          {money(a.value)}
                        </Txt>
                      </Row>
                    ))}
                    {agingTotal === 0 && <Txt v="small">Nothing outstanding.</Txt>}
                  </Card>
                  {r.clients.length > 0 && (
                    <Card>
                      <Txt v="h">Top clients</Txt>
                      {r.clients.slice(0, 3).map((c) => (
                        <KV key={c.clientId} k={c.clientName} v={money(c.invoiced)} />
                      ))}
                    </Card>
                  )}
                </>
              )}

              {tab === 'collections' && (
                <>
                  <Chips
                    value={grain}
                    onChange={setGrain}
                    options={[
                      { value: 'daily', label: 'Daily' },
                      { value: 'weekly', label: 'Weekly' },
                      { value: 'monthly', label: 'Monthly' },
                    ]}
                  />
                  {!series || series.length === 0 ? (
                    <Empty icon="cash-outline" title="No collections in this period" />
                  ) : (
                    <>
                      <Card>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, alignItems: 'flex-end' }}>
                          {series.map((x) => (
                            <Column key={`${grain}-${x.key}`} ratio={x.amount / peak} label={x.label} value={money(x.amount)} color={t.primary} />
                          ))}
                        </ScrollView>
                      </Card>
                      <Card>
                        {series.map((x) => (
                          <KV key={x.key} k={`${grain === 'weekly' ? 'Week of ' : ''}${x.label} · ${x.count} payment${x.count === 1 ? '' : 's'}`} v={money(x.amount)} />
                        ))}
                        <KV k="Total" v={money(r.totals.collected)} bold />
                      </Card>
                    </>
                  )}
                </>
              )}

              {tab === 'clients' &&
                (r.clients.length === 0 ? (
                  <Empty icon="people-outline" title="No client activity in this period" />
                ) : (
                  r.clients.map((c) => (
                    <Card key={c.clientId} onPress={() => router.push({ pathname: '/client/[id]', params: { id: c.clientId } })} label={c.clientName}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Txt style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>
                          {c.clientName}
                        </Txt>
                        <Txt style={{ fontWeight: '800' }}>{money(c.invoiced)}</Txt>
                      </Row>
                      <ShareBar ratio={r.totals.invoiced ? c.invoiced / r.totals.invoiced : 0} color={t.primary} />
                      <Txt v="small">
                        {c.invoiceCount} invoice{c.invoiceCount === 1 ? '' : 's'} · collected {money(c.collected)} · owes {money(c.outstanding)}
                      </Txt>
                    </Card>
                  ))
                ))}

              {tab === 'services' && (
                <>
                  {r.services.length === 0 ? (
                    <Empty icon="pricetags-outline" title="No invoiced services in this period" />
                  ) : (
                    r.services.map((s) => {
                      const total = r.services.reduce((a, x) => a + x.revenue, 0);
                      return (
                        <Card key={`${s.serviceId}-${s.name}`}>
                          <Row style={{ justifyContent: 'space-between' }}>
                            <Txt style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>
                              {s.name}
                            </Txt>
                            <Txt style={{ fontWeight: '800' }}>{money(s.revenue)}</Txt>
                          </Row>
                          <ShareBar ratio={total ? s.revenue / total : 0} color={t.success} />
                          <Txt v="small">
                            Qty {qtyToString(s.qty)} · {s.invoiceCount} invoice{s.invoiceCount === 1 ? '' : 's'}
                          </Txt>
                        </Card>
                      );
                    })
                  )}
                  <Txt v="small">Revenue is each line after item discounts, before the overall discount, tax and charges.</Txt>
                </>
              )}

              {tab === 'methods' &&
                (r.methods.length === 0 ? (
                  <Empty icon="card-outline" title="No payments in this period" />
                ) : (
                  <Card>
                    {r.methods.map((x) => (
                      <View key={x.method} style={{ gap: 5, paddingVertical: 5 }}>
                        <Row style={{ justifyContent: 'space-between' }}>
                          <Txt v="sub" color={t.text} style={{ fontWeight: '600' }}>
                            {PAYMENT_METHOD_LABELS[x.method]} · {x.count}
                          </Txt>
                          <Txt v="sub" color={t.text}>
                            {money(x.amount)} · {r.totals.collected ? Math.round((x.amount / r.totals.collected) * 100) : 0}%
                          </Txt>
                        </Row>
                        <ShareBar ratio={r.totals.collected ? x.amount / r.totals.collected : 0} color={t.primary} />
                      </View>
                    ))}
                  </Card>
                ))}

              {tab === 'overdue' && (
                <>
                  <Card>
                    <KV k="Total overdue today" v={money(r.totals.overdue)} bold color={r.totals.overdue ? t.danger : undefined} />
                    {agingRows.slice(1).map((a) => (
                      <KV key={a.label} k={a.label} v={money(a.value)} />
                    ))}
                  </Card>
                  {r.overdueInvoices.length === 0 ? (
                    <Empty icon="happy-outline" title="Nothing is overdue" />
                  ) : (
                    r.overdueInvoices.map((o) => (
                      <Card key={o.invoiceId} onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: o.invoiceId } })} label={`Invoice ${o.number}`}>
                        <Row style={{ justifyContent: 'space-between' }}>
                          <View style={{ flex: 1 }}>
                            <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
                              {o.clientName}
                            </Txt>
                            <Txt v="small">
                              {o.number} · due {fd(o.dueDate)}
                            </Txt>
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: 4 }}>
                            <Txt style={{ fontWeight: '800' }} color={t.danger}>
                              {money(o.balance)}
                            </Txt>
                            <Txt v="small" color={t.danger}>
                              {o.daysOverdue} day{o.daysOverdue === 1 ? '' : 's'} late
                            </Txt>
                          </View>
                        </Row>
                      </Card>
                    ))
                  )}
                </>
              )}

              {tab === 'installments' && (
                <>
                  <Card>
                    <KV k="Scheduled in period" v={money(r.installments.scheduled)} />
                    <KV k="Collected" v={money(r.installments.collected)} color={t.success} />
                    <KV k="Still to collect" v={money(r.installments.outstanding)} bold />
                    <KV k="Of which overdue" v={money(r.installments.overdue)} color={r.installments.overdue ? t.danger : undefined} />
                    <ShareBar ratio={r.installments.scheduled ? r.installments.collected / r.installments.scheduled : 0} color={t.success} />
                  </Card>
                  {r.installments.rows.length === 0 ? (
                    <Empty icon="calendar-outline" title="No installments fall due in this period" />
                  ) : (
                    r.installments.rows.map((x, n) => (
                      <Card key={`${x.invoiceId}-${n}`} onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: x.invoiceId } })} label={`Installment for ${x.clientName}`}>
                        <Row style={{ justifyContent: 'space-between' }}>
                          <View style={{ flex: 1 }}>
                            <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
                              {x.clientName}
                            </Txt>
                            <Txt v="small">
                              {x.invoiceNumber} · due {fd(x.dueDate)}
                            </Txt>
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: 4 }}>
                            <Txt style={{ fontWeight: '700' }}>{money(x.amount)}</Txt>
                            <InstallmentBadge status={x.status} />
                          </View>
                        </Row>
                      </Card>
                    ))
                  )}
                </>
              )}
            </View>
          </FadeIn>
        )}
      </Loader>

      {r && business && <DocumentViewer visible={viewer} onClose={() => setViewer(false)} title="Financial report" fileName={`monetra-report-${range.from}-to-${range.to}`} build={buildDoc} />}
    </Screen>
  );
}

