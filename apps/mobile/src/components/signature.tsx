import { createElement, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Platform, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import Svg, { Path, SvgXml } from 'react-native-svg';
import { useTheme, useToast } from '@/lib/app-context';
import { Btn, Row, Sheet, Txt } from './ui';

const SVG_PREFIX = 'data:image/svg+xml;utf8,';
const PAD_HEIGHT = 190;

/** Image that also understands the drawn-signature format (an SVG data URI) on phones. */
export function Img({ uri, style, label }: { uri: string; style?: StyleProp<ImageStyle>; label?: string }) {
  if (Platform.OS === 'web' && uri.startsWith(SVG_PREFIX)) {
    // the browser draws vector data URIs natively
    return createElement('img', { src: uri, alt: label ?? '', style: { ...(StyleSheet.flatten(style) as object), objectFit: 'contain', display: 'block' } });
  }
  if (uri.startsWith(SVG_PREFIX)) {
    return (
      <View style={style as any} accessibilityLabel={label}>
        <SvgXml xml={decodeURIComponent(uri.slice(SVG_PREFIX.length))} width="100%" height="100%" />
      </View>
    );
  }
  return <Image source={{ uri }} style={style} resizeMode="contain" accessibilityLabel={label} />;
}

/** Draw a signature with a finger, stylus or mouse. Saves a small vector image. */
export function SignaturePad({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: (dataUri: string) => void }) {
  const t = useTheme();
  const toast = useToast();
  const [strokes, setStrokes] = useState<string[]>([]);
  const [live, setLive] = useState('');
  const current = useRef('');
  const width = useRef(320);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          current.current = `M${e.nativeEvent.locationX.toFixed(1)} ${e.nativeEvent.locationY.toFixed(1)}`;
          setLive(current.current);
        },
        onPanResponderMove: (e) => {
          current.current += ` L${e.nativeEvent.locationX.toFixed(1)} ${e.nativeEvent.locationY.toFixed(1)}`;
          setLive(current.current);
        },
        onPanResponderRelease: () => {
          const done = current.current;
          current.current = '';
          setLive('');
          // a tap leaves a dot
          setStrokes((s) => [...s, done.includes('L') ? done : `${done} l0.1 0.1`]);
        },
      }),
    [],
  );

  function save() {
    if (strokes.length === 0) return toast('Draw your signature first', 'error');
    const paths = strokes.map((d) => `<path d="${d}"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width.current)}" height="${PAD_HEIGHT}" viewBox="0 0 ${Math.round(width.current)} ${PAD_HEIGHT}" fill="none" stroke="#14141a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    onSave(SVG_PREFIX + encodeURIComponent(svg));
    setStrokes([]);
  }

  return (
    <Sheet visible={visible} title="Draw signature" onClose={onClose}>
      <Txt v="sub">Sign inside the box. This signature is placed on invoices, receipts and statements issued by this business.</Txt>
      <View
        {...pan.panHandlers}
        onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
        accessibilityLabel="Signature drawing area"
        style={{ height: PAD_HEIGHT, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: t.primary, borderStyle: 'dashed', overflow: 'hidden', cursor: 'crosshair', touchAction: 'none', userSelect: 'none' } as any}>
        <Svg width="100%" height="100%" pointerEvents="none">
          {[...strokes, live].filter(Boolean).map((d, n) => (
            <Path key={n} d={d} stroke="#14141a" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ))}
        </Svg>
        <View pointerEvents="none" style={{ position: 'absolute', left: 24, right: 24, bottom: 38, height: 1, backgroundColor: '#c9c9d2' }} />
      </View>
      <Row gap={10}>
        <Btn style={{ flex: 1 }} kind="secondary" icon="arrow-undo-outline" title="Undo" onPress={() => setStrokes((s) => s.slice(0, -1))} disabled={strokes.length === 0} />
        <Btn style={{ flex: 1 }} kind="secondary" icon="refresh-outline" title="Clear" onPress={() => setStrokes([])} disabled={strokes.length === 0} />
      </Row>
      <Btn icon="checkmark-circle-outline" title="Use this signature" onPress={save} />
    </Sheet>
  );
}
