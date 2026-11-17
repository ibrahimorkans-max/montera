import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { CurrencySelect } from '@/components/money';
import { StepSlide, Stepper, type StepDef } from '@/components/stepper';
import { Btn, Card, Chips, CountUp, DateField, Field, IconBtn, InstallmentBadge, KV, Loading, Notice, Row, Screen, Section, Select, Sheet, Txt, addDays, addMonths, confirm, fd, fm, isDate, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import {
  draftFromInvoice,
  draftPrecision,
  draftFromQuote,
  draftFromRecurring,
  draftPreview,
  draftToBody,
  draftToQuoteBody,
  draftToRecurringBody,
  quotePreview,
  draftTotals,
  emptyDraft,
  emptyLine,
  depositAmount,
  initialPaymentAmount,
  paidInstallmentsAmount,
  lineFromService,
  newKey,
  type InvoiceDraft,
  type LineDraft,
  type PaymentMode,
} from '@/lib/invoice-draft';
import { invoiceHtml, quotationHtml, type Paper } from '@/lib/pdf';
import {
  FREQUENCY_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  describeSchedule,
  moneyToInput,
  occurrence,
  parseMoney,
  parseQty,
  type BusinessProfile,
  type Client,
  type Frequency,
  type Invoice,
  type InvoiceTemplate,
  type Quotation,
  type RecurringInvoice,
  type Service,
} from '@/lib/shared';
import { local } from '@/lib/storage';

export type BuilderKind = 'invoice' | 'quote' | 'recurring';
type StepId = 'party' | 'items' | 'adjust' | 'payment' | 'schedule' | 'preview';

const STEP_DEFS: Record<StepId, StepDef> = {
  party: { title: 'Business & Client', hint: 'Who is issuing this, and who is it for?', icon: 'people-outline' },
  items: { title: 'Services & Products', hint: 'Add what you are billing for.', icon: 'cube-outline' },
  adjust: { title: 'Discounts, Tax & Charges', hint: 'Fine-tune the total.', icon: 'pricetag-outline' },
  payment: { title: 'Payment', hint: 'Has the client paid anything yet?', icon: 'wallet-outline' },
  schedule: { title: 'Schedule & Approval', hint: 'How often to invoice, and who approves it.', icon: 'repeat-outline' },
  preview: { title: 'Preview & Save', hint: 'Check everything before it is saved.', icon: 'eye-outline' },
};
const FLOW: Record<BuilderKind, StepId[]> = {
  invoice: ['party', 'items', 'adjust', 'payment', 'preview'],
  quote: ['party', 'items', 'adjust', 'preview'],
  recurring: ['party', 'items', 'adjust', 'schedule', 'preview'],
};
const NOUN: Record<BuilderKind, string> = { invoice: 'invoice', quote: 'quotation', recurring: 'recurring invoice' };
const MODES: { value: PaymentMode; label: string }[] = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'paid', label: 'Fully Paid' },
  { value: 'partial', label: 'Partially Paid' },
  { value: 'installments', label: 'Installments' },
  { value: 'advance', label: 'Advance Received' },
];

/** Step-by-step editor shared by invoices, quotations and recurring invoice schedules. */
export default function DocBuilder({ kind = 'invoice' }: { kind?: BuilderKind }) {
  const t = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { id, clientId: presetClient } = useLocalSearchParams<{ id?: string; clientId?: string }>();
  const storageKey = kind === 'invoice' ? `millnexa.draft.${id ?? 'new'}` : `millnexa.${kind}.${id ?? 'new'}`;
  const flow = FLOW[kind];
  const STEPS = flow.map((x) => STEP_DEFS[x]);
  const at = (x: StepId) => flow.indexOf(x);
  const noun = NOUN[kind];

  const businesses = useApi<BusinessProfile[]>('/businesses');
  const clients = useApi<Client[]>('/clients?limit=100');
  const services = useApi<Service[]>('/services');

  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [restored, setRestored] = useState(false);
  const [step, setStepRaw] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [viewer, setViewer] = useState(false);
  const setStep = (next: number | ((s: number) => number)) =>
    setStepRaw((cur) => {
      const n = typeof next === 'function' ? next(cur) : next;
      setDirection(n >= cur ? 1 : -1);
      return n;
    });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<'' | 'draft' | 'final'>('');
  const [editing, setEditing] = useState<LineDraft | null>(null);
  const [clientSheet, setClientSheet] = useState<{ name: string; phone: string; city: string } | null>(null);
  const [serviceSheet, setServiceSheet] = useState<{ name: string; price: string; unit: string; tax: string } | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const saved = useRef(false);

  const set = (patch: Partial<InvoiceDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setSchedule = (patch: Partial<InvoiceDraft['schedule']>) => setDraft((d) => (d ? { ...d, schedule: { ...d.schedule, ...patch } } : d));
  const today = todayStr();

  // Load: unsaved local copy first, then the server draft, else a blank invoice.
  useEffect(() => {
    let alive = true;
    (async () => {
      const localCopy = await local.get<InvoiceDraft>(storageKey);
      if (!alive) return;
      if (localCopy && (localCopy.lines.length > 0 || localCopy.clientId)) {
        // a copy saved by an older app version may lack newer fields: fill them from a blank draft
        const blank = emptyDraft();
        setDraft({ ...blank, ...localCopy, schedule: { ...blank.schedule, ...localCopy.schedule } });
        setRestored(true);
        return;
      }
      if (id) {
        try {
          const loaded = await loadExisting(kind, id);
          if (alive) setDraft(loaded);
        } catch (e: any) {
          toast(e.message, 'error');
          router.back();
        }
        return;
      }
      setDraft(kind === 'quote' ? { ...emptyDraft(), clientRequestId: `qt-${newKey()}`, dueDate: addDays(todayStr(), 15) } : emptyDraft());
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Defaults once reference data arrives.
  useEffect(() => {
    if (!draft) return;
    if (!draft.businessId && businesses.data?.length) {
      const first = businesses.data.find((b) => b.status === 'active') ?? businesses.data[0];
      set({ businessId: first.id });
    }
    if (!draft.clientId && presetClient && clients.data) {
      const c = clients.data.find((x) => x.id === presetClient);
      if (c) set({ clientId: c.id, clientName: c.name, billingAddress: c.address });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.businessId, draft?.clientId, businesses.data, clients.data, presetClient]);

  // Autosave so nothing is lost if the app closes or the user navigates away.
  useEffect(() => {
    if (!draft || saved.current) return;
    const timer = setTimeout(() => local.set(storageKey, draft), 500);
    return () => clearTimeout(timer);
  }, [draft, storageKey]);

  const business = businesses.data?.find((b) => b.id === draft?.businessId);
  const client = clients.data?.find((c) => c.id === draft?.clientId);
  const precision = draft ? draftPrecision(draft, business) : (business?.currencyPrecision ?? 2);
  const docCurrency = (draft?.currency || business?.currency) ?? 'PKR';
  const totals = useMemo(() => (draft ? draftTotals(draft, business) : null), [draft, business]);
  const canPay = can('payments.record');
  const buildDoc = useCallback(
    (paper: Paper, template: InvoiceTemplate) =>
      !draft || !business
        ? ''
        : kind === 'quote'
          ? quotationHtml(quotePreview(draft, business, client), paper, template)
          : invoiceHtml(draftPreview(kind === 'recurring' ? { ...draft, paymentMode: 'unpaid' } : draft, business, client, canPay), paper, template),
    [draft, business, client, canPay, kind],
  );

  if (!draft || !totals) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const money = (v: number) => fm(v, { currency: docCurrency, currencyPrecision: precision });
  const foreign = !!business && docCurrency !== business.currency;
  // business-currency value of this invoice, for the credit-limit check (typed rate, else 1:1 as an estimate)
  const baseTotal = foreign && draft.fxRate && Number(draft.fxRate) > 0 ? Math.round((totals.total * Number(draft.fxRate) * 10 ** (business!.currencyPrecision - precision))) : totals.total;
  const overLimit = kind === 'invoice' && !!client && client.creditLimit > 0 && (client.outstanding ?? 0) + baseTotal - payNowBase() > client.creditLimit;
  function payNowBase() {
    return foreign ? 0 : Math.min(kind === 'invoice' && can('payments.record') ? initialPaymentAmount(draft!, totals!.total, precision) : 0, totals!.total);
  }
  const payNow = kind === 'invoice' && can('payments.record') ? initialPaymentAmount(draft, totals.total, precision) : 0;
  const scheduleSum = draft.installments.reduce((a, s) => a + (parseMoney(s.amount, precision) ?? 0), 0);
  // with installments, the schedule covers what is left after the down payment; installments switched
  // to Paid are part of the schedule and are recorded as received together with it
  const paidInstallments = kind === 'invoice' && can('payments.record') && draft.paymentMode === 'installments' ? paidInstallmentsAmount(draft, precision) : 0;
  const deposit = draft.paymentMode === 'installments' ? (kind === 'invoice' && can('payments.record') ? depositAmount(draft, precision) : 0) : payNow;
  const remainingAfterPay = Math.max(0, totals.total - deposit);

  // ------------------------------------------------------------ validation

  function validate(upTo: number): boolean {
    const e: Record<string, string> = {};
    let failStep = -1;
    const fail = (sid: StepId, key: string, msg: string) => {
      e[key] = msg;
      const s = at(sid);
      if (failStep < 0 || s < failStep) failStep = s;
    };
    const reached = (sid: StepId) => at(sid) >= 0 && upTo >= at(sid);
    if (!draft) return false;
    if (!draft.businessId) fail('party', 'business', 'Choose the issuing business');
    if (!draft.clientId) fail('party', 'client', 'Choose a client');
    if (!isDate(draft.issueDate)) fail('party', 'issueDate', 'Enter a valid date');
    if (kind === 'recurring') {
      if (!draft.schedule.name.trim()) fail('party', 'name', 'Give this schedule a name');
    } else if (!isDate(draft.dueDate)) fail('party', 'dueDate', 'Enter a valid date');
    else if (isDate(draft.issueDate) && draft.dueDate < draft.issueDate) fail('party', 'dueDate', kind === 'quote' ? 'A quotation cannot expire before its date' : 'Due date cannot be before the invoice date');
    if (reached('items')) {
      if (draft.lines.length === 0) fail('items', 'lines', 'Add at least one service or product');
      else if (draft.lines.some((l) => !l.name.trim() || !((parseQty(l.qty) ?? 0) > 0) || parseMoney(l.unitPrice, precision) === null))
        fail('items', 'lines', 'Every item needs a name, a quantity above zero and a price');
    }
    if (reached('adjust') && upTo > at('adjust') && totals && totals.total < 0) fail('adjust', 'total', `The ${noun} total cannot be negative`);
    if (kind === 'invoice' && reached('payment') && totals) {
      if (['partial', 'advance'].includes(draft.paymentMode) && payNow <= 0) fail('payment', 'payAmount', 'Enter the amount received');
      if (draft.paymentMode === 'partial' && payNow >= totals.total && totals.total > 0) fail('payment', 'payAmount', 'This covers the whole invoice. Choose Fully Paid, or Advance Received to keep the extra as credit.');
      if (payNow > 0 && !isDate(draft.payDate)) fail('payment', 'payDate', 'Enter a valid date');
      if (draft.paymentMode === 'installments') {
        if (draft.installments.length === 0) fail('payment', 'installments', 'Add at least one installment');
        else if (draft.installments.some((s) => !isDate(s.dueDate) || !((parseMoney(s.amount, precision) ?? 0) > 0))) fail('payment', 'installments', 'Every installment needs a date and an amount');
        else if (scheduleSum > remainingAfterPay) fail('payment', 'installments', `Installments add up to ${money(scheduleSum)}, more than the ${money(remainingAfterPay)} remaining`);
        else if (paidInstallments > 0 && scheduleSum !== remainingAfterPay)
          fail('payment', 'installments', `When some installments are already paid, the installments must add up to the full ${money(remainingAfterPay)} remaining (now ${money(scheduleSum)})`);
      }
    }
    if (kind === 'recurring' && reached('schedule')) {
      const sc = draft.schedule;
      if (!(Number(sc.interval) >= 1)) fail('schedule', 'interval', 'Enter how many weeks, months, years or days apart');
      if (sc.endDate && !isDate(sc.endDate)) fail('schedule', 'endDate', 'Enter a valid date or leave it empty');
      else if (sc.endDate && sc.endDate < draft.issueDate) fail('schedule', 'endDate', 'The end date cannot be before the first invoice');
      if (!(Number(sc.dueDays) >= 0)) fail('schedule', 'dueDays', 'Enter the number of days');
    }
    setErrors(e);
    if (failStep >= 0 && failStep <= upTo) {
      setStep(failStep);
      toast(Object.values(e)[0], 'error');
      return false;
    }
    return true;
  }

  const next = () => validate(step) && setStep((s) => Math.min(s + 1, STEPS.length - 1));

  // ------------------------------------------------------------ saving

  async function save(finalize: boolean) {
    if (!draft) return;
    if (finalize || kind !== 'invoice' ? !validate(flow.length - 1) : !validate(0)) return;
    if (kind === 'invoice' && finalize) {
      const what = payNow > 0 ? `finalize this invoice and record a payment of ${money(payNow)}` : 'finalize this invoice';
      if (!(await confirm('Save as final invoice?', `This will ${what}. A final invoice gets its number and can no longer be edited.`, 'Finalize'))) return;
    }
    if (kind === 'recurring' && draft.schedule.autoIssue) {
      if (!(await confirm('Issue invoices automatically?', `Each run will create a final, numbered invoice for ${client?.name ?? draft.clientName} without asking anyone first.`, 'Turn on'))) return;
    }
    setSaving(finalize ? 'final' : 'draft');
    try {
      if (kind === 'quote') {
        const q = await api<Quotation>(draft.id ? `/quotations/${draft.id}` : '/quotations', { method: draft.id ? 'PUT' : 'POST', body: draftToQuoteBody(draft, business) });
        if (finalize && q.status === 'draft') await api(`/quotations/${q.id}/status`, { body: { status: 'sent' } });
        await done(`Quotation ${q.number} saved`);
        router.replace({ pathname: '/quotation/[id]', params: { id: q.id } });
        return;
      }
      if (kind === 'recurring') {
        const r = await api<RecurringInvoice>(draft.id ? `/recurring/${draft.id}` : '/recurring', { method: draft.id ? 'PUT' : 'POST', body: draftToRecurringBody(draft, business) });
        await done(r.generatedCount > 0 && !draft.id ? `Schedule saved · ${r.generatedCount} invoice${r.generatedCount === 1 ? '' : 's'} created` : 'Schedule saved');
        router.replace({ pathname: '/recurring/[id]', params: { id: r.id } });
        return;
      }
      const body = draftToBody(can('payments.record') ? draft : { ...draft, paymentMode: 'unpaid' }, business, finalize);
      const send = (b: object) => api<Invoice>(draft.id ? `/invoices/${draft.id}` : '/invoices', { method: draft.id ? 'PUT' : 'POST', body: b });
      let inv: Invoice;
      try {
        inv = await send(body);
      } catch (e: any) {
        if (!finalize || !/credit limit/i.test(e.message) || !can('invoices.approve')) throw e;
        if (!(await confirm('Over the credit limit', `${e.message}\n\nApprove and finalize anyway?`, 'Approve'))) return;
        inv = await send({ ...body, overrideCreditLimit: true });
      }
      await done(finalize ? `Invoice ${inv.number} saved` : 'Draft saved');
      if (finalize) router.replace({ pathname: '/invoice/[id]', params: { id: inv.id } });
      else router.back();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving('');
    }
  }

  async function done(message: string) {
    saved.current = true;
    await local.remove(storageKey);
    toast(message);
  }

  async function startFresh() {
    if (!(await confirm(`Discard this ${noun}?`, `Everything entered on this unsaved ${noun} will be cleared.`, 'Discard'))) return;
    await local.remove(storageKey);
    setRestored(false);
    setStep(0);
    if (id) setDraft(await loadExisting(kind, id));
    else setDraft({ ...emptyDraft(), businessId: draft?.businessId ?? '' });
  }

  // ------------------------------------------------------------ inline add

  async function addClient() {
    if (!clientSheet?.name.trim()) return toast('Enter the client name', 'error');
    setSheetBusy(true);
    try {
      const c = await api<Client>('/clients', { body: { name: clientSheet.name.trim(), phone: clientSheet.phone.trim(), whatsapp: clientSheet.phone.trim(), city: clientSheet.city.trim() } });
      clients.setData([c, ...(clients.data ?? [])]);
      set({ clientId: c.id, clientName: c.name, billingAddress: '' });
      setClientSheet(null);
      toast('Client added');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSheetBusy(false);
    }
  }

  async function addService() {
    if (!serviceSheet?.name.trim()) return toast('Enter the service name', 'error');
    setSheetBusy(true);
    try {
      const s = await api<Service>('/services', {
        body: { name: serviceSheet.name.trim(), unit: serviceSheet.unit.trim(), defaultPrice: parseMoney(serviceSheet.price, precision) ?? 0, taxRateBp: parseMoney(serviceSheet.tax, 2) ?? 0 },
      });
      services.setData([...(services.data ?? []), s]);
      set({ lines: [...draft!.lines, lineFromService(s, precision)] });
      setServiceSheet(null);
      toast('Service saved and added');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSheetBusy(false);
    }
  }

  // ------------------------------------------------------------ line helpers

  const lineTotal = (i: number) => totals.lines[i]?.net ?? 0;
  function commitLine(l: LineDraft) {
    const exists = draft!.lines.some((x) => x.key === l.key);
    set({ lines: exists ? draft!.lines.map((x) => (x.key === l.key ? l : x)) : [...draft!.lines, l] });
    setEditing(null);
  }
  function moveLine(index: number, dir: -1 | 1) {
    const to = index + dir;
    if (to < 0 || to >= draft!.lines.length) return;
    const lines = [...draft!.lines];
    [lines[index], lines[to]] = [lines[to], lines[index]];
    set({ lines });
  }

  function splitInstallments(count: number) {
    if (remainingAfterPay <= 0) return toast('Nothing remains to schedule', 'error');
    const base = Math.floor(remainingAfterPay / count);
    const start = isDate(draft!.dueDate) ? draft!.dueDate : draft!.issueDate;
    set({
      installments: Array.from({ length: count }, (_, i) => ({
        key: newKey(),
        dueDate: addMonths(start, i),
        amount: moneyToInput(i === count - 1 ? remainingAfterPay - base * (count - 1) : base, precision),
      })),
    });
  }

  // ------------------------------------------------------------ steps

  const step1 = (
    <>
      {restored && (
        <Card>
          <Txt v="sub">Your unsaved {noun} was restored.</Txt>
          <Btn small kind="secondary" title="Discard and start fresh" onPress={startFresh} />
        </Card>
      )}
      <Select
        label="Issuing business"
        value={business ? business.tradingName || business.legalName : ''}
        placeholder="Choose business"
        items={(businesses.data ?? []).filter((b) => b.status === 'active' || b.id === draft.businessId)}
        getKey={(b) => b.id}
        getLabel={(b) => b.tradingName || b.legalName}
        getSub={(b) => `${b.currency} · invoices ${b.invoicePrefix}…`}
        onSelect={(b) => set({ businessId: b.id })}
        error={errors.business}
      />
      <Select
        label="Client"
        value={client?.name ?? draft.clientName}
        placeholder="Choose client"
        items={(clients.data ?? []).filter((c) => c.status === 'active' || c.id === draft.clientId)}
        getKey={(c) => c.id}
        getLabel={(c) => c.name}
        getSub={(c) => [c.contactPerson, c.phone, c.city].filter(Boolean).join(' · ')}
        onSelect={(c) => set({ clientId: c.id, clientName: c.name, billingAddress: c.address })}
        onAdd={can('clients.manage') ? (typed) => setClientSheet({ name: typed, phone: '', city: '' }) : undefined}
        addLabel="Add new client"
        error={errors.client}
      />
      {client && (client.address || client.extraAddresses.length > 0) && (
        <Select
          label="Billing address"
          value={draft.billingAddress}
          placeholder="Choose address"
          items={[client.address, ...client.extraAddresses].filter(Boolean)}
          getKey={(a) => a}
          getLabel={(a) => a}
          onSelect={(a) => set({ billingAddress: a })}
        />
      )}
      {kind === 'recurring' && (
        <Field label="Schedule name" value={draft.schedule.name} onChangeText={(v) => setSchedule({ name: v })} placeholder="e.g. Monthly maintenance contract" error={errors.name} />
      )}
      <DateField
        label={kind === 'recurring' ? 'First invoice date' : kind === 'quote' ? 'Quotation date' : 'Invoice date'}
        value={draft.issueDate}
        onChange={(v) => set({ issueDate: v })}
        error={errors.issueDate}
        quick={kind === 'recurring' ? [{ label: 'Today', value: today }, { label: '1st of next month', value: firstOfNextMonth(today) }] : undefined}
      />
      {kind !== 'recurring' && (
      <DateField
        label={kind === 'quote' ? 'Valid until' : 'Due date'}
        value={draft.dueDate}
        onChange={(v) => set({ dueDate: v })}
        error={errors.dueDate}
        quick={
          isDate(draft.issueDate)
            ? [
                ...(kind === 'quote' ? [] : [{ label: 'On receipt', value: draft.issueDate }]),
                { label: '7 days', value: addDays(draft.issueDate, 7) },
                { label: '15 days', value: addDays(draft.issueDate, 15) },
                { label: '30 days', value: addDays(draft.issueDate, 30) },
              ]
            : undefined
        }
      />
      )}
      <Field label="Reference or project number (optional)" value={draft.reference} onChangeText={(v) => set({ reference: v })} />
      {kind !== 'recurring' && business && (
        <>
          <CurrencySelect label="Currency" value={docCurrency} onChange={(c) => set({ currency: c === business.currency ? '' : c, fxRate: '' })} />
          {foreign && (
            <Field
              label={`1 ${docCurrency} = how many ${business.currency}?`}
              money
              value={draft.fxRate}
              onChangeText={(v) => set({ fxRate: v })}
              placeholder="Latest recorded rate"
              hint="Leave empty to use the latest rate under Finance → Exchange rates. The rate is kept with the invoice."
            />
          )}
        </>
      )}
      {client && client.creditLimit > 0 && kind === 'invoice' && (
        <Txt v="small" color={(client.outstanding ?? 0) > client.creditLimit ? t.danger : undefined}>
          Credit limit {fm(client.creditLimit, business)} · currently owes {fm(client.outstanding ?? 0, business)}
        </Txt>
      )}
    </>
  );

  const step2 = (
    <>
      <Select
        label="Add a saved service or product"
        value=""
        placeholder="Search services"
        items={(services.data ?? []).filter((s) => s.status === 'active')}
        getKey={(s) => s.id}
        getLabel={(s) => s.name}
        getSub={(s) => `${money(s.defaultPrice)}${s.unit ? ` / ${s.unit}` : ''}${s.category ? ` · ${s.category}` : ''}`}
        onSelect={(s) => set({ lines: [...draft.lines, lineFromService(s, precision)] })}
        onAdd={can('invoices.create') ? (typed) => setServiceSheet({ name: typed, price: '', unit: '', tax: '' }) : undefined}
        addLabel="Quick-add service"
        error={errors.lines}
      />
      <Btn kind="secondary" icon="create-outline" title="Add custom item" onPress={() => setEditing(emptyLine())} />
      {draft.lines.length === 0 && <Txt v="sub">No items yet. Pick a saved service or add a custom item.</Txt>}
      {draft.lines.map((l, i) => (
        <Card key={l.key}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${l.name || 'item'}`} onPress={() => setEditing(l)} style={{ gap: 3 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Txt style={{ fontWeight: '700', flex: 1 }}>{l.name || 'Untitled item'}</Txt>
              <Txt style={{ fontWeight: '700' }}>{money(lineTotal(i))}</Txt>
            </Row>
            <Txt v="small">
              {l.qty || '0'} {l.unit} × {l.unitPrice || '0'}
              {l.discountValue ? ` · discount ${l.discountValue}${l.discountType === 'percent' ? '%' : ''}` : ''}
              {l.taxPercent ? ` · tax ${l.taxPercent}%` : ''}
            </Txt>
          </Pressable>
          <Row style={{ justifyContent: 'flex-end' }} gap={6}>
            <IconBtn icon="arrow-up" label="Move up" onPress={() => moveLine(i, -1)} />
            <IconBtn icon="arrow-down" label="Move down" onPress={() => moveLine(i, 1)} />
            <IconBtn icon="copy-outline" label="Duplicate item" onPress={() => set({ lines: [...draft.lines.slice(0, i + 1), { ...l, key: newKey() }, ...draft.lines.slice(i + 1)] })} />
            <IconBtn icon="create-outline" label="Edit item" onPress={() => setEditing(l)} />
            <IconBtn icon="trash-outline" label="Remove item" color={t.danger} onPress={() => set({ lines: draft.lines.filter((x) => x.key !== l.key) })} />
          </Row>
        </Card>
      ))}
    </>
  );

  const step3 = (
    <>
      <Section title="Overall discount">
        <Chips
          value={draft.overallDiscountType}
          onChange={(v) => set({ overallDiscountType: v, overallDiscountValue: '' })}
          options={[
            { value: 'percent', label: 'Percentage %' },
            { value: 'fixed', label: 'Fixed amount' },
          ]}
        />
        <Field
          label={draft.overallDiscountType === 'percent' ? 'Discount %' : 'Discount amount'}
          money
          value={draft.overallDiscountValue}
          onChangeText={(v) => set({ overallDiscountValue: v })}
          placeholder="0"
          hint={totals.overallDiscount ? `− ${money(totals.overallDiscount)}` : undefined}
        />
      </Section>
      <Section title="Tax">
        <Field
          label="Tax % for all items"
          money
          placeholder="0"
          value={draft.lines.length && draft.lines.every((l) => l.taxPercent === draft.lines[0].taxPercent) ? draft.lines[0].taxPercent : ''}
          onChangeText={(v) => set({ lines: draft.lines.map((l) => ({ ...l, taxPercent: v })) })}
          hint={`${business?.taxInclusive ? 'Prices include tax' : 'Tax is added on top of prices'} · tax ${money(totals.taxAmount)}. Edit an item to give it its own rate.`}
        />
      </Section>
      <Section title="Additional charges">
        <Row style={{ flexWrap: 'wrap' }}>
          {['Transportation', 'Other expenses', 'Adjustment'].map((label) => (
            <Btn key={label} small kind="secondary" icon="add" title={label} onPress={() => set({ charges: [...draft.charges, { key: newKey(), label, amount: '' }] })} />
          ))}
        </Row>
        {draft.charges.map((c) => {
          const patch = (p: Partial<typeof c>) => set({ charges: draft.charges.map((x) => (x.key === c.key ? { ...x, ...p } : x)) });
          return (
            <Card key={c.key}>
              <Field label="Charge name" value={c.label} onChangeText={(v) => patch({ label: v })} />
              <Field
                label="Amount"
                value={c.amount}
                onChangeText={(v) => patch({ amount: v })}
                keyboardType="numbers-and-punctuation"
                placeholder="0"
                hint="Use a minus sign for a deduction"
                right={<IconBtn icon="trash-outline" label="Remove charge" color={t.danger} onPress={() => set({ charges: draft.charges.filter((x) => x.key !== c.key) })} />}
              />
            </Card>
          );
        })}
      </Section>
      <Totals />
    </>
  );

  const step4 = !can('payments.record') ? (
    <Notice>You can create this invoice, but recording payments needs a higher permission. It will be saved as unpaid.</Notice>
  ) : (
    <>
      <Section title="Payment status">
        <View style={{ gap: 8 }}>
          {MODES.map((m) => {
            const on = draft.paymentMode === m.value;
            return (
              <Pressable
                key={m.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => set({ paymentMode: m.value })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primarySoft : t.card }}>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? t.primary : t.sub} />
                <Txt style={{ fontWeight: '600' }}>{m.label}</Txt>
              </Pressable>
            );
          })}
        </View>
      </Section>

      {draft.paymentMode !== 'unpaid' && (
        <Section title={draft.paymentMode === 'installments' ? 'Payment received now (optional)' : 'Payment received'}>
          {draft.paymentMode === 'paid' ? (
            <Notice kind="success">The full {money(totals.total)} will be recorded as received.</Notice>
          ) : (
            <Field
              label={draft.paymentMode === 'advance' ? 'Advance amount' : 'Amount received'}
              money
              placeholder="0"
              value={draft.payAmount}
              onChangeText={(v) => set({ payAmount: v })}
              error={errors.payAmount}
              hint={
                payNow > totals.total
                  ? `${money(payNow - totals.total)} more than the invoice: the extra is kept as client advance`
                  : payNow > 0
                    ? `Remaining after this payment: ${money(remainingAfterPay)}`
                    : undefined
              }
            />
          )}
          {payNow > 0 && (
            <>
              <Txt v="label">Payment method</Txt>
              <Chips value={draft.payMethod} onChange={(v) => set({ payMethod: v })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
              <DateField label="Payment date" value={draft.payDate} onChange={(v) => set({ payDate: v })} error={errors.payDate} />
              <Field label="Transaction reference (optional)" value={draft.payReference} onChangeText={(v) => set({ payReference: v })} />
            </>
          )}
        </Section>
      )}

      {draft.paymentMode === 'installments' && (
        <Section title="Installment schedule">
          <Txt v="sub">Split the remaining {money(remainingAfterPay)} into monthly installments:</Txt>
          <Row style={{ flexWrap: 'wrap' }}>
            {[2, 3, 4, 6, 12].map((n) => (
              <Btn key={n} small kind="secondary" title={`${n}`} onPress={() => splitInstallments(n)} />
            ))}
            <Btn small kind="secondary" icon="add" title="Add" onPress={() => set({ installments: [...draft.installments, { key: newKey(), dueDate: draft.dueDate, amount: '' }] })} />
          </Row>
          {!!errors.installments && <Notice kind="danger">{errors.installments}</Notice>}
          {draft.installments.map((s, i) => {
            const patch = (p: Partial<typeof s>) => set({ installments: draft.installments.map((x) => (x.key === s.key ? { ...x, ...p } : x)) });
            return (
              <Card key={s.key}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt v="label">Installment {i + 1}</Txt>
                  <IconBtn icon="trash-outline" label="Remove installment" color={t.danger} onPress={() => set({ installments: draft.installments.filter((x) => x.key !== s.key) })} />
                </Row>
                <Row gap={10} style={{ alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <DateField label="Due date" value={s.dueDate} onChange={(v) => patch({ dueDate: v })} />
                  </View>
                  <Field style={{ flex: 1 }} label="Amount" money placeholder="0" value={s.amount} onChangeText={(v) => patch({ amount: v })} />
                </Row>
                {can('payments.record') && (
                  <Row style={{ justifyContent: 'space-between' }}>
                    <InstallmentBadge status={s.paid ? 'paid' : 'pending'} />
                    <Row gap={8}>
                      <Txt v="small">{s.paid ? 'Already paid' : 'Mark as paid'}</Txt>
                      <Switch
                        accessibilityLabel={`Installment ${i + 1} paid`}
                        value={!!s.paid}
                        onValueChange={(on) =>
                          // money settles installments in order, so paid ones are always the earliest
                          set({ installments: draft.installments.map((x, n) => ({ ...x, paid: on ? n <= i || !!x.paid : n < i && !!x.paid })) })
                        }
                      />
                    </Row>
                  </Row>
                )}
              </Card>
            );
          })}
          {draft.installments.length > 0 && <KV k="Scheduled" v={`${money(scheduleSum)} of ${money(remainingAfterPay)}`} color={scheduleSum > remainingAfterPay ? t.danger : undefined} />}
          {paidInstallments > 0 && <KV k={`Already paid (${draft.installments.filter((x) => x.paid).length} installment${draft.installments.filter((x) => x.paid).length === 1 ? '' : 's'})`} v={money(paidInstallments)} color={t.success} />}
          {paidInstallments > 0 && <Txt v="small">This is recorded as a payment when the invoice is saved. Choose its method and date under Payment received.</Txt>}
        </Section>
      )}
    </>
  );

  const sc = draft.schedule;
  const upcoming = isDate(draft.issueDate)
    ? Array.from({ length: 4 }, (_, n) => occurrence(draft.issueDate, sc.frequency, Number(sc.interval) || 1, n)).filter((x) => !sc.endDate || !isDate(sc.endDate) || x <= sc.endDate)
    : [];
  const unitWord = { weekly: 'weeks', monthly: 'months', yearly: 'years', custom: 'days' }[sc.frequency];

  const stepSchedule = (
    <>
      <Section title="How often">
        <Chips
          value={sc.frequency}
          onChange={(v: Frequency) => setSchedule({ frequency: v, interval: v === 'custom' ? '10' : '1' })}
          options={(['weekly', 'monthly', 'yearly', 'custom'] as Frequency[]).map((x) => ({ value: x, label: FREQUENCY_LABELS[x] }))}
        />
        <Field
          label={`Every how many ${unitWord}?`}
          value={sc.interval}
          onChangeText={(v) => setSchedule({ interval: v.replace(/\D/g, '') })}
          keyboardType="number-pad"
          maxLength={3}
          error={errors.interval}
          hint={describeSchedule(sc.frequency, Number(sc.interval) || 1)}
        />
      </Section>
      <Section title="Each invoice is due">
        <Chips
          value={['0', '7', '15', '30'].includes(sc.dueDays) ? sc.dueDays : 'other'}
          onChange={(v) => setSchedule({ dueDays: v === 'other' ? '' : v })}
          options={[
            { value: '0', label: 'On issue' },
            { value: '7', label: '7 days' },
            { value: '15', label: '15 days' },
            { value: '30', label: '30 days' },
            { value: 'other', label: 'Other' },
          ]}
        />
        {!['0', '7', '15', '30'].includes(sc.dueDays) && (
          <Field label="Days after the invoice date" value={sc.dueDays} onChangeText={(v) => setSchedule({ dueDays: v.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={3} error={errors.dueDays} />
        )}
      </Section>
      <DateField label="Stop after (optional)" value={sc.endDate} onChange={(v) => setSchedule({ endDate: v })} error={errors.endDate} quick={sc.endDate ? [{ label: 'No end date', value: '' }] : undefined} />
      <Card>
        <Txt v="label">Next invoice dates</Txt>
        {upcoming.length === 0 ? <Txt v="sub">Enter a valid first invoice date.</Txt> : upcoming.map((d, n) => <KV key={d} k={`${n + 1}. ${fd(d)}`} v={`due ${fd(addDays(d, Number(sc.dueDays) || 0))}`} />)}
      </Card>
      <Section title="Approval">
        <Card>
          <Row style={{ justifyContent: 'space-between' }} gap={12}>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: '700' }}>Issue automatically</Txt>
              <Txt v="small">
                {sc.autoIssue
                  ? 'Each run creates a final, numbered invoice straight away.'
                  : 'Each run creates a draft that waits in Recurring → Awaiting approval until someone finalizes it.'}
              </Txt>
            </View>
            <Switch accessibilityLabel="Issue invoices automatically" value={sc.autoIssue} disabled={!can('invoices.finalize')} onValueChange={(v) => setSchedule({ autoIssue: v })} />
          </Row>
          {!can('invoices.finalize') && <Txt v="small">Only users who can finalize invoices can turn this on.</Txt>}
        </Card>
        <Notice>Nothing is sent to the client automatically. Generated invoices appear in the app for you to share.</Notice>
      </Section>
    </>
  );

  function Totals() {
    return (
      <Card>
        <KV k="Subtotal" v={money(totals!.subtotal)} />
        {totals!.itemDiscounts > 0 && <KV k="Item discounts" v={`− ${money(totals!.itemDiscounts)}`} />}
        {totals!.overallDiscount > 0 && <KV k="Overall discount" v={`− ${money(totals!.overallDiscount)}`} />}
        <KV k="Taxable amount" v={money(totals!.taxableAmount)} />
        <KV k={business?.taxInclusive ? 'Tax (included)' : 'Tax'} v={money(totals!.taxAmount)} />
        {totals!.chargesTotal !== 0 && <KV k="Additional charges" v={money(totals!.chargesTotal)} />}
        {totals!.roundingAdjustment !== 0 && <KV k="Rounding" v={money(totals!.roundingAdjustment)} />}
        <KV k={kind === 'quote' ? 'Quotation total' : kind === 'recurring' ? 'Total per invoice' : 'Invoice total'} v={money(totals!.total)} bold />
        {payNow > 0 && <KV k="Received now" v={money(payNow)} color={t.success} />}
        {payNow > 0 && <KV k={payNow > totals!.total ? 'Kept as client advance' : 'Remaining balance'} v={money(Math.abs(totals!.total - payNow))} bold />}
      </Card>
    );
  }

  const step5 = (
    <>
      <Card>
        <Txt v="small">FROM</Txt>
        <Txt v="h">{business ? business.tradingName || business.legalName : ''}</Txt>
        {!!business?.address && <Txt v="small">{business.address}</Txt>}
        <View style={{ height: 6 }} />
        <Txt v="small">BILL TO</Txt>
        <Txt style={{ fontWeight: '700' }}>{client?.name ?? draft.clientName}</Txt>
        {!!draft.billingAddress && <Txt v="small">{draft.billingAddress}</Txt>}
        <View style={{ height: 6 }} />
        {kind === 'invoice' && <KV k="Invoice number" v="Assigned when finalized" />}
        {kind === 'quote' && <KV k="Quotation number" v="Assigned when saved" />}
        {kind === 'recurring' ? (
          <>
            <KV k="Schedule" v={`${draft.schedule.name || 'Untitled'} · ${describeSchedule(sc.frequency, Number(sc.interval) || 1)}`} />
            <KV k="First invoice" v={fd(draft.issueDate)} />
            <KV k="Due" v={Number(sc.dueDays) ? `${sc.dueDays} days after each invoice` : 'On issue'} />
            <KV k="Ends" v={sc.endDate ? fd(sc.endDate) : 'No end date'} />
            <KV k="Approval" v={sc.autoIssue ? 'Issued automatically' : 'Drafts wait for approval'} />
          </>
        ) : (
          <>
            <KV k={kind === 'quote' ? 'Quotation date' : 'Invoice date'} v={fd(draft.issueDate)} />
            <KV k={kind === 'quote' ? 'Valid until' : 'Due date'} v={fd(draft.dueDate)} />
          </>
        )}
        {!!draft.reference && <KV k="Reference" v={draft.reference} />}
      </Card>
      <Card>
        {draft.lines.map((l, i) => (
          <Row key={l.key} style={{ justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 4 }}>
            <View style={{ flex: 1 }}>
              <Txt v="sub" color={t.text} style={{ fontWeight: '600' }}>
                {l.name}
              </Txt>
              <Txt v="small">
                {l.qty} {l.unit} × {l.unitPrice}
              </Txt>
            </View>
            <Txt v="sub" color={t.text}>
              {money(lineTotal(i))}
            </Txt>
          </Row>
        ))}
      </Card>
      <Totals />
      {kind === 'invoice' && draft.paymentMode === 'installments' && draft.installments.length > 0 && (
        <Card>
          <Txt v="label">Installments</Txt>
          {draft.installments.map((s, i) => (
            <KV key={s.key} k={`${i + 1}. ${fd(s.dueDate)}${s.paid && paidInstallments > 0 ? ' · Paid' : ''}`} v={money(parseMoney(s.amount, precision) ?? 0)} />
          ))}
        </Card>
      )}
      <Field
        label={kind === 'quote' ? 'Terms & conditions (optional)' : 'Payment terms (optional)'}
        value={draft.paymentTerms}
        onChangeText={(v) => set({ paymentTerms: v })}
        placeholder={kind === 'quote' ? 'e.g. 50% advance, balance on delivery' : 'e.g. Net 30'}
        multiline={kind === 'quote'}
      />
      <Field label={`Notes on ${kind === 'quote' ? 'quotation' : 'invoice'} (optional)`} value={draft.notes} onChangeText={(v) => set({ notes: v })} multiline />
      <Btn kind="secondary" icon="eye-outline" title={`Preview ${kind === 'quote' ? 'quotation' : 'invoice'} document`} onPress={() => (validate(flow.length - 2) ? setViewer(true) : undefined)} />
      {overLimit && (
        <Notice kind="danger">
          This invoice takes {client?.name} over their credit limit of {fm(client!.creditLimit, business)}. {can('invoices.approve') ? 'You can approve it when saving.' : 'Save it as a draft for a manager to approve.'}
        </Notice>
      )}
      {kind === 'invoice' && (
        <>
          <Notice>Nothing is issued until you choose Save as Final. The invoice number is assigned at that moment.</Notice>
          {can('invoices.finalize') ? (
            <Btn icon="checkmark-circle-outline" title={payNow > 0 ? 'Save Final & Record Payment' : 'Save as Final Invoice'} onPress={() => save(true)} loading={saving === 'final'} disabled={!!saving} />
          ) : (
            <Notice kind="warn">Finalizing needs a higher permission. Save a draft for approval.</Notice>
          )}
          <Btn kind="secondary" icon="save-outline" title="Save as Draft" onPress={() => save(false)} loading={saving === 'draft'} disabled={!!saving} />
        </>
      )}
      {kind === 'quote' && (
        <>
          <Notice>Saving does not send anything. Share the quotation from its page, then mark it as sent.</Notice>
          <Btn icon="paper-plane-outline" title="Save & mark as sent" onPress={() => save(true)} loading={saving === 'final'} disabled={!!saving} />
          <Btn kind="secondary" icon="save-outline" title={draft.id ? 'Save changes' : 'Save as draft quotation'} onPress={() => save(false)} loading={saving === 'draft'} disabled={!!saving} />
        </>
      )}
      {kind === 'recurring' && <Btn icon="repeat-outline" title={draft.id ? 'Save schedule' : 'Start schedule'} onPress={() => save(false)} loading={saving === 'draft'} disabled={!!saving} />}
    </>
  );

  return (
    <Screen
      scrollKey={step}
      footer={
        <>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="sub">
              {draft.lines.length} item{draft.lines.length === 1 ? '' : 's'}
            </Txt>
            <CountUp value={totals.total} format={(v) => `Total ${money(v)}`} style={{ fontSize: 18, fontWeight: '800', color: t.text }} />
          </Row>
          <Row gap={10}>
            {step > 0 && <Btn kind="secondary" title="Back" onPress={() => setStep(step - 1)} style={{ flex: 1 }} />}
            {step < STEPS.length - 1 ? (
              <Btn title="Next" onPress={next} style={{ flex: 2 }} />
            ) : (
              <Btn kind="secondary" title={kind === 'recurring' ? 'Save schedule' : 'Save Draft'} onPress={() => save(false)} loading={saving === 'draft'} disabled={!!saving} style={{ flex: 2 }} />
            )}
          </Row>
        </>
      }>
      <Stack.Screen options={{ title: TITLES[kind][id ? 1 : 0] }} />
      <Stepper steps={STEPS} step={step} onStepPress={(i) => (i <= step || validate(i - 1)) && setStep(i)} />

      <StepSlide key={step} direction={direction}>
        {{ party: step1, items: step2, adjust: step3, payment: step4, schedule: stepSchedule, preview: step5 }[flow[step]]}
      </StepSlide>

      {business && (
        <DocumentViewer
          visible={viewer}
          onClose={() => setViewer(false)}
          title={kind === 'quote' ? 'Quotation preview' : 'Invoice preview'}
          fileName={kind === 'quote' ? 'quotation-preview' : 'invoice-preview'}
          build={buildDoc}
          template={business.invoiceTemplate}
          note={kind === 'quote' ? 'Not saved yet. The quotation number appears once you save it.' : kind === 'recurring' ? 'Sample of one generated invoice. Each one gets its own number and dates.' : 'Not saved yet. The invoice number appears once you save it as final.'}
        />
      )}

      <LineSheet line={editing} precision={precision} onClose={() => setEditing(null)} onSave={commitLine} />

      <Sheet visible={!!clientSheet} title="New client" onClose={() => setClientSheet(null)}>
        <Field label="Client or business name" value={clientSheet?.name ?? ''} onChangeText={(v) => setClientSheet((s) => s && { ...s, name: v })} autoFocus />
        <Field label="Phone / WhatsApp (optional)" value={clientSheet?.phone ?? ''} onChangeText={(v) => setClientSheet((s) => s && { ...s, phone: v })} keyboardType="phone-pad" />
        <Field label="City (optional)" value={clientSheet?.city ?? ''} onChangeText={(v) => setClientSheet((s) => s && { ...s, city: v })} />
        <Txt v="small">You can add the remaining details later from the client's profile.</Txt>
        <Btn title="Save client" onPress={addClient} loading={sheetBusy} />
      </Sheet>

      <Sheet visible={!!serviceSheet} title="Quick-add service" onClose={() => setServiceSheet(null)}>
        <Field label="Service or product name" value={serviceSheet?.name ?? ''} onChangeText={(v) => setServiceSheet((s) => s && { ...s, name: v })} autoFocus />
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <Field style={{ flex: 1 }} label="Default price" money placeholder="0" value={serviceSheet?.price ?? ''} onChangeText={(v) => setServiceSheet((s) => s && { ...s, price: v })} />
          <Field style={{ flex: 1 }} label="Unit" placeholder="hour, kg, trip" value={serviceSheet?.unit ?? ''} onChangeText={(v) => setServiceSheet((s) => s && { ...s, unit: v })} autoCapitalize="none" />
        </Row>
        <Field label="Tax % (optional)" money placeholder="0" value={serviceSheet?.tax ?? ''} onChangeText={(v) => setServiceSheet((s) => s && { ...s, tax: v })} />
        <Btn title="Save and add to invoice" onPress={addService} loading={sheetBusy} />
      </Sheet>
    </Screen>
  );
}

const TITLES: Record<BuilderKind, [string, string]> = {
  invoice: ['Create Invoice', 'Edit Draft Invoice'],
  quote: ['New Quotation', 'Edit Quotation'],
  recurring: ['New Recurring Invoice', 'Edit Recurring Invoice'],
};

function firstOfNextMonth(date: string) {
  const [y, m] = date.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

async function loadExisting(kind: BuilderKind, id: string): Promise<InvoiceDraft> {
  if (kind === 'quote') return draftFromQuote((await api<{ quotation: Quotation }>(`/quotations/${id}`)).quotation);
  if (kind === 'recurring') return draftFromRecurring((await api<{ schedule: RecurringInvoice }>(`/recurring/${id}`)).schedule);
  return draftFromInvoice((await api<{ invoice: Invoice }>(`/invoices/${id}`)).invoice);
}

function LineSheet({ line, precision, onClose, onSave }: { line: LineDraft | null; precision: number; onClose: () => void; onSave: (l: LineDraft) => void }) {
  const toast = useToast();
  const [l, setL] = useState<LineDraft | null>(line);
  useEffect(() => setL(line), [line]);
  if (!l) return null;
  const patch = (p: Partial<LineDraft>) => setL({ ...l, ...p });
  function done() {
    if (!l) return;
    if (!l.name.trim()) return toast('Enter the item name', 'error');
    if (!((parseQty(l.qty) ?? 0) > 0)) return toast('Quantity must be above zero', 'error');
    if (parseMoney(l.unitPrice, precision) === null) return toast('Enter the unit price', 'error');
    onSave(l);
  }
  return (
    <Sheet visible title="Item" onClose={onClose}>
      <Field label="Service / product name" value={l.name} onChangeText={(v) => patch({ name: v })} />
      <Field label="Description (optional)" value={l.description} onChangeText={(v) => patch({ description: v })} multiline />
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <Field style={{ flex: 1 }} label="Quantity" money value={l.qty} onChangeText={(v) => patch({ qty: v })} />
        <Field style={{ flex: 1 }} label="Unit" value={l.unit} onChangeText={(v) => patch({ unit: v })} autoCapitalize="none" placeholder="hour, kg, trip" />
      </Row>
      <Field label="Unit price" money placeholder="0" value={l.unitPrice} onChangeText={(v) => patch({ unitPrice: v })} />
      <Chips
        value={l.discountType}
        onChange={(v) => patch({ discountType: v, discountValue: '' })}
        options={[
          { value: 'percent', label: 'Discount %' },
          { value: 'fixed', label: 'Discount amount' },
        ]}
      />
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <Field style={{ flex: 1 }} label={l.discountType === 'percent' ? 'Discount %' : 'Discount amount'} money placeholder="0" value={l.discountValue} onChangeText={(v) => patch({ discountValue: v })} />
        <Field style={{ flex: 1 }} label="Tax %" money placeholder="0" value={l.taxPercent} onChangeText={(v) => patch({ taxPercent: v })} />
      </Row>
      <Btn title="Done" onPress={done} />
    </Sheet>
  );
}
