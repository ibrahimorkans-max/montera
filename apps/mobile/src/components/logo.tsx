import { Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';

export const BRAND = {
  name: 'Kaarobarly',
  tagline: ['Invoice.', 'Track.', 'Grow.'] as const,
  navy: '#0B1B4D',
  blue: '#1463F3',
  teal: '#0FA9B8',
  green: '#1DC87C',
  splash: ['#060F2E', '#0B1B4D', '#0E2C72'] as const,
};

// Geometry on a 100 x 100 grid. scripts/make-icons.cjs draws the same shapes for the icon files.
/** K: a stem, an arm that rises into an arrow, and a leg. */
const K_PATHS = ['M18 14 L18 84', 'M18 56 L78 16', 'M36 44 L56 84'];
const ARROW = '88.8,8.8 82.2,24.0 72.2,9.05';
const BARS = [
  { x: 64, y: 62 },
  { x: 74, y: 48 },
  { x: 84, y: 36 },
];

/** The Kaarobarly mark: a K whose arm becomes a rising arrow over growing bars. */
export function LogoMark({ size = 48, mono }: { size?: number; mono?: string }) {
  const paint = mono ?? 'url(#brand)';
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="Kaarobarly logo">
      <Defs>
        <LinearGradient id="brand" x1="10" y1="0" x2="90" y2="0" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={BRAND.blue} />
          <Stop offset="0.56" stopColor={BRAND.teal} />
          <Stop offset="1" stopColor={BRAND.green} />
        </LinearGradient>
      </Defs>
      {BARS.map((b) => (
        <Rect key={b.x} x={b.x} y={b.y} width={7} height={84 - b.y} rx={2} fill={paint} />
      ))}
      {K_PATHS.map((d) => (
        <Path key={d} d={d} stroke={paint} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
      <Polygon points={ARROW} fill={paint} />
    </Svg>
  );
}

/** Mark with the name and tagline beside it. `onDark` switches the wordmark to white. */
export function LogoLockup({ size = 44, onDark }: { size?: number; onDark?: boolean }) {
  const ink = onDark ? '#FFFFFF' : BRAND.navy;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.28 }}>
      <LogoMark size={size} mono={undefined} />
      <View>
        <Text style={{ color: ink, fontSize: size * 0.74, fontWeight: '800', letterSpacing: -0.8, lineHeight: size * 0.86 }}>{BRAND.name}</Text>
        <Text style={{ color: ink, opacity: 0.85, fontSize: size * 0.3, fontWeight: '500', letterSpacing: 0.4 }}>
          Invoice. Track. <Text style={{ color: BRAND.green, fontWeight: '700', opacity: 1 }}>Grow.</Text>
        </Text>
      </View>
    </View>
  );
}
