import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { Txt } from './ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1] ?? m;

/** 0 → 1 over `ms`, restarting whenever `key` changes. Drives chart entrance animations. */
function useProgress(key: unknown, ms = 700) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = Date.now();
    const tick = () => {
      const x = Math.min(1, (Date.now() - t0) / ms);
      setP(1 - Math.pow(1 - x, 3));
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, ms]);
  return p;
}

/** Rounded vertical bars; the highlighted (usually last) bar uses the strong colour. */
export function Bars({
  values,
  labels,
  color,
  soft,
  height = 120,
  highlight,
  labelColor,
}: {
  values: number[];
  labels: string[];
  color: string;
  soft: string;
  height?: number;
  highlight?: number;
  labelColor?: string;
}) {
  const peak = Math.max(1, ...values);
  const hi = highlight ?? values.length - 1;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: height + 22 }}>
      {values.map((v, i) => (
        <BarColumn key={`${labels[i]}-${i}`} ratio={v / peak} height={height} color={i === hi ? color : soft} label={labels[i]} bold={i === hi} labelColor={labelColor} />
      ))}
    </View>
  );
}

function BarColumn({ ratio, height, color, label, bold, labelColor }: { ratio: number; height: number; color: string; label: string; bold: boolean; labelColor?: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: Math.max(0.03, ratio), duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [ratio, v]);
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      <View style={{ height, width: '100%', justifyContent: 'flex-end' }}>
        <Animated.View style={{ width: '100%', borderRadius: 8, backgroundColor: color, height: v.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) }} />
      </View>
      <Txt v="small" color={labelColor} style={{ fontWeight: bold ? '800' : '500' }} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

/** Smooth line with a soft gradient fill underneath, drawn left to right. */
export function AreaLine({ values, labels, color, height = 130, width = 320, labelColor }: { values: number[]; labels: string[]; color: string; height?: number; width?: number; labelColor?: string }) {
  const [w, setW] = useState(width);
  const p = useProgress(values.join(','));
  const n = values.length;
  const peak = Math.max(1, ...values);
  const pad = 8;
  const pts = values.map((v, i) => ({ x: n === 1 ? w / 2 : (i / (n - 1)) * (w - pad * 2) + pad, y: height - pad - (v / peak) * (height - pad * 2) }));
  // Catmull-Rom → Bézier for a smooth curve
  let d = pts.length ? `M${pts[0].x},${pts[0].y}` : '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d += ` C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`;
  }
  const area = pts.length ? `${d} L${pts[pts.length - 1].x},${height} L${pts[0].x},${height} Z` : '';
  const last = pts[pts.length - 1];
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <View style={{ height, overflow: 'hidden', width: `${Math.max(2, p * 100)}%` }}>
        <Svg width={w} height={height}>
          <Defs>
            <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.32} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={area} fill="url(#area)" />
          <Path d={d} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" />
          {last && p > 0.98 && <Circle cx={last.x} cy={last.y} r={5} fill="#fff" stroke={color} strokeWidth={3} />}
        </Svg>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        {labels.map((l, i) => (
          <Txt key={`${l}-${i}`} v="small" color={labelColor} style={{ fontWeight: i === labels.length - 1 ? '800' : '500' }}>
            {l}
          </Txt>
        ))}
      </View>
    </View>
  );
}

/** Ring chart. Segments sweep in clockwise. */
export function Donut({ segments, size = 150, stroke = 20, track, children }: { segments: { value: number; color: string }[]; size?: number; stroke?: number; track: string; children?: React.ReactNode }) {
  const p = useProgress(segments.map((s) => s.value).join(','), 900);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0);
  let offset = 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        {total > 0 &&
          segments.map((s, i) => {
            const len = (s.value / total) * c * p;
            const gap = segments.length > 1 ? Math.min(4, len / 3) : 0;
            const el = <Circle key={i} cx={size / 2} cy={size / 2} r={r} stroke={s.color} strokeWidth={stroke} fill="none" strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-offset} strokeLinecap="butt" />;
            offset += (s.value / total) * c * p;
            return el;
          })}
      </Svg>
      {children}
    </View>
  );
}
