import { useState } from 'react';
import { View } from 'react-native';
import { Badge, Btn, Card, Chips, Empty, Field, Loader, Row, Screen, SearchBar, Sheet, Txt, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { moneyToInput, parseMoney, parsePercent, percentToString, type Service } from '@/lib/shared';

interface Form {
  id?: string;
  name: string;
  category: string;
  description: string;
  price: string;
  unit: string;
  tax: string;
  discount: string;
  status: 'active' | 'inactive';
}
const blank: Form = { name: '', category: '', description: '', price: '', unit: '', tax: '', discount: '', status: 'active' };
const EXAMPLES = ['Software Development', 'Consultancy', 'Laboratory Testing', 'Weighbridge Services', 'Transportation', 'Installation', 'Maintenance', 'Technical Support'];

export default function Services() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload, refreshing } = useApi<Service[]>('/services');
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can('invoices.create');
  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  const needle = q.trim().toLowerCase();
  const shown = (data ?? []).filter((s) => !needle || `${s.name} ${s.category}`.toLowerCase().includes(needle));

  const edit = (s: Service) =>
    setForm({
      id: s.id,
      name: s.name,
      category: s.category,
      description: s.description,
      price: moneyToInput(s.defaultPrice),
      unit: s.unit,
      tax: s.taxRateBp ? percentToString(s.taxRateBp) : '',
      discount: s.defaultDiscountBp ? percentToString(s.defaultDiscountBp) : '',
      status: s.status,
    });

  async function save() {
    if (!form) return;
    if (!form.name.trim()) return toast('Enter the service name', 'error');
    const tax = form.tax.trim() ? parsePercent(form.tax) : 0;
    const discount = form.discount.trim() ? parsePercent(form.discount) : 0;
    const price = form.price.trim() ? parseMoney(form.price) : 0;
    if (price === null || price < 0) return toast('Default price is not a valid amount', 'error');
    if (tax === null || tax < 0 || tax > 10000 || discount === null || discount < 0 || discount > 10000) return toast('Tax and discount must be between 0 and 100%', 'error');
    setBusy(true);
    try {
      const body = { name: form.name.trim(), category: form.category.trim(), description: form.description.trim(), defaultPrice: price, unit: form.unit.trim(), taxRateBp: tax, defaultDiscountBp: discount, status: form.status };
      await api(form.id ? `/services/${form.id}` : '/services', { method: form.id ? 'PUT' : 'POST', body });
      toast(form.id ? 'Service updated' : 'Service added');
      setForm(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <SearchBar value={q} onChange={setQ} placeholder="Search services and products" />
      {canEdit && <Btn icon="add" title="Add service or product" onPress={() => setForm(blank)} />}
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {shown.length === 0 ? (
          <Empty icon="pricetags-outline" title={needle ? 'Nothing matches' : 'No services yet'} hint={needle ? undefined : `Add anything you bill for: ${EXAMPLES.slice(0, 4).join(', ')} and more.`} />
        ) : (
          shown.map((s) => (
            <Card key={s.id} onPress={canEdit ? () => edit(s) : undefined} label={`Service ${s.name}`}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt style={{ fontWeight: '700' }}>{s.name}</Txt>
                  <Txt v="small">
                    {[s.category, s.taxRateBp ? `tax ${percentToString(s.taxRateBp)}%` : '', s.defaultDiscountBp ? `discount ${percentToString(s.defaultDiscountBp)}%` : ''].filter(Boolean).join(' · ') || 'No category'}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Txt style={{ fontWeight: '700' }}>
                    {fm(s.defaultPrice)}
                    {s.unit ? ` / ${s.unit}` : ''}
                  </Txt>
                  {s.status === 'inactive' && <Badge status="inactive" />}
                </View>
              </Row>
            </Card>
          ))
        )}
      </Loader>

      <Sheet visible={!!form} title={form?.id ? 'Edit service' : 'New service or product'} onClose={() => setForm(null)}>
        <Field label="Service / product name" value={form?.name ?? ''} onChangeText={(v) => set({ name: v })} placeholder="e.g. Laboratory Testing" />
        <Field label="Category" value={form?.category ?? ''} onChangeText={(v) => set({ category: v })} />
        <Field label="Description" value={form?.description ?? ''} onChangeText={(v) => set({ description: v })} multiline />
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <Field style={{ flex: 1 }} label="Default price" money placeholder="0" value={form?.price ?? ''} onChangeText={(v) => set({ price: v })} />
          <Field style={{ flex: 1 }} label="Unit" placeholder="hour, kg, trip" value={form?.unit ?? ''} onChangeText={(v) => set({ unit: v })} autoCapitalize="none" />
        </Row>
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <Field style={{ flex: 1 }} label="Tax %" money placeholder="0" value={form?.tax ?? ''} onChangeText={(v) => set({ tax: v })} />
          <Field style={{ flex: 1 }} label="Default discount %" money placeholder="0" value={form?.discount ?? ''} onChangeText={(v) => set({ discount: v })} />
        </Row>
        <Chips
          value={form?.status ?? 'active'}
          onChange={(v) => set({ status: v })}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
        />
        <Btn title="Save" onPress={save} loading={busy} />
      </Sheet>
    </Screen>
  );
}
