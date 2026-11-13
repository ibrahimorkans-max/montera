import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { Badge, Btn, Card, KV, Loader, Notice, Row, Screen, Section, Txt, confirm, fd, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { quotationHtml, type Paper } from '@/lib/pdf';
import { percentToString, qtyToString, type BusinessProfile, type Client, type InvoiceTemplate, type Quotation } from '@/lib/shared';

interface Detail {
  quotation: Quotation;
  client: Client;
  business: BusinessProfile;
}

const STEPS = ['draft', 'sent', 'accepted', 'converted'] as const;
const STEP_LABEL = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', converted: 'Invoiced' };

export default function QuotationDetail() {
  const t = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload, refreshing, setData } = useApi<Detail>(`/quotations/${id}`);
  const [busy, setBusy] = useState('');
  const [viewer, setViewer] = useState(false);
  const q = data?.quotation;
  const m = (v: number) => fm(v, q);
  const buildDoc = useCallback((paper: Paper, template: InvoiceTemplate) => (data ? quotationHtml(data, paper, template) : ''), [data]);

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
  const status = (s: 'draft' | 'sent' | 'accepted' | 'rejected', message: string) =>
    run(s, async () => {
      const quotation = await api<Quotation>(`/quotations/${id}/status`, { body: { status: s } });
      setData({ ...data!, quotation });
      toast(message);
    });
  const convert = async () => {
    if (!(await confirm('Convert to invoice?', 'A draft invoice is created with the same items and prices. You can review it, then finalize it.', 'Create invoice'))) return;
    run('convert', async () => {
      const { invoiceId } = await api<{ invoiceId: string }>(`/quotations/${id}/convert`, { method: 'POST' });
      toast('Draft invoice created from the quotation');
      router.push({ pathname: '/invoice/new', params: { id: invoiceId } });
    });
  };
  const remove = async () => {
    if (!(await confirm('Delete this draft quotation?', 'It will be removed permanently.', 'Delete'))) return;
    run('delete', async () => {
      await api(`/quotations/${id}`, { method: 'DELETE' });
      toast('Quotation deleted');
      router.back();
    });
  };

  const shown = q?.displayStatus;
  const reachedIndex = shown === 'converted' ? 3 : shown === 'accepted' ? 2 : shown === 'sent' || shown === 'expired' ? 1 : 0;
  const editable = q && !q.convertedInvoiceId && (q.status === 'draft' || q.status === 'sent');

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: q?.number ?? 'Quotation' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && q && (
          <>
            <Card>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt v="small">Quotation from {q.businessName}</Txt>
                  <Txt v="big">{q.number}</Txt>
                </View>
                <Badge status={q.displayStatus} />
              </Row>
              <Txt style={{ fontWeight: '700' }} color={t.primary} onPress={() => router.push({ pathname: '/client/[id]', params: { id: q.clientId } })}>
                {q.clientName}
              </Txt>
              <KV k="Date" v={fd(q.issueDate)} />
              <KV k="Valid until" v={fd(q.validUntil)} color={shown === 'expired' ? t.danger : undefined} />
              {!!q.reference && <KV k="Reference" v={q.reference} />}
              <KV k="Total" v={m(q.total)} bold />
            </Card>

            {shown !== 'rejected' && (
              <Row gap={4} style={{ paddingHorizontal: 4 }}>
                {STEPS.map((s, n) => (
                  <View key={s} style={{ flex: 1, gap: 6 }}>
                    <View style={{ height: 5, borderRadius: 3, backgroundColor: n <= reachedIndex ? (shown === 'expired' && n === 1 ? t.danger : t.primary) : t.neutralSoft }} />
                    <Txt v="small" style={{ textAlign: 'center', fontWeight: n === reachedIndex ? '700' : '400' }} color={n <= reachedIndex ? t.text : undefined}>
                      {n === 1 && shown === 'expired' ? 'Expired' : STEP_LABEL[s]}
                    </Txt>
                  </View>
                ))}
              </Row>
            )}

            <Card>
              <Txt v="h">Preview & send</Txt>
              <Txt v="sub">See the finished quotation in your invoice design, then export it as PDF, PNG or JPG to share.</Txt>
              <Btn icon="eye-outline" title="Preview quotation" onPress={() => setViewer(true)} />
            </Card>

            {can('invoices.create') && (
              <Card>
                <Txt v="h">Next step</Txt>
                {q.convertedInvoiceId ? (
                  <>
                    <Notice kind="success">Converted to invoice {q.convertedInvoiceNumber ?? '(draft)'}.</Notice>
                    <Btn
                      icon="document-text-outline"
                      title="Open the invoice"
                      onPress={() => (q.convertedInvoiceNumber ? router.push({ pathname: '/invoice/[id]', params: { id: q.convertedInvoiceId! } }) : router.push({ pathname: '/invoice/new', params: { id: q.convertedInvoiceId! } }))}
                    />
                  </>
                ) : (
                  <>
                    {q.status === 'draft' && <Btn icon="paper-plane-outline" title="Mark as sent" onPress={() => status('sent', 'Marked as sent')} loading={busy === 'sent'} />}
                    {q.status === 'sent' && (
                      <Row gap={10}>
                        <Btn style={{ flex: 1 }} icon="checkmark-outline" title="Accepted" onPress={() => status('accepted', 'Marked as accepted')} loading={busy === 'accepted'} />
                        <Btn style={{ flex: 1 }} kind="danger" icon="close-outline" title="Rejected" onPress={() => status('rejected', 'Marked as rejected')} loading={busy === 'rejected'} />
                      </Row>
                    )}
                    {(q.status === 'accepted' || q.status === 'rejected') && (
                      <Btn kind="secondary" icon="arrow-undo-outline" title="Back to sent" onPress={() => status('sent', 'Marked as sent again')} loading={busy === 'sent'} />
                    )}
                    {q.status !== 'rejected' && <Btn kind={q.status === 'accepted' ? 'primary' : 'secondary'} icon="swap-horizontal-outline" title="Convert to invoice" onPress={convert} loading={busy === 'convert'} />}
                  </>
                )}
              </Card>
            )}

            <Section title="Items">
              <Card>
                {q.lines.map((l, n) => (
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
                <KV k="Subtotal" v={m(q.subtotal)} />
                {q.itemDiscounts > 0 && <KV k="Item discounts" v={`− ${m(q.itemDiscounts)}`} />}
                {q.overallDiscount > 0 && <KV k="Overall discount" v={`− ${m(q.overallDiscount)}`} />}
                <KV k={q.taxInclusive ? 'Tax (included)' : 'Tax'} v={m(q.taxAmount)} />
                {q.charges.map((c, n) => (
                  <KV key={n} k={c.label} v={m(c.amount)} />
                ))}
                <KV k="Total" v={m(q.total)} bold />
              </Card>
              {!!q.terms && <KV k="Terms" v={q.terms} />}
              {!!q.notes && <Txt v="sub">{q.notes}</Txt>}
            </Section>

            {editable && can('invoices.edit_draft') && <Btn kind="secondary" icon="create-outline" title="Edit quotation" onPress={() => router.push({ pathname: '/quotation/new', params: { id: q.id } })} />}
            {q.status === 'draft' && can('invoices.edit_draft') && <Btn kind="danger" icon="trash-outline" title="Delete draft" onPress={remove} loading={busy === 'delete'} />}

            <DocumentViewer visible={viewer} onClose={() => setViewer(false)} title={`Quotation ${q.number}`} fileName={`quotation-${q.number}`} build={buildDoc} template={data.business.invoiceTemplate} />
          </>
        )}
      </Loader>
    </Screen>
  );
}
