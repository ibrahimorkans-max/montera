import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { usePending } from '@/components/sync-ui';
import { Badge, Btn, Card, KV, Loader, Notice, Row, Screen, Txt, confirm, fd, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { receiptHtml, type Paper } from '@/lib/pdf';
import { PAYMENT_METHOD_LABELS, type BusinessProfile, type Client, type Invoice, type Payment } from '@/lib/shared';

interface Detail {
  payment: Payment;
  client: Client;
  business: BusinessProfile;
  invoices: Invoice[];
}

export default function Receipt() {
  const t = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload, refreshing } = useApi<Detail>(`/payments/${id}`);
  const [viewer, setViewer] = useState(false);
  const buildDoc = useCallback((paper: Paper) => (data ? receiptHtml(data, paper) : ''), [data]);
  const [busy, setBusy] = useState('');
  const p = data?.payment;
  const unsynced = usePending(p?.id);
  const m = (v: number) => fm(v, p);

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
  const verify = () =>
    run('verify', async () => {
      await api(`/payments/${id}/verify`, { method: 'POST' });
      toast('Payment verified');
      reload();
    });
  const reject = async () => {
    if (!(await confirm('Reject this payment?', 'It will be removed from the invoice and the client balance. This cannot be undone.', 'Reject'))) return;
    run('reject', async () => {
      await api(`/payments/${id}/reject`, { method: 'POST' });
      toast('Payment rejected');
      reload();
    });
  };

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: p ? `Receipt ${p.number}` : 'Receipt' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && p && (
          <>
            <Card>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Txt v="small">Received by {data.business.tradingName || data.business.legalName}</Txt>
                  <Txt v="title" color={p.verificationStatus === 'rejected' ? t.sub : t.success}>
                    {m(p.amount)}
                  </Txt>
                </View>
                <Badge status={p.verificationStatus} />
              </Row>
              <Txt style={{ fontWeight: '700' }} color={t.primary} onPress={() => router.push({ pathname: '/client/[id]', params: { id: p.clientId } })}>
                {p.clientName}
              </Txt>
              <KV k="Payment ID" v={p.number} />
              <KV k="Date" v={fd(p.date)} />
              <KV k="Method" v={PAYMENT_METHOD_LABELS[p.method]} />
              <KV k="Transaction ID" v={p.method === 'cash' ? 'Cash' : p.reference || '—'} />
              <KV k="Received by" v={p.receivedBy} />
              {!!p.notes && <KV k="Notes" v={p.notes} />}
            </Card>

            {unsynced && <Notice kind="warn">Saved on this phone only. It becomes a confirmed receipt, with its final number, once it reaches the server.</Notice>}
            {p.verificationStatus === 'rejected' && <Notice kind="danger">This payment was rejected and does not count toward any balance.</Notice>}
            {p.verificationStatus === 'pending' && (
              <Card>
                <Notice kind="info">Waiting for verification.</Notice>
                {can('payments.verify') && (
                  <Row gap={10}>
                    <Btn style={{ flex: 1 }} icon="checkmark-outline" title="Verify" onPress={verify} loading={busy === 'verify'} />
                    <Btn style={{ flex: 1 }} kind="danger" icon="close-outline" title="Reject" onPress={reject} loading={busy === 'reject'} />
                  </Row>
                )}
              </Card>
            )}

            {(p.allocations.length > 0 || p.unallocated > 0) && (
              <Card>
                <Txt v="h">Applied to</Txt>
                {p.allocations.map((a) => {
                  const inv = data.invoices.find((i) => i.id === a.invoiceId);
                  return (
                    <View key={a.invoiceId}>
                      <KV k={`Invoice ${a.invoiceNumber ?? ''}`} v={m(a.amount)} />
                      {inv && (
                        <Txt v="small" color={t.primary} onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: inv.id } })}>
                          Balance now {m(inv.balance)} · open invoice
                        </Txt>
                      )}
                    </View>
                  );
                })}
                {p.unallocated > 0 && <KV k="Held as client advance" v={m(p.unallocated)} />}
              </Card>
            )}

            <Card>
              <Txt v="h">Receipt</Txt>
              <Btn icon="eye-outline" title="Preview & send receipt" onPress={() => setViewer(true)} />
            </Card>

            {!!p.proof && (
              <Card>
                <Txt v="h">Proof of payment</Txt>
                <Image source={{ uri: p.proof }} style={{ width: '100%', height: 260, borderRadius: 10, backgroundColor: t.neutralSoft }} resizeMode="contain" accessibilityLabel="Proof of payment" />
              </Card>
            )}

            {p.verificationStatus === 'verified' && can('payments.verify') && <Btn kind="danger" icon="close-circle-outline" title="Reject payment" onPress={reject} loading={busy === 'reject'} />}
          </>
        )}
      </Loader>
      {data && p && <DocumentViewer visible={viewer} onClose={() => setViewer(false)} title={`Receipt ${p.number}`} fileName={`receipt-${p.number}`} build={buildDoc} defaultPaper="A5" />}
    </Screen>
  );
}
