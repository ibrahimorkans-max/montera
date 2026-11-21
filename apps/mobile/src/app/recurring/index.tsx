import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { View } from 'react-native';
import { InvoiceRow } from '@/components/rows';
import { Badge, Btn, Card, Empty, FadeIn, Loader, Row, Screen, Section, Txt, fd, fm } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useAuth, useTheme } from '@/lib/app-context';
import { describeSchedule, type Invoice, type RecurringInvoice } from '@/lib/shared';

export default function Recurring() {
  const t = useTheme();
  const { can } = useAuth();
  const list = useApi<RecurringInvoice[]>('/recurring');
  const pending = useApi<Invoice[]>('/recurring-pending');
  const reload = () => {
    list.reload();
    pending.reload();
  };

  return (
    <Screen onRefresh={reload} refreshing={list.refreshing}>
      <Txt v="sub">Invoice the same client on a schedule — retainers, rent, maintenance contracts, subscriptions.</Txt>
      {can('invoices.create') && <Btn icon="add" title="New recurring invoice" onPress={() => router.push('/recurring/new')} />}

      {(pending.data?.length ?? 0) > 0 && (
        <Section title={`Awaiting approval (${pending.data!.length})`}>
          <Txt v="small">These were created by a schedule as drafts. Open one to check it and finalize it.</Txt>
          {pending.data!.map((i) => (
            <InvoiceRow key={i.id} invoice={i} />
          ))}
        </Section>
      )}

      <Loader loading={list.loading && !list.data} error={list.data ? '' : list.error} onRetry={reload}>
        {(list.data ?? []).length === 0 ? (
          <Empty icon="repeat-outline" title="No recurring invoices yet" hint="Set up a schedule once and Kaarobarly prepares each invoice for you on time." />
        ) : (
          <Section title="Schedules">
            {list.data!.map((r, n) => (
              <FadeIn key={r.id} delay={n * 50}>
                <Card onPress={() => router.push({ pathname: '/recurring/[id]', params: { id: r.id } })} label={`Schedule ${r.name}`}>
                  <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
                        {r.name}
                      </Txt>
                      <Txt v="small" numberOfLines={1}>
                        {r.clientName} · {describeSchedule(r.frequency, r.interval)}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Txt style={{ fontWeight: '700' }}>{fm(r.total, r)}</Txt>
                      <Badge status={r.status} />
                    </View>
                  </Row>
                  <Row gap={6}>
                    <Ionicons name={r.autoIssue ? 'flash-outline' : 'hand-left-outline'} size={14} color={t.sub} />
                    <Txt v="small">
                      {r.status === 'ended' ? 'Finished' : r.nextDate ? `Next ${fd(r.nextDate)}` : 'No more runs'} · {r.autoIssue ? 'issued automatically' : 'drafts for approval'}
                      {r.pendingDrafts ? ` · ${r.pendingDrafts} waiting` : ''}
                    </Txt>
                  </Row>
                </Card>
              </FadeIn>
            ))}
          </Section>
        )}
      </Loader>
    </Screen>
  );
}
