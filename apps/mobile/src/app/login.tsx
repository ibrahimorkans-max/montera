import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND, LogoLockup } from '@/components/logo';
import { Btn, Card, Chips, FadeIn, Field, Notice, Screen } from '@/components/ui';
import { useAuth } from '@/lib/app-context';

export default function Login() {
  const { signIn, register } = useAuth();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [businessName, setBusinessName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!email.trim() || !password) return setError('Enter your email and password.');
    if (mode === 'up' && (!businessName.trim() || !name.trim())) return setError('Enter your business name and your name.');
    setBusy(true);
    try {
      if (mode === 'in') await signIn(email.trim(), password);
      else await register({ businessName: businessName.trim(), name: name.trim(), email: email.trim(), password });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <FadeIn>
        <LinearGradient colors={BRAND.splash} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ marginTop: insets.top + 8, borderRadius: 24, padding: 22, paddingVertical: 30, gap: 16, overflow: 'hidden' }}>
          <View pointerEvents="none" style={{ position: 'absolute', right: -50, top: -60, width: 190, height: 190, borderRadius: 95, backgroundColor: 'rgba(20,99,243,0.25)' }} />
          <LogoLockup size={50} onDark />
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 15, lineHeight: 21 }}>Smarter invoicing. Stronger finances. Create invoices, track payments and manage your business money from your phone.</Text>
        </LinearGradient>
      </FadeIn>
      <Chips
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError('');
        }}
        options={[
          { value: 'in', label: 'Sign in' },
          { value: 'up', label: 'Create account' },
        ]}
      />
      <Card style={{ gap: 12 }}>
        {mode === 'up' && (
          <>
            <Field label="Business name" value={businessName} onChangeText={setBusinessName} autoCapitalize="words" />
            <Field label="Your name" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" />
          </>
        )}
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoCorrect={false} />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          hint={mode === 'up' ? 'At least 8 characters' : undefined}
          onSubmitEditing={submit}
        />
        {!!error && <Notice kind="danger">{error}</Notice>}
        <Btn title={mode === 'in' ? 'Sign in' : 'Create account'} onPress={submit} loading={busy} />
      </Card>
    </Screen>
  );
}
