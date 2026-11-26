import type { AuthMethod } from '@instincts/spree-sdk';
import { space } from '@instincts/spree-ui';
import { useMutation } from '@tanstack/react-query';
import * as Device from 'expo-device';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { PairingScanner } from '@/components/pairing-scanner';
import { Button, Screen, TextField } from '@/components/primitives';
import { Text } from '@/components/text';
import { useSession } from '@/session/session';
import { useTRPC } from '@/trpc/trpc';

type Mode = AuthMethod;

const SWITCH_LABEL: Record<Mode, string> = {
  pairing: 'Pair with a code from Spree admin',
  password: 'Sign in with email instead',
  apiKey: 'Use a secret API key instead',
  spreeToken: 'Use an API key instead',
  oauthClient: 'Use an OAuth application instead',
};

const HELP: Partial<Record<Mode, string>> = {
  pairing:
    'In Spree admin, open Mobile app devices and tap Pair a device. Scan the QR code, or type the 12-character code.',
  spreeToken:
    'In Spree admin, open Users, edit your account and generate an API key. Spree 4.2 and 4.3 don’t allow admin sign-in with a password from apps.',
  oauthClient: 'In Spree admin, open Configuration → OAuth applications and create one with the admin scope.',
  apiKey: 'In Spree admin, open Settings → Developer → API keys and create a secret key.',
};

export default function SignInScreen() {
  const { url, methods } = useLocalSearchParams<{ url: string; methods: string }>();
  const available = (methods ?? 'password').split(',').filter((m): m is Mode => m in SWITCH_LABEL);
  const trpc = useTRPC();
  const session = useSession();
  const [mode, setMode] = useState<Mode>(available[0] ?? 'password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');
  const [clientId, setClientId] = useState('');

  const [scanning, setScanning] = useState(false);
  type SignedIn = {
    probe: Parameters<typeof session.connect>[0];
    credential: Parameters<typeof session.connect>[1];
  };
  const onSignedIn = ({ probe, credential }: SignedIn) => session.connect(probe, credential);
  const signIn = useMutation(trpc.store.signIn.mutationOptions({ onSuccess: onSignedIn }));
  const pair = useMutation(trpc.store.pair.mutationOptions({ onSuccess: onSignedIn }));
  const deviceName = Device.deviceName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android phone');
  const pairWith = (code: string, storeUrl = url) =>
    pair.mutate({ url: storeUrl, code, deviceName, platform: Platform.OS });

  const submit = () => {
    if (mode === 'pairing') pairWith(secret);
    else if (mode === 'password') signIn.mutate({ method: 'password', url, email, password });
    else if (mode === 'apiKey') signIn.mutate({ method: 'apiKey', url, apiKey: secret });
    else if (mode === 'spreeToken') signIn.mutate({ method: 'spreeToken', url, token: secret });
    else signIn.mutate({ method: 'oauthClient', url, clientId, clientSecret: secret });
  };

  const help = HELP[mode];
  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: space[4], gap: space[4] }}
          keyboardShouldPersistTaps="handled"
        >
          <Text tone="muted">{url.replace(/^https?:\/\//, '')}</Text>
          {mode === 'pairing' ? (
            <>
              <Button title="Scan pairing code" onPress={() => setScanning(true)} loading={pair.isPending} />
              <TextField
                label="Or type the code"
                value={secret}
                onChangeText={setSecret}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="ABCD-EFGH-JKMN"
                onSubmitEditing={submit}
              />
              <PairingScanner
                visible={scanning}
                onClose={() => setScanning(false)}
                onScanned={(p) => {
                  setScanning(false);
                  pairWith(p.code, p.url);
                }}
              />
            </>
          ) : mode === 'password' ? (
            <>
              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="username"
              />
              <TextField
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                onSubmitEditing={submit}
              />
            </>
          ) : mode === 'oauthClient' ? (
            <>
              <TextField
                label="OAuth application ID"
                value={clientId}
                onChangeText={setClientId}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextField
                label="OAuth application secret"
                value={secret}
                onChangeText={setSecret}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
            </>
          ) : (
            <TextField
              label={mode === 'apiKey' ? 'Secret API key' : 'Admin API key'}
              value={secret}
              onChangeText={setSecret}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder={mode === 'apiKey' ? 'sk_…' : undefined}
              onSubmitEditing={submit}
            />
          )}
          {help ? (
            <Text size="footnote" tone="muted">
              {help}
            </Text>
          ) : null}
          {(signIn.error ?? pair.error) ? (
            <Text tone="critical">{(signIn.error ?? pair.error)?.message}</Text>
          ) : null}
          <Button
            title={mode === 'pairing' ? 'Pair' : 'Sign in'}
            variant={mode === 'pairing' ? 'plain' : 'primary'}
            loading={signIn.isPending || pair.isPending}
            onPress={submit}
          />
          {available
            .filter((m) => m !== mode)
            .map((m) => (
              <Pressable
                key={m}
                accessibilityRole="button"
                onPress={() => setMode(m)}
                style={{ alignSelf: 'center', padding: space[2] }}
              >
                <Text tone="accent" font="uiMedium">
                  {SWITCH_LABEL[m]}
                </Text>
              </Pressable>
            ))}
          <View style={{ height: space[8] }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
