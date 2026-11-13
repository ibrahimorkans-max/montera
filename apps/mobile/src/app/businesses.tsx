import { router } from 'expo-router';
import { Image, View } from 'react-native';
import { Badge, Btn, Card, Loader, Notice, Row, Screen, Txt } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useAuth } from '@/lib/app-context';
import type { BusinessProfile } from '@/lib/shared';

export default function Businesses() {
  const { can } = useAuth();
  const manage = can('businesses.manage');
  const { data, loading, error, reload, refreshing } = useApi<BusinessProfile[]>('/businesses');
  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Txt v="sub">The business you pick on an invoice is the one shown as its issuer, on the invoice, its receipts and client statements.</Txt>
      {manage ? <Btn icon="add" title="Add business profile" onPress={() => router.push('/business/edit')} /> : <Notice>Only the account owner can change business profiles.</Notice>}
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {(data ?? []).map((b) => (
          <Card key={b.id} onPress={manage ? () => router.push({ pathname: '/business/edit', params: { id: b.id } }) : undefined} label={`Business ${b.legalName}`}>
            <Row gap={12}>
              {!!b.logo && <Image source={{ uri: b.logo }} style={{ width: 48, height: 48, borderRadius: 8 }} resizeMode="contain" accessibilityLabel="Logo" />}
              <View style={{ flex: 1, gap: 2 }}>
                <Txt style={{ fontWeight: '700' }}>{b.tradingName || b.legalName}</Txt>
                <Txt v="small">
                  {[b.tradingName ? b.legalName : '', b.currency, `invoices ${b.invoicePrefix}00001`].filter(Boolean).join(' · ')}
                </Txt>
              </View>
              {b.status === 'inactive' && <Badge status="inactive" />}
            </Row>
          </Card>
        ))}
      </Loader>
    </Screen>
  );
}
