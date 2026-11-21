import { NavStylePicker } from '@/components/nav-style-picker';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { useSyncState } from '@/components/sync-ui';
import { Switch, View } from 'react-native';
import { Badge, Btn, Card, Chips, Field, KV, Loader, Notice, Row, Screen, Section, Sheet, Txt, confirm, fd } from '@/components/ui';
import { API_URL, api, useApi } from '@/lib/api';
import { downloadFromApi } from '@/lib/download';
import { useAuth, useTheme, useThemeMode, useToast, type ThemeMode } from '@/lib/app-context';
import { PIN_LENGTH, PinPad, useLock } from '@/lib/lock';

interface Session {
  id: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

type PinFlow = null | { stage: 'current' | 'new' | 'confirm' | 'password'; purpose: 'set' | 'off'; first?: string };

export default function Settings() {
  const t = useTheme();
  const { user, signOut } = useAuth();
  const { mode, setMode } = useThemeMode();
  const toast = useToast();
  const lock = useLock();
  const sessions = useApi<Session[]>('/auth/sessions');
  const [flow, setFlow] = useState<PinFlow>(null);
  const [pinError, setPinError] = useState(0);
  const [pinMessage, setPinMessage] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<null | { password: string; confirm: string; error: string }>(null);
  const [exporting, setExporting] = useState(false);
  const owner = user?.role === 'owner';

  async function exportAll() {
    setExporting(true);
    try {
      await downloadFromApi('/account/export.xlsx', `monetra-all-data-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast('Export ready');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    if (!del) return;
    if (del.confirm.trim() !== 'DELETE') return setDel({ ...del, error: 'Type DELETE in capital letters to confirm.' });
    if (!del.password) return setDel({ ...del, error: 'Enter your password.' });
    setBusy(true);
    try {
      await api('/account/delete', { body: { password: del.password, confirm: 'DELETE' } });
      setDel(null);
      await signOut(true);
    } catch (e: any) {
      setDel((d) => (d ? { ...d, error: e.message } : d));
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    setFlow(null);
    setPinMessage('');
    setPassword('');
  };
  const wrong = (message: string) => {
    setPinMessage(message);
    setPinError((n) => n + 1);
  };

  async function onPin(pin: string) {
    if (!flow) return;
    if (flow.stage === 'current') {
      if (!(await lock.checkPin(pin))) return wrong('That is not your current PIN.');
      setPinMessage('');
      if (flow.purpose === 'off') {
        await lock.disable();
        close();
        return toast('App lock turned off');
      }
      return setFlow({ stage: 'new', purpose: 'set' });
    }
    if (flow.stage === 'new') {
      setPinMessage('');
      return setFlow({ stage: 'confirm', purpose: 'set', first: pin });
    }
    if (pin !== flow.first) {
      wrong('The two PINs did not match. Start again.');
      return setFlow({ stage: 'new', purpose: 'set' });
    }
    await lock.setPin(pin);
    close();
    toast('PIN saved. The app now locks when you leave it.');
  }

  /** Changing or removing the lock without the PIN requires the account password. */
  async function confirmPassword() {
    if (!flow || !password) return;
    setBusy(true);
    try {
      await api('/auth/verify-password', { body: { password } });
      setPassword('');
      setPinMessage('');
      if (flow.purpose === 'off') {
        await lock.disable();
        close();
        toast('App lock turned off');
      } else setFlow({ stage: 'new', purpose: 'set' });
    } catch (e: any) {
      setPinMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(s: Session) {
    if (!(await confirm('Sign out this device?', `${s.deviceName || 'This device'} will need to sign in again.`, 'Sign out device'))) return;
    try {
      await api(`/auth/sessions/${s.id}`, { method: 'DELETE' });
      toast('Device signed out');
      sessions.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  const title = flow?.stage === 'current' ? 'Enter current PIN' : flow?.stage === 'new' ? `Choose a ${PIN_LENGTH}-digit PIN` : flow?.stage === 'confirm' ? 'Enter the PIN again' : 'Confirm with password';

  return (
    <Screen>
      <Section title="Security">
        <Card>
          <Row gap={12}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: lock.enabled ? t.successSoft : t.neutralSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={lock.enabled ? 'lock-closed' : 'lock-open-outline'} size={22} color={lock.enabled ? t.success : t.sub} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: '700' }}>App lock</Txt>
              <Txt v="small">{lock.enabled ? 'On · asks for your PIN when the app opens or after a minute away' : 'Off · anyone holding this phone can open your accounts'}</Txt>
            </View>
          </Row>
          {lock.enabled ? (
            <>
              <Row style={{ justifyContent: 'space-between', minHeight: 48 }}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '600' }}>Fingerprint / Face unlock</Txt>
                  <Txt v="small">{lock.biometricAvailable ? 'Unlock without typing the PIN' : 'Not available: no fingerprint or face is set up on this device'}</Txt>
                </View>
                <Switch accessibilityLabel="Fingerprint or face unlock" value={lock.biometric} disabled={!lock.biometricAvailable} onValueChange={(v) => lock.setBiometric(v)} />
              </Row>
              <Row gap={10}>
                <Btn small style={{ flex: 1 }} kind="secondary" icon="keypad-outline" title="Change PIN" onPress={() => setFlow({ stage: 'current', purpose: 'set' })} />
                <Btn small style={{ flex: 1 }} kind="secondary" icon="lock-closed-outline" title="Lock now" onPress={lock.lockNow} />
              </Row>
              <Btn small kind="danger" icon="lock-open-outline" title="Turn off app lock" onPress={() => setFlow({ stage: 'current', purpose: 'off' })} />
            </>
          ) : (
            <Btn icon="keypad-outline" title="Set up PIN lock" onPress={() => setFlow({ stage: 'new', purpose: 'set' })} />
          )}
          <Txt v="small">Three ways to unlock: your PIN, your fingerprint or face, or your account password if you forget the PIN.</Txt>
        </Card>
      </Section>

      <Section title="Offline & sync">
        <MenuRowLike onPress={() => router.push('/sync')} />
      </Section>

      <Section title="Appearance">
        <Chips<ThemeMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'system', label: 'Match phone' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        <Txt v="label">Bottom bar style</Txt>
        <NavStylePicker />
      </Section>

      <Section title="Account">
        <Card>
          <KV k="Name" v={user?.name ?? ''} />
          <KV k="Email" v={user?.email ?? ''} />
          <KV k="Role" v={user?.role ?? ''} />
          <KV k="Account" v={user?.tenantName ?? ''} />
        </Card>
      </Section>

      <Section title="Signed-in devices">
        <Loader loading={sessions.loading && !sessions.data} error={sessions.data ? '' : sessions.error} onRetry={sessions.reload}>
          {(sessions.data ?? []).map((s) => (
            <Card key={s.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '600' }}>{s.deviceName || 'Unknown device'}</Txt>
                  <Txt v="small">Last active {fd(s.lastUsedAt)}</Txt>
                </View>
                {s.current ? <Badge status="active" label="This device" /> : <Btn small kind="danger" title="Sign out" onPress={() => revoke(s)} />}
              </Row>
            </Card>
          ))}
        </Loader>
      </Section>

      <Txt v="small">Server: {API_URL}</Txt>
      <Btn kind="danger" icon="log-out-outline" title="Sign out" onPress={() => signOut()} />

      {owner && (
        <Section title="Your data">
          <Card>
            <Txt style={{ fontWeight: '700' }}>Export all data</Txt>
            <Txt v="small">One Excel file with every business, client, invoice, payment, installment, expense and account.</Txt>
            <Btn kind="secondary" icon="download-outline" title="Export all data" onPress={exportAll} loading={exporting} />
          </Card>
          <Card>
            <Txt style={{ fontWeight: '700' }} color={t.danger}>Delete account</Txt>
            <Txt v="small">Permanently deletes {user?.tenantName || 'this account'} with all its businesses, records and team members. This cannot be undone.</Txt>
            <Btn kind="danger" icon="trash-outline" title="Delete account" onPress={() => setDel({ password: '', confirm: '', error: '' })} />
          </Card>
        </Section>
      )}

      <Sheet visible={!!del} title="Delete account" onClose={() => setDel(null)}>
        <Notice kind="danger">Everything in {user?.tenantName || 'this account'} is deleted for good: businesses, clients, invoices, payments, finance and every team member's login. Export your data first if you may need it.</Notice>
        <Btn kind="secondary" icon="download-outline" title="Export all data first" onPress={exportAll} loading={exporting} />
        {!!del?.error && <Notice kind="danger">{del.error}</Notice>}
        <Field label="Type DELETE to confirm" value={del?.confirm ?? ''} onChangeText={(v) => setDel((d) => (d ? { ...d, confirm: v, error: '' } : d))} autoCapitalize="characters" />
        <Field label="Your password" value={del?.password ?? ''} onChangeText={(v) => setDel((d) => (d ? { ...d, password: v, error: '' } : d))} secureTextEntry />
        <Btn kind="danger" icon="trash-outline" title="Delete account permanently" onPress={deleteAccount} loading={busy} />
      </Sheet>

      <Sheet visible={!!flow} title={title} onClose={close}>
        {!!pinMessage && <Notice kind="danger">{pinMessage}</Notice>}
        {flow?.stage === 'password' ? (
          <>
            <Field label="Account password" value={password} onChangeText={setPassword} secureTextEntry autoFocus onSubmitEditing={confirmPassword} />
            <Btn title="Continue" onPress={confirmPassword} loading={busy} />
          </>
        ) : (
          <View style={{ paddingVertical: 12, alignItems: 'center', gap: 16 }}>
            <PinPad key={flow?.stage} onComplete={onPin} error={pinError} />
            {flow?.stage === 'current' && (
              <Txt v="label" color={t.primary} onPress={() => (setPinMessage(''), setFlow({ stage: 'password', purpose: flow.purpose }))}>
                Forgot PIN? Use account password
              </Txt>
            )}
          </View>
        )}
      </Sheet>
    </Screen>
  );
}

function MenuRowLike({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  const s = useSyncState();
  return (
    <Card onPress={onPress} label="Sync and offline status">
      <Row gap={12}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: s.online ? t.successSoft : t.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={s.online ? 'cloud-done-outline' : 'cloud-offline-outline'} size={22} color={s.online ? t.success : t.warn} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt style={{ fontWeight: '700' }}>{s.online ? 'Online' : 'Offline'} · works without internet</Txt>
          <Txt v="small">{s.pending ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to sync` : s.failed ? `${s.failed} change${s.failed === 1 ? '' : 's'} need attention` : 'All changes synced'}</Txt>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.sub} />
      </Row>
    </Card>
  );
}
