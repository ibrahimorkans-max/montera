import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AccountIcon } from '@/components/money';
import { Card, Chips, CountUp, DateField, Empty, FadeIn, KV, Loader, Row, Screen, Select, Txt, addDays, fd, fm, isDate, todayStr } from '@/components/ui';
import { qs, useApi } from '@/lib/api';
import { useTheme } from '@/lib/app-context';
import type { BusinessProfile, Cashbook as CashbookData, MoneyAccount, Movement } from '@/lib/shared';

type Range = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

function rangeOf(r: Range, custom: { from: string; to: string }) {
  const t = todayStr();
  if (r === 'today') return { from: t, to: t };
  if (r === 'yesterday') return { from: addDays(t, -1), to: addDays(t, -1) };
  if (r === 'week') return { from: addDays(t, -6), to: t };
  if (r === 'month') return { from: `${t.slice(0, 7)}-01`, to: t };
  return custom;
}

const KIND_ICON: Record<Movement['kind'], React.ComponentProps<typeof Ionicons>['name']> = {
  opening: 'flag-outline',
  payment: 'arrow-down',
  income: 'arrow-down',
  expense: 'arrow-up',
  transfer_in: 'swap-vertical',
  transfer_out: 'swap-vertical',
  refund: 'return-up-back',
};

export default function Cashbook() {
  const t = useTheme();
  const params = useLocalSearchParams<{ accountId?: string }>();
  const [range, setRange] = useState<Range>('today');
  const [custom, setCustom] = useState({ from: addDays(todayStr(), -30), to: todayStr() });
  const [accountId, setAccountId] = useState(params.accountId ?? '');
  const [businessId, setBusinessId] = useState('');
  const r = rangeOf(range, custom);
  const valid = isDate(r.from) && isDate(r.to) && r.from <= r.to;
  const accounts = useApi<MoneyAccount[]>('/accounts');
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const { data: book, loading, error, reload, refreshing } = useApi<CashbookData>(valid ? `/cashbook${qs({ ...r, accountId, businessId: accountId ? undefined : businessId })}` : null);
  const account = accounts.data?.find((a) => a.id === accountId);
  const m = (v: number) => fm(v, book);

  const allLabel = 'All accounts (business currency)';
  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: account ? `Cashbook · ${account.name}` : 'Daily Cashbook' }} />
      <Chips
        value={range}
        onChange={setRange}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'yesterday', label: 'Yesterday' },
          { value: 'week', label: 'Last 7 days' },
          { value: 'month', label: 'This month' },
          { value: 'custom', label: 'Custom' },
        ]}
      />
      {range === 'custom' && (
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <DateField label="From" value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="To" value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} />
          </View>
        </Row>
      )}
      <Select
        label="Account"
        value={account ? account.name : allLabel}
        placeholder={allLabel}
        items={[{ id: '', name: allLabel } as MoneyAccount, ...(accounts.data ?? [])]}
        getKey={(a) => a.id || 'all'}
        getLabel={(a) => a.name}
        getSub={(a) => (a.id ? `${a.currency} · balance ${fm(a.balance, a)}` : 'Cash, bank and wallets together')}
        onSelect={(a) => setAccountId(a.id)}
      />
      {!accountId && (businesses.data?.length ?? 0) > 1 && (
        <Select
          label="Business"
          value={businesses.data?.find((b) => b.id === businessId)?.legalName ?? businesses.data?.[0]?.legalName ?? ''}
          placeholder="Choose business"
          items={businesses.data ?? []}
          getKey={(b) => b.id}
          getLabel={(b) => b.tradingName || b.legalName}
          onSelect={(b) => setBusinessId(b.id)}
        />
      )}

      <Loader loading={loading && !book} error={book ? '' : error} onRetry={reload}>
        {book && (
          <>
            <FadeIn>
              <Card>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View>
                    <Txt v="small">Opening {fd(book.from)}</Txt>
                    <Txt style={{ fontWeight: '800' }}>{m(book.opening)}</Txt>
                  </View>
                  <Ionicons name="arrow-forward" size={18} color={t.sub} />
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt v="small">Closing {fd(book.to)}</Txt>
                    <CountUp value={book.closing} format={m} style={{ fontSize: 20, fontWeight: '800', color: t.text }} />
                  </View>
                </Row>
                <Row gap={10}>
                  <View style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: t.successSoft }}>
                    <Txt v="small" color={t.success}>
                      Money in
                    </Txt>
                    <Txt style={{ fontWeight: '800' }} color={t.success}>
                      + {m(book.moneyIn)}
                    </Txt>
                  </View>
                  <View style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: t.dangerSoft }}>
                    <Txt v="small" color={t.danger}>
                      Money out
                    </Txt>
                    <Txt style={{ fontWeight: '800' }} color={t.danger}>
                      − {m(book.moneyOut)}
                    </Txt>
                  </View>
                </Row>
              </Card>
            </FadeIn>

            {book.days.length === 0 ? (
              <Empty icon="book-outline" title="No money moved in this period" hint={`Balance stayed at ${m(book.closing)}.`} />
            ) : (
              book.days.map((day, n) => (
                <FadeIn key={day.date} delay={n * 50}>
                  <Card>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Txt v="h">{fd(day.date)}</Txt>
                      <Txt v="small">
                        {m(day.opening)} → <Txt v="small" color={t.text} style={{ fontWeight: '800' }}>{m(day.closing)}</Txt>
                      </Txt>
                    </Row>
                    {day.lines.map((l) => {
                      const isIn = l.moneyIn > 0;
                      const tone = isIn ? t.success : t.danger;
                      const open = () => {
                        if (l.kind === 'payment' && l.refId) router.push({ pathname: '/payment/[id]', params: { id: l.refId } });
                      };
                      return (
                        <Row key={l.id} gap={10} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: t.border }}>
                          {accountId ? (
                            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: isIn ? t.successSoft : t.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
                              <Ionicons name={KIND_ICON[l.kind]} size={15} color={tone} />
                            </View>
                          ) : (
                            <AccountIcon type={accounts.data?.find((a) => a.id === l.accountId)?.type ?? 'cash'} size={32} />
                          )}
                          <View style={{ flex: 1 }}>
                            <Txt v="sub" color={t.text} style={{ fontWeight: '600' }} numberOfLines={1} onPress={l.kind === 'payment' ? open : undefined}>
                              {l.label}
                            </Txt>
                            <Txt v="small" numberOfLines={1}>
                              {[l.party, accountId ? '' : l.accountName].filter(Boolean).join(' · ') || ' '}
                            </Txt>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Txt v="sub" color={tone} style={{ fontWeight: '800' }}>
                              {isIn ? '+' : '−'} {m(isIn ? l.moneyIn : l.moneyOut)}
                            </Txt>
                            <Txt v="small">{m(l.balance)}</Txt>
                          </View>
                        </Row>
                      );
                    })}
                    <KV k="Day total" v={`+ ${m(day.moneyIn)}  /  − ${m(day.moneyOut)}`} />
                  </Card>
                </FadeIn>
              ))
            )}
          </>
        )}
      </Loader>
    </Screen>
  );
}
