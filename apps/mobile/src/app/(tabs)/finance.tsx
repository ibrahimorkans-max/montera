import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Animated, Easing, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { AccountIcon, AccountSelect, TransferSheet } from '@/components/money';
import { pickImage } from '@/lib/image';
import { Btn, Card, Chips, CountUp, DateField, Empty, FadeIn, Field, Gradient, Loader, Row, Screen, Section, Select, Sheet, Txt, addDays, confirm, fd, fm, isDate, todayStr } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  moneyToInput,
  parseMoney,
  type BusinessProfile,
  type FinanceEntry,
  type FinanceSummary,
  type MoneyAccount,
  type PaymentMethod,
} from '@/lib/shared';

type Range = 'month' | '30d' | 'year' | 'all';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function rangeDates(r: Range): { from?: string; to?: string } {
  const today = todayStr();
  if (r === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (r === '30d') return { from: addDays(today, -30), to: today };
  if (r === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return {};
}

/** A bar that grows to its height when it appears or changes. */
function GrowBar({ ratio, color, max = 110 }: { ratio: number; color: string; max?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: ratio, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [ratio, v]);
  return <Animated.View style={{ width: 12, borderRadius: 6, backgroundColor: color, height: v.interpolate({ inputRange: [0, 1], outputRange: [3, max] }) }} />;
}

function Breakdown({ title, rows, total, color, money }: { title: string; rows: { category: string; amount: number }[]; total: number; color: string; money: (v: number) => string }) {
  const t = useTheme();
  return (
    <Card>
      <Txt v="h">{title}</Txt>
      {rows.length === 0 && <Txt v="sub">Nothing recorded in this period.</Txt>}
      {rows.map((r) => {
        const pct = total > 0 ? Math.round((r.amount / total) * 100) : 0;
        return (
          <View key={r.category} style={{ gap: 4, paddingVertical: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt v="sub" color={t.text} style={{ fontWeight: '600', flex: 1 }} numberOfLines={1}>
                {r.category}
              </Txt>
              <Txt v="sub" color={t.text}>
                {money(r.amount)} · {pct}%
              </Txt>
            </Row>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: t.neutralSoft, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(pct, 2)}%`, height: '100%', borderRadius: 4, backgroundColor: color }} />
            </View>
          </View>
        );
      })}
    </Card>
  );
}

interface Form {
  id?: string;
  type: 'income' | 'expense';
  category: string;
  amount: string;
  date: string;
  method: PaymentMethod;
  party: string;
  notes: string;
  businessId: string;
  accountId: string;
  attachment: string;
}

export default function Finance() {
  const t = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const [range, setRange] = useState<Range>('month');
  const [filter, setFilter] = useState<'' | 'income' | 'expense'>('');
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const dates = rangeDates(range);
  const summary = useApi<FinanceSummary>(`/finance/summary${qs(dates)}`);
  const entries = useApi<FinanceEntry[]>(`/finance/entries${qs({ ...dates, type: filter, limit: 100 })}`);
  const accounts = useApi<MoneyAccount[]>('/accounts');
  const usedCategories = useApi<{ income: string[]; expense: string[] }>('/finance/categories');
  const [transfer, setTransfer] = useState(false);
  const s = summary.data;
  const money = (v: number) => fm(v, s);
  const manage = can('finance.manage');
  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));
  const reload = () => {
    summary.reload();
    entries.reload();
    accounts.reload();
    usedCategories.reload();
  };

  const open = (type: 'income' | 'expense') =>
    setForm({ type, category: '', amount: '', date: todayStr(), method: 'cash', party: '', notes: '', businessId: businesses.data?.[0]?.id ?? '', accountId: '', attachment: '' });
  const edit = (e: FinanceEntry) =>
    setForm({ id: e.id, type: e.type, category: e.category, amount: moneyToInput(e.amount, s?.currencyPrecision ?? 2), date: e.date, method: e.method, party: e.party, notes: e.notes, businessId: e.businessId, accountId: e.accountId ?? '', attachment: '' });

  async function save() {
    if (!form) return;
    const amount = parseMoney(form.amount, s?.currencyPrecision ?? 2);
    if (!amount || amount <= 0) return toast('Enter the amount', 'error');
    if (!form.category.trim()) return toast('Choose a category', 'error');
    if (!isDate(form.date)) return toast('Enter a valid date', 'error');
    // the form may have opened before the business list loaded; with one business there is no picker
    const businessId = form.businessId || (businesses.data?.length === 1 ? businesses.data[0].id : '');
    if (!businessId) return toast('Choose a business', 'error');
    setBusy(true);
    try {
      const { id, amount: _typed, accountId, ...rest } = { ...form, businessId };
      await api(id ? `/finance/entries/${id}` : '/finance/entries', { method: id ? 'PUT' : 'POST', body: { ...rest, accountId: accountId || null, category: form.category.trim(), amount } });
      toast(form.type === 'income' ? 'Money in recorded' : 'Money out recorded');
      setForm(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!form?.id) return;
    if (!(await confirm('Delete this entry?', 'It will be removed from your money in / money out record.', 'Delete'))) return;
    try {
      await api(`/finance/entries/${form.id}`, { method: 'DELETE' });
      toast('Entry deleted');
      setForm(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  const peak = Math.max(1, ...(s?.monthly ?? []).flatMap((m) => [m.income, m.expense]));
  const used = form?.type === 'income' ? usedCategories.data?.income : usedCategories.data?.expense;
  const defaults: readonly string[] = form?.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  // the built-in list, then every category typed in before (so a custom one only has to be typed once)
  const categories = [...defaults, ...(used ?? []).filter((c) => !defaults.includes(c))];

  return (
    <Screen onRefresh={reload} refreshing={summary.refreshing}>
      <View style={{ paddingTop: 0 }}>
        <Txt v="title">Finance</Txt>
        <Txt v="sub">Where your money comes from and where it is used.</Txt>
      </View>
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
              <Gradient>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' }}>NET CASH FLOW</Text>
                <CountUp value={s.net} format={money} style={{ color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: -0.5, marginTop: 2 }} />
                <Row gap={10} style={{ marginTop: 14 }}>
                  <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 16, padding: 12 }}>
                    <Row gap={6}>
                      <Ionicons name="arrow-down-circle" size={18} color="#86EFAC" />
                      <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12.5, fontWeight: '600' }}>Money in</Text>
                    </Row>
                    <CountUp value={s.income} format={money} style={{ color: '#fff', fontSize: 17, fontWeight: '800', marginTop: 4 }} />
                  </View>
                  <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 16, padding: 12 }}>
                    <Row gap={6}>
                      <Ionicons name="arrow-up-circle" size={18} color="#FDA4AF" />
                      <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12.5, fontWeight: '600' }}>Money out</Text>
                    </Row>
                    <CountUp value={s.expense} format={money} style={{ color: '#fff', fontSize: 17, fontWeight: '800', marginTop: 4 }} />
                  </View>
                </Row>
              </Gradient>
            </FadeIn>

            {manage && (
              <FadeIn delay={80}>
                <Row gap={10}>
                  <Btn style={{ flex: 1 }} kind="secondary" icon="add-circle-outline" title="Money in" onPress={() => open('income')} />
                  <Btn style={{ flex: 1 }} kind="secondary" icon="remove-circle-outline" title="Money out" onPress={() => open('expense')} />
                </Row>
              </FadeIn>
            )}

            <FadeIn delay={110}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 6 }}>
                {(accounts.data ?? []).map((a) => (
                  <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`${a.name} ${fm(a.balance, a)}`} onPress={() => router.push({ pathname: '/cashbook', params: { accountId: a.id } })}>
                    <Card style={{ width: 160, gap: 6 }}>
                      <AccountIcon type={a.type} size={34} />
                      <Txt v="small" numberOfLines={1}>
                        {a.name}
                      </Txt>
                      <Txt style={{ fontWeight: '800' }} numberOfLines={1}>
                        {fm(a.balance, a)}
                      </Txt>
                    </Card>
                  </Pressable>
                ))}
              </ScrollView>
            </FadeIn>
            <FadeIn delay={120}>
              <Row gap={8} style={{ flexWrap: 'wrap' }}>
                <Btn small kind="secondary" icon="bag-handle-outline" title="Purchases" onPress={() => router.push('/purchases')} />
                {manage && <Btn small kind="secondary" icon="swap-vertical-outline" title="Transfer" onPress={() => setTransfer(true)} />}
                <Btn small kind="secondary" icon="book-outline" title="Cashbook" onPress={() => router.push('/cashbook')} />
                <Btn small kind="secondary" icon="wallet-outline" title="Accounts" onPress={() => router.push('/accounts')} />
                <Btn small kind="secondary" icon="trending-up-outline" title="Profit & Loss" onPress={() => router.push({ pathname: '/statements', params: { tab: 'pnl' } })} />
                <Btn small kind="secondary" icon="water-outline" title="Cash flow" onPress={() => router.push({ pathname: '/statements', params: { tab: 'cashflow' } })} />
                <Btn small kind="secondary" icon="globe-outline" title="Exchange rates" onPress={() => router.push('/rates')} />
              </Row>
            </FadeIn>

            <FadeIn delay={140}>
              <Card>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt v="h">Last 6 months</Txt>
                  <Row gap={12}>
                    <Row gap={5}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.success }} />
                      <Txt v="small">In</Txt>
                    </Row>
                    <Row gap={5}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.danger }} />
                      <Txt v="small">Out</Txt>
                    </Row>
                  </Row>
                </Row>
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', height: 140, paddingTop: 8 }} gap={4}>
                  {s.monthly.map((m) => (
                    <View key={m.month} style={{ flex: 1, alignItems: 'center', gap: 6 }} accessibilityLabel={`${MONTHS[Number(m.month.slice(5)) - 1]}: in ${money(m.income)}, out ${money(m.expense)}`}>
                      <Row gap={3} style={{ alignItems: 'flex-end' }}>
                        <GrowBar ratio={m.income / peak} color={t.success} />
                        <GrowBar ratio={m.expense / peak} color={t.danger} />
                      </Row>
                      <Txt v="small">{MONTHS[Number(m.month.slice(5)) - 1]}</Txt>
                    </View>
                  ))}
                </Row>
              </Card>
            </FadeIn>

            <FadeIn delay={200}>
              <Breakdown title="Where money comes from" rows={s.incomeByCategory} total={s.income} color={t.success} money={money} />
            </FadeIn>
            <FadeIn delay={260}>
              <Breakdown title="Where money is used" rows={s.expenseByCategory} total={s.expense} color={t.danger} money={money} />
            </FadeIn>

            <Section title="Transactions">
              <Chips
                value={filter}
                onChange={setFilter}
                options={[
                  { value: '', label: 'All' },
                  { value: 'income', label: 'Money in' },
                  { value: 'expense', label: 'Money out' },
                ]}
              />
              {(entries.data ?? []).length === 0 && !entries.loading && (
                <Empty icon="swap-vertical-outline" title="No transactions in this period" hint="Client payments appear here automatically. Add rent, salaries and other spending with Money out." />
              )}
              {(entries.data ?? []).map((e) => {
                const income = e.type === 'income';
                const editable = manage && e.source === 'manual';
                const bill = e.source === 'purchase' && e.purchaseId;
                return (
                  <Card key={`${e.source}-${e.id}`} onPress={bill ? () => router.push({ pathname: '/purchase/[id]', params: { id: e.purchaseId! } }) : editable ? () => edit(e) : undefined} label={`${e.category} ${money(e.amount)}`}>
                    <Row gap={12}>
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: income ? t.successSoft : t.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name={income ? 'arrow-down' : 'arrow-up'} size={18} color={income ? t.success : t.danger} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
                          {e.category}
                        </Txt>
                        <Txt v="small" numberOfLines={1}>
                          {[fd(e.date), e.party, e.accountName || PAYMENT_METHOD_LABELS[e.method], e.source === 'payment' ? `receipt ${e.notes}` : '', e.hasAttachment ? '📎' : ''].filter(Boolean).join(' · ')}
                        </Txt>
                      </View>
                      <Txt style={{ fontWeight: '800' }} color={income ? t.success : t.danger}>
                        {income ? '+' : '−'} {money(e.amount)}
                      </Txt>
                    </Row>
                  </Card>
                );
              })}
            </Section>
          </>
        )}
      </Loader>

      <Sheet visible={!!form} title={form?.id ? 'Edit entry' : form?.type === 'income' ? 'Record money in' : 'Record money out'} onClose={() => setForm(null)}>
        <Chips
          value={form?.type ?? 'expense'}
          onChange={(v) => set({ type: v, category: '' })}
          options={[
            { value: 'income', label: 'Money in' },
            { value: 'expense', label: 'Money out' },
          ]}
        />
        <Field label="Amount" money placeholder="0" value={form?.amount ?? ''} onChangeText={(v) => set({ amount: v })} autoFocus={!form?.id} />
        <Txt v="label">{form?.type === 'income' ? 'Where did it come from?' : 'What was it used for?'}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {categories.map((c) => {
            const on = form?.category === c;
            return (
              <Pressable key={c} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => set({ category: c })} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', borderWidth: 1, borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primary : t.card }}>
                <Text style={{ color: on ? t.onPrimary : t.text, fontSize: 14, fontWeight: '600' }}>{c}</Text>
              </Pressable>
            );
          })}
        </View>
        <Field label="Or type your own category" value={form && !categories.includes(form.category) ? form.category : ''} onChangeText={(v) => set({ category: v })} placeholder="e.g. Equipment" />
        <DateField label="Date" value={form?.date ?? ''} onChange={(v) => set({ date: v })} quick={[{ label: 'Today', value: todayStr() }, { label: 'Yesterday', value: addDays(todayStr(), -1) }]} />
        <Field label={form?.type === 'income' ? 'Received from (optional)' : 'Paid to (optional)'} value={form?.party ?? ''} onChangeText={(v) => set({ party: v })} />
        <Txt v="label">Method</Txt>
        <Chips value={form?.method ?? 'cash'} onChange={(v) => set({ method: v })} options={PAYMENT_METHODS.map((x) => ({ value: x, label: PAYMENT_METHOD_LABELS[x] }))} />
        {(businesses.data?.length ?? 0) > 1 && (
          <Select
            label="Business"
            value={(() => {
              const b = businesses.data?.find((x) => x.id === form?.businessId);
              return b ? b.tradingName || b.legalName : '';
            })()}
            placeholder="Choose business"
            items={businesses.data ?? []}
            getKey={(b) => b.id}
            getLabel={(b) => b.tradingName || b.legalName}
            onSelect={(b) => set({ businessId: b.id })}
          />
        )}
        <AccountSelect
          label={form?.type === 'income' ? 'Paid into' : 'Paid from'}
          accounts={(accounts.data ?? []).filter((a) => !form?.businessId || a.businessId === form.businessId)}
          value={form?.accountId ?? ''}
          onChange={(id) => set({ accountId: id })}
        />
        <Field label="Notes (optional)" value={form?.notes ?? ''} onChangeText={(v) => set({ notes: v })} multiline />
        <Card>
          <Txt v="label">{form?.type === 'income' ? 'Proof (optional)' : 'Bill or receipt photo (optional)'}</Txt>
          {!!form?.attachment && <Image source={{ uri: form.attachment }} style={{ width: '100%', height: 160, borderRadius: 10 }} resizeMode="contain" accessibilityLabel="Receipt photo" />}
          <Row gap={8}>
            <Btn
              small
              kind="secondary"
              icon="camera-outline"
              title={form?.attachment ? 'Replace photo' : 'Attach photo'}
              onPress={async () => {
                try {
                  const uri = await pickImage();
                  if (uri) set({ attachment: uri });
                } catch (e: any) {
                  toast(e.message, 'error');
                }
              }}
            />
            {!!form?.attachment && <Btn small kind="danger" icon="trash-outline" title="Remove" onPress={() => set({ attachment: '' })} />}
          </Row>
          {form?.id && !form.attachment && <Txt v="small">Attaching a new photo replaces any saved one.</Txt>}
        </Card>
        <Btn title="Save" onPress={save} loading={busy} />
        {!!form?.id && <Btn kind="danger" icon="trash-outline" title="Delete entry" onPress={remove} />}
      </Sheet>
      <TransferSheet visible={transfer} onClose={() => setTransfer(false)} accounts={accounts.data ?? []} onDone={reload} />
    </Screen>
  );
}
