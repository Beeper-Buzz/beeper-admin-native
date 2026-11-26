import type { SpreeAdapter, StoreProbe } from '@instincts/spree-sdk';
import { type FetchLike, isSpreeError } from '@instincts/spree-sdk';
import { initTRPC, TRPCError } from '@trpc/server';
import { capabilityMessage } from './capabilityMessages';

/** A signed-in store. */
export interface Session {
  probe: StoreProbe;
  adapter: SpreeAdapter;
}

export interface Context {
  /** Injected so tests, the app and the relay can each supply their own fetch. */
  fetch?: FetchLike;
  session: Session | null;
}

const t = initTRPC.context<Context>().create({
  // The router runs inside the app (localLink, ADR 0002). React Native defines `window`, so tRPC's
  // server check fails on devices and create() throws at startup unless this is opted into. Jest
  // and Vitest pass that check by name, which is why only release builds crashed.
  allowOutsideOfServer: true,
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    return {
      ...shape,
      data: {
        ...shape.data,
        /** SpreeError kind (`auth`, `network`, `invalid`…) or `capability`, for the UI to branch on. */
        spreeKind: isSpreeError(cause)
          ? cause.kind
          : error.code === 'PRECONDITION_FAILED'
            ? 'capability'
            : null,
        fieldErrors: isSpreeError(cause) ? (cause.fieldErrors ?? null) : null,
      },
    };
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

const CODE_FOR_KIND = {
  auth: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT',
  invalid: 'BAD_REQUEST',
  rateLimited: 'TOO_MANY_REQUESTS',
  timeout: 'TIMEOUT',
  capability: 'PRECONDITION_FAILED',
  notSpree: 'BAD_REQUEST',
} as const;

/** Turn SpreeErrors into TRPCErrors with the original kept as `cause`. */
const spreeErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && isSpreeError(result.error.cause)) {
    const cause = result.error.cause;
    const code = (CODE_FOR_KIND as Record<string, TRPCError['code']>)[cause.kind] ?? 'INTERNAL_SERVER_ERROR';
    throw new TRPCError({ code, message: cause.message, cause });
  }
  return result;
});

export const publicProcedure = t.procedure.use(spreeErrors);

export const storeProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Connect a store first.' });
  return next({ ctx: { ...ctx, session: ctx.session } });
});

/** Gate a procedure on a store capability, with a plain-words reason when it's missing. */
export function requireCapability(capability: string) {
  return storeProcedure.use(({ ctx, next }) => {
    if (!ctx.session.probe.capabilities.includes(capability as never)) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: capabilityMessage(capability) });
    }
    return next();
  });
}
