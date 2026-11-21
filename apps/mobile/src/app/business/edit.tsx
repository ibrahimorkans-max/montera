import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { DocumentViewer } from '@/components/doc-viewer';
import { Img, SignaturePad } from '@/components/signature';
import { Btn, Card, Chips, Field, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { api } from '@/lib/api';
import { useTheme, useToast } from '@/lib/app-context';
import { pickImage } from '@/lib/image';
import { DEFAULT_DISCLAIMER, TEMPLATE_COLORS, invoiceHtml, type Paper } from '@/lib/pdf';
import { sampleInvoiceDoc } from '@/lib/sample';
import { DASHBOARD_STYLES, DASHBOARD_STYLE_LABELS, INVOICE_TEMPLATES, INVOICE_TEMPLATE_LABELS, financialYear, type BusinessProfile, type DashboardStyle, type InvoiceTemplate } from '@/lib/shared';
import { StylePreview } from '@/components/dashboard-styles';

type Form = Omit<BusinessProfile, 'id'>;
const blank: Form = {
  legalName: '', tradingName: '', ownerName: '', logo: '', registrationNo: '', ntn: '', phone: '', whatsapp: '', email: '', address: '', website: '',
  bankDetails: '', iban: '', paymentInstructions: '', signature: '', stamp: '', invoiceFooter: '', invoiceDisclaimer: '', currency: 'PKR', currencyPrecision: 2,
  invoicePrefix: 'INV-', taxInclusive: false, rounding: 'none', invoiceTemplate: 'amber', accentColor: '', fyStartMonth: 7, numberReset: 'never', dashboardStyle: 'monetra', status: 'active',
};
const ACCENTS = ['', '#E9A23B', '#1F3A8A', '#4B3F9E', '#E0483E', '#0F766E', '#BE185D', '#334155'];

function ImageSlot({ label, value, onChange, onDraw }: { label: string; value: string; onChange: (v: string) => void; onDraw?: () => void }) {
  const toast = useToast();
  return (
    <Card>
      <Txt v="label">{label}</Txt>
      {!!value && <Img uri={value} label={label} style={{ width: '100%', height: 96, backgroundColor: '#fff', borderRadius: 10 }} />}
      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        {onDraw && <Btn small icon="pencil-outline" title={value ? 'Redraw' : 'Draw signature'} onPress={onDraw} />}
        <Btn
          small
          kind="secondary"
          icon="image-outline"
          title={value ? 'Replace image' : 'Upload image'}
          onPress={async () => {
            try {
              const uri = await pickImage();
              if (uri) onChange(uri);
            } catch (e: any) {
              toast(e.message, 'error');
            }
          }}
        />
        {!!value && <Btn small kind="danger" icon="trash-outline" title="Remove" onPress={() => onChange('')} />}
      </Row>
    </Card>
  );
}

/** Tiny drawing of each design so the choice can be made at a glance. */
function TemplateThumb({ id, accent, selected, onPress }: { id: InvoiceTemplate; accent: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const a = accent || TEMPLATE_COLORS[id].accent;
  const d = TEMPLATE_COLORS[id].dark;
  const line = (w: string, c = '#d4d6de', h = 4) => <View style={{ width: w as any, height: h, backgroundColor: c, borderRadius: 2 }} />;
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${INVOICE_TEMPLATE_LABELS[id]} design`} onPress={onPress} style={{ width: 118, gap: 6 }}>
      <View style={{ height: 150, backgroundColor: '#fff', borderRadius: 10, borderWidth: selected ? 3 : 1, borderColor: selected ? t.primary : t.border, overflow: 'hidden', padding: 8, gap: 6 }}>
        {id === 'amber' && <View style={{ position: 'absolute', left: 0, top: 0, width: '68%', height: 20, backgroundColor: a, borderBottomRightRadius: 14 }} />}
        {id === 'amber' && <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, backgroundColor: d }} />}
        {id === 'ocean' && <View style={{ position: 'absolute', right: 0, top: 0, width: '68%', height: 26, backgroundColor: a, borderBottomLeftRadius: 12 }} />}
        {id === 'ocean' && <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 16, backgroundColor: a }} />}
        {id === 'crimson' && <View style={{ width: 12, height: 12, backgroundColor: a }} />}
        <View style={{ height: id === 'amber' || id === 'ocean' ? 22 : 4 }} />
        {id === 'violet' && line('40%', a, 7)}
        {line('55%')}
        {line('35%')}
        <View style={{ height: 9, backgroundColor: id === 'classic' ? '#fff' : a, borderBottomWidth: id === 'classic' ? 1.5 : 0, borderBottomColor: '#111', marginTop: 4 }} />
        {line('100%', id === 'crimson' ? '#d4d8d9' : '#e6e7ee', 7)}
        {line('100%', '#eeeef3', 7)}
        {line('100%', id === 'crimson' ? '#d4d8d9' : '#e6e7ee', 7)}
        <View style={{ alignSelf: 'flex-end', width: '48%', height: 10, backgroundColor: id === 'classic' ? '#111' : a, marginTop: 4 }} />
        {selected && (
          <View style={{ position: 'absolute', right: 6, bottom: id === 'ocean' ? 20 : 6, backgroundColor: t.primary, borderRadius: 11 }}>
            <Ionicons name="checkmark" size={18} color={t.onPrimary} />
          </View>
        )}
      </View>
      <Txt v="label" style={{ textAlign: 'center' }} color={selected ? t.primary : undefined}>
        {INVOICE_TEMPLATE_LABELS[id]}
      </Txt>
    </Pressable>
  );
}

export default function BusinessEdit() {
  const t = useTheme();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [f, setF] = useState<Form | null>(id ? null : blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [preview, setPreview] = useState(false);
  const set = (p: Partial<Form>) => setF((x) => (x ? { ...x, ...p } : x));

  useEffect(() => {
    if (!id) return;
    api<BusinessProfile[]>('/businesses')
      .then((all) => {
        const b = all.find((x) => x.id === id);
        if (!b) throw new Error('Business profile not found.');
        setF(b);
      })
      .catch((e) => {
        toast(e.message, 'error');
        router.back();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const buildSample = useCallback(
    (paper: Paper, template: InvoiceTemplate) => (f ? invoiceHtml(sampleInvoiceDoc({ ...f, id: id ?? 'new', legalName: f.legalName || 'Your Business', invoiceTemplate: template }), paper, template) : ''),
    [f, id],
  );

  async function save() {
    if (!f) return;
    if (!f.legalName.trim()) return setError('Legal business name is required');
    if (!/^[A-Za-z]{3}$/.test(f.currency.trim())) return toast('Currency must be a 3-letter code such as PKR', 'error');
    setBusy(true);
    try {
      await api(id ? `/businesses/${id}` : '/businesses', { method: id ? 'PUT' : 'POST', body: f });
      toast('Business profile saved');
      router.back();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!f) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen footer={<Btn title="Save business profile" onPress={save} loading={busy} />}>
      <Stack.Screen options={{ title: id ? 'Edit Business Profile' : 'New Business Profile' }} />

      <Section title="Invoice design">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 8 }}>
          {INVOICE_TEMPLATES.map((x) => (
            <TemplateThumb key={x} id={x} accent={f.invoiceTemplate === x ? f.accentColor : ''} selected={f.invoiceTemplate === x} onPress={() => set({ invoiceTemplate: x })} />
          ))}
        </ScrollView>
        <Txt v="label">Accent colour</Txt>
        <Row gap={10} style={{ flexWrap: 'wrap' }}>
          {ACCENTS.map((c) => {
            const on = f.accentColor === c;
            const shown = c || TEMPLATE_COLORS[f.invoiceTemplate].accent;
            return (
              <Pressable
                key={c || 'default'}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={c ? `Accent colour ${c}` : 'Design default colour'}
                onPress={() => set({ accentColor: c })}
                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: shown, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 3 : 0, borderColor: t.text }}>
                {!c && <Ionicons name="color-wand-outline" size={18} color="#fff" />}
                {on && !!c && <Ionicons name="checkmark" size={20} color="#fff" />}
              </Pressable>
            );
          })}
        </Row>
        <Btn kind="secondary" icon="eye-outline" title="Preview design with sample invoice" onPress={() => setPreview(true)} />
      </Section>

      <Section title="Home dashboard style">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 8 }}>
          {DASHBOARD_STYLES.map((x: DashboardStyle) => (
            <Pressable key={x} accessibilityRole="radio" accessibilityState={{ selected: f.dashboardStyle === x }} accessibilityLabel={`${DASHBOARD_STYLE_LABELS[x].name} dashboard`} onPress={() => set({ dashboardStyle: x })} style={{ width: 120, gap: 6 }}>
              <StylePreview style={x} selected={f.dashboardStyle === x} />
              <Txt v="label" style={{ textAlign: 'center' }} color={f.dashboardStyle === x ? t.primary : undefined}>
                {DASHBOARD_STYLE_LABELS[x].name}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>
        <Txt v="small">{DASHBOARD_STYLE_LABELS[f.dashboardStyle].hint}. Shown on Home whenever this business is selected.</Txt>
      </Section>

      <Section title="Identity">
        <Field label="Legal business name" value={f.legalName} onChangeText={(v) => (set({ legalName: v }), setError(''))} error={error} />
        <Field label="Business / trading name" value={f.tradingName} onChangeText={(v) => set({ tradingName: v })} hint="Shown as the main name on invoices when filled" />
        <Field label="Owner / signatory name" value={f.ownerName} onChangeText={(v) => set({ ownerName: v })} hint="Printed under the signature" />
        <ImageSlot label="Logo" value={f.logo} onChange={(v) => set({ logo: v })} />
        <Field label="Registration number" value={f.registrationNo} onChangeText={(v) => set({ registrationNo: v })} />
        <Field label="NTN / tax number" value={f.ntn} onChangeText={(v) => set({ ntn: v })} />
      </Section>

      <Section title="Digital signature & stamp">
        <ImageSlot label="Authorized signature" value={f.signature} onChange={(v) => set({ signature: v })} onDraw={() => setDrawing(true)} />
        <ImageSlot label="Business stamp" value={f.stamp} onChange={(v) => set({ stamp: v })} />
        <Txt v="small">The signature and stamp are placed automatically on every invoice, receipt and statement this business issues.</Txt>
      </Section>

      <Section title="Contact">
        <Field label="Phone" value={f.phone} onChangeText={(v) => set({ phone: v })} keyboardType="phone-pad" />
        <Field label="WhatsApp" value={f.whatsapp} onChangeText={(v) => set({ whatsapp: v })} keyboardType="phone-pad" />
        <Field label="Email" value={f.email} onChangeText={(v) => set({ email: v })} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Complete address" value={f.address} onChangeText={(v) => set({ address: v })} multiline />
        <Field label="Website" value={f.website} onChangeText={(v) => set({ website: v })} autoCapitalize="none" keyboardType="url" />
      </Section>

      <Section title="Payment details">
        <Field label="Bank details" value={f.bankDetails} onChangeText={(v) => set({ bankDetails: v })} multiline placeholder="Bank, branch, account title and number" />
        <Field label="IBAN" value={f.iban} onChangeText={(v) => set({ iban: v })} autoCapitalize="characters" />
        <Field label="Payment instructions" value={f.paymentInstructions} onChangeText={(v) => set({ paymentInstructions: v })} multiline />
        <Field label="Invoice footer" value={f.invoiceFooter} onChangeText={(v) => set({ invoiceFooter: v })} multiline placeholder="Thank you for your business!" />
        <Field label="Disclaimer (end of every invoice and purchase slip)" value={f.invoiceDisclaimer} onChangeText={(v) => set({ invoiceDisclaimer: v })} multiline placeholder={DEFAULT_DISCLAIMER} hint="Leave empty to print the standard disclaimer." />
        <Field label="Invoice number prefix" value={f.invoicePrefix} onChangeText={(v) => set({ invoicePrefix: v })} autoCapitalize="characters" hint={`Next invoices look like ${f.invoicePrefix}00001`} />
      </Section>

      <Section title="Currency & calculation">
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <Field style={{ flex: 1 }} label="Default currency" value={f.currency} onChangeText={(v) => set({ currency: v.toUpperCase() })} autoCapitalize="characters" maxLength={3} />
          <Field
            style={{ flex: 1 }}
            label="Decimal places"
            value={String(f.currencyPrecision)}
            onChangeText={(v) => set({ currencyPrecision: Math.min(3, Math.max(0, Number(v.replace(/\D/g, '')) || 0)) })}
            keyboardType="number-pad"
            maxLength={1}
          />
        </Row>
        <Txt v="label">Prices entered on invoices</Txt>
        <Chips
          value={f.taxInclusive ? 'inc' : 'exc'}
          onChange={(v) => set({ taxInclusive: v === 'inc' })}
          options={[
            { value: 'exc', label: 'Exclude tax (added on top)' },
            { value: 'inc', label: 'Include tax' },
          ]}
        />
        <Txt v="label">Round invoice total</Txt>
        <Chips
          value={f.rounding}
          onChange={(v) => set({ rounding: v })}
          options={[
            { value: 'none', label: 'No rounding' },
            { value: 'nearest_1', label: 'Nearest 1' },
            { value: 'nearest_5', label: 'Nearest 5' },
            { value: 'nearest_10', label: 'Nearest 10' },
          ]}
        />
        <Txt v="label">Financial year starts in</Txt>
        <Chips
          value={String(f.fyStartMonth)}
          onChange={(v) => set({ fyStartMonth: Number(v) })}
          options={['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, n) => ({ value: String(n + 1), label: m }))}
        />
        <Txt v="label">Invoice numbers</Txt>
        <Chips
          value={f.numberReset}
          onChange={(v) => set({ numberReset: v })}
          options={[
            { value: 'never', label: 'One running sequence' },
            { value: 'yearly', label: 'Restart each financial year' },
          ]}
        />
        <Txt v="small">
          Next invoice looks like {f.numberReset === 'yearly' ? `${f.invoicePrefix}${financialYear(new Date().toISOString().slice(0, 10), f.fyStartMonth)}-00001` : `${f.invoicePrefix}00001`}. Quotations follow the same rule.
        </Txt>
        <Txt v="small">Changes here apply to new invoices. Invoices already finalized keep the settings they were issued with.</Txt>
        <Txt v="label">Status</Txt>
        <Chips
          value={f.status}
          onChange={(v) => set({ status: v })}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
        />
      </Section>

      <SignaturePad
        visible={drawing}
        onClose={() => setDrawing(false)}
        onSave={(uri) => {
          set({ signature: uri });
          setDrawing(false);
          toast('Signature added. Save the profile to keep it.');
        }}
      />
      <DocumentViewer
        visible={preview}
        onClose={() => setPreview(false)}
        title="Design preview"
        fileName="sample-invoice"
        build={buildSample}
        template={f.invoiceTemplate}
        note="Sample data only. Pick a design above, then save the profile to use it."
      />
    </Screen>
  );
}
