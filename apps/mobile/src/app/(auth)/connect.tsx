import type { StoreProbe } from '@instincts/spree-sdk';
import { space } from '@instincts/spree-ui';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CapabilityList } from '@/components/capability-list';
import { Badge, Button, Screen, TextField } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { distribution } from '@/distribution';
import { useTRPC } from '@/trpc/trpc';

const API_LABEL: Record<StoreProbe['preferredApi'], string> = {
  'api-v1': 'API v1 · Spree 4.2–4.3',
  'platform-v2': 'Platform API · Spree 4.4–5.x',
  'admin-v3': 'Admin API · Spree 5.4+',
};

export default function ConnectScreen() {
  const trpc = useTRPC();
  const [url, setUrl] = useState(distribution.defaultStoreUrl ?? '');
  const probe = useMutation(trpc.store.probe.mutationOptions());
  const result = probe.data;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={{ padding: space[4], gap: space[5], flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={{ gap: space[2], marginTop: space[8] }}>
              <Label>{distribution.name}</Label>
              <Text size="title1" font="display">
                Connect your store
              </Text>
              <Text tone="muted">
                Enter the address of your Spree admin. The app checks what your store supports before you sign
                in.
              </Text>
            </View>

            <TextField
              label="Store address"
              value={url}
              onChangeText={(v) => {
                setUrl(v);
                if (probe.data || probe.error) probe.reset();
              }}
              placeholder="admin.yourstore.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
              returnKeyType="go"
              onSubmitEditing={() => url && probe.mutate({ url })}
              error={probe.error?.message ?? null}
            />

            {result ? (
              <View style={{ gap: space[3] }}>
                <View style={{ gap: space[1] }}>
                  <Text size="title3" font="uiSemibold">
                    {result.storeName ?? result.baseUrl.replace(/^https?:\/\//, '')}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                    <Badge tone="positive" label={API_LABEL[result.preferredApi]} />
                    {result.gem ? <Badge tone="info" label={`Companion gem ${result.gem.version}`} /> : null}
                  </View>
                </View>
                <CapabilityList capabilities={result.capabilities} />
              </View>
            ) : null}

            <View style={{ marginTop: 'auto', gap: space[2] }}>
              {result ? (
                <Button
                  title="Continue"
                  onPress={() =>
                    router.push({
                      pathname: '/sign-in',
                      params: { url: result.baseUrl, methods: result.authMethods.join(',') },
                    })
                  }
                />
              ) : (
                <Button
                  title="Check store"
                  disabled={url.trim().length < 3}
                  loading={probe.isPending}
                  onPress={() => probe.mutate({ url })}
                />
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}
