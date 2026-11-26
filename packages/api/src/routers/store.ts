import {
  adminJwt,
  apiKeyAuth,
  createAdapter,
  createTransport,
  exchangePairingCode,
  oauthClientCredentials,
  probeStore,
  type SessionAuth,
  type StoredCredential,
  type StoreProbe,
  spreeTokenAuth,
  type TransportOptions,
} from '@spree-native/spree-sdk';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { publicProcedure, router, storeProcedure } from '../trpc';

const url = z.string().min(3);
const SignInInput = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('password'),
    url,
    email: z.string().trim().min(3),
    password: z.string().min(1),
  }),
  z.object({ method: z.literal('apiKey'), url, apiKey: z.string().trim().min(8) }),
  z.object({ method: z.literal('spreeToken'), url, token: z.string().trim().min(8) }),
  z.object({
    method: z.literal('oauthClient'),
    url,
    clientId: z.string().trim().min(1),
    clientSecret: z.string().min(1),
  }),
]);

const WRONG_METHOD: Record<string, string> = {
  'api-v1':
    'This store runs Spree 4.2 or 4.3. Sign in with your admin API key (Spree admin → Users → your account → API key).',
  'platform-v2':
    'This store uses the Platform API. Sign in with an OAuth application ID and secret that has the admin scope.',
  'admin-v3':
    'This store runs Spree 5.4 or later. Sign in with your email and password, or a secret API key.',
};

export const storeRouter = router({
  /** Look at an address before sign-in: is it Spree, which API, which sign-in methods. */
  probe: publicProcedure
    .input(z.object({ url: z.string().min(3) }))
    .mutation(({ ctx, input }) =>
      probeStore(ctx.fetch ? { baseUrl: input.url, fetch: ctx.fetch } : { baseUrl: input.url }),
    ),

  /**
   * Sign in and return what the app should keep in the keychain. The router holds no state;
   * the app builds the next session from the returned credential.
   */
  signIn: publicProcedure
    .input(SignInInput)
    .mutation(async ({ ctx, input }): Promise<{ probe: StoreProbe; credential: StoredCredential }> => {
      const probe = await probeStore(
        ctx.fetch ? { baseUrl: input.url, fetch: ctx.fetch } : { baseUrl: input.url },
      );
      if (!probe.authMethods.includes(input.method)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: WRONG_METHOD[probe.preferredApi] ?? 'Use a different sign-in method.',
        });
      }
      const options: TransportOptions = { baseUrl: probe.baseUrl };
      if (ctx.fetch) options.fetch = ctx.fetch;
      const transport = createTransport(options);

      let auth: SessionAuth;
      switch (input.method) {
        case 'password':
          auth = await adminJwt.signIn(transport, input);
          break;
        case 'apiKey':
          auth = apiKeyAuth(input.apiKey);
          break;
        case 'spreeToken':
          auth = spreeTokenAuth(input.token);
          break;
        case 'oauthClient':
          auth = await oauthClientCredentials.signIn(transport, input);
          break;
      }
      // Keys aren't checked at sign-in time; one cheap authenticated read proves them.
      if (input.method === 'apiKey' || input.method === 'spreeToken') {
        await createAdapter(probe.preferredApi, transport.withAuth(auth)).orders.list({
          filter: 'all',
          perPage: 1,
        });
      }
      return { probe, credential: auth.serialize() };
    }),

  /**
   * Sign in with a one-time code from Spree admin (companion gem). The device token works as an
   * API v1 key, so the session uses the api-v1 adapter even on stores that also have Platform v2.
   */
  pair: publicProcedure
    .input(
      z.object({
        url,
        code: z.string().trim().min(6),
        deviceName: z.string().trim().min(1).max(80),
        platform: z.string().max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ probe: StoreProbe; credential: StoredCredential }> => {
      const probe = await probeStore(
        ctx.fetch ? { baseUrl: input.url, fetch: ctx.fetch } : { baseUrl: input.url },
      );
      if (!probe.authMethods.includes('pairing') || !probe.apiFamilies.includes('api-v1')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            "This store can't pair devices. Ask its developer to install the spree_admin_native gem, or sign in another way.",
        });
      }
      const options: TransportOptions = { baseUrl: probe.baseUrl };
      if (ctx.fetch) options.fetch = ctx.fetch;
      const pairing: Parameters<typeof exchangePairingCode>[1] = {
        code: input.code,
        deviceName: input.deviceName,
      };
      if (input.platform) pairing.platform = input.platform;
      const result = await exchangePairingCode(createTransport(options), pairing);
      return {
        probe: { ...probe, preferredApi: 'api-v1' },
        credential: spreeTokenAuth(result.token).serialize(),
      };
    }),

  current: storeProcedure.query(({ ctx }) => ctx.session.probe),
});
