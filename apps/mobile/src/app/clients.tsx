import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { ClientRow, useDebounced } from '@/components/rows';
import { Btn, Empty, Loading, SearchBar, styles } from '@/components/ui';
import { qs, usePaged } from '@/lib/api';
import { useAuth, useTheme } from '@/lib/app-context';
import type { Client } from '@/lib/shared';

export default function Clients() {
  const t = useTheme();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const list = usePaged<Client>(`/clients${qs({ q: query })}`);
  const add = () => router.push('/client/edit');

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: 'Clients' }} />
      <View style={[styles.content, { paddingBottom: 10 }]}>
        <SearchBar value={q} onChange={setQ} placeholder="Search name, phone or city" />
        {can('clients.manage') && <Btn icon="person-add-outline" title="Add client" onPress={add} />}
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <ClientRow client={item} />}
        contentContainerStyle={[styles.content, { paddingTop: 4, gap: 10 }]}
        onEndReached={list.more}
        onEndReachedThreshold={0.4}
        onRefresh={list.reload}
        refreshing={false}
        ListFooterComponent={list.loading || (!list.done && list.items.length > 0) ? <Loading /> : undefined}
        ListEmptyComponent={
          list.loading ? undefined : list.error ? (
            <Empty icon="cloud-offline-outline" title="Could not load clients" hint={list.error} action={<Btn small kind="secondary" title="Try again" onPress={list.reload} />} />
          ) : (
            <Empty
              icon="people-outline"
              title={q ? 'No clients match' : 'No clients yet'}
              hint={q ? 'Try a different search.' : 'Add the businesses and people you invoice.'}
              action={can('clients.manage') && !q ? <Btn small icon="add" title="Add Client" onPress={add} /> : undefined}
            />
          )
        }
      />
    </View>
  );
}
