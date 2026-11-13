import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Bars, monthLabel } from '@/components/charts';
import { AccountIcon } from '@/components/money';
import { Card, Chips, CountUp, DateField, Empty, FadeIn, Gradient, KV, Loader, Notice, Row, Screen, Section, Select, Txt, addDays, fd, fm, isDate, todayStr } from '@/components/ui';
import { qs, useApi } from '@/lib/api';
import { useTheme } from '@/lib/app-context';
import { percentToString, type BusinessProfile, type CashFlow, type ProfitLoss } from '@/lib/shared';

type Period = 'month' | 'last_month' | 'quarter' | 'year' | 'fy' | 'custom';
type Tab = 'pnl' | 'cashflow';

function periodRange(p: Period, custom: { from: string; to: string }, fyStart: number) {
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
  if (p === 'fy') return { from: `${m >= fyStart ? y : y - 1}-${pad(fyStart)}-01`, to: t };
  return custom;
}

function Line({ label, value, tone, bold }: { label: string; value: string; tone?: string; bold?: boolean }) {
  return <KV k={label} v={value} color={tone} bold={bold} />;
}

export default function Statements() {
  const t = useTheme();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'pnl');
  const [period, setPeriod] = useState<Period>('month');
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual');
  const [custom, setCustom] = useState({ from: addDays(todayStr(), -90), to: todayStr() });
  const [businessId, setBusinessId] = useState('');
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const biz = businesses.data?.find((b) => b.id === businessId) ?? businesses.data?.[0];
  const range = periodRange(period, custom, biz?.fyStartMonth ?? 7);
  const valid = isDate(range.from) && isDate(range.to) && range.from <= range.to;
  const q = qs({ ...range, businessId, basis });
  const pnl = useApi<ProfitLoss & { missingRates: boolean }>(valid && tab === 'pnl' ? `/reports/pnl${q}` : null);
  const flow = useApi<CashFlow & { missingRates: boolean }>(valid && tab === 'cashflow' ? `/reports/cashflow${q}` : null);
  const active = tab === 'pnl' ? pnl : flow;
  const money = (v: number) => fm(v, active.data);
  const multi = (businesses.data?.length ?? 0) > 1;

  return (
    <Screen onRefresh={active.reload} refreshing={active.refreshing}>
      <Chips
        value={tab}
        onChange={setTab}
        options={[
          { value: 'pnl', label: 'Profit & Loss' },
          { value: 'cashflow', label: 'Cash Flow' },
        ]}
      />
      <Chips
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'month', label: 'This month' },
          { value: 'last_month', label: 'Last month' },
          { value: 'quarter', label: 'This quarter' },
          { value: 'fy', label: 'Financial year' },
          { value: 'year', label: 'Calendar year' },
          { value: 'custom', label: 'Custom' },
        ]}
      />
      {period === 'custom' && (
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <DateField label="From" value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="To" value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} />
          </View>
        </Row>
      )}
      {multi && (
        <Select
          label="Business"
          value={businessId ? (biz?.tradingName || biz?.legalName) ?? '' : 'All businesses (combined)'}
          placeholder="All businesses"
          items={[{ id: '', legalName: 'All businesses (combined)', tradingName: '' } as BusinessProfile, ...(businesses.data ?? [])]}
          getKey={(b) => b.id || 'all'}
          getLabel={(b) => b.tradingName || b.legalName}
          onSelect={(b) => setBusinessId(b.id)}
        />
      )}
      {tab === 'pnl' && (
        <Chips
          value={basis}
          onChange={setBasis}
          options={[
            { value: 'accrual', label: 'Invoiced (accrual)' },
            { value: 'cash', label: 'Received (cash)' },
          ]}
        />
      )}
      <Txt v="small">{valid ? `${fd(range.from)} – ${fd(range.to)}` : 'Choose a valid period'}</Txt>

      <Loader loading={active.loading && !active.data} error={active.data ? '' : active.error} onRetry={active.reload}>
        {active.data?.missingRates && <Notice kind="warn">Some amounts are in a currency with no exchange rate and were left out. Add the rate under Finance → Exchange rates.</Notice>}

        {tab === 'pnl' && pnl.data && (
          <>
            <FadeIn>
              <Gradient>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700', letterSpacing: 0.6 }}>{pnl.data.netProfit >= 0 ? 'NET PROFIT' : 'NET LOSS'}</Text>
                <CountUp value={pnl.data.netProfit} format={money} style={{ color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 2 }} />
                <Row gap={8} style={{ marginTop: 8 }}>
                  <Ionicons name={pnl.data.netProfit >= 0 ? 'trending-up' : 'trending-down'} size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{percentToString(pnl.data.marginBp)}% margin on {money(pnl.data.totalIncome)} income</Text>
                </Row>
              </Gradient>
            </FadeIn>
            {pnl.data.monthly.length > 1 && (
              <Card>
                <Txt v="h">Profit by month</Txt>
                <Bars values={pnl.data.monthly.map((x) => Math.max(0, x.profit))} labels={pnl.data.monthly.map((x) => monthLabel(x.month))} color={t.success} soft={t.successSoft} height={100} />
              </Card>
            )}
            <Card>
              <Txt v="h">Income</Txt>
              {pnl.data.income.length === 0 && <Txt v="sub">No income in this period.</Txt>}
              {pnl.data.income.map((x) => (
                <Line key={x.label} label={x.label} value={money(x.amount)} />
              ))}
              <Line label="Total income" value={money(pnl.data.totalIncome)} bold tone={t.success} />
            </Card>
            <Card>
              <Txt v="h">Expenses</Txt>
              {pnl.data.expenses.length === 0 && <Txt v="sub">No expenses recorded in this period.</Txt>}
              {pnl.data.expenses.map((x) => (
                <Line key={x.label} label={x.label} value={money(x.amount)} />
              ))}
              <Line label="Total expenses" value={money(pnl.data.totalExpenses)} bold tone={t.danger} />
            </Card>
            <Card>
              <Line label="Net profit" value={money(pnl.data.netProfit)} bold tone={pnl.data.netProfit >= 0 ? t.success : t.danger} />
              {pnl.data.basis === 'accrual' && <Line label="Tax collected (owed to government, not income)" value={money(pnl.data.taxCollected)} />}
            </Card>
            <Txt v="small">
              {pnl.data.basis === 'accrual' ? 'Invoiced basis: income is counted when invoices are issued, before tax.' : 'Cash basis: income is counted when payments are received.'} Owner withdrawals are not counted as expenses.
            </Txt>
          </>
        )}

        {tab === 'cashflow' && flow.data && (
          <>
            <FadeIn>
              <Card>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View>
                    <Txt v="small">Opening cash</Txt>
                    <Txt style={{ fontWeight: '800' }}>{money(flow.data.opening)}</Txt>
                  </View>
                  <Ionicons name="arrow-forward" size={18} color={t.sub} />
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt v="small">Closing cash</Txt>
                    <CountUp value={flow.data.closing} format={money} style={{ fontSize: 22, fontWeight: '800', color: t.text }} />
                  </View>
                </Row>
                <Line label="Net change" value={`${flow.data.totalIn - flow.data.totalOut >= 0 ? '+' : '−'} ${money(Math.abs(flow.data.totalIn - flow.data.totalOut))}`} bold tone={flow.data.totalIn >= flow.data.totalOut ? t.success : t.danger} />
              </Card>
            </FadeIn>
            {flow.data.monthly.length > 0 && (
              <Card>
                <Txt v="h">Money in vs out</Txt>
                {flow.data.monthly.map((x) => (
                  <View key={x.month} style={{ gap: 4, paddingVertical: 4 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Txt v="sub" color={t.text} style={{ fontWeight: '700' }}>
                        {monthLabel(x.month)} {x.month.slice(0, 4)}
                      </Txt>
                      <Txt v="small">closing {money(x.closing)}</Txt>
                    </Row>
                    <Bar ratio={x.moneyIn / Math.max(1, ...flow.data!.monthly.flatMap((y) => [y.moneyIn, y.moneyOut]))} color={t.success} label={`+ ${money(x.moneyIn)}`} />
                    <Bar ratio={x.moneyOut / Math.max(1, ...flow.data!.monthly.flatMap((y) => [y.moneyIn, y.moneyOut]))} color={t.danger} label={`− ${money(x.moneyOut)}`} />
                  </View>
                ))}
              </Card>
            )}
            <Card>
              <Txt v="h">Where money came from</Txt>
              {flow.data.inflows.length === 0 && <Txt v="sub">Nothing came in.</Txt>}
              {flow.data.inflows.map((x) => (
                <Line key={x.label} label={x.label} value={money(x.amount)} />
              ))}
              <Line label="Total in" value={money(flow.data.totalIn)} bold tone={t.success} />
            </Card>
            <Card>
              <Txt v="h">Where money went</Txt>
              {flow.data.outflows.length === 0 && <Txt v="sub">Nothing went out.</Txt>}
              {flow.data.outflows.map((x) => (
                <Line key={x.label} label={x.label} value={money(x.amount)} />
              ))}
              <Line label="Total out" value={money(flow.data.totalOut)} bold tone={t.danger} />
            </Card>
            <Section title="By account">
              {flow.data.accounts.length === 0 && <Empty icon="wallet-outline" title="No accounts" />}
              {flow.data.accounts.map((a) => (
                <Card key={a.accountId}>
                  <Row gap={12}>
                    <AccountIcon type={a.type} size={36} />
                    <Txt style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>
                      {a.name}
                    </Txt>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Txt style={{ fontWeight: '800' }}>{money(a.closing)}</Txt>
                      <Txt v="small">from {money(a.opening)}</Txt>
                    </View>
                  </Row>
                </Card>
              ))}
            </Section>
            <Txt v="small">Transfers between your own accounts are not counted as money in or out.</Txt>
          </>
        )}
      </Loader>
    </Screen>
  );
}

function Bar({ ratio, color, label }: { ratio: number; color: string; label: string }) {
  const t = useTheme();
  return (
    <Row gap={8}>
      <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: t.neutralSoft, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(1, Math.min(100, ratio * 100))}%`, height: '100%', backgroundColor: color, borderRadius: 5 }} />
      </View>
      <Txt v="small" style={{ width: 110, textAlign: 'right' }}>
        {label}
      </Txt>
    </Row>
  );
}
