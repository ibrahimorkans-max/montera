import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { usePending } from '@/components/sync-ui';
import { MarkPaidButton, PaymentRow } from '@/components/rows';
import { Badge, Btn, Card, DateField, Field, IconBtn, InstallmentBadge, KV, Loader, Notice, Progress, Row, Screen, Section, Sheet, Txt, confirm, fd, fm, isDate, statusLabel } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { newKey } from '@/lib/invoice-draft';
import { invoiceHtml, type Paper } from '@/lib/pdf';
import { moneyToInput, parseMoney, percentToString, qtyToString, type BusinessProfile, type Client, type Invoice, type InvoiceTemplate, type Payment } from '@/lib/shared';

interface Detail {
  invoice: Invoice;
  payments: Payment[];
  client: Client;
  business: BusinessProfile;
}
const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

export default function InvoiceDetail() {
  const t = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload, refreshing, setData } = useApi<Detail>(`/invoices/${id}`);
  const [viewer, setViewer] = useState(false);
  const [busy, setBusy] = useState('');
  const [schedule, setSchedule] = useState<{ key: string; dueDate: string; amount: string }[] | null>(null);

  const i = data?.invoice;
  const unsynced = usePending(i?.id);
  const m = (v: number) => fm(v, i);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try {
      await fn();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  const buildDoc = useCallback((paper: Paper, template: InvoiceTemplate) => (data ? invoiceHtml(data, paper, template) : ''), [data]);

  const finalize = async () => {
    if (!(await confirm('Finalize this invoice?', 'It will get its invoice number and can no longer be edited.', 'Finalize'))) return;
    run('finalize', async () => {
      try {
        await api(`/invoices/${id}/finalize`, { body: {} });
      } catch (e: any) {
        if (!/credit limit/i.test(e.message) || !can('invoices.approve')) throw e;
        if (!(await confirm('Over the credit limit', `${e.message}\n\nApprove and finalize anyway?`, 'Approve'))) return;
        await api(`/invoices/${id}/finalize`, { body: { overrideCreditLimit: true } });
      }
      toast('Invoice finalized');
      reload();
    });
  };
  const cancel = async () => {
    const paid = i!.paid > 0 ? ` The ${m(i!.paid)} already received will be kept on the client's account as an advance.` : '';
    if (!(await confirm('Cancel this invoice?', `This cannot be undone.${paid}`, 'Cancel invoice'))) return;
    run('cancel', async () => {
      await api(`/invoices/${id}/cancel`, { body: {} });
      toast('Invoice cancelled');
      reload();
    });
  };
  const remove = async () => {
    if (!(await confirm('Delete this draft?', 'The draft will be removed permanently.', 'Delete'))) return;
    run('delete', async () => {
      await api(`/invoices/${id}`, { method: 'DELETE' });
      toast('Draft deleted');
      router.back();
    });
  };
  const applyCredit = () =>
    run('credit', async () => {
      const r = await api<{ applied: number }>(`/invoices/${id}/apply-credit`, { body: {} });
      toast(r.applied > 0 ? `${m(r.applied)} of client advance applied` : 'No advance available for this business');
      reload();
    });
  const saveSchedule = () =>
    run('schedule', async () => {
      const p = i!.currencyPrecision;
      const rows = (schedule ?? []).map((s) => ({ dueDate: s.dueDate, amount: parseMoney(s.amount, p) ?? 0 }));
      if (rows.some((s) => !isDate(s.dueDate) || s.amount <= 0)) throw new Error('Every installment needs a valid date and an amount.');
      const invoice = await api<Invoice>(`/invoices/${id}/installments`, { method: 'PUT', body: { installments: rows } });
      setData({ ...data!, invoice });
      setSchedule(null);
      toast('Installment schedule saved');
    });

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: i?.number ?? (i?.status === 'draft' ? 'Draft Invoice' : 'Invoice') }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && i && (
          <>
            <Card>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt v="small">Issued by {i.businessName}</Txt>
                  <Txt v="big">{i.number ?? 'Draft'}</Txt>
                </View>
                <Badge status={i.displayStatus} />
              </Row>
              <Txt style={{ fontWeight: '700' }} color={t.primary} onPress={() => router.push({ pathname: '/client/[id]', params: { id: i.clientId } })}>
                {i.clientName}
              </Txt>
              <KV k="Invoice date" v={fd(i.issueDate)} />
              <KV k="Due date" v={fd(i.dueDate)} color={i.displayStatus === 'overdue' ? t.danger : undefined} />
              {!!i.reference && <KV k="Reference" v={i.reference} />}
            </Card>

            {unsynced && <Notice kind="warn">Saved on this phone only. The invoice number is provisional until it reaches the server.</Notice>}
            {i.status === 'final' && (
              <Card>
                <Txt v="h">Payment progress</Txt>
                <Progress value={i.paid} total={i.total} />
                <KV k="Invoice total" v={m(i.total)} />
                {data.payments
                  .filter((p) => p.verificationStatus !== 'rejected')
                  .slice()
                  .reverse()
                  .map((p, n) => (
                    <KV key={p.id} k={`${ORDINALS[n] ?? `#${n + 1}`} payment · ${fd(p.date)}`} v={m(p.allocations.find((a) => a.invoiceId === i.id)?.amount ?? 0)} color={t.success} />
                  ))}
                {i.balance > 0 && <KV k="Pending" v={m(i.balance)} color={t.warn} />}
                <View style={{ height: 1, backgroundColor: t.border, marginVertical: 4 }} />
                <KV k="Total paid" v={m(i.paid)} bold />
                <KV k="Remaining" v={m(i.balance)} bold color={i.balance > 0 ? t.danger : t.success} />
                <KV k="Payment status" v={statusLabel(i.displayStatus)} />
                {i.balance > 0 && can('payments.record') && (
                  <Btn icon="cash-outline" title="Record Payment" onPress={() => router.push({ pathname: '/payment/new', params: { invoiceId: i.id } })} />
                )}
                {i.balance > 0 && (data.client.credit ?? 0) > 0 && can('payments.record') && (
                  <Btn kind="secondary" icon="wallet-outline" title={`Apply client advance (${fm(data.client.credit ?? 0, i)})`} onPress={applyCredit} loading={busy === 'credit'} />
                )}
              </Card>
            )}

            {i.status === 'draft' && (
              <Card>
                <Notice>This is a draft. It has no invoice number and has not been issued.</Notice>
                {can('invoices.edit_draft') && <Btn icon="create-outline" title="Continue editing" onPress={() => router.replace({ pathname: '/invoice/new', params: { id: i.id } })} />}
                {can('invoices.finalize') && <Btn kind="secondary" icon="checkmark-circle-outline" title="Finalize invoice" onPress={finalize} loading={busy === 'finalize'} />}
                {can('invoices.edit_draft') && <Btn kind="danger" icon="trash-outline" title="Delete draft" onPress={remove} loading={busy === 'delete'} />}
              </Card>
            )}

            {i.status !== 'draft' && (
              <Card>
                <Txt v="h">Preview & send</Txt>
                <Txt v="sub">See the finished invoice, try another design, then export it as PDF, PNG or JPG or print it.</Txt>
                <Btn icon="eye-outline" title="Preview invoice" onPress={() => setViewer(true)} />
              </Card>
            )}

            {(i.installments.length > 0 || (i.status === 'final' && i.balance > 0)) && (
              <Section
                title="Installments"
                action={
                  i.status !== 'cancelled' && can('invoices.finalize') ? (
                    <Btn
                      small
                      kind="ghost"
                      icon="create-outline"
                      title={i.installments.length ? 'Edit schedule' : 'Add schedule'}
                      onPress={() => setSchedule(i.installments.map((s) => ({ key: newKey(), dueDate: s.dueDate, amount: moneyToInput(s.amount, i.currencyPrecision) })))}
                    />
                  ) : undefined
                }>
                {i.installments.length === 0 && <Txt v="sub">No installment schedule for this invoice.</Txt>}
                {i.installments.length > 0 && (
                  <Row gap={14} style={{ flexWrap: 'wrap' }}>
                    <Txt v="small" color={t.success}>
                      Paid {i.installments.filter((s) => s.status === 'paid').length} of {i.installments.length}
                    </Txt>
                    <Txt v="small" color={i.installments.some((s) => s.status === 'overdue') ? t.danger : undefined}>
                      Unpaid {i.installments.filter((s) => s.status !== 'paid').length}
                    </Txt>
                  </Row>
                )}
                {(() => {
                  let owed = 0; // running amount that settles each installment, earlier ones included
                  return i.installments.map((s, n) => {
                    const done = s.status === 'paid';
                    if (!done) owed += s.amount - (s.paid ?? 0);
                    return (
                      <Card key={s.id ?? n}>
                        <Row style={{ justifyContent: 'space-between' }}>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Txt style={{ fontWeight: '600' }}>
                              Installment {n + 1} · {fd(s.dueDate)}
                            </Txt>
                            <Txt v="small" color={done ? t.success : undefined}>
                              {done ? 'Fully paid' : (s.paid ?? 0) > 0 ? `${m(s.paid ?? 0)} received · ${m(s.amount - (s.paid ?? 0))} left` : 'Nothing received yet'}
                            </Txt>
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: 4 }}>
                            <Txt style={{ fontWeight: '700' }}>{m(s.amount)}</Txt>
                            <InstallmentBadge status={s.status} />
                          </View>
                        </Row>
                        {!done && i.status === 'final' && can('payments.record') && <MarkPaidButton invoiceId={i.id} amount={Math.min(owed, i.balance)} precision={i.currencyPrecision} />}
                      </Card>
                    );
                  });
                })()}
              </Section>
            )}

            <Section title="Items">
              <Card>
                {i.lines.length === 0 && <Txt v="sub">No items yet.</Txt>}
                {i.lines.map((l, n) => (
                  <Row key={n} style={{ justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Txt v="sub" color={t.text} style={{ fontWeight: '600' }}>
                        {l.name}
                      </Txt>
                      <Txt v="small">
                        {qtyToString(l.qty)} {l.unit} × {m(l.unitPrice)}
                        {l.discountValue ? ` · disc ${l.discountType === 'percent' ? `${percentToString(l.discountValue)}%` : m(l.discountValue)}` : ''}
                        {l.taxRateBp ? ` · tax ${percentToString(l.taxRateBp)}%` : ''}
                      </Txt>
                    </View>
                    <Txt v="sub" color={t.text}>
                      {m(l.lineTotal ?? 0)}
                    </Txt>
                  </Row>
                ))}
              </Card>
              <Card>
                <KV k="Subtotal" v={m(i.subtotal)} />
                {i.itemDiscounts > 0 && <KV k="Item discounts" v={`− ${m(i.itemDiscounts)}`} />}
                {i.overallDiscount > 0 && <KV k="Overall discount" v={`− ${m(i.overallDiscount)}`} />}
                <KV k="Taxable amount" v={m(i.taxableAmount)} />
                <KV k={i.taxInclusive ? 'Tax (included)' : 'Tax'} v={m(i.taxAmount)} />
                {i.charges.map((c, n) => (
                  <KV key={n} k={c.label} v={m(c.amount)} />
                ))}
                {i.roundingAdjustment !== 0 && <KV k="Rounding" v={m(i.roundingAdjustment)} />}
                <KV k="Total" v={m(i.total)} bold />
              </Card>
              {!!i.paymentTerms && <KV k="Payment terms" v={i.paymentTerms} />}
              {!!i.notes && <Txt v="sub">{i.notes}</Txt>}
            </Section>

            {data.payments.length > 0 && (
              <Section title="Payment history & receipts">
                {data.payments.map((p) => (
                  <PaymentRow key={p.id} payment={p} />
                ))}
              </Section>
            )}

            {i.status === 'final' && can('invoices.cancel') && <Btn kind="danger" icon="close-circle-outline" title="Cancel invoice" onPress={cancel} loading={busy === 'cancel'} />}
          </>
        )}
      </Loader>

      {data && i && (
        <DocumentViewer
          visible={viewer}
          onClose={() => setViewer(false)}
          title={`Invoice ${i.number ?? 'draft'}`}
          fileName={`invoice-${i.number ?? 'draft'}`}
          build={buildDoc}
          template={data.business.invoiceTemplate}
        />
      )}

      <Sheet visible={!!schedule} title="Installment schedule" onClose={() => setSchedule(null)}>
        {i && <Txt v="sub">Scheduled amounts can total up to {m(i.total)}. Payments already received are applied to the earliest installments.</Txt>}
        {(schedule ?? []).map((s, n) => {
          const patch = (p: Partial<typeof s>) => setSchedule((all) => (all ?? []).map((x) => (x.key === s.key ? { ...x, ...p } : x)));
          return (
            <Card key={s.key}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt v="label">Installment {n + 1}</Txt>
                <IconBtn icon="trash-outline" label="Remove installment" color={t.danger} onPress={() => setSchedule((all) => (all ?? []).filter((x) => x.key !== s.key))} />
              </Row>
              <DateField label="Due date" value={s.dueDate} onChange={(v) => patch({ dueDate: v })} />
              <Field label="Amount" money placeholder="0" value={s.amount} onChangeText={(v) => patch({ amount: v })} />
            </Card>
          );
        })}
        <Btn kind="secondary" icon="add" title="Add installment" onPress={() => setSchedule((all) => [...(all ?? []), { key: newKey(), dueDate: i?.dueDate ?? '', amount: '' }])} />
        <Btn title="Save schedule" onPress={saveSchedule} loading={busy === 'schedule'} />
      </Sheet>
    </Screen>
  );
}
