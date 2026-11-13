import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { View } from 'react-native';
import { useSyncState } from '@/components/sync-ui';
import { Btn, Card, Empty, KV, Notice, Row, Screen, Section, Txt, confirm, fd } from '@/components/ui';
import { useTheme } from '@/lib/app-context';
import { engine } from '@/lib/engine';

const time = (iso: string | null) => (iso ? `${fd(iso.slice(0, 10))}, ${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Never');

export default function SyncCenter() {
  const t = useTheme();
  const s = useSyncState();
  const [, setTick] = useState(0);
  const queue = engine.queue();
  const failed = queue.filter((q) => q.status === 'failed');
  const pending = queue.filter((q) => q.status === 'pending');

  return (
    <Screen onRefresh={() => engine.sync().then(() => setTick((n) => n + 1))} refreshing={s.syncing}>
      <Card>
        <Row gap={12}>
          <View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: s.online ? t.successSoft : t.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={s.online ? 'cloud-done-outline' : 'cloud-offline-outline'} size={24} color={s.online ? t.success : t.warn} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt v="h">{s.online ? (s.syncing ? 'Syncing…' : 'Online') : 'Offline'}</Txt>
            <Txt v="small">{s.online ? 'Changes are sent to the server as you make them.' : 'Everything still works. Changes are kept on this phone and sent when you are back online.'}</Txt>
          </View>
        </Row>
        <KV k="Last synced" v={time(s.lastSync)} />
        <KV k="Waiting to sync" v={String(s.pending)} />
        <KV k="Refused by the server" v={String(s.failed)} color={s.failed ? t.danger : undefined} />
        {!!s.lastError && <Notice kind="danger">{s.lastError}</Notice>}
        <Btn icon="sync-outline" title="Sync now" onPress={() => engine.sync().then(() => setTick((n) => n + 1))} loading={s.syncing} />
      </Card>

      {failed.length > 0 && (
        <Section title="Needs your attention">
          <Txt v="small">The server could not apply these, usually because someone changed the same record from another device. Discard to keep the server's version, or retry.</Txt>
          {failed.map((q) => (
            <Card key={q.id} style={{ borderColor: t.danger }}>
              <Txt style={{ fontWeight: '700' }}>{q.label}</Txt>
              <Txt v="small">Made {time(q.createdAt)}</Txt>
              <Notice kind="danger">{q.error}</Notice>
              <Row gap={10}>
                <Btn small style={{ flex: 1 }} kind="secondary" icon="refresh-outline" title="Retry" onPress={() => (engine.retry(q.id), setTick((n) => n + 1))} />
                <Btn
                  small
                  style={{ flex: 1 }}
                  kind="danger"
                  icon="trash-outline"
                  title="Discard"
                  onPress={async () => {
                    if (await confirm('Discard this change?', 'It was never saved on the server. This phone will show the server\'s version instead.', 'Discard')) {
                      engine.discard(q.id);
                      setTick((n) => n + 1);
                    }
                  }}
                />
              </Row>
            </Card>
          ))}
        </Section>
      )}

      <Section title="Waiting to sync">
        {pending.length === 0 ? (
          <Empty icon="checkmark-done-outline" title="Everything is synced" />
        ) : (
          pending.map((q) => (
            <Card key={q.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt style={{ fontWeight: '600' }}>{q.label}</Txt>
                <Txt v="small">{time(q.createdAt)}</Txt>
              </Row>
            </Card>
          ))
        )}
      </Section>
      <Txt v="small">
        Invoice and receipt numbers created offline are provisional: the server confirms or replaces them when the change syncs. Payments recorded offline become confirmed receipts only after the server accepts them. Excel export, team management and signing in need a connection.
      </Txt>
    </Screen>
  );
}
