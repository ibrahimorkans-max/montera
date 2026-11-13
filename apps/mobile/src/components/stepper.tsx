import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, Pressable, View } from 'react-native';
import { useTheme } from '@/lib/app-context';
import { GRADIENT, Txt, type IconName } from './ui';

const NATIVE = Platform.OS !== 'web';

export interface StepDef {
  title: string;
  hint: string;
  icon: IconName;
}

function Dot({ def, index, step, onPress }: { def: StepDef; index: number; step: number; onPress: () => void }) {
  const t = useTheme();
  const active = index === step;
  const done = index < step;
  const scale = useRef(new Animated.Value(active ? 1.18 : 1)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: active ? 1.18 : 1, useNativeDriver: NATIVE, bounciness: 14, speed: 14 }).start();
  }, [active, scale]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Step ${index + 1}: ${def.title}`} accessibilityState={{ selected: active }} onPress={onPress} hitSlop={8}>
      <Animated.View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: done ? t.primarySoft : t.card,
          borderWidth: active || done ? 0 : 1.5,
          borderColor: t.border,
          transform: [{ scale }],
        }}>
        {active && <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />}
        <Ionicons name={done ? 'checkmark' : def.icon} size={19} color={active ? '#fff' : done ? t.primary : t.sub} />
      </Animated.View>
    </Pressable>
  );
}

/** Wizard progress: icon dots joined by a line that fills as the user advances. */
export function Stepper({ steps, step, onStepPress }: { steps: StepDef[]; step: number; onStepPress: (index: number) => void }) {
  const t = useTheme();
  const progress = useRef(new Animated.Value(step)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: step, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [step, progress]);
  const last = steps.length - 1;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: 20, right: 20, height: 4, borderRadius: 2, backgroundColor: t.neutralSoft, overflow: 'hidden' }}>
          <Animated.View style={{ height: '100%', borderRadius: 2, backgroundColor: t.primary, width: progress.interpolate({ inputRange: [0, last], outputRange: ['0%', '100%'] }) }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {steps.map((s, i) => (
            <Dot key={s.title} def={s} index={i} step={step} onPress={() => onStepPress(i)} />
          ))}
        </View>
      </View>
      <View>
        <Txt v="small" color={t.primary} style={{ fontWeight: '700', letterSpacing: 0.6 }}>
          STEP {step + 1} OF {steps.length}
        </Txt>
        <Txt v="big">{steps[step].title}</Txt>
        <Txt v="sub">{steps[step].hint}</Txt>
      </View>
    </View>
  );
}

/** Slides step content in from the side the user is moving toward. Give it a `key` that changes per step. */
export function StepSlide({ children, direction }: { children: ReactNode; direction: 1 | -1 }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
  }, [v]);
  return (
    <Animated.View style={{ gap: 14, opacity: v, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [46 * direction, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}
