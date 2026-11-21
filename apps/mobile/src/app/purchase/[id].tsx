import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { Btn, Card, InstallmentBadge, KV, Loader, Row, Screen, Section, Txt, confirm, fd, fm, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { purchaseSlipHtml, txnId, type Paper } from '@/lib/pdf';
import { PAYMENT_METHOD_LABELS, qtyToString, type BusinessProfile, type InvoiceTemplate, type Purchase } from '@/lib/shared';

export default function PurchaseDetail() {
  const t = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: p, loading, error, reload, refreshing } = useApi<Purchase & { attachment?: string }>(`/purchases/${id}`);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState(false);
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const biz = businesses.data?.find((b) => b.id === p?.businessId);
  const buildDoc = useCallback((paper: Paper, template: InvoiceTemplate) => (p && biz ? purchaseSlipHtml(p, biz, paper, template) : ''), [p, biz]);
  const m = (v: number) => fm(v, p);
  const [toggling, setToggling] = useState(-1);

  async function setPaid(index: number, paid: boolean) {
    if (!p) return;
    setToggling(index);
    try {
      await api(`/purchases/${p.id}/installments/${index}`, { method: 'PUT', body: { paid } });
      toast(paid ? `Installment ${index + 1} paid · ${m(p.installments[index].amount)} recorded as money out` : `Installment ${index + 1} marked unpaid`);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setToggling(-1);
    }
  }

  async function remove() {
    if (!p) return;
    if (!(await confirm(`Delete ${p.number}?`, `The bill and its money out of ${m(p.total)} will be removed, and the amount goes back to ${p.accountName || 'the account'}.`, 'Delete'))) return;
    setBusy(true);
    try {
      await api(`/purchases/${p.id}`, { method: 'DELETE' });
      toast('Purchase deleted');
      router.back();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: p?.number ?? 'Purchase' }} />
      <Loader loading={loading && !p} error={p ? '' : error} onRetry={reload}>
        {p && (
          <>
            <Card>
              <Row gap={12}>
                <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: t.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="bag-handle-outline" size={22} color={t.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '800', fontSize: 17 }} numberOfLines={1}>
                    {p.supplier}
                  </Txt>
                  <Txt v="small">
                    {[p.number, fd(p.date), p.billNo ? `bill ${p.billNo}` : ''].filter(Boolean).join(' · ')}
                  </Txt>
                </View>
              </Row>
              <Txt v="small">{p.installments?.length ? 'Paid so far' : 'Total paid'}</Txt>
              <Txt style={{ fontWeight: '800', fontSize: 28 }} color={t.danger}>
                − {m(p.paid ?? p.total)}
              </Txt>
              {(p.balance ?? 0) > 0 && (
                <Row gap={8}>
                  <InstallmentBadge status={(p.paid ?? 0) > 0 ? 'partial' : 'pending'} />
                  <Txt v="small">
                    {m(p.balance)} still to pay of {m(p.total)}
                  </Txt>
                </Row>
              )}
            </Card>

            <Btn icon="document-text-outline" title="Purchase slip · print, PDF or share" onPress={() => setViewer(true)} disabled={!biz} />

            <Section title={`Items (${p.lines.length})`}>
              <Card>
                {p.lines.map((l, i) => (
                  <Row key={i} gap={10} style={{ paddingVertical: 6, borderBottomWidth: i < p.lines.length - 1 ? 1 : 0, borderColor: t.border }}>
                    <View style={{ flex: 1 }}>
                      <Txt style={{ fontWeight: '700' }}>{l.name}</Txt>
                      <Txt v="small">
                        {qtyToString(l.qty)}
                        {l.unit ? ` ${l.unit}` : ''} × {m(l.unitPrice)}
                      </Txt>
                    </View>
                    <Txt style={{ fontWeight: '700' }}>{m(l.amount)}</Txt>
                  </Row>
                ))}
                <KV k="Total" v={m(p.total)} bold />
              </Card>
            </Section>

            {(p.installments?.length ?? 0) > 0 && (
              <Section title={`Installments (${p.installments.filter((x) => x.paid).length} of ${p.installments.length} paid)`}>
                {p.installments.map((x, i) => (
                  <Card key={i}>
                    <Row gap={10}>
                      <View style={{ flex: 1 }}>
                        <Txt style={{ fontWeight: '700' }}>
                          Installment {i + 1} · {m(x.amount)}
                        </Txt>
                        <Txt v="small">{x.paid ? `Paid${x.paidDate ? ` on ${fd(x.paidDate)}` : ''}` : `Due ${fd(x.dueDate)}`}</Txt>
                      </View>
                      <InstallmentBadge status={x.paid ? 'paid' : x.dueDate < todayStr() ? 'overdue' : 'pending'} />
                    </Row>
                    {can('finance.manage') && (
                      <Btn
                        small
                        kind={x.paid ? 'secondary' : 'primary'}
                        icon={x.paid ? 'arrow-undo-outline' : 'checkmark-circle-outline'}
                        title={x.paid ? 'Mark unpaid' : 'Mark paid'}
                        loading={toggling === i}
                        disabled={toggling >= 0}
                        onPress={() => setPaid(i, !x.paid)}
                      />
                    )}
                  </Card>
                ))}
              </Section>
            )}

            <Section title="Money out">
              <Card>
                <KV k="Paid from" v={p.accountName || PAYMENT_METHOD_LABELS[p.method]} />
                <KV k="Method" v={PAYMENT_METHOD_LABELS[p.method]} />
                <KV k="Transaction ID" v={txnId(p.method, p.reference ?? '')} />
                <KV k="Category" v={p.category} />
                {!!p.notes && <KV k="Notes" v={p.notes} />}
                <Txt v="small">This bill appears in Finance as money out and is included in your balances and Profit & Loss.</Txt>
              </Card>
            </Section>

            {!!p.attachment && (
              <Section title="Bill photo">
                <Image source={{ uri: p.attachment }} style={{ width: '100%', height: 260, borderRadius: 12 }} resizeMode="contain" accessibilityLabel="Bill photo" />
              </Section>
            )}

            {can('finance.manage') && (
              <Row gap={10}>
                <Btn style={{ flex: 1 }} kind="secondary" icon="create-outline" title="Edit" onPress={() => router.push({ pathname: '/purchase/new', params: { id: p.id } })} />
                <Btn style={{ flex: 1 }} kind="danger" icon="trash-outline" title="Delete" onPress={remove} loading={busy} />
              </Row>
            )}
          </>
        )}
      </Loader>
      {p && biz && <DocumentViewer visible={viewer} onClose={() => setViewer(false)} title={`Purchase ${p.number}`} fileName={`purchase-${p.number}`} build={buildDoc} template={biz.invoiceTemplate ?? 'amber'} defaultPaper="A5" />}
    </Screen>
  );
}
