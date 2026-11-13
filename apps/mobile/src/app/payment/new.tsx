import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { AccountSelect } from '@/components/money';
import { Btn, Card, Chips, DateField, Field, KV, Loading, Notice, Progress, Row, Screen, Select, Txt, fd, fm, isDate, todayStr } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { pickImage } from '@/lib/image';
import { newKey } from '@/lib/invoice-draft';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, moneyToInput, parseMoney, type BusinessProfile, type Client, type Invoice, type MoneyAccount, type Payment, type PaymentMethod } from '@/lib/shared';

type Mode = 'one' | 'several' | 'advance';

export default function RecordPayment() {
  const t = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const params = useLocalSearchParams<{ invoiceId?: string; clientId?: string }>();
  const requestId = useRef(`pay-${newKey()}`).current;

  const [clientId, setClientId] = useState(params.clientId ?? '');
  const [mode, setMode] = useState<Mode>('one');
  const [invoiceId, setInvoiceId] = useState(params.invoiceId ?? '');
  const [businessId, setBusinessId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayStr());
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [proof, setProof] = useState('');
  const [split, setSplit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const clients = useApi<Client[]>('/clients?limit=100');
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const accounts = useApi<MoneyAccount[]>('/accounts');
  const preset = useApi<{ invoice: Invoice }>(params.invoiceId ? `/invoices/${params.invoiceId}` : null);
  const open = useApi<Invoice[]>(clientId ? `/invoices${qs({ clientId, status: 'outstanding', limit: 100 })}` : null);

  const invoices = useMemo(() => {
    const list = open.data ?? [];
    const p = preset.data?.invoice;
    return p && !list.some((i) => i.id === p.id) ? [p, ...list] : list;
  }, [open.data, preset.data]);
  const invoice = mode === 'one' ? invoices.find((i) => i.id === invoiceId) : undefined;
  const client = clients.data?.find((c) => c.id === clientId);
  const bizId = invoice?.businessId ?? businessId ?? '';
  const business = businesses.data?.find((b) => b.id === bizId) ?? businesses.data?.[0];
  // invoices that can share one payment: same business and currency, oldest due first
  const several = invoices
    .filter((i) => i.businessId === business?.id && i.currency === business?.currency)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.issueDate.localeCompare(b.issueDate));
  const cur = invoice ?? { currency: business?.currency ?? 'PKR', currencyPrecision: business?.currencyPrecision ?? 2 };
  const precision = cur.currencyPrecision;
  const m = (v: number) => fm(v, cur);

  useEffect(() => {
    const p = preset.data?.invoice;
    if (!p) return;
    setClientId(p.clientId);
    const nextDue = p.installments.find((s) => s.status !== 'paid');
    const suggested = nextDue ? Math.min(nextDue.amount - (nextDue.paid ?? 0), p.balance) : p.balance;
    setAmount((a) => a || moneyToInput(suggested, p.currencyPrecision));
  }, [preset.data]);
  useEffect(() => {
    if (!businessId && businesses.data?.length) setBusinessId(businesses.data[0].id);
  }, [businesses.data, businessId]);

  const value = parseMoney(amount, precision) ?? 0;

  // spread the amount over invoices oldest first whenever it changes in "several" mode
  useEffect(() => {
    if (mode !== 'several') return;
    let left = value;
    const next: Record<string, string> = {};
    for (const i of several) {
      const take = Math.max(0, Math.min(left, i.balance));
      next[i.id] = take ? moneyToInput(take, i.currencyPrecision) : '';
      left -= take;
    }
    setSplit(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, value, several.map((i) => i.id).join()]);

  const splitTotal = several.reduce((a, i) => a + (parseMoney(split[i.id] ?? '', precision) ?? 0), 0);
  const excess = mode === 'one' && invoice ? Math.max(0, value - invoice.balance) : mode === 'several' ? Math.max(0, value - splitTotal) : value;
  const accountChoices = (accounts.data ?? []).filter((a) => a.businessId === business?.id);

  async function save() {
    setError('');
    if (!clientId) return toast('Choose a client', 'error');
    if (value <= 0) return setError('Enter the amount received');
    if (!isDate(date)) return toast('Enter a valid payment date', 'error');
    if (!business) return toast('Choose the receiving business', 'error');
    let allocations: { invoiceId: string; amount: number }[] | undefined;
    if (mode === 'several') {
      allocations = several.map((i) => ({ invoiceId: i.id, amount: parseMoney(split[i.id] ?? '', precision) ?? 0 })).filter((a) => a.amount > 0);
      const over = several.find((i) => (parseMoney(split[i.id] ?? '', precision) ?? 0) > i.balance);
      if (over) return toast(`${over.number} only has ${m(over.balance)} left to pay`, 'error');
      if (splitTotal > value) return toast('The amounts given to invoices add up to more than the payment', 'error');
    }
    setBusy(true);
    try {
      const p = await api<Payment>('/payments', {
        body: {
          clientId,
          businessId: business.id,
          invoiceId: mode === 'one' ? (invoice?.id ?? null) : null,
          allocations,
          amount: value,
          date,
          method,
          accountId: accountId || null,
          reference: reference.trim(),
          notes: notes.trim(),
          proof,
          clientRequestId: requestId,
        },
      });
      toast(`Payment saved · receipt ${p.number}`);
      router.replace({ pathname: '/payment/[id]', params: { id: p.id } });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!can('payments.record')) {
    return (
      <Screen>
        <Notice kind="warn">You do not have permission to record payments.</Notice>
      </Screen>
    );
  }
  if (params.invoiceId && preset.loading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen footer={<Btn icon="checkmark-circle-outline" title={value > 0 ? `Save payment of ${m(value)}` : 'Save payment'} onPress={save} loading={busy} />}>
      <Select
        label="Client"
        value={client?.name ?? preset.data?.invoice.clientName ?? ''}
        placeholder="Choose client"
        items={clients.data ?? []}
        getKey={(c) => c.id}
        getLabel={(c) => c.name}
        getSub={(c) => `Outstanding ${fm(c.outstanding ?? 0)}${c.credit ? ` · advance ${fm(c.credit)}` : ''}`}
        onSelect={(c) => {
          setClientId(c.id);
          setInvoiceId('');
        }}
      />
      {!!clientId && (
        <Chips
          value={mode}
          onChange={(v) => {
            setMode(v);
            if (v !== 'one') setInvoiceId('');
          }}
          options={[
            { value: 'one', label: 'One invoice' },
            { value: 'several', label: `Several invoices${several.length ? ` (${several.length})` : ''}` },
            { value: 'advance', label: 'Advance / on account' },
          ]}
        />
      )}
      {!!clientId && mode === 'one' && (
        <Select
          label="Apply to invoice"
          value={invoice ? `${invoice.number} · balance ${fm(invoice.balance, invoice)}` : ''}
          placeholder="Choose invoice"
          items={invoices}
          getKey={(i) => i.id}
          getLabel={(i) => `${i.number} · balance ${fm(i.balance, i)}`}
          getSub={(i) => `Total ${fm(i.total, i)} · due ${fd(i.dueDate)}`}
          onSelect={(i) => {
            setInvoiceId(i.id);
            setAmount(moneyToInput(i.balance, i.currencyPrecision));
          }}
        />
      )}
      {!invoice && (businesses.data?.length ?? 0) > 1 && (
        <Select
          label="Received by business"
          value={business ? business.tradingName || business.legalName : ''}
          placeholder="Choose business"
          items={businesses.data ?? []}
          getKey={(b) => b.id}
          getLabel={(b) => b.tradingName || b.legalName}
          onSelect={(b) => (setBusinessId(b.id), setAccountId(''))}
        />
      )}

      {invoice && (
        <Card>
          <Progress value={invoice.paid} total={invoice.total} />
          <KV k="Invoice total" v={m(invoice.total)} />
          <KV k="Paid so far" v={m(invoice.paid)} />
          <KV k="Remaining" v={m(invoice.balance)} bold />
          <KV k="After this payment" v={m(Math.max(0, invoice.balance - value))} />
        </Card>
      )}

      <Field label={`Amount received${cur.currency !== 'PKR' ? ` (${cur.currency})` : ''}`} money placeholder="0" value={amount} onChangeText={(v) => (setAmount(v), setError(''))} error={error} />

      {mode === 'several' && (
        <Card>
          <Txt v="h">Split over invoices</Txt>
          <Txt v="small">Filled oldest due first. Change any amount if the client said which invoices they are paying.</Txt>
          {several.length === 0 && <Txt v="sub">This client has no open invoices in {business?.currency}.</Txt>}
          {several.map((i) => (
            <Row key={i.id} gap={10} style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingTop: 22 }}>
                <Txt v="sub" color={t.text} style={{ fontWeight: '700' }}>
                  {i.number}
                </Txt>
                <Txt v="small" color={i.displayStatus === 'overdue' ? t.danger : undefined}>
                  due {fd(i.dueDate)} · owes {fm(i.balance, i)}
                </Txt>
              </View>
              <Field style={{ width: 130 }} label="Pay" money placeholder="0" value={split[i.id] ?? ''} onChangeText={(v) => setSplit((s) => ({ ...s, [i.id]: v }))} />
            </Row>
          ))}
          <KV k="Given to invoices" v={m(splitTotal)} bold color={splitTotal > value ? t.danger : undefined} />
        </Card>
      )}

      {excess > 0 && mode !== 'advance' && <Notice kind="warn">{m(excess)} is more than the invoices need. It will be kept as the client's advance, not applied to an invoice.</Notice>}
      {mode === 'advance' && value > 0 && <Notice>This payment is not tied to an invoice. {m(value)} is held as the client's advance; apply it to invoices later from the client's page.</Notice>}

      <Txt v="label">Payment method</Txt>
      <Chips value={method} onChange={(v) => (setMethod(v), setAccountId(''))} options={PAYMENT_METHODS.map((x) => ({ value: x, label: PAYMENT_METHOD_LABELS[x] }))} />
      <AccountSelect label="Received into" accounts={accountChoices} value={accountId} onChange={setAccountId} />
      <DateField label="Payment date" value={date} onChange={setDate} quick={[{ label: 'Today', value: todayStr() }]} />
      <Field label="Transaction reference (optional)" value={reference} onChangeText={setReference} placeholder="Cheque no., transaction ID" />
      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />

      <Card>
        <Txt v="label">Proof of payment (optional)</Txt>
        {!!proof && <Image source={{ uri: proof }} style={{ width: '100%', height: 180, borderRadius: 10, backgroundColor: t.neutralSoft }} resizeMode="contain" accessibilityLabel="Proof of payment" />}
        <Row gap={10}>
          <Btn
            small
            kind="secondary"
            icon="attach-outline"
            title={proof ? 'Replace photo' : 'Attach photo'}
            onPress={async () => {
              try {
                const uri = await pickImage();
                if (uri) setProof(uri);
              } catch (e: any) {
                toast(e.message, 'error');
              }
            }}
          />
          {!!proof && <Btn small kind="danger" icon="trash-outline" title="Remove" onPress={() => setProof('')} />}
        </Row>
      </Card>
      <Txt v="small">A receipt is generated as soon as the payment is saved{can('payments.verify') ? '.' : ' and stays pending until it is verified.'}</Txt>
    </Screen>
  );
}
