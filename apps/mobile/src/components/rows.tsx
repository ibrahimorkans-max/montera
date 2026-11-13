import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/lib/app-context';
import { PAYMENT_METHOD_LABELS, type Client, type InstallmentRow, type Invoice, type Payment } from '@/lib/shared';
import { PendingTag } from './sync-ui';
import { Badge, Card, Row, Txt, fd, fm, type IconName } from './ui';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function InvoiceRow({ invoice: i }: { invoice: Invoice }) {
  const t = useTheme();
  const open = () => (i.status === 'draft' ? router.push({ pathname: '/invoice/new', params: { id: i.id } }) : router.push({ pathname: '/invoice/[id]', params: { id: i.id } }));
  return (
    <Card onPress={open} label={`Invoice ${i.number ?? 'draft'} for ${i.clientName}`}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
            {i.clientName}
          </Txt>
          <Txt v="small">
            {i.number ?? 'Draft'} · {fd(i.issueDate)}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Txt style={{ fontWeight: '700' }}>{fm(i.total, i)}</Txt>
          <Badge status={i.displayStatus} />
          <PendingTag id={i.id} />
        </View>
      </Row>
      {i.status === 'final' && i.balance > 0 && (
        <Txt v="small" color={i.displayStatus === 'overdue' ? t.danger : undefined}>
          Balance {fm(i.balance, i)} · due {fd(i.dueDate)}
        </Txt>
      )}
    </Card>
  );
}

export function PaymentRow({ payment: p }: { payment: Payment }) {
  return (
    <Card onPress={() => router.push({ pathname: '/payment/[id]', params: { id: p.id } })} label={`Payment ${p.number} from ${p.clientName}`}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
            {p.clientName}
          </Txt>
          <Txt v="small">
            {p.number} · {fd(p.date)} · {PAYMENT_METHOD_LABELS[p.method]}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Txt style={{ fontWeight: '700' }}>{fm(p.amount, p)}</Txt>
          <Badge status={p.verificationStatus} />
          <PendingTag id={p.id} />
        </View>
      </Row>
      {p.unallocated > 0 && <Txt v="small">{fm(p.unallocated, p)} held as client advance</Txt>}
    </Card>
  );
}

export function ClientRow({ client: c }: { client: Client }) {
  const t = useTheme();
  const owes = (c.outstanding ?? 0) > 0;
  return (
    <Card onPress={() => router.push({ pathname: '/client/[id]', params: { id: c.id } })} label={`Client ${c.name}`}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
            {c.name}
          </Txt>
          <Txt v="small" numberOfLines={1}>
            {[c.contactPerson, c.phone, c.city].filter(Boolean).join(' · ') || 'No contact details'}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Txt style={{ fontWeight: '700' }} color={owes ? t.danger : t.sub}>
            {fm(c.outstanding ?? 0)}
          </Txt>
          <Txt v="small">{(c.credit ?? 0) > 0 ? `Advance ${fm(c.credit ?? 0)}` : 'Outstanding'}</Txt>
        </View>
      </Row>
    </Card>
  );
}

export function InstallmentItem({ item: s }: { item: InstallmentRow }) {
  return (
    <Card onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: s.invoiceId } })} label={`Installment for ${s.clientName}`}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
            {s.clientName}
          </Txt>
          <Txt v="small">
            {s.invoiceNumber} · due {fd(s.dueDate)}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Txt style={{ fontWeight: '700' }}>{fm(s.amount - (s.paid ?? 0), s)}</Txt>
          <Badge status={s.status ?? 'pending'} />
        </View>
      </Row>
    </Card>
  );
}

export function MenuRow({ icon, title, sub, onPress, disabled }: { icon: IconName; title: string; sub?: string; onPress?: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Card onPress={disabled ? undefined : onPress} style={disabled && { opacity: 0.55 }} label={title}>
      <Row gap={12}>
        <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={20} color={t.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt style={{ fontWeight: '600' }}>{title}</Txt>
          {!!sub && <Txt v="small">{sub}</Txt>}
        </View>
        {!disabled && <Ionicons name="chevron-forward" size={18} color={t.sub} />}
      </Row>
    </Card>
  );
}
