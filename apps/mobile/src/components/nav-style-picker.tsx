import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, View } from 'react-native';
import { useTheme } from '@/lib/app-context';
import { NAV_STYLES, NAV_STYLE_LABELS, softInset, softShadow, useNavStyle, type NavStyle } from './styles-kit';
import { GRADIENT, Row, Txt } from './ui';

const ICONS = ['grid', 'document-text-outline', 'add', 'bag-handle-outline', 'stats-chart-outline'] as const;

/** A miniature of one bottom-bar style. */
function Mini({ style }: { style: Exclude<NavStyle, 'auto'> }) {
  const t = useTheme();
  const glass = style === 'glass';
  const icons = (
    <Row gap={0} style={{ justifyContent: 'space-around', flex: 1 }}>
      {ICONS.map((n, i) =>
        i === 2 ? (
          <View key={n} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: GRADIENT[1], alignItems: 'center', justifyContent: 'center', marginTop: style === 'classic' ? -12 : 0 }}>
            <Ionicons name="add" size={14} color="#fff" />
          </View>
        ) : (
          <View
            key={n}
            style={
              i === 0
                ? ({
                    padding: 3,
                    borderRadius: 8,
                    backgroundColor: style === 'dock' ? t.primarySoft : style === 'neumorph' ? t.bg : glass ? 'rgba(255,255,255,0.25)' : undefined,
                    boxShadow: style === 'neumorph' ? softInset(t) : undefined,
                  } as any)
                : { padding: 3 }
            }>
            <Ionicons name={n as any} size={13} color={glass ? '#fff' : i === 0 ? t.primary : t.sub} />
          </View>
        ),
      )}
    </Row>
  );
  const frame = { height: 64, borderRadius: 12, backgroundColor: t.bg, justifyContent: 'flex-end' as const, overflow: 'hidden' as const, padding: style === 'classic' ? 0 : 7 };
  if (style === 'classic')
    return (
      <View style={frame}>
        <View style={{ height: 30, backgroundColor: t.card, borderTopWidth: 1, borderColor: t.border, flexDirection: 'row', alignItems: 'center', overflow: 'visible' }}>{icons}</View>
      </View>
    );
  if (glass)
    return (
      <View style={frame}>
        <LinearGradient colors={['#6D5DFC', '#A855F7', '#EC4899']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 32, borderRadius: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' }}>
          {icons}
        </LinearGradient>
      </View>
    );
  return (
    <View style={frame}>
      <View
        style={
          {
            height: 32,
            borderRadius: 16,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: style === 'neumorph' ? t.bg : t.card,
            borderWidth: style === 'dock' ? 1 : 0,
            borderColor: t.border,
            boxShadow: style === 'neumorph' ? softShadow(t, 3) : '0 4px 10px rgba(16,32,80,0.18)',
          } as any
        }>
        {icons}
      </View>
    </View>
  );
}

/** Grid for choosing the bottom bar style; saved on this phone. */
export function NavStylePicker() {
  const t = useTheme();
  const [value, resolved, set] = useNavStyle();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {NAV_STYLES.map((s) => {
        const on = s === value;
        return (
          <Pressable
            key={s}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={NAV_STYLE_LABELS[s].name}
            onPress={() => set(s)}
            style={{ flexBasis: '46%', flexGrow: 1, gap: 4, padding: 6, borderRadius: 14, borderWidth: on ? 3 : 1, borderColor: on ? t.primary : t.border }}>
            <View pointerEvents="none">
              <Mini style={s === 'auto' ? resolved : s} />
            </View>
            <Txt style={{ fontWeight: '700', textAlign: 'center' }} color={on ? t.primary : undefined}>
              {NAV_STYLE_LABELS[s].name}
            </Txt>
            <Txt v="small" style={{ textAlign: 'center' }}>
              {s === 'auto' ? `Now: ${NAV_STYLE_LABELS[resolved].name}` : NAV_STYLE_LABELS[s].hint}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
