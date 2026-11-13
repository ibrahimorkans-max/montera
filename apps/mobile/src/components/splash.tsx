import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { BRAND, LogoMark } from './logo';

const NATIVE = Platform.OS !== 'web';
const MARK = 112;
const LETTERS = BRAND.name.split('');

/**
 * Launch animation: the mark is wiped in along the rising arrow, the name appears letter
 * by letter, the tagline follows, then the whole screen fades away to reveal the app.
 */
export function SplashReveal({ onDone }: { onDone: () => void }) {
  const [gone, setGone] = useState(false);
  const wipe = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const letters = useRef(LETTERS.map(() => new Animated.Value(0))).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const line = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      setGone(true);
      onDone();
    };
    const fadeOut = Animated.timing(out, { toValue: 0, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE });

    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          // no motion: show the finished logo briefly
          [wipe, pop, tagline, line, ...letters].forEach((v) => v.setValue(1));
          Animated.sequence([Animated.delay(900), fadeOut]).start(finish);
          return;
        }
        Animated.sequence([
          Animated.parallel([
            Animated.timing(wipe, { toValue: 1, duration: 720, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
            Animated.spring(pop, { toValue: 1, useNativeDriver: NATIVE, bounciness: 10, speed: 8 }),
          ]),
          Animated.stagger(
            70,
            letters.map((v) => Animated.timing(v, { toValue: 1, duration: 340, easing: Easing.out(Easing.back(1.6)), useNativeDriver: NATIVE })),
          ),
          Animated.parallel([
            Animated.timing(line, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
            Animated.timing(tagline, { toValue: 1, duration: 420, useNativeDriver: NATIVE }),
          ]),
          Animated.delay(650),
          fadeOut,
        ]).start(finish);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gone) return null;
  return (
    <Animated.View accessibilityLabel={`${BRAND.name}. ${BRAND.tagline.join(' ')}`} style={[StyleSheet.absoluteFill, { zIndex: 2000, opacity: out }]}>
      <LinearGradient colors={BRAND.splash} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <View style={{ position: 'absolute', width: 420, height: 420, borderRadius: 210, backgroundColor: 'rgba(20,99,243,0.16)' }} />
        <Animated.View style={{ width: MARK, height: MARK, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }}>
          <Animated.View style={{ height: MARK, overflow: 'hidden', width: wipe.interpolate({ inputRange: [0, 1], outputRange: [0, MARK] }) }}>
            <View style={{ width: MARK, height: MARK }}>
              <LogoMark size={MARK} />
            </View>
          </Animated.View>
        </Animated.View>

        <View style={{ alignItems: 'center' }}>
          <View style={{ flexDirection: 'row' }}>
            {LETTERS.map((ch, i) => (
              <Animated.Text
                key={i}
                style={{
                  color: '#FFFFFF',
                  fontSize: 50,
                  fontWeight: '800',
                  letterSpacing: -1,
                  opacity: letters[i],
                  transform: [{ translateY: letters[i].interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }],
                }}>
                {ch}
              </Animated.Text>
            ))}
          </View>
          <Animated.View style={{ height: 3, borderRadius: 2, backgroundColor: BRAND.green, marginTop: 2, width: line.interpolate({ inputRange: [0, 1], outputRange: [0, 150] }) }} />
          <Animated.Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 17, fontWeight: '500', letterSpacing: 1, marginTop: 12, opacity: tagline }}>
            Invoice. Track. <Animated.Text style={{ color: BRAND.green, fontWeight: '800' }}>Grow.</Animated.Text>
          </Animated.Text>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}
