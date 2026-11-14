import * as Sharing from 'expo-sharing';
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { WebView } from 'react-native-webview';
import { ToastView, useTheme, useToast } from '@/lib/app-context';
import { downloadImageInBrowser, type ImageFormat } from '@/lib/export-image';
import { PAPERS, PAPER_SIZE, printDoc, sharePdf, type Paper } from '@/lib/pdf';
import { INVOICE_TEMPLATES, INVOICE_TEMPLATE_LABELS, type InvoiceTemplate } from '@/lib/shared';
import { Btn, Chips, IconBtn, MAX_WIDTH, Row, Txt } from './ui';

/** Shows an HTML document scaled to the available width, exactly as it will print. */
export function DocPreview({ html, paper }: { html: string; paper: Paper }) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [docHeight, setDocHeight] = useState(PAPER_SIZE[paper].pxHeight || 700);
  const px = PAPER_SIZE[paper].px;
  const scale = width ? Math.min(1, width / px) : 0;
  const shown = Math.max(docHeight, PAPER_SIZE[paper].pxHeight || 0);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: '100%', alignItems: 'center' }}>
      {scale > 0 && (
        <View
          style={{ width: px * scale, height: shown * scale, backgroundColor: '#fff', borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: t.border, boxShadow: '0 8px 24px rgba(0,0,0,0.18)' } as any}>
          {Platform.OS === 'web' ? (
            createElement('iframe', {
              title: 'Document preview',
              srcDoc: html,
              onLoad: (e: any) => {
                const d = e.target.contentDocument;
                if (d) setDocHeight(Math.max(d.documentElement.scrollHeight, d.body.scrollHeight));
              },
              style: { display: 'block', flexShrink: 0, width: px, minWidth: px, height: shown, minHeight: shown, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', background: '#fff' },
            })
          ) : (
            <WebView
              originWhitelist={['*']}
              source={{ html }}
              scalesPageToFit
              scrollEnabled={false}
              javaScriptEnabled
              injectedJavaScript="window.ReactNativeWebView.postMessage(String(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))); true;"
              onMessage={(e) => {
                const h = Number(e.nativeEvent.data);
                if (h > 0) setDocHeight(h);
              }}
              style={{ flex: 1, backgroundColor: '#fff' }}
            />
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Full-screen preview of a document before it is sent, with design and paper choices
 * and export as PDF, PNG or JPG.
 */
export function DocumentViewer({
  visible,
  onClose,
  title,
  fileName,
  build,
  template,
  defaultPaper = 'A4',
  note,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  fileName: string;
  build: (paper: Paper, template: InvoiceTemplate) => string;
  /** pass the business's design to let the user try the others; omit for documents with one design */
  template?: InvoiceTemplate;
  defaultPaper?: Paper;
  note?: string;
}) {
  const t = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [paper, setPaper] = useState<Paper>(defaultPaper);
  const [design, setDesign] = useState<InvoiceTemplate>(template ?? 'amber');
  const [busy, setBusy] = useState('');
  const shot = useRef<any>(null);
  // each time the viewer opens, start from the business's own design
  useEffect(() => {
    if (visible && template) setDesign(template);
  }, [visible, template]);
  const html = useMemo(() => (visible ? build(paper, design) : ''), [visible, build, paper, design]);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try {
      await fn();
    } catch (e: any) {
      toast(e.message ?? 'Export failed', 'error');
    } finally {
      setBusy('');
    }
  }

  const image = (format: ImageFormat) =>
    run(format, async () => {
      if (Platform.OS === 'web') {
        await downloadImageInBrowser(html, paper, format, fileName);
        toast(`${format.toUpperCase()} downloaded`);
        return;
      }
      const uri = await captureRef(shot, { format, quality: 0.95, result: 'tmpfile' });
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      await Sharing.shareAsync(uri, { mimeType: format === 'png' ? 'image/png' : 'image/jpeg', dialogTitle: title });
    });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 }}>
          <View style={{ flex: 1 }}>
            <Txt v="h">{title}</Txt>
            <Txt v="small">Preview · exactly what the client will receive</Txt>
          </View>
          <IconBtn icon="close" label="Close preview" onPress={onClose} />
        </Row>
        <View style={{ paddingHorizontal: 16, gap: 8, paddingBottom: 10 }}>
          {template && paper !== 'thermal' && (
            <Chips value={design} onChange={setDesign} options={INVOICE_TEMPLATES.map((x) => ({ value: x, label: INVOICE_TEMPLATE_LABELS[x] }))} />
          )}
          <Chips value={paper} onChange={setPaper} options={PAPERS} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, alignItems: 'center' }}>
          <View ref={shot} collapsable={false} style={{ width: '100%', maxWidth: MAX_WIDTH }}>
            {!!html && <DocPreview html={html} paper={paper} />}
          </View>
          {!!note && (
            <Txt v="small" style={{ marginTop: 12, textAlign: 'center' }}>
              {note}
            </Txt>
          )}
        </ScrollView>
        <View style={{ backgroundColor: t.card, borderTopWidth: 1, borderTopColor: t.border, padding: 12, paddingBottom: Math.max(insets.bottom, 12), gap: 8 }}>
          <Txt v="label">Export or send as</Txt>
          <Row gap={8}>
            <Btn small style={{ flex: 1 }} icon="document-text-outline" title="PDF" onPress={() => run('pdf', () => sharePdf(html, paper, title))} loading={busy === 'pdf'} disabled={!!busy} />
            <Btn small style={{ flex: 1 }} kind="secondary" icon="image-outline" title="PNG" onPress={() => image('png')} loading={busy === 'png'} disabled={!!busy} />
            <Btn small style={{ flex: 1 }} kind="secondary" icon="image-outline" title="JPG" onPress={() => image('jpg')} loading={busy === 'jpg'} disabled={!!busy} />
            <Btn small style={{ flex: 1 }} kind="secondary" icon="print-outline" title="Print" onPress={() => run('print', () => printDoc(html, paper))} loading={busy === 'print'} disabled={!!busy} />
          </Row>
        </View>
      </View>
      <ToastView />
    </Modal>
  );
}
