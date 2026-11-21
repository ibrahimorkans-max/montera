import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { DashboardView, StylePreview } from '@/components/dashboard-styles';
import { NavStylePicker } from '@/components/nav-style-picker';
import { reportDashboardStyle } from '@/components/styles-kit';
import { LogoMark } from '@/components/logo';
import { Chips, IconBtn, Loader, Row, Screen, Select, Sheet, Txt, addDays, todayStr } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { useAuth, useTheme, useToast } from '@/lib/app-context';
import { DASHBOARD_STYLES, DASHBOARD_STYLE_LABELS, type BusinessProfile, type DashboardStyle, type DashboardSummary, type Invoice } from '@/lib/shared';
import { local } from '@/lib/storage';

type Range = 'all' | 'month' | '30d' | 'year';
const STYLE_KEY = 'millnexa.dashboardStyle';

function rangeDates(r: Range): { from?: string; to?: string } {
  const today = todayStr();
  if (r === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (r === '30d') return { from: addDays(today, -30), to: today };
  if (r === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return {};
}

export default function Home() {
  const t = useTheme();
  const toast = useToast();
  const { user, can } = useAuth();
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const multi = (businesses.data?.length ?? 0) > 1;
  // one business: always that business. Several: start with the combined view.
  const [businessId, setBusinessId] = useState<string | null>(null);
  const selectedId = businessId ?? (multi ? '' : (businesses.data?.[0]?.id ?? ''));
  const [range, setRange] = useState<Range>('all');
  const [picker, setPicker] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, DashboardStyle>>({});
  useEffect(() => {
    local.get<Record<string, DashboardStyle>>(STYLE_KEY).then((v) => v && setOverrides(v));
  }, []);

  const { data: d, loading, error, reload, refreshing } = useApi<DashboardSummary>(businesses.data ? `/dashboard${qs({ businessId: selectedId, ...rangeDates(range) })}` : null);
  const pending = useApi<Invoice[]>('/recurring-pending');
  const business = businesses.data?.find((b) => b.id === selectedId);
  const styleKey = selectedId || 'all';
  const style: DashboardStyle = overrides[styleKey] ?? business?.dashboardStyle ?? d?.dashboardStyle ?? 'monetra';
  useEffect(() => reportDashboardStyle(style), [style]);

  async function chooseStyle(s: DashboardStyle) {
    setPicker(false);
    // the owner's choice is saved on the business so the whole team sees it; anyone else changes only their own phone
    if (business && can('businesses.manage')) {
      try {
        await api(`/businesses/${business.id}`, { method: 'PUT', body: { ...business, dashboardStyle: s } });
        const next = { ...overrides };
        delete next[styleKey];
        setOverrides(next);
        local.set(STYLE_KEY, next);
        businesses.reload();
        toast(`${DASHBOARD_STYLE_LABELS[s].name} style saved for ${business.tradingName || business.legalName}`);
        return;
      } catch (e: any) {
        toast(e.message, 'error');
      }
    }
    const next = { ...overrides, [styleKey]: s };
    setOverrides(next);
    local.set(STYLE_KEY, next);
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const title = business ? business.tradingName || business.legalName : multi ? 'All businesses' : (user?.tenantName ?? '');

  return (
    <Screen onRefresh={() => (reload(), pending.reload())} refreshing={refreshing}>
      <Row style={{ justifyContent: 'space-between', paddingTop: 0 }}>
        <Row gap={10} style={{ flex: 1 }}>
          <LogoMark size={34} />
          <View style={{ flex: 1 }}>
            <Txt v="small">
              {greeting}, {user?.name.split(' ')[0]}
            </Txt>
            <Txt v="big" numberOfLines={1}>
              {title}
            </Txt>
          </View>
        </Row>
        <Row gap={8}>
          <IconBtn icon="color-palette-outline" label="Change dashboard style" onPress={() => setPicker(true)} />
          <IconBtn icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} />
        </Row>
      </Row>

      {multi && (
        <Select
          label="Business"
          value={business ? business.tradingName || business.legalName : 'All businesses (combined)'}
          placeholder="All businesses"
          items={[{ id: '', legalName: 'All businesses (combined)', tradingName: '' } as BusinessProfile, ...(businesses.data ?? [])]}
          getKey={(b) => b.id || 'all'}
          getLabel={(b) => b.tradingName || b.legalName}
          getSub={(b) => (b.id ? `${b.currency} · ${DASHBOARD_STYLE_LABELS[b.dashboardStyle].name} style` : 'Totals converted to one currency')}
          onSelect={(b) => setBusinessId(b.id)}
        />
      )}
      <Chips
        value={range}
        onChange={setRange}
        options={[
          { value: 'all', label: 'All time' },
          { value: 'month', label: 'This month' },
          { value: '30d', label: 'Last 30 days' },
          { value: 'year', label: 'This year' },
        ]}
      />

      <Loader loading={(loading || businesses.loading) && !d} error={d ? '' : error || businesses.error} onRetry={reload}>
        {d && <DashboardView key={style} style={style} d={d} pending={pending.data?.length ?? 0} />}
      </Loader>

      <Sheet visible={picker} title="Dashboard style" onClose={() => setPicker(false)}>
        <Txt v="sub">
          {business && can('businesses.manage')
            ? `Saved for ${business.tradingName || business.legalName}, so everyone on your team sees it.`
            : 'Changes the look on this phone only.'}
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {DASHBOARD_STYLES.map((s) => (
            <Pressable key={s} accessibilityRole="radio" accessibilityState={{ selected: s === style }} accessibilityLabel={DASHBOARD_STYLE_LABELS[s].name} onPress={() => chooseStyle(s)} style={{ flexBasis: '46%', flexGrow: 1, gap: 6 }}>
              <StylePreview style={s} selected={s === style} />
              <Txt style={{ fontWeight: '700', textAlign: 'center' }} color={s === style ? t.primary : undefined}>
                {DASHBOARD_STYLE_LABELS[s].name}
              </Txt>
              <Txt v="small" style={{ textAlign: 'center' }}>
                {DASHBOARD_STYLE_LABELS[s].hint}
              </Txt>
            </Pressable>
          ))}
        </View>
        <Txt v="h" style={{ marginTop: 8 }}>
          Bottom bar style
        </Txt>
        <NavStylePicker />
      </Sheet>
    </Screen>
  );
}
