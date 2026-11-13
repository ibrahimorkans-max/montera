import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, useTheme } from '@/lib/app-context';
import { engine, type SyncState } from '@/lib/engine';

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (fn) => engine.subscribe(fn),
    () => engine.state,
  );
}

/** True while a record was created or changed on this phone and the server has not confirmed it. */
export function usePending(id: string | null | undefined) {
  useSyncState();
  return engine.isPending(id);
}

/** Thin bar at the top: offline, changes waiting, or changes the server refused. Tap for details. */
export function SyncBanner({ embedded }: { embedded?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const s = useSyncState();
  if (!user) return null;
  let text = '';
  let tone = t.info;
  let bg = t.infoSoft;
  let icon: React.ComponentProps<typeof Ionicons>['name'] = 'cloud-upload-outline';
  if (s.failed > 0) {
    text = `${s.failed} change${s.failed === 1 ? '' : 's'} could not be saved on the server — tap to review`;
    tone = t.danger;
    bg = t.dangerSoft;
    icon = 'alert-circle';
  } else if (!s.online) {
    text = s.pending ? `Offline · ${s.pending} change${s.pending === 1 ? '' : 's'} saved on this phone, will sync` : 'Offline · working from this phone';
    tone = t.warn;
    bg = t.warnSoft;
    icon = 'cloud-offline-outline';
  } else if (s.pending > 0) {
    text = `Syncing ${s.pending} change${s.pending === 1 ? '' : 's'}…`;
  } else return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${text}. Open sync status`} onPress={() => router.push('/sync')} style={{ backgroundColor: bg, paddingTop: !embedded && insets.top ? insets.top : 6, paddingBottom: 6, paddingHorizontal: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 720, alignSelf: 'center', width: '100%' }}>
        {s.syncing && s.online ? <ActivityIndicator size="small" color={tone} /> : <Ionicons name={icon} size={16} color={tone} />}
        <Text style={{ color: tone, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>
          {text}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={tone} />
      </View>
    </Pressable>
  );
}

/** Small "Not synced" label for list rows. */
export function PendingTag({ id }: { id: string | null | undefined }) {
  const t = useTheme();
  const pending = usePending(id);
  if (!pending) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, backgroundColor: t.warnSoft, alignSelf: 'flex-start' }}>
      <Ionicons name="cloud-upload-outline" size={11} color={t.warn} />
      <Text style={{ color: t.warn, fontSize: 11, fontWeight: '700' }}>Not synced</Text>
    </View>
  );
}
