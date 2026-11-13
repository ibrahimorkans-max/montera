import { useState } from 'react';
import { View } from 'react-native';
import { CurrencySelect } from '@/components/money';
import { Btn, Card, DateField, Empty, Field, IconBtn, Loader, Notice, Row, Screen, Section, Sheet, Txt, confirm, fd, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { parseRate, rateToString, type ExchangeRate } from '@/lib/shared';

export default function Rates() {
  const t = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload, refreshing } = useApi<{ reportingCurrency: string; rates: ExchangeRate[] }>('/exchange-rates');
  const [form, setForm] = useState<{ currency: string; base: string; rate: string; date: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const manage = can('finance.manage');
  const reporting = data?.reportingCurrency ?? 'PKR';

  // latest rate per pair
  const latest = new Map<string, ExchangeRate>();
  for (const r of data?.rates ?? []) if (!latest.has(`${r.currency}/${r.baseCurrency}`)) latest.set(`${r.currency}/${r.baseCurrency}`, r);

  async function save() {
    if (!form) return;
    const rate = parseRate(form.rate);
    if (!rate) return toast('Enter the rate, e.g. 278.50', 'error');
    if (form.currency === form.base) return toast('Choose two different currencies', 'error');
    setBusy(true);
    try {
      await api('/exchange-rates', { body: { currency: form.currency, baseCurrency: form.base, rate, date: form.date, note: form.note.trim() } });
      toast('Rate saved');
      setForm(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function remove(r: ExchangeRate) {
    if (!(await confirm('Delete this rate?', `${r.currency} → ${r.baseCurrency} on ${fd(r.date)}`, 'Delete'))) return;
    try {
      await api(`/exchange-rates/${r.id}`, { method: 'DELETE' });
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }
  async function setReporting(code: string) {
    try {
      await api('/settings/reporting-currency', { method: 'PUT', body: { currency: code } });
      toast(`Combined totals now shown in ${code}`);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Txt v="sub">Rates convert foreign-currency invoices and accounts into your business currency for dashboards and reports. Each invoice keeps the rate it was issued with.</Txt>
      {can('businesses.manage') && <CurrencySelect label="Show combined totals (all businesses) in" value={reporting} onChange={setReporting} />}
      {manage && <Btn icon="add" title="Record a rate" onPress={() => setForm({ currency: 'USD', base: reporting, rate: '', date: todayStr(), note: '' })} />}
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {latest.size > 0 && (
          <Section title="Current rates">
            <Row gap={10} style={{ flexWrap: 'wrap' }}>
              {[...latest.values()].map((r) => (
                <Card key={r.id} style={{ flexBasis: '47%', flexGrow: 1, gap: 2 }}>
                  <Txt v="small">
                    1 {r.currency} =
                  </Txt>
                  <Txt v="h">
                    {rateToString(r.rate)} {r.baseCurrency}
                  </Txt>
                  <Txt v="small">since {fd(r.date)}</Txt>
                </Card>
              ))}
            </Row>
          </Section>
        )}
        <Section title="History">
          {(data?.rates.length ?? 0) === 0 ? (
            <Empty icon="swap-horizontal-outline" title="No rates recorded" hint="Add one before invoicing in another currency." />
          ) : (
            data!.rates.map((r) => (
              <Card key={r.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontWeight: '700' }}>
                      1 {r.currency} = {rateToString(r.rate)} {r.baseCurrency}
                    </Txt>
                    <Txt v="small">
                      {fd(r.date)}
                      {r.note ? ` · ${r.note}` : ''}
                    </Txt>
                  </View>
                  {manage && <IconBtn icon="trash-outline" label="Delete rate" color={t.danger} onPress={() => remove(r)} />}
                </Row>
              </Card>
            ))
          )}
        </Section>
      </Loader>

      <Sheet visible={!!form} title="Record exchange rate" onClose={() => setForm(null)}>
        <CurrencySelect label="Foreign currency" value={form?.currency ?? 'USD'} onChange={(c) => setForm((f) => f && { ...f, currency: c })} />
        <CurrencySelect label="In terms of" value={form?.base ?? reporting} onChange={(c) => setForm((f) => f && { ...f, base: c })} />
        <Field label={`1 ${form?.currency ?? ''} = how many ${form?.base ?? ''}?`} value={form?.rate ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, rate: v })} money placeholder="278.50" />
        <DateField label="Effective from" value={form?.date ?? ''} onChange={(v) => setForm((f) => f && { ...f, date: v })} />
        <Field label="Note (optional)" value={form?.note ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, note: v })} placeholder="e.g. State Bank rate" />
        <Notice>Recording a new rate does not change invoices already issued.</Notice>
        <Btn title="Save rate" onPress={save} loading={busy} />
      </Sheet>
    </Screen>
  );
}
