import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { InvoiceRow } from '@/components/rows';
import { Badge, Btn, Card, KV, Loader, Notice, Row, Screen, Section, Txt, addDays, confirm, fd, fm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { describeSchedule, occurrence, qtyToString, type Invoice, type RecurringInvoice } from '@/lib/shared';

interface Detail {
  schedule: RecurringInvoice;
  invoices: Invoice[];
}

export default function RecurringDetail() {
  const t = useTheme();
  const toast = useToast();
  const { can } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload, refreshing } = useApi<Detail>(`/recurring/${id}`);
  const [busy, setBusy] = useState('');
  const r = data?.schedule;
  const m = (v: number) => fm(v, r);

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
  const setStatus = (status: 'active' | 'paused') =>
    run(status, async () => {
      await api(`/recurring/${id}/status`, { body: { status } });
      toast(status === 'active' ? 'Schedule resumed' : 'Schedule paused');
      reload();
    });
  const remove = async () => {
    if (!(await confirm('Delete this schedule?', 'No more invoices will be created. Invoices it already created are kept.', 'Delete'))) return;
    run('delete', async () => {
      await api(`/recurring/${id}`, { method: 'DELETE' });
      toast('Schedule deleted');
      router.back();
    });
  };

  const upcoming = r?.nextDate
    ? Array.from({ length: 4 }, (_, n) => occurrence(r.startDate, r.frequency, r.interval, r.generatedCount + n)).filter((d) => !r.endDate || d <= r.endDate)
    : [];
  const drafts = (data?.invoices ?? []).filter((i) => i.status === 'draft');

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Stack.Screen options={{ title: r?.name ?? 'Recurring invoice' }} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {data && r && (
          <>
            <Card>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt v="small">{r.businessName}</Txt>
                  <Txt v="big">{r.name}</Txt>
                </View>
                <Badge status={r.status} />
              </Row>
              <Txt style={{ fontWeight: '700' }} color={t.primary} onPress={() => router.push({ pathname: '/client/[id]', params: { id: r.clientId } })}>
                {r.clientName}
              </Txt>
              <KV k="Repeats" v={describeSchedule(r.frequency, r.interval)} />
              <KV k="Started" v={fd(r.startDate)} />
              <KV k="Ends" v={r.endDate ? fd(r.endDate) : 'No end date'} />
              <KV k="Each invoice due" v={r.dueDays ? `${r.dueDays} days after issue` : 'On issue'} />
              <KV k="Approval" v={r.autoIssue ? 'Issued automatically' : 'Drafts wait for approval'} />
              <KV k="Invoices created" v={String(r.generatedCount)} />
              <KV k="Amount per invoice" v={m(r.total)} bold />
            </Card>

            {drafts.length > 0 && <Notice kind="warn">{drafts.length} generated invoice{drafts.length === 1 ? ' is' : 's are'} waiting for approval below.</Notice>}

            {r.status !== 'ended' && (
              <Card>
                <Txt v="h">Coming up</Txt>
                {r.status === 'paused' && <Txt v="sub">Paused: nothing will be created until you resume.</Txt>}
                {upcoming.length === 0 ? (
                  <Txt v="sub">No more runs before the end date.</Txt>
                ) : (
                  upcoming.map((d, n) => <KV key={d} k={`${n === 0 ? 'Next' : `${n + 1}.`} ${fd(d)}`} v={`due ${fd(addDays(d, r.dueDays))}`} color={r.status === 'paused' ? t.sub : undefined} />)
                )}
              </Card>
            )}

            {can('invoices.create') && (
              <Row gap={10}>
                <Btn style={{ flex: 1 }} kind="secondary" icon="create-outline" title="Edit" onPress={() => router.push({ pathname: '/recurring/new', params: { id: r.id } })} />
                {r.status === 'active' && <Btn style={{ flex: 1 }} kind="secondary" icon="pause-outline" title="Pause" onPress={() => setStatus('paused')} loading={busy === 'paused'} />}
                {r.status === 'paused' && <Btn style={{ flex: 1 }} icon="play-outline" title="Resume" onPress={() => setStatus('active')} loading={busy === 'active'} />}
              </Row>
            )}

            <Section title="Items on each invoice">
              <Card>
                {r.lines.map((l, n) => (
                  <Row key={n} style={{ justifyContent: 'space-between', paddingVertical: 3 }}>
                    <Txt v="sub" color={t.text} style={{ flex: 1 }}>
                      {l.name} · {qtyToString(l.qty)} {l.unit}
                    </Txt>
                    <Txt v="sub" color={t.text}>
                      {m(l.unitPrice)}
                    </Txt>
                  </Row>
                ))}
              </Card>
            </Section>

            <Section title={`Invoices created (${data.invoices.length})`}>
              {data.invoices.length === 0 ? <Txt v="sub">None yet. The first one is created on {r.nextDate ? fd(r.nextDate) : 'the start date'}.</Txt> : data.invoices.map((i) => <InvoiceRow key={i.id} invoice={i} />)}
            </Section>

            {can('invoices.create') && <Btn kind="danger" icon="trash-outline" title="Delete schedule" onPress={remove} loading={busy === 'delete'} />}
          </>
        )}
      </Loader>
    </Screen>
  );
}
