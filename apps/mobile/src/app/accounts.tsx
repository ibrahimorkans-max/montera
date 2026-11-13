import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { AccountIcon, CurrencySelect, TransferSheet } from '@/components/money';
import { Badge, Btn, Card, Chips, CountUp, DateField, Empty, FadeIn, Field, Gradient, Loader, Row, Screen, Section, Select, Sheet, Txt, fm, isDate, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { ACCOUNT_TYPE_LABELS, moneyToInput, parseMoney, precisionOf, type AccountType, type BusinessProfile, type MoneyAccount } from '@/lib/shared';
import { Text } from 'react-native';

interface Form {
  id?: string;
  businessId: string;
  name: string;
  type: AccountType;
  institution: string;
  accountNumber: string;
  currency: string;
  openingBalance: string;
  openingDate: string;
  isDefault: boolean;
  status: 'active' | 'archived';
}

export default function Accounts() {
  const toast = useToast();
  const { can } = useAuth();
  const manage = can('finance.manage');
  const [showArchived, setShowArchived] = useState(false);
  const list = useApi<MoneyAccount[]>(`/accounts${showArchived ? '?all=1' : ''}`);
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const [form, setForm] = useState<Form | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));
  const accounts = list.data ?? [];
  const active = accounts.filter((a) => a.status === 'active');
  const multiBiz = (businesses.data?.length ?? 0) > 1;

  // totals per currency
  const totals = new Map<string, { amount: number; precision: number }>();
  for (const a of active) {
    const e = totals.get(a.currency) ?? { amount: 0, precision: a.currencyPrecision };
    e.amount += a.balance;
    totals.set(a.currency, e);
  }

  const open = (a?: MoneyAccount) =>
    setForm(
      a
        ? { id: a.id, businessId: a.businessId, name: a.name, type: a.type, institution: a.institution, accountNumber: a.accountNumber, currency: a.currency, openingBalance: a.openingBalance ? moneyToInput(a.openingBalance, a.currencyPrecision) : '', openingDate: a.openingDate, isDefault: a.isDefault, status: a.status }
        : { businessId: businesses.data?.[0]?.id ?? '', name: '', type: 'bank', institution: '', accountNumber: '', currency: businesses.data?.[0]?.currency ?? 'PKR', openingBalance: '', openingDate: todayStr(), isDefault: false, status: 'active' },
    );

  async function save() {
    if (!form) return;
    if (!form.name.trim()) return toast('Name the account', 'error');
    const opening = form.openingBalance.trim() ? parseMoney(form.openingBalance, precisionOf(form.currency)) : 0;
    if (opening === null) return toast('Opening balance is not a valid amount', 'error');
    if (!isDate(form.openingDate)) return toast('Enter a valid opening date', 'error');
    setBusy(true);
    try {
      const { id, openingBalance: _o, ...rest } = form;
      await api(id ? `/accounts/${id}` : '/accounts', { method: id ? 'PUT' : 'POST', body: { ...rest, openingBalance: opening } });
      toast(id ? 'Account updated' : 'Account added');
      setForm(null);
      list.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={list.reload} refreshing={list.refreshing}>
      <Loader loading={list.loading && !list.data} error={list.data ? '' : list.error} onRetry={list.reload}>
        <FadeIn>
          <Gradient>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700', letterSpacing: 0.6 }}>MONEY IN ALL ACCOUNTS</Text>
            {[...totals].map(([cur, v]) => (
              <CountUp key={cur} value={v.amount} format={(x) => fm(x, { currency: cur, currencyPrecision: v.precision })} style={{ color: '#fff', fontSize: totals.size > 1 ? 24 : 32, fontWeight: '800', marginTop: 2 }} />
            ))}
            {totals.size === 0 && <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>—</Text>}
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 6 }}>
              {active.length} account{active.length === 1 ? '' : 's'} · cash, bank and mobile wallets
            </Text>
          </Gradient>
        </FadeIn>
        <Row gap={10}>
          {manage && <Btn style={{ flex: 1 }} kind="secondary" icon="swap-vertical-outline" title="Transfer" onPress={() => setTransfer(true)} disabled={active.length < 2} />}
          <Btn style={{ flex: 1 }} kind="secondary" icon="book-outline" title="Cashbook" onPress={() => router.push('/cashbook')} />
        </Row>
        {manage && <Btn icon="add" title="Add account" onPress={() => open()} />}

        {accounts.length === 0 ? (
          <Empty icon="wallet-outline" title="No accounts yet" />
        ) : (
          <Section title="Accounts" action={<Txt v="label" onPress={() => setShowArchived(!showArchived)}>{showArchived ? 'Hide archived' : 'Show archived'}</Txt>}>
            {accounts.map((a, n) => (
              <FadeIn key={a.id} delay={n * 40}>
                <Card>
                  <Row gap={12}>
                    <AccountIcon type={a.type} />
                    <View style={{ flex: 1 }}>
                      <Row gap={6}>
                        <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
                          {a.name}
                        </Txt>
                        {a.isDefault && <Badge status="active" label="Default" />}
                        {a.status === 'archived' && <Badge status="inactive" label="Archived" />}
                      </Row>
                      <Txt v="small" numberOfLines={1}>
                        {[ACCOUNT_TYPE_LABELS[a.type], a.institution, a.accountNumber && `•••${a.accountNumber.slice(-4)}`, multiBiz ? a.businessName : ''].filter(Boolean).join(' · ')}
                      </Txt>
                    </View>
                    <Txt style={{ fontWeight: '800' }}>{fm(a.balance, a)}</Txt>
                  </Row>
                  <Row gap={8} style={{ justifyContent: 'flex-end' }}>
                    <Btn small kind="ghost" icon="book-outline" title="Cashbook" onPress={() => router.push({ pathname: '/cashbook', params: { accountId: a.id } })} />
                    {manage && <Btn small kind="ghost" icon="create-outline" title="Edit" onPress={() => open(a)} />}
                  </Row>
                </Card>
              </FadeIn>
            ))}
          </Section>
        )}
        <Txt v="small">Payments go to the default account for their method (cash, bank, or mobile wallet for Easypaisa and JazzCash) unless you pick one.</Txt>
      </Loader>

      <TransferSheet visible={transfer} onClose={() => setTransfer(false)} accounts={active} onDone={list.reload} />

      <Sheet visible={!!form} title={form?.id ? 'Edit account' : 'New account'} onClose={() => setForm(null)}>
        {multiBiz && !form?.id && (
          <Select
            label="Business"
            value={businesses.data?.find((b) => b.id === form?.businessId)?.legalName ?? ''}
            placeholder="Choose business"
            items={businesses.data ?? []}
            getKey={(b) => b.id}
            getLabel={(b) => b.tradingName || b.legalName}
            onSelect={(b) => set({ businessId: b.id, currency: b.currency })}
          />
        )}
        <Chips value={form?.type ?? 'bank'} onChange={(v) => set({ type: v })} options={(['cash', 'bank', 'wallet'] as AccountType[]).map((x) => ({ value: x, label: ACCOUNT_TYPE_LABELS[x] }))} />
        <Field label="Account name" value={form?.name ?? ''} onChangeText={(v) => set({ name: v })} placeholder="e.g. Meezan Bank current, Shop cash drawer" />
        {form?.type !== 'cash' && (
          <>
            <Field label={form?.type === 'wallet' ? 'Provider' : 'Bank'} value={form?.institution ?? ''} onChangeText={(v) => set({ institution: v })} placeholder={form?.type === 'wallet' ? 'Easypaisa, JazzCash…' : 'Meezan, HBL, UBL…'} />
            <Field label="Account / IBAN / mobile number" value={form?.accountNumber ?? ''} onChangeText={(v) => set({ accountNumber: v })} autoCapitalize="characters" />
          </>
        )}
        <CurrencySelect value={form?.currency ?? 'PKR'} onChange={(c) => set({ currency: c })} />
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <Field style={{ flex: 1 }} label="Opening balance" value={form?.openingBalance ?? ''} onChangeText={(v) => set({ openingBalance: v })} keyboardType="numbers-and-punctuation" placeholder="0" />
          <View style={{ flex: 1 }}>
            <DateField label="As of" value={form?.openingDate ?? ''} onChange={(v) => set({ openingDate: v })} />
          </View>
        </Row>
        <Row style={{ justifyContent: 'space-between', minHeight: 48 }}>
          <View style={{ flex: 1 }}>
            <Txt style={{ fontWeight: '600' }}>Default {form ? ACCOUNT_TYPE_LABELS[form.type].toLowerCase() : ''} account</Txt>
            <Txt v="small">New payments of this kind land here unless another account is chosen.</Txt>
          </View>
          <Switch accessibilityLabel="Default account" value={!!form?.isDefault} onValueChange={(v) => set({ isDefault: v })} />
        </Row>
        {form?.id && (
          <Chips
            value={form.status}
            onChange={(v) => set({ status: v })}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
            ]}
          />
        )}
        <Btn title="Save account" onPress={save} loading={busy} />
      </Sheet>
    </Screen>
  );
}
