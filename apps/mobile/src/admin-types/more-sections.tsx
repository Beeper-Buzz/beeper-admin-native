import { space } from '@instincts/spree-ui';
import { router } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { LinkCard } from '@/components/link-card';
import { Button } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { TypeIcon } from './icons';
import { groupTypes, useAdminTypes } from './use-admin-types';

/**
 * The store's own admin types on the More screen: one section per group, one row per type.
 * Nothing at all without `admin.resources`; a failed manifest is a quiet line, never a broken screen.
 */
export function AdminTypeSections() {
  const types = useAdminTypes();
  if (!types.enabled) return null;
  if (types.isPending)
    return (
      <ActivityIndicator
        accessibilityLabel="Loading this store's admin types"
        style={{ alignSelf: 'flex-start' }}
      />
    );
  if (types.error)
    return (
      <View style={{ gap: space[1], alignItems: 'flex-start' }}>
        <Text size="footnote" tone="muted">
          Couldn't load this store's own admin types. {types.error.message}
        </Text>
        <Button size="small" variant="plain" title="Try again" onPress={() => void types.refetch()} />
      </View>
    );
  return (
    <>
      {groupTypes(types.types ?? []).map(({ group, types: list }) => (
        <View key={group} style={{ gap: space[2] }}>
          <Label accessibilityRole="header">{group}</Label>
          <LinkCard
            items={list.map((t) => ({
              key: t.key,
              title: t.label,
              leading: <TypeIcon name={t.icon} />,
              onPress: () => router.push({ pathname: '/more/admin/[key]', params: { key: t.key } }),
            }))}
          />
        </View>
      ))}
    </>
  );
}
