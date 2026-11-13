import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Btn, Card, Chips, Field, IconBtn, Loading, Row, Screen, Section } from '@/components/ui';
import { api } from '@/lib/api';
import { useTheme, useToast } from '@/lib/app-context';
import { moneyToInput, parseMoney, type Client } from '@/lib/shared';

type Form = Omit<Client, 'id' | 'openingBalance' | 'creditLimit' | 'outstanding' | 'credit'> & { openingBalance: string; creditLimit: string };
const blank: Form = {
  name: '', contactPerson: '', phone: '', whatsapp: '', email: '', cnic: '', ntn: '', address: '', city: '', province: '', country: 'Pakistan',
  extraAddresses: [], extraContacts: [], category: '', openingBalance: '', creditLimit: '', notes: '', status: 'active',
};

export default function ClientEdit() {
  const t = useTheme();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [f, setF] = useState<Form | null>(id ? null : blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (p: Partial<Form>) => setF((x) => (x ? { ...x, ...p } : x));

  useEffect(() => {
    if (!id) return;
    api<Client>(`/clients/${id}`)
      .then((c) => setF({ ...c, openingBalance: c.openingBalance ? moneyToInput(c.openingBalance) : '', creditLimit: c.creditLimit ? moneyToInput(c.creditLimit) : '' }))
      .catch((e) => {
        toast(e.message, 'error');
        router.back();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    if (!f) return;
    if (!f.name.trim()) return setError('Client name is required');
    const openingBalance = f.openingBalance.trim() ? parseMoney(f.openingBalance) : 0;
    if (openingBalance === null) return toast('Opening balance is not a valid amount', 'error');
    const creditLimit = f.creditLimit.trim() ? parseMoney(f.creditLimit) : 0;
    if (creditLimit === null || creditLimit < 0) return toast('Credit limit is not a valid amount', 'error');
    setBusy(true);
    try {
      const body = {
        ...f,
        openingBalance,
        creditLimit,
        extraAddresses: f.extraAddresses.map((a) => a.trim()).filter(Boolean),
        extraContacts: f.extraContacts.filter((c) => c.name.trim() || c.phone.trim()),
      };
      const c = await api<Client>(id ? `/clients/${id}` : '/clients', { method: id ? 'PUT' : 'POST', body });
      toast(id ? 'Client updated' : 'Client added');
      if (id) router.back();
      else router.replace({ pathname: '/client/[id]', params: { id: c.id } });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!f) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen footer={<Btn title={id ? 'Save changes' : 'Save client'} onPress={save} loading={busy} />}>
      <Stack.Screen options={{ title: id ? 'Edit Client' : 'New Client' }} />
      <Section title="Basics">
        <Field label="Client / business name" value={f.name} onChangeText={(v) => (set({ name: v }), setError(''))} error={error} autoCapitalize="words" />
        <Field label="Contact person" value={f.contactPerson} onChangeText={(v) => set({ contactPerson: v })} autoCapitalize="words" />
        <Field label="Phone number" value={f.phone} onChangeText={(v) => set({ phone: v })} keyboardType="phone-pad" autoComplete="tel" />
        <Field label="WhatsApp number" value={f.whatsapp} onChangeText={(v) => set({ whatsapp: v })} keyboardType="phone-pad" hint="Leave empty to use the phone number" />
        <Field label="Email" value={f.email} onChangeText={(v) => set({ email: v })} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Client category" value={f.category} onChangeText={(v) => set({ category: v })} placeholder="e.g. Mill, Retail, Corporate" />
      </Section>

      <Section title="Billing address">
        <Field label="Address" value={f.address} onChangeText={(v) => set({ address: v })} multiline />
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <Field style={{ flex: 1 }} label="City" value={f.city} onChangeText={(v) => set({ city: v })} />
          <Field style={{ flex: 1 }} label="Province" value={f.province} onChangeText={(v) => set({ province: v })} />
        </Row>
        <Field label="Country" value={f.country} onChangeText={(v) => set({ country: v })} />
      </Section>

      <Section title="More addresses" action={<Btn small kind="ghost" icon="add" title="Add" onPress={() => set({ extraAddresses: [...f.extraAddresses, ''] })} />}>
        {f.extraAddresses.map((a, n) => (
          <Field
            key={n}
            label={`Address ${n + 2}`}
            value={a}
            onChangeText={(v) => set({ extraAddresses: f.extraAddresses.map((x, k) => (k === n ? v : x)) })}
            right={<IconBtn icon="trash-outline" label="Remove address" color={t.danger} onPress={() => set({ extraAddresses: f.extraAddresses.filter((_, k) => k !== n) })} />}
          />
        ))}
      </Section>

      <Section title="More contacts" action={<Btn small kind="ghost" icon="add" title="Add" onPress={() => set({ extraContacts: [...f.extraContacts, { name: '', phone: '' }] })} />}>
        {f.extraContacts.map((c, n) => {
          const patch = (p: Partial<typeof c>) => set({ extraContacts: f.extraContacts.map((x, k) => (k === n ? { ...x, ...p } : x)) });
          return (
            <Card key={n}>
              <Field label="Name" value={c.name} onChangeText={(v) => patch({ name: v })} />
              <Field
                label="Phone"
                value={c.phone}
                onChangeText={(v) => patch({ phone: v })}
                keyboardType="phone-pad"
                right={<IconBtn icon="trash-outline" label="Remove contact" color={t.danger} onPress={() => set({ extraContacts: f.extraContacts.filter((_, k) => k !== n) })} />}
              />
            </Card>
          );
        })}
      </Section>

      <Section title="Tax & account">
        <Field label="CNIC or registration number (optional)" value={f.cnic} onChangeText={(v) => set({ cnic: v })} />
        <Field label="NTN / tax number (optional)" value={f.ntn} onChangeText={(v) => set({ ntn: v })} />
        <Field label="Opening balance" value={f.openingBalance} onChangeText={(v) => set({ openingBalance: v })} keyboardType="numbers-and-punctuation" placeholder="0" hint="Amount the client already owes. Use a minus sign if you owe them." />
        <Field label="Credit limit" value={f.creditLimit} onChangeText={(v) => set({ creditLimit: v })} money placeholder="No limit" hint="Most this client may owe. Invoices that go over need a manager's approval. Leave empty for no limit." />
        <Field label="Notes" value={f.notes} onChangeText={(v) => set({ notes: v })} multiline />
        <Chips
          value={f.status}
          onChange={(v) => set({ status: v })}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
        />
      </Section>
    </Screen>
  );
}
