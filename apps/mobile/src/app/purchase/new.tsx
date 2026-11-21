import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, Switch, Text, View } from 'react-native';
import { AccountSelect } from '@/components/money';
import { Btn, Card, Chips, DateField, Field, IconBtn, InstallmentBadge, KV, Loader, Notice, Row, Screen, Section, Select, Txt, addDays, addMonths, fm, isDate, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useTheme, useToast } from '@/lib/app-context';
import { pickImage } from '@/lib/image';
import { newKey } from '@/lib/invoice-draft';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  moneyToInput,
  parseMoney,
  parseQty,
  qtyToString,
  type BusinessProfile,
  type MoneyAccount,
  type PaymentMethod,
  type Purchase,
} from '@/lib/shared';

interface Line {
  key: string;
  name: string;
  qty: string;
  unit: string;
  unitPrice: string;
}
const blankLine = (): Line => ({ key: newKey(), name: '', qty: '1', unit: '', unitPrice: '' });
const CATEGORIES = ['Purchases', 'Stock / inventory', 'Raw materials', 'Supplies', 'Equipment', 'Maintenance'];

export default function NewPurchase() {
  const t = useTheme();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = useApi<Purchase>(id ? `/purchases/${id}` : null);
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const accounts = useApi<MoneyAccount[]>('/accounts');
  const supplierList = useApi<string[]>('/purchases/suppliers');
  const requestId = useRef(`pur-${newKey()}`);

  const [businessId, setBusinessId] = useState('');
  const [supplier, setSupplier] = useState('');
  const [billNo, setBillNo] = useState('');
  const [date, setDate] = useState(todayStr());
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [category, setCategory] = useState('Purchases');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [accountId, setAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [reference, setReference] = useState('');
  const [onPlan, setOnPlan] = useState(false);
  const [plan, setPlan] = useState<{ key: string; dueDate: string; amount: string; paid: boolean }[]>([]);
  const [attachment, setAttachment] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const bizId = businessId || businesses.data?.[0]?.id || '';
  const biz = businesses.data?.find((b) => b.id === bizId);
  const precision = biz?.currencyPrecision ?? 2;
  const money = (v: number) => fm(v, biz);

  // fill the form once when editing
  const loaded = useRef(false);
  useEffect(() => {
    const p = editing.data;
    if (!p || loaded.current) return;
    loaded.current = true;
    setBusinessId(p.businessId);
    setSupplier(p.supplier);
    setBillNo(p.billNo);
    setDate(p.date);
    setLines(p.lines.map((l) => ({ key: newKey(), name: l.name, qty: qtyToString(l.qty), unit: l.unit, unitPrice: moneyToInput(l.unitPrice, p.currencyPrecision) })));
    setCategory(p.category);
    setMethod(p.method);
    setAccountId(p.accountId ?? '');
    setNotes(p.notes);
    setReference(p.reference ?? '');
    setOnPlan((p.installments ?? []).length > 0);
    setPlan((p.installments ?? []).map((x) => ({ key: newKey(), dueDate: x.dueDate, amount: moneyToInput(x.amount, p.currencyPrecision), paid: x.paid })));
  }, [editing.data]);

  const amounts = lines.map((l) => {
    const q = parseQty(l.qty) ?? 0;
    const p = parseMoney(l.unitPrice, precision) ?? 0;
    return Math.round((q * p) / 1000);
  });
  const total = amounts.reduce((a, b) => a + b, 0);
  const setLine = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const planAmounts = plan.map((x) => parseMoney(x.amount || '0', precision) ?? 0);
  const planSum = planAmounts.reduce((a, b) => a + b, 0);
  const planPaid = plan.reduce((a, x, i) => a + (x.paid ? planAmounts[i] : 0), 0);
  const paidNow = onPlan ? planPaid : total;
  /** Split the bill into n monthly installments; the first absorbs any rounding. */
  function split(n: number) {
    const unit = 10 ** precision;
    const each = Math.floor(total / n / unit) * unit;
    setPlan(
      Array.from({ length: n }, (_, i) => ({
        key: newKey(),
        dueDate: addMonths(isDate(date) ? date : todayStr(), i),
        amount: moneyToInput(i === 0 ? total - each * (n - 1) : each, precision),
        paid: false,
      })),
    );
  }
  const known = (supplierList.data ?? []).filter((s) => s.toLowerCase().includes(supplier.trim().toLowerCase()) && s !== supplier).slice(0, 6);

  async function save() {
    const e: Record<string, string> = {};
    if (!supplier.trim()) e.supplier = 'Enter who you bought from';
    if (!isDate(date)) e.date = 'Enter a valid date';
    const body = lines
      .filter((l) => l.name.trim() || l.unitPrice.trim())
      .map((l) => ({ key: l.key, name: l.name.trim(), qty: parseQty(l.qty), unit: l.unit.trim(), unitPrice: parseMoney(l.unitPrice || '0', precision) }));
    if (!body.length) e.lines = 'Add at least one item';
    for (const l of body) {
      if (!l.name) e[`name-${l.key}`] = 'Item name';
      if (!l.qty || l.qty <= 0) e[`qty-${l.key}`] = 'Above 0';
      if (l.unitPrice === null || l.unitPrice < 0) e[`price-${l.key}`] = 'Enter price';
    }
    if (!e.lines && total <= 0) e.lines = 'The bill total must be above zero';
    if (!bizId) e.business = 'Choose a business';
    if (onPlan && !e.lines) {
      if (!plan.length) e.plan = 'Add installments, or turn off "Pay in installments"';
      else if (plan.some((x, i) => !isDate(x.dueDate) || planAmounts[i] <= 0)) e.plan = 'Every installment needs a date and an amount';
      else if (planSum !== total) e.plan = `Installments add up to ${money(planSum)} but the bill is ${money(total)}`;
    }
    setErrors(e);
    if (Object.keys(e).length) return toast(Object.values(e)[0], 'error');
    setBusy(true);
    try {
      const payload = {
        businessId: bizId,
        supplier: supplier.trim(),
        billNo: billNo.trim(),
        date,
        lines: body.map(({ key: _k, ...l }) => l),
        category: category.trim() || 'Purchases',
        method,
        accountId: accountId || null,
        notes: notes.trim(),
        reference: method === 'cash' ? '' : reference.trim(),
        installments: onPlan ? plan.map((x, i) => ({ dueDate: x.dueDate, amount: planAmounts[i], paid: x.paid })) : [],
        attachment,
        ...(id ? {} : { clientRequestId: requestId.current }),
      };
      const saved = await api<Purchase>(id ? `/purchases/${id}` : '/purchases', { method: id ? 'PUT' : 'POST', body: payload });
      toast(`${saved.number ?? 'Purchase'} saved · ${money(saved.paid ?? paidNow)} recorded as money out`);
      if (id) router.back();
      else router.replace({ pathname: '/purchase/[id]', params: { id: saved.id } });
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <Row gap={10}>
          <View style={{ flex: 1 }}>
            <Txt v="small">{onPlan ? `Bill ${money(total)} · paying now` : 'Bill total'}</Txt>
            <Txt style={{ fontWeight: '800', fontSize: 20 }}>{money(paidNow)}</Txt>
          </View>
          <Btn style={{ flex: 1.3 }} icon="checkmark" title={id ? 'Save changes' : 'Save purchase'} onPress={save} loading={busy} />
        </Row>
      }>
      <Stack.Screen options={{ title: id ? 'Edit Purchase' : 'New Purchase' }} />
      <Loader loading={!!id && editing.loading && !editing.data} error={id && !editing.data ? editing.error : ''} onRetry={editing.reload}>
        <Notice kind="info">The amount you pay is recorded as Money out and taken from the account you pay with. On installments, only paid ones count.</Notice>

        <Section title="Supplier">
          <Field label="Bought from" value={supplier} onChangeText={setSupplier} placeholder="Shop or supplier name" error={errors.supplier} />
          {known.length > 0 && (
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {known.map((s) => (
                <Pressable key={s} accessibilityRole="button" onPress={() => setSupplier(s)} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', borderWidth: 1, borderColor: t.border, backgroundColor: t.card }}>
                  <Text style={{ color: t.text, fontWeight: '600' }}>{s}</Text>
                </Pressable>
              ))}
            </Row>
          )}
          <Row gap={10} style={{ alignItems: 'flex-start' }}>
            <Field style={{ flex: 1 }} label="Bill number (optional)" value={billNo} onChangeText={setBillNo} placeholder="Their bill no." />
          </Row>
          <DateField label="Purchase date" value={date} onChange={setDate} error={errors.date} quick={[{ label: 'Today', value: todayStr() }, { label: 'Yesterday', value: addDays(todayStr(), -1) }]} />
          {(businesses.data?.length ?? 0) > 1 && (
            <Select
              label="Business"
              value={biz ? biz.tradingName || biz.legalName : ''}
              placeholder="Choose business"
              items={businesses.data ?? []}
              getKey={(b) => b.id}
              getLabel={(b) => b.tradingName || b.legalName}
              onSelect={(b) => {
                setBusinessId(b.id);
                setAccountId('');
              }}
              error={errors.business}
            />
          )}
        </Section>

        <Section title="Items bought">
          {!!errors.lines && <Notice kind="danger">{errors.lines}</Notice>}
          {lines.map((l, i) => (
            <Card key={l.key}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt v="label">Item {i + 1}</Txt>
                {lines.length > 1 && <IconBtn icon="trash-outline" label={`Remove item ${i + 1}`} color={t.danger} onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />}
              </Row>
              <Field label="Item name" value={l.name} onChangeText={(v) => setLine(l.key, { name: v })} placeholder="e.g. Cement bag" error={errors[`name-${l.key}`]} />
              <Row gap={8} style={{ alignItems: 'flex-start' }}>
                <Field style={{ flex: 1 }} label="Qty" money value={l.qty} onChangeText={(v) => setLine(l.key, { qty: v })} error={errors[`qty-${l.key}`]} />
                <Field style={{ flex: 1 }} label="Unit" value={l.unit} onChangeText={(v) => setLine(l.key, { unit: v })} placeholder="pcs, kg" />
                <Field style={{ flex: 1.4 }} label="Price each" money value={l.unitPrice} onChangeText={(v) => setLine(l.key, { unitPrice: v })} placeholder="0" error={errors[`price-${l.key}`]} />
              </Row>
              <Row style={{ justifyContent: 'flex-end' }}>
                <Txt style={{ fontWeight: '700' }}>{money(amounts[i])}</Txt>
              </Row>
            </Card>
          ))}
          <Btn kind="secondary" icon="add" title="Add another item" onPress={() => setLines((ls) => [...ls, blankLine()])} />
        </Section>

        <Section title="Payment">
          <Txt v="label">Paid with</Txt>
          <Chips
            value={method}
            onChange={(v) => {
              setMethod(v);
              setAccountId('');
            }}
            options={PAYMENT_METHODS.map((x) => ({ value: x, label: PAYMENT_METHOD_LABELS[x] }))}
          />
          {method === 'cash' ? (
            <Txt v="small">Transaction ID: Cash</Txt>
          ) : (
            <Field label="Transaction ID" value={reference} onChangeText={setReference} placeholder="Bank / JazzCash / Easypaisa transaction ID or cheque no." />
          )}
          <AccountSelect label="Paid from" accounts={(accounts.data ?? []).filter((a) => a.businessId === bizId)} value={accountId} onChange={setAccountId} />
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '700' }}>Pay in installments</Txt>
                <Txt v="small">Only installments marked paid are taken out as money out.</Txt>
              </View>
              <Switch
                accessibilityLabel="Pay in installments"
                value={onPlan}
                onValueChange={(on) => {
                  setOnPlan(on);
                  if (on && !plan.length && total > 0) split(2);
                }}
              />
            </Row>
          </Card>
          {onPlan && (
            <>
              <Row style={{ flexWrap: 'wrap' }}>
                <Txt v="small">Split into:</Txt>
                {[2, 3, 4, 6, 12].map((n) => (
                  <Btn key={n} small kind="secondary" title={`${n}`} onPress={() => split(n)} />
                ))}
                <Btn small kind="secondary" icon="add" title="Add" onPress={() => setPlan((ps) => [...ps, { key: newKey(), dueDate: date, amount: '', paid: false }])} />
              </Row>
              {!!errors.plan && <Notice kind="danger">{errors.plan}</Notice>}
              {plan.map((s, i) => {
                const patch = (p: Partial<typeof s>) => setPlan((ps) => ps.map((x) => (x.key === s.key ? { ...x, ...p } : x)));
                return (
                  <Card key={s.key}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Txt v="label">Installment {i + 1}</Txt>
                      <IconBtn icon="trash-outline" label={`Remove installment ${i + 1}`} color={t.danger} onPress={() => setPlan((ps) => ps.filter((x) => x.key !== s.key))} />
                    </Row>
                    <Row gap={10} style={{ alignItems: 'flex-start' }}>
                      <View style={{ flex: 1 }}>
                        <DateField label="Due date" value={s.dueDate} onChange={(v) => patch({ dueDate: v })} />
                      </View>
                      <Field style={{ flex: 1 }} label="Amount" money placeholder="0" value={s.amount} onChangeText={(v) => patch({ amount: v })} />
                    </Row>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <InstallmentBadge status={s.paid ? 'paid' : 'pending'} />
                      <Row gap={8}>
                        <Txt v="small">{s.paid ? 'Paid' : 'Unpaid'}</Txt>
                        <Switch accessibilityLabel={`Installment ${i + 1} paid`} value={s.paid} onValueChange={(on) => patch({ paid: on })} />
                      </Row>
                    </Row>
                  </Card>
                );
              })}
              {plan.length > 0 && <KV k="Scheduled" v={`${money(planSum)} of ${money(total)}`} color={planSum !== total ? t.danger : undefined} />}
              <KV k="Paid now (money out)" v={money(planPaid)} color={t.danger} />
              <KV k="Still to pay supplier" v={money(Math.max(0, total - planPaid))} />
            </>
          )}
          <Txt v="label">Category</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CATEGORIES.map((c) => {
              const on = category === c;
              return (
                <Pressable key={c} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setCategory(c)} style={{ minHeight: 38, paddingHorizontal: 13, borderRadius: 19, justifyContent: 'center', borderWidth: 1, borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primary : t.card }}>
                  <Text style={{ color: on ? t.onPrimary : t.text, fontSize: 14, fontWeight: '600' }}>{c}</Text>
                </Pressable>
              );
            })}
          </View>
          <Field label="Or type your own category" value={CATEGORIES.includes(category) ? '' : category} onChangeText={(v) => setCategory(v || 'Purchases')} placeholder="e.g. Spare parts" />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
          <Card>
            <Txt v="label">Bill photo (optional)</Txt>
            {!!attachment && <Image source={{ uri: attachment }} style={{ width: '100%', height: 160, borderRadius: 10 }} resizeMode="contain" accessibilityLabel="Bill photo" />}
            <Row gap={8}>
              <Btn
                small
                kind="secondary"
                icon="camera-outline"
                title={attachment ? 'Replace photo' : 'Attach photo'}
                onPress={async () => {
                  try {
                    const uri = await pickImage();
                    if (uri) setAttachment(uri);
                  } catch (err: any) {
                    toast(err.message, 'error');
                  }
                }}
              />
              {!!attachment && <Btn small kind="danger" icon="trash-outline" title="Remove" onPress={() => setAttachment('')} />}
            </Row>
            {!!id && editing.data?.hasAttachment && !attachment && (
              <Row gap={6}>
                <Ionicons name="attach" size={16} color={t.sub} />
                <Txt v="small">A photo is saved. Attaching a new one replaces it.</Txt>
              </Row>
            )}
          </Card>
        </Section>
      </Loader>
    </Screen>
  );
}
