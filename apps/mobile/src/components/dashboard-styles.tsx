import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useAuth, useTheme } from '@/lib/app-context';
import { PAYMENT_METHOD_LABELS, type DashboardStyle, type DashboardSummary, type Invoice } from '@/lib/shared';
import { AreaLine, Bars, Donut, monthLabel } from './charts';
import { InstallmentItem, InvoiceRow, PaymentRow } from './rows';
import { Badge, Card, CountUp, FadeIn, Row, Section, Txt, fd, fm, usePressScale, type IconName } from './ui';

// ---------------------------------------------------------------- palettes

const STUDIO = { accent: '#7C5CFC', soft: '#E4DCFF', ink: '#14121F' };
const EMERALD = { deep: '#0E3B32', mid: '#145446', accent: '#2BB894', soft: '#CDEFE4', line: '#38C79F' };
const WALLET = { deep: '#163B2C', mid: '#1F5A42', accent: '#3E8E67', soft: '#DCEBE2', cream: '#F4F1EA' };

const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

// ---------------------------------------------------------------- previews for the style picker

/** Miniature of each style, used when choosing one. */
export function StylePreview({ style, selected }: { style: DashboardStyle; selected: boolean }) {
  const t = useTheme();
  const box = { height: 150, borderRadius: 14, borderWidth: selected ? 3 : 1, borderColor: selected ? t.primary : t.border, overflow: 'hidden' as const, padding: 8, gap: 5 };
  const line = (w: string, c: string, h = 5) => <View style={{ width: w as any, height: h, borderRadius: 3, backgroundColor: c }} />;
  if (style === 'monetra')
    return (
      <View style={[box, { backgroundColor: '#F3F6FC' }]}>
        <LinearGradient colors={['#0B46D6', '#0E9E8A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 46, borderRadius: 10, padding: 7, gap: 5 }}>
          {line('50%', 'rgba(255,255,255,0.7)', 4)}
          {line('70%', '#fff', 8)}
        </LinearGradient>
        <Row gap={5}>
          <View style={{ flex: 1, height: 30, borderRadius: 7, backgroundColor: '#fff' }} />
          <View style={{ flex: 1, height: 30, borderRadius: 7, backgroundColor: '#fff' }} />
        </Row>
        <Row gap={5}>
          <View style={{ flex: 1, height: 30, borderRadius: 7, backgroundColor: '#fff' }} />
          <View style={{ flex: 1, height: 30, borderRadius: 7, backgroundColor: '#fff' }} />
        </Row>
      </View>
    );
  if (style === 'minimal')
    return (
      <View style={[box, { backgroundColor: '#F6F6F8' }]}>
        <View style={{ backgroundColor: '#fff', borderRadius: 10, padding: 7, gap: 5 }}>
          {line('60%', STUDIO.ink, 7)}
          <Row gap={3} style={{ alignItems: 'flex-end', height: 30 }}>
            {[8, 14, 10, 20, 16, 22, 28].map((h, i) => (
              <View key={i} style={{ flex: 1, height: h, borderRadius: 2, backgroundColor: i === 6 ? STUDIO.accent : STUDIO.soft }} />
            ))}
          </Row>
        </View>
        <Row gap={5}>
          <View style={{ flex: 1, height: 26, borderRadius: 7, backgroundColor: '#fff', justifyContent: 'flex-end', padding: 4 }}>{line('70%', STUDIO.accent, 3)}</View>
          <View style={{ flex: 1, height: 26, borderRadius: 7, backgroundColor: '#fff', justifyContent: 'flex-end', padding: 4 }}>{line('80%', '#22A06B', 3)}</View>
        </Row>
        <Row gap={4}>
          <View style={{ width: 28, height: 10, borderRadius: 5, backgroundColor: STUDIO.ink }} />
          <View style={{ width: 20, height: 10, borderRadius: 5, backgroundColor: '#fff' }} />
          <View style={{ width: 24, height: 10, borderRadius: 5, backgroundColor: '#fff' }} />
        </Row>
      </View>
    );
  if (style === 'emerald')
    return (
      <View style={[box, { backgroundColor: '#EEF2F0' }]}>
        <View style={{ height: 40, borderRadius: 10, backgroundColor: EMERALD.deep, padding: 7, gap: 5 }}>
          {line('70%', '#fff', 5)}
          <Row gap={4}>
            {line('25%', EMERALD.soft, 4)}
            {line('25%', EMERALD.soft, 4)}
          </Row>
        </View>
        <View style={{ height: 40, borderRadius: 10, backgroundColor: '#fff', padding: 6, justifyContent: 'flex-end' }}>
          <View style={{ height: 16, borderTopWidth: 3, borderColor: EMERALD.line, borderTopLeftRadius: 20, borderTopRightRadius: 30, backgroundColor: EMERALD.soft }} />
        </View>
        <Row gap={3} style={{ alignItems: 'flex-end', height: 30, backgroundColor: '#fff', borderRadius: 10, padding: 5 }}>
          {[12, 18, 10, 22, 14, 20].map((h, i) => (
            <View key={i} style={{ flex: 1, height: h, borderRadius: 2, backgroundColor: i % 2 ? EMERALD.deep : '#8DB3A6' }} />
          ))}
        </Row>
      </View>
    );
  return (
    <View style={[box, { backgroundColor: WALLET.cream }]}>
      <View style={{ height: 44, borderRadius: 12, backgroundColor: WALLET.deep, padding: 7, gap: 5 }}>
        {line('40%', 'rgba(255,255,255,0.7)', 4)}
        {line('65%', '#fff', 8)}
      </View>
      <Row gap={6} style={{ justifyContent: 'center' }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' }} />
        ))}
      </Row>
      <Row gap={6} style={{ alignItems: 'center' }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 7, borderColor: WALLET.accent, borderRightColor: WALLET.soft }} />
        <View style={{ flex: 1, gap: 4 }}>
          {line('90%', '#fff', 6)}
          {line('70%', '#fff', 6)}
        </View>
      </Row>
    </View>
  );
}

// ---------------------------------------------------------------- shared pieces

function QuickAction({ icon, label, onPress, bg, fg, labelColor }: { icon: IconName; label: string; onPress: () => void; bg: string; fg: string; labelColor?: string }) {
  const press = usePressScale(0.9);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={{ flex: 1, alignItems: 'center', gap: 6, minHeight: 76 }}>
      <Animated.View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', transform: [{ scale: press.scale }] }}>
        <Ionicons name={icon} size={23} color={fg} />
      </Animated.View>
      <Txt v="small" color={labelColor} style={{ textAlign: 'center', fontWeight: '600' }}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Lists that every style shows under its own header area. */
function CommonSections({ d, pending, accent }: { d: DashboardSummary; pending: number; accent: string }) {
  const t = useTheme();
  const money = (v: number) => fm(v, d);
  return (
    <>
      {d.missingRates && (
        <Card style={{ borderColor: t.warn }}>
          <Txt v="sub" color={t.warn}>
            Some businesses or invoices use a currency with no exchange rate, so they are left out of these totals. Add rates under Finance → Exchange rates.
          </Txt>
        </Card>
      )}
      {pending > 0 && (
        <FadeIn>
          <Card onPress={() => router.push('/recurring')} label="Recurring invoices awaiting approval" style={{ borderColor: t.warn }}>
            <Row gap={12}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="repeat" size={20} color={t.warn} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '700' }}>
                  {pending} recurring invoice{pending === 1 ? '' : 's'} awaiting approval
                </Txt>
                <Txt v="small">Created by your schedules as drafts. Review and finalize them.</Txt>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.sub} />
            </Row>
          </Card>
        </FadeIn>
      )}
      {(d.businesses?.length ?? 0) > 1 && (
        <Section title="By business">
          {d.businesses.map((b) => (
            <Card key={b.businessId}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>
                  {b.name}
                </Txt>
                <Txt style={{ fontWeight: '800' }}>{money(b.invoiced)}</Txt>
              </Row>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: t.neutralSoft, overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${d.totalInvoiced ? Math.max(2, (b.invoiced / d.totalInvoiced) * 100) : 0}%`, backgroundColor: accent }} />
              </View>
              <Txt v="small">
                Received {money(b.received)} · owed {money(b.outstanding)}
                {b.overdue ? ` · ${money(b.overdue)} overdue` : ''}
              </Txt>
            </Card>
          ))}
        </Section>
      )}
      {d.overdueClients.length > 0 && (
        <Section title="Overdue client payments">
          {d.overdueClients.slice(0, 5).map((c) => (
            <Card key={c.clientId} onPress={() => router.push({ pathname: '/client/[id]', params: { id: c.clientId } })} label={`${c.clientName} overdue`}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
                    {c.clientName}
                  </Txt>
                  <Txt v="small">Due since {fd(c.oldestDueDate)}</Txt>
                </View>
                <Txt style={{ fontWeight: '700' }} color={t.danger}>
                  {money(c.amount)}
                </Txt>
              </Row>
            </Card>
          ))}
        </Section>
      )}
      {d.upcomingInstallments.length > 0 && (
        <Section title="Upcoming installments" action={<Txt v="label" color={accent} onPress={() => router.push('/installments')}>See all</Txt>}>
          {d.upcomingInstallments.map((s) => (
            <InstallmentItem key={s.id} item={s} />
          ))}
        </Section>
      )}
    </>
  );
}

function StatusPills({ value, onChange, active, activeText, idle, idleText }: { value: string; onChange: (v: string) => void; active: string; activeText: string; idle: string; idleText: string }) {
  const t = useTheme();
  const opts = [
    { v: '', label: 'All', dot: '' },
    { v: 'paid', label: 'Paid', dot: t.success },
    { v: 'pending', label: 'Pending', dot: t.warn },
    { v: 'overdue', label: 'Overdue', dot: t.danger },
  ];
  return (
    <Row gap={8} style={{ flexWrap: 'wrap' }}>
      {opts.map((o) => {
        const on = value === o.v;
        return (
          <Pressable key={o.v} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(o.v)} style={{ minHeight: 38, paddingHorizontal: 14, borderRadius: 19, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? active : idle }}>
            {!!o.dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: o.dot }} />}
            <Text style={{ color: on ? activeText : idleText, fontWeight: '700', fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </Row>
  );
}

const matches = (i: Invoice, f: string) =>
  !f || (f === 'paid' ? i.displayStatus === 'paid' : f === 'overdue' ? i.displayStatus === 'overdue' : i.displayStatus === 'unpaid' || i.displayStatus === 'partially_paid');

// ---------------------------------------------------------------- 1. Monetra

function MonetraStyle({ d, pending }: { d: DashboardSummary; pending: number }) {
  const t = useTheme();
  const { can } = useAuth();
  const money = (v: number) => fm(v, d);
  const collectedPct = d.totalInvoiced > 0 ? Math.min(100, Math.round((d.totalReceived / d.totalInvoiced) * 100)) : 0;
  const tiles: { label: string; value: number; money?: boolean; icon: IconName; tone: string; soft: string; go?: string }[] = [
    { label: 'Total Invoiced', value: d.totalInvoiced, money: true, icon: 'document-text', tone: t.primary, soft: t.primarySoft },
    { label: 'Total Received', value: d.totalReceived, money: true, icon: 'checkmark-circle', tone: t.success, soft: t.successSoft },
    { label: 'Overdue Payments', value: d.overdue, money: true, icon: 'alert-circle', tone: t.danger, soft: t.dangerSoft, go: 'overdue' },
    { label: "This Month's Collections", value: d.monthCollections, money: true, icon: 'trending-up', tone: t.success, soft: t.successSoft },
    { label: 'Partially Paid Invoices', value: d.partiallyPaidCount, icon: 'pie-chart', tone: t.warn, soft: t.warnSoft, go: 'partially_paid' },
    { label: 'Unpaid Invoices', value: d.unpaidCount, icon: 'time', tone: t.info, soft: t.infoSoft, go: 'unpaid' },
  ];
  return (
    <>
      <FadeIn>
        <LinearGradient colors={['#0B46D6', '#0A6FD0', '#0E9E8A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 22, padding: 18, overflow: 'hidden' }}>
          <View pointerEvents="none" style={{ position: 'absolute', right: -40, top: -50, width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.10)' }} />
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700', letterSpacing: 0.6 }}>OUTSTANDING BALANCE</Text>
          <CountUp value={d.outstanding} format={money} style={{ color: '#fff', fontSize: 36, fontWeight: '800', letterSpacing: -0.6, marginTop: 2 }} />
          <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)', marginTop: 14, overflow: 'hidden' }}>
            <View style={{ width: `${collectedPct}%`, height: '100%', borderRadius: 4, backgroundColor: '#86EFAC' }} />
          </View>
          <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>{collectedPct}% of invoiced amount collected</Text>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Cash {money(d.cashBalance)}</Text>
          </Row>
        </LinearGradient>
      </FadeIn>
      <Row style={{ flexWrap: 'wrap', alignItems: 'stretch' }} gap={10}>
        {tiles.map((x, n) => (
          <FadeIn key={x.label} delay={60 + n * 50} style={{ flexBasis: '47%', flexGrow: 1 }}>
            <Card onPress={x.go ? () => router.push({ pathname: '/invoices', params: { status: x.go } }) : undefined} label={x.label} style={{ gap: 8 }}>
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: x.soft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={x.icon} size={18} color={x.tone} />
              </View>
              <View>
                <CountUp value={x.value} format={x.money ? money : String} style={{ fontSize: 18, fontWeight: '800', color: t.text }} />
                <Txt v="small">{x.label}</Txt>
              </View>
            </Card>
          </FadeIn>
        ))}
      </Row>
      <FadeIn delay={380}>
        <Card>
          <Row gap={4} style={{ alignItems: 'flex-start' }}>
            {can('invoices.create') && <QuickAction icon="document-text-outline" label="New Invoice" onPress={() => router.push('/invoice/new')} bg={t.primarySoft} fg={t.primary} />}
            {can('payments.record') && <QuickAction icon="cash-outline" label="Payment" onPress={() => router.push('/payment/new')} bg={t.primarySoft} fg={t.primary} />}
            <QuickAction icon="people-outline" label="Clients" onPress={() => router.push('/clients')} bg={t.primarySoft} fg={t.primary} />
            <QuickAction icon="wallet-outline" label="Accounts" onPress={() => router.push('/accounts')} bg={t.primarySoft} fg={t.primary} />
            <QuickAction icon="bar-chart-outline" label="Reports" onPress={() => router.push('/reports')} bg={t.primarySoft} fg={t.primary} />
          </Row>
        </Card>
      </FadeIn>
      <CommonSections d={d} pending={pending} accent={t.primary} />
      <Section title="Recent invoices" action={<Txt v="label" color={t.primary} onPress={() => router.push('/invoices')}>See all</Txt>}>
        {d.recentInvoices.length === 0 ? <Txt v="sub">No invoices yet. Tap + to create your first one.</Txt> : d.recentInvoices.map((i) => <InvoiceRow key={i.id} invoice={i} />)}
      </Section>
      {d.recentPayments.length > 0 && (
        <Section title="Recent payments" action={<Txt v="label" color={t.primary} onPress={() => router.push('/payments')}>See all</Txt>}>
          {d.recentPayments.map((p) => (
            <PaymentRow key={p.id} payment={p} />
          ))}
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- 2. Studio (clean white, purple bars)

function StudioStyle({ d, pending }: { d: DashboardSummary; pending: number }) {
  const t = useTheme();
  const [filter, setFilter] = useState('');
  const money = (v: number) => fm(v, d);
  const last7 = d.monthly.slice(-7);
  const thisYear = d.monthly.filter((m) => m.month.slice(0, 4) === d.monthly[d.monthly.length - 1].month.slice(0, 4)).reduce((a, m) => a + m.collected, 0);
  const prev6 = d.monthly.slice(0, 6).reduce((a, m) => a + m.collected, 0);
  const last6 = d.monthly.slice(6).reduce((a, m) => a + m.collected, 0);
  const change = pct(last6, prev6);
  const card = { backgroundColor: t.card, borderRadius: 22, padding: 16, gap: 10, borderWidth: 1, borderColor: t.border };
  const Tile = ({ label, count, value, color, ratio, go }: { label: string; count: number; value: number; color: string; ratio: number; go: string }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push({ pathname: '/invoices', params: { status: go } })} style={[card, { flexBasis: '47%', flexGrow: 1, gap: 8 }]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt v="small">{label}</Txt>
        <Txt v="small" color={color} style={{ fontWeight: '800' }}>
          {count}
        </Txt>
      </Row>
      <CountUp value={value} format={money} style={{ fontSize: 20, fontWeight: '800', color: t.text, letterSpacing: -0.4 }} />
      <View style={{ height: 5, borderRadius: 3, backgroundColor: t.neutralSoft, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${Math.max(4, Math.min(100, ratio * 100))}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
    </Pressable>
  );
  const total = Math.max(1, d.outstanding + d.monthCollections);
  return (
    <>
      <FadeIn>
        <View style={card}>
          <Txt v="small">Total revenue · {d.monthly[d.monthly.length - 1].month.slice(0, 4)}</Txt>
          <CountUp value={thisYear} format={money} style={{ fontSize: 34, fontWeight: '800', color: t.text, letterSpacing: -0.8 }} />
          {change !== null && (
            <Row gap={6}>
              <Ionicons name={change >= 0 ? 'trending-up' : 'trending-down'} size={16} color={change >= 0 ? t.success : t.danger} />
              <Txt v="small" color={change >= 0 ? t.success : t.danger} style={{ fontWeight: '800' }}>
                {Math.abs(change)}%
              </Txt>
              <Txt v="small">vs previous 6 months</Txt>
            </Row>
          )}
          <Bars values={last7.map((m) => m.collected)} labels={last7.map((m) => monthLabel(m.month))} color={STUDIO.accent} soft={t.dark ? '#3A3170' : STUDIO.soft} height={90} />
        </View>
      </FadeIn>
      <Row style={{ flexWrap: 'wrap' }} gap={10}>
        <Tile label="Total outstanding" count={d.unpaidCount + d.partiallyPaidCount} value={d.outstanding} color={STUDIO.accent} ratio={d.outstanding / total} go="outstanding" />
        <Tile label="Paid this month" count={d.paidCount} value={d.monthCollections} color={t.success} ratio={d.monthCollections / total} go="paid" />
        <Tile label="Pending" count={d.unpaidCount} value={Math.max(0, d.outstanding - d.overdue)} color={t.warn} ratio={(d.outstanding - d.overdue) / total} go="unpaid" />
        <Tile label="Overdue" count={d.overdueCount} value={d.overdue} color={t.danger} ratio={d.overdue / total} go="overdue" />
      </Row>
      <CommonSections d={d} pending={pending} accent={STUDIO.accent} />
      <Section title="Recent invoices" action={<Txt v="label" color={STUDIO.accent} onPress={() => router.push('/invoices')}>View all</Txt>}>
        <StatusPills value={filter} onChange={setFilter} active={t.dark ? '#fff' : STUDIO.ink} activeText={t.dark ? STUDIO.ink : '#fff'} idle={t.card} idleText={t.sub} />
        {d.recentInvoices.filter((i) => matches(i, filter)).map((i) => (
          <InvoiceRow key={i.id} invoice={i} />
        ))}
        {d.recentInvoices.filter((i) => matches(i, filter)).length === 0 && <Txt v="sub">No recent invoices here.</Txt>}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- 3. Emerald report (dark green report card and trend line)

function EmeraldStyle({ d, pending }: { d: DashboardSummary; pending: number }) {
  const t = useTheme();
  const money = (v: number) => fm(v, d);
  const now = d.monthly[d.monthly.length - 1];
  const prev = d.monthly[d.monthly.length - 2];
  const monthName = new Date(`${now.month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const last7 = d.monthly.slice(-7);
  const col = pct(now.collected, prev?.collected ?? 0);
  return (
    <>
      <FadeIn>
        <LinearGradient colors={[EMERALD.deep, EMERALD.mid]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 22, padding: 18, gap: 14, overflow: 'hidden' }}>
          <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0, width: 120, height: 80, backgroundColor: 'rgba(255,255,255,0.05)', borderBottomLeftRadius: 40 }} />
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', lineHeight: 28 }}>{monthName} Invoices{'\n'}Report</Text>
          <Row gap={14}>
            {[
              { label: 'Paid', value: d.paidCount, change: col },
              { label: 'Unpaid', value: d.unpaidCount + d.partiallyPaidCount, change: null as number | null },
              { label: 'Overdue', value: d.overdueCount, change: null },
            ].map((x) => (
              <View key={x.label} style={{ flex: 1 }}>
                <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>{x.label}</Text>
                <Row gap={6} style={{ alignItems: 'baseline' }}>
                  <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{x.value}</Text>
                  {x.change !== null && <Text style={{ color: EMERALD.line, fontSize: 12, fontWeight: '700' }}>{x.change >= 0 ? '+' : ''}{x.change}%</Text>}
                </Row>
              </View>
            ))}
          </Row>
        </LinearGradient>
      </FadeIn>
      <FadeIn delay={80}>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <CountUp value={d.totalReceived} format={money} style={{ fontSize: 26, fontWeight: '800', color: t.text }} />
              <Txt v="small">Received</Txt>
            </View>
            <Badge status="paid" label="Monthly" />
          </Row>
          <AreaLine values={last7.map((m) => m.collected)} labels={last7.map((m) => monthLabel(m.month))} color={EMERALD.line} height={120} />
        </Card>
      </FadeIn>
      <FadeIn delay={140}>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="h">Invoiced by month</Txt>
            <Txt v="small" style={{ fontWeight: '700' }}>
              Paid {money(d.monthCollections)}
            </Txt>
          </Row>
          <Bars values={last7.map((m) => m.invoiced)} labels={last7.map((m) => monthLabel(m.month))} color={t.dark ? EMERALD.line : EMERALD.deep} soft={t.dark ? '#24493F' : '#8DB3A6'} height={100} />
        </Card>
      </FadeIn>
      <FadeIn delay={200}>
        <View style={{ flexDirection: 'row', backgroundColor: EMERALD.deep, borderRadius: 18, padding: 14 }}>
          {[
            { n: d.paidCount, l: 'Paid', go: 'paid' },
            { n: d.unpaidCount, l: 'Unpaid', go: 'unpaid' },
            { n: d.overdueCount, l: 'Over due', go: 'overdue' },
            { n: d.draftCount, l: 'Draft', go: 'draft' },
          ].map((x, i) => (
            <Pressable key={x.l} accessibilityRole="button" accessibilityLabel={`${x.n} ${x.l}`} onPress={() => router.push({ pathname: '/invoices', params: { status: x.go } })} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.15)' }}>
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{String(x.n).padStart(2, '0')}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>{x.l}</Text>
            </Pressable>
          ))}
        </View>
      </FadeIn>
      <CommonSections d={d} pending={pending} accent={EMERALD.accent} />
      <Section title="Invoices" action={<Txt v="label" color={EMERALD.accent} onPress={() => router.push('/invoices')}>All</Txt>}>
        {d.recentInvoices.map((i) => (
          <Card key={i.id} onPress={() => router.push(i.status === 'draft' ? { pathname: '/invoice/new', params: { id: i.id } } : { pathname: '/invoice/[id]', params: { id: i.id } })} label={`Invoice for ${i.clientName}`}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row gap={10} style={{ flex: 1 }}>
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: EMERALD.soft, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: EMERALD.deep, fontWeight: '800' }}>{i.clientName.slice(0, 1).toUpperCase()}</Text>
                </View>
                <Txt style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>
                  {i.clientName}
                </Txt>
              </Row>
              <Badge status={i.displayStatus} />
            </Row>
            <View style={{ flexDirection: 'row', backgroundColor: t.neutralSoft, borderRadius: 12, padding: 10 }}>
              {[
                ['Amount', fm(i.total, i)],
                ['No', i.number ?? 'Draft'],
                ['Date', fd(i.issueDate)],
              ].map(([k, v]) => (
                <View key={k} style={{ flex: 1 }}>
                  <Txt v="small">{k}</Txt>
                  <Txt v="sub" color={t.text} style={{ fontWeight: '700' }} numberOfLines={1}>
                    {v}
                  </Txt>
                </View>
              ))}
            </View>
          </Card>
        ))}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- 4. Wallet (balance, actions, spending ring)

const RING = ['#2F6B4F', '#5E9C7B', '#94C3A8', '#C9E1D3', '#E8B04A', '#D96B4A'];

function WalletStyle({ d, pending }: { d: DashboardSummary; pending: number }) {
  const t = useTheme();
  const { can } = useAuth();
  const [hidden, setHidden] = useState(false);
  const money = (v: number) => fm(v, d);
  const now = d.monthly[d.monthly.length - 1];
  const prev = d.monthly[d.monthly.length - 2];
  const change = pct(now.collected, prev?.collected ?? 0);
  const spend = d.expenseMix.slice(0, 5);
  const spentTotal = d.expenseMix.reduce((a, x) => a + x.amount, 0);
  const last6 = d.monthly.slice(-6);
  return (
    <>
      <FadeIn>
        <View style={{ backgroundColor: WALLET.deep, borderRadius: 24, padding: 18, gap: 10, overflow: 'hidden' }}>
          <View pointerEvents="none" style={{ position: 'absolute', right: -30, bottom: -60, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.06)' }} />
          <Row style={{ justifyContent: 'space-between' }}>
            <Row gap={8}>
              <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="wallet" size={14} color="#fff" />
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' }}>Total balance</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Show balance' : 'Hide balance'} hitSlop={10} onPress={() => setHidden(!hidden)}>
                <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={18} color="rgba(255,255,255,0.85)" />
              </Pressable>
            </Row>
            <Ionicons name="stats-chart" size={18} color="rgba(255,255,255,0.85)" onPress={() => router.push('/accounts')} />
          </Row>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            {hidden ? (
              <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: 4 }}>••••••</Text>
            ) : (
              <CountUp value={d.cashBalance} format={money} style={{ color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: -0.6 }} />
            )}
            {change !== null && (
              <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)' }}>
                <Text style={{ color: '#CFF5DF', fontSize: 12, fontWeight: '800' }}>
                  {change >= 0 ? '▲' : '▼'} {Math.abs(change)}%
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10 }}>vs last month</Text>
              </View>
            )}
          </Row>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>Clients owe you {hidden ? '••••' : money(d.outstanding)}</Text>
        </View>
      </FadeIn>
      <FadeIn delay={60}>
        <Row gap={4}>
          {can('payments.record') && <QuickAction icon="add" label="Add money" onPress={() => router.push('/payment/new')} bg={t.card} fg={WALLET.deep} />}
          {can('invoices.create') && <QuickAction icon="paper-plane-outline" label="Invoice" onPress={() => router.push('/invoice/new')} bg={t.card} fg={WALLET.deep} />}
          <QuickAction icon="swap-horizontal" label="Transfer" onPress={() => router.push('/accounts')} bg={WALLET.deep} fg="#fff" />
          <QuickAction icon="ellipsis-horizontal" label="More" onPress={() => router.push('/more')} bg={t.card} fg={WALLET.deep} />
        </Row>
      </FadeIn>
      <FadeIn delay={120}>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="h">Recent transactions</Txt>
            <Txt v="label" color={WALLET.accent} onPress={() => router.push('/finance')}>
              See all →
            </Txt>
          </Row>
          {d.recentPayments.length === 0 && <Txt v="sub">No money received yet.</Txt>}
          {d.recentPayments.map((p) => (
            <Pressable key={p.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/payment/[id]', params: { id: p.id } })}>
              <Row gap={12} style={{ paddingVertical: 6 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: WALLET.soft, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="arrow-down" size={18} color={WALLET.deep} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
                    {p.clientName}
                  </Txt>
                  <Txt v="small">{PAYMENT_METHOD_LABELS[p.method]}</Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt style={{ fontWeight: '800' }} color={t.success}>
                    + {fm(p.amount, p)}
                  </Txt>
                  <Txt v="small">{fd(p.date)}</Txt>
                </View>
              </Row>
            </Pressable>
          ))}
        </Card>
      </FadeIn>
      <FadeIn delay={180}>
        <Card>
          <Txt v="h">Your spending</Txt>
          {spentTotal === 0 ? (
            <Txt v="sub">No expenses recorded in this period. Add them from Finance → Money out.</Txt>
          ) : (
            <Row gap={16}>
              <Donut segments={spend.map((s, i) => ({ value: s.amount, color: RING[i] }))} track={t.neutralSoft} size={140} stroke={18}>
                <Txt v="small">Total spent</Txt>
                <Txt style={{ fontWeight: '800' }}>{money(spentTotal)}</Txt>
              </Donut>
              <View style={{ flex: 1, gap: 6 }}>
                {spend.map((s, i) => (
                  <Row key={s.category} gap={6}>
                    <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: RING[i] }} />
                    <Txt v="small" style={{ flex: 1 }} numberOfLines={1}>
                      {s.category}
                    </Txt>
                    <Txt v="small" color={t.text} style={{ fontWeight: '700' }}>
                      {Math.round((s.amount / spentTotal) * 100)}%
                    </Txt>
                  </Row>
                ))}
              </View>
            </Row>
          )}
        </Card>
      </FadeIn>
      <FadeIn delay={240}>
        <Card>
          <Txt v="h">Spending trend</Txt>
          <Bars values={last6.map((m) => m.expenses)} labels={last6.map((m) => monthLabel(m.month))} color={WALLET.deep} soft={t.dark ? '#2C4A3C' : '#A9C7B5'} height={90} />
        </Card>
      </FadeIn>
      <CommonSections d={d} pending={pending} accent={WALLET.accent} />
      <Section title="Recent invoices">
        {d.recentInvoices.map((i) => (
          <InvoiceRow key={i.id} invoice={i} />
        ))}
      </Section>
    </>
  );
}

export function DashboardView({ style, d, pending }: { style: DashboardStyle; d: DashboardSummary; pending: number }): ReactNode {
  if (style === 'minimal') return <StudioStyle d={d} pending={pending} />;
  if (style === 'emerald') return <EmeraldStyle d={d} pending={pending} />;
  if (style === 'wallet') return <WalletStyle d={d} pending={pending} />;
  return <MonetraStyle d={d} pending={pending} />;
}
