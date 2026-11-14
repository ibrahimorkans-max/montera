import { useMemo, useState } from 'react';
import { InstallmentItem, settleAmounts } from '@/components/rows';
import { Card, Chips, Empty, KV, Loader, Screen } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useTheme } from '@/lib/app-context';
import { fm } from '@/components/ui';
import type { InstallmentRow } from '@/lib/shared';

type Filter = 'due' | 'overdue' | 'paid' | 'all';

export default function Installments() {
  const t = useTheme();
  const { data, loading, error, reload, refreshing } = useApi<InstallmentRow[]>('/installments');
  const [filter, setFilter] = useState<Filter>('due');
  const all = data ?? [];
  const shown = all.filter((s) => (filter === 'all' ? true : filter === 'due' ? s.status !== 'paid' : s.status === filter));
  const sum = (rows: InstallmentRow[]) => rows.reduce((a, s) => a + s.amount - (s.paid ?? 0), 0);
  const overdue = all.filter((s) => s.status === 'overdue');
  const upcoming = all.filter((s) => s.status === 'pending' || s.status === 'partial');
  const paidRows = all.filter((s) => s.status === 'paid');
  const settle = useMemo(() => settleAmounts(all), [all]);

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        <Card>
          <KV k="Overdue installments" v={`${overdue.length} · ${fm(sum(overdue), all[0])}`} color={overdue.length ? t.danger : undefined} />
          <KV k="Unpaid, not yet due" v={`${upcoming.length} · ${fm(sum(upcoming), all[0])}`} />
          <KV k="Paid installments" v={`${paidRows.length}`} color={paidRows.length ? t.success : undefined} />
        </Card>
        <Chips
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'due', label: `Unpaid (${overdue.length + upcoming.length})` },
            { value: 'overdue', label: `Overdue (${overdue.length})` },
            { value: 'paid', label: `Paid (${paidRows.length})` },
            { value: 'all', label: 'All' },
          ]}
        />
        {shown.length === 0 ? (
          <Empty icon="calendar-outline" title="No installments here" hint="Choose Installments in the payment step of an invoice to set up a schedule." />
        ) : (
          shown.map((s) => <InstallmentItem key={s.id} item={s} payAmount={s.id ? settle.get(s.id) : undefined} />)
        )}
      </Loader>
    </Screen>
  );
}
