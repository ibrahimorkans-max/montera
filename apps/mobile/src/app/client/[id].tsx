import * as Clipboard from 'expo-clipboard';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { InstallmentItem, InvoiceRow, PaymentRow, settleAmounts } from '@/components/rows';
import { Badge, Btn, Card, Chips, IconBtn, KV, Loader, Row, Screen, Txt, fd, fm, Sheet, Field, DateField } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { AccountSelect } from '@/components/money';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { statementHtml, type Paper } from '@/lib/pdf';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, moneyToInput, parseMoney, type BusinessProfile, type ClientLedger, type InstallmentRow, type MoneyAccount, type PaymentMethod } from '@/lib/shared';

type Tab = 'overview' | 'invoices' | 'payments' | 'installments' | 'statement';
const digits = (s: string) => s.replace(/[^\d+]/g, '');

export default function ClientProfile() {
  const t = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: l, loading, error, reload, refreshing } = useApi<ClientLedger>(`/clients/${id}/ledger`);
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const installments = useApi<InstallmentRow[]>('/installments');
  const [tab, setTab] = useState<Tab>('overview');
  const [viewer, setViewer] = useState(false);
  const [refund, setRefund] = useState<{ amount: string; method: PaymentMethod; accountId: string; date: string; notes: string } | null>(null);
  const [busyAction, setBusyAction] = useState('');
  const accounts = useApi<MoneyAccount[]>('/accounts');

  const c = l?.client;
  // statement header: the business that invoiced this client most recently, else the first profile
  const business = businesses.data?.find((b) => b.id === l?.invoices.find((i) => i.status === 'final')?.businessId) ?? businesses.data?.[0];
  const m = (v: number) => fm(v, business);
  const buildStatement = useCallback((paper: Paper) => (l && business ? statementHtml(l, business, paper) : ''), [l, business]);
  const open = (url: string) => Linking.openURL(url).catch(() => toast('No app available to open this', 'error'));
  const phone = c ? digits(c.phone) : '';
  const whatsapp = c ? digits(c.whatsapp || c.phone).replace(/^\+/, '') : '';

  const clientInstallments = (installments.data ?? []).filter((s) => s.clientId === id);
  const settle = settleAmounts(clientInstallments);

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: c?.name ?? 'Client' }} />
      <Loader loading={loading && !l} error={l ? '' : error} onRetry={reload}>
        {l && c && (
          <>
            <Card>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Txt v="big">{c.name}</Txt>
                  <Txt v="sub">{[c.contactPerson, c.category].filter(Boolean).join(' · ')}</Txt>
                </View>
                <Badge status={c.status} />
              </Row>
              <Row gap={10} style={{ flexWrap: 'wrap' }}>
                {!!phone && <IconBtn icon="call-outline" label="Call client" onPress={() => open(`tel:${phone}`)} />}
                {!!whatsapp && <IconBtn icon="logo-whatsapp" label="Open WhatsApp chat" onPress={() => open(`https://wa.me/${whatsapp}`)} />}
                {!!c.email && <IconBtn icon="mail-outline" label="Send email" onPress={() => open(`mailto:${c.email}`)} />}
                {!!c.phone && (
                  <IconBtn
                    icon="copy-outline"
                    label="Copy phone number"
                    onPress={async () => {
                      await Clipboard.setStringAsync(c.phone);
                      toast('Phone number copied');
                    }}
                  />
                )}
                {can('clients.manage') && <IconBtn icon="create-outline" label="Edit client" onPress={() => router.push({ pathname: '/client/edit', params: { id: c.id } })} />}
              </Row>
              <Row gap={10}>
                {can('invoices.create') && <Btn small style={{ flex: 1 }} icon="document-text-outline" title="Create Invoice" onPress={() => router.push({ pathname: '/invoice/new', params: { clientId: c.id } })} />}
                {can('payments.record') && <Btn small style={{ flex: 1 }} kind="secondary" icon="cash-outline" title="Add Payment" onPress={() => router.push({ pathname: '/payment/new', params: { clientId: c.id } })} />}
              </Row>
            </Card>

            <Chips
              value={tab}
              onChange={setTab}
              options={[
                { value: 'overview', label: 'Overview' },
                { value: 'invoices', label: `Invoices (${l.invoices.length})` },
                { value: 'payments', label: `Payments (${l.payments.length})` },
                { value: 'installments', label: 'Installments' },
                { value: 'statement', label: 'Statement' },
              ]}
            />

            {tab === 'overview' && (
              <>
                <Card>
                  <KV k="Opening balance" v={m(c.openingBalance)} />
                  <KV k="Total invoices" v={m(l.totalInvoiced)} />
                  <KV k="Total payments" v={m(l.totalPaid)} color={t.success} />
                  <KV k="Overdue invoices" v={m(l.overdue)} color={l.overdue > 0 ? t.danger : undefined} />
                  <KV k="Advance balance" v={m(l.credit)} />
                  <KV k="Outstanding balance" v={m(l.outstanding)} bold color={l.outstanding > 0 ? t.danger : t.success} />
                  {c.creditLimit > 0 && (
                    <>
                      <KV k="Credit limit" v={m(c.creditLimit)} />
                      <View style={{ height: 8, borderRadius: 4, backgroundColor: t.neutralSoft, overflow: 'hidden' }}>
                        <View style={{ height: '100%', width: `${Math.min(100, Math.max(2, (l.outstanding / c.creditLimit) * 100))}%`, backgroundColor: l.outstanding > c.creditLimit ? t.danger : l.outstanding > c.creditLimit * 0.8 ? t.warn : t.success }} />
                      </View>
                      <Txt v="small" color={l.outstanding > c.creditLimit ? t.danger : undefined}>
                        {l.outstanding > c.creditLimit ? `Over the limit by ${m(l.outstanding - c.creditLimit)}` : `${m(c.creditLimit - l.outstanding)} still available`}
                      </Txt>
                    </>
                  )}
                </Card>
                {l.credit > 0 && (can('payments.record') || can('payments.refund')) && (
                  <Card>
                    <Txt v="h">Advance of {m(l.credit)}</Txt>
                    <Txt v="small">Money this client paid that is not yet used on an invoice.</Txt>
                    <Row gap={10}>
                      {can('payments.record') && l.outstanding > 0 && (
                        <Btn
                          small
                          style={{ flex: 1 }}
                          icon="git-merge-outline"
                          title="Apply to invoices"
                          loading={busyAction === 'apply'}
                          onPress={async () => {
                            setBusyAction('apply');
                            try {
                              const r = await api<{ applied: number }>(`/clients/${c.id}/apply-credit`, { method: 'POST' });
                              toast(r.applied > 0 ? `${m(r.applied)} applied to open invoices, oldest first` : 'Nothing could be applied');
                              reload();
                            } catch (e: any) {
                              toast(e.message, 'error');
                            } finally {
                              setBusyAction('');
                            }
                          }}
                        />
                      )}
                      {can('payments.refund') && (
                        <Btn small style={{ flex: 1 }} kind="secondary" icon="return-up-back-outline" title="Refund" onPress={() => setRefund({ amount: moneyToInput(l.credit), method: 'cash', accountId: '', date: new Date().toISOString().slice(0, 10), notes: '' })} />
                      )}
                    </Row>
                  </Card>
                )}
                <Card>
                  <Txt v="h">Client information</Txt>
                  {(
                    [
                      ['Phone', c.phone],
                      ['WhatsApp', c.whatsapp],
                      ['Email', c.email],
                      ['CNIC / registration', c.cnic],
                      ['NTN / tax number', c.ntn],
                      ['Billing address', c.address],
                      ['City', [c.city, c.province, c.country].filter(Boolean).join(', ')],
                      ...c.extraAddresses.map((a, n) => [`Address ${n + 2}`, a]),
                      ...c.extraContacts.map((x) => [x.name || 'Contact', x.phone]),
                      ['Notes', c.notes],
                    ] as [string, string][]
                  )
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <KV key={k} k={k} v={v} />
                    ))}
                </Card>
              </>
            )}

            {tab === 'invoices' && (l.invoices.length === 0 ? <Txt v="sub">No invoices for this client yet.</Txt> : l.invoices.map((i) => <InvoiceRow key={i.id} invoice={i} />))}
            {tab === 'payments' && (l.payments.length === 0 ? <Txt v="sub">No payments from this client yet.</Txt> : l.payments.map((p) => <PaymentRow key={p.id} payment={p} />))}
            {tab === 'installments' &&
              (clientInstallments.length === 0 ? <Txt v="sub">No installment schedules for this client.</Txt> : clientInstallments.map((s) => <InstallmentItem key={s.id} item={s} payAmount={s.id ? settle.get(s.id) : undefined} />))}

            {tab === 'statement' && (
              <>
                <Btn icon="eye-outline" title="Preview & share statement" onPress={() => setViewer(true)} disabled={!business} />
                <Card>
                  {l.entries.map((e, n) => (
                    <View key={n} style={{ paddingVertical: 6, borderBottomWidth: n < l.entries.length - 1 ? 1 : 0, borderBottomColor: t.border }}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Txt v="sub" color={t.text} style={{ fontWeight: '600', flex: 1 }}>
                          {e.label}
                        </Txt>
                        <Txt v="sub" color={e.credit ? t.success : t.text}>
                          {e.credit ? `− ${m(e.credit)}` : m(e.debit)}
                        </Txt>
                      </Row>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Txt v="small">{e.date ? fd(e.date) : ''}</Txt>
                        <Txt v="small">Balance {m(e.balance)}</Txt>
                      </Row>
                    </View>
                  ))}
                </Card>
              </>
            )}
          </>
        )}
      </Loader>
      <Sheet visible={!!refund} title="Refund advance" onClose={() => setRefund(null)}>
        <Txt v="sub">Give back money the client paid in advance. It comes out of the account you choose.</Txt>
        <Field label="Amount" money value={refund?.amount ?? ''} onChangeText={(v) => setRefund((r) => r && { ...r, amount: v })} hint={l ? `Up to ${m(l.credit)}` : undefined} />
        <Txt v="label">Method</Txt>
        <Chips value={refund?.method ?? 'cash'} onChange={(v) => setRefund((r) => r && { ...r, method: v, accountId: '' })} options={PAYMENT_METHODS.map((x) => ({ value: x, label: PAYMENT_METHOD_LABELS[x] }))} />
        <AccountSelect label="Paid from" accounts={(accounts.data ?? []).filter((a) => a.businessId === business?.id)} value={refund?.accountId ?? ''} onChange={(id) => setRefund((r) => r && { ...r, accountId: id })} />
        <DateField label="Date" value={refund?.date ?? ''} onChange={(v) => setRefund((r) => r && { ...r, date: v })} />
        <Field label="Notes (optional)" value={refund?.notes ?? ''} onChangeText={(v) => setRefund((r) => r && { ...r, notes: v })} />
        <Btn
          title="Record refund"
          loading={busyAction === 'refund'}
          onPress={async () => {
            if (!refund || !business) return;
            const amount = parseMoney(refund.amount);
            if (!amount || amount <= 0) return toast('Enter the amount', 'error');
            setBusyAction('refund');
            try {
              await api(`/clients/${id}/refunds`, { body: { businessId: business.id, amount, method: refund.method, accountId: refund.accountId || null, date: refund.date, notes: refund.notes } });
              toast('Refund recorded');
              setRefund(null);
              reload();
            } catch (e: any) {
              toast(e.message, 'error');
            } finally {
              setBusyAction('');
            }
          }}
        />
      </Sheet>
      {l && business && <DocumentViewer visible={viewer} onClose={() => setViewer(false)} title={`Statement · ${l.client.name}`} fileName="account-statement" build={buildStatement} />}
    </Screen>
  );
}
