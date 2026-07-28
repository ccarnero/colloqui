// Shared `"ioredis"` module double, mirroring `fake-nats-jetstream.ts` /
// `fake-traced-fetch.ts`'s rationale and fix shape.
//
// WHY THIS EXISTS (bun `mock.module` + module-singleton interaction):
// `activities/_shared/adapter-client.provider.ts`'s `getRedis()` constructs
// exactly ONE `new Redis(...)` for the whole process (`let redis:
// RedisClient | null = null;`) and caches it forever — the FIRST spec file
// (across the whole `bun test` run) that triggers `getAdapterClient()` /
// `getRedis()` "wins" whichever `"ioredis"` double was registered via
// `mock.module("ioredis", ...)` at that moment. A later spec file's own
// private `mock.module("ioredis", anotherFactory)` does NOT retroactively
// rebind the already-constructed client, silently starving that spec's own
// Redis-shaped assertions (cache hits, breaker denials) — confirmed
// empirically: `endpoint-call-core.spec.ts`'s stateful cache-hit and
// breaker-open tests broke once `service-call.activity.spec.ts` (a third
// spec file exercising the same `getAdapterClient()` singleton) joined the
// suite (`manual-loops/connectors/connection-call-inspector.md` T01).
//
// FIX: route the SINGLE constructed `Redis` instance's methods through a
// mutable indirection cell, resolved at CALL TIME (via a `Proxy`) instead of
// at construction time, and have every consuming spec file reassign it via
// `setActiveRedisInstance` in its own `beforeEach` so calls always land on
// THAT file's currently-active fake.
import { mock } from "bun:test";

export interface FakeRedisInstance {
  get: (key: string) => Promise<string | null>;
  /**
   * ioredis's variadic `SET key value [EX ttl] [NX|XX] ...` signature.
   * Optional — only `invocation-store.spec.ts` (via `invocation-store.ts`'s
   * `getClient().set(key, value, "EX", ttlSeconds)`) needs it; the
   * adapter-cache consumers (`endpoint-call-core.spec.ts`,
   * `endpoint-call.activity.spec.ts`, `service-call.activity.spec.ts`) use
   * `setex` instead.
   */
  set?: (...args: unknown[]) => Promise<unknown>;
  setex: (key: string, ttl: number, value: string) => Promise<unknown>;
  del: (...keys: string[]) => Promise<unknown>;
  script: (...args: unknown[]) => Promise<unknown>;
  evalsha: (...args: unknown[]) => Promise<unknown>;
  eval: (...args: unknown[]) => Promise<unknown>;
  options: Record<string, unknown>;
  status: string;
}

function defaultRedisInstance(): FakeRedisInstance {
  return {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve("OK"),
    setex: () => Promise.resolve("OK"),
    del: () => Promise.resolve(0),
    script: () => Promise.resolve("sha-fake"),
    evalsha: () => Promise.resolve(["allow", "closed", ""]),
    eval: () => Promise.resolve(["allow", "closed", ""]),
    options: {},
    status: "ready",
  };
}

let activeRedisInstance: FakeRedisInstance = defaultRedisInstance();

/** Call in `beforeEach`/before importing the unit under test so calls land on YOUR fake. */
export function setActiveRedisInstance(instance: FakeRedisInstance): void {
  activeRedisInstance = instance;
}

mock.module("ioredis", () => ({
  default: class Redis {
    constructor() {
      // Every property lookup resolves against `activeRedisInstance` AT
      // ACCESS TIME, not at construction time — the underlying `Redis`
      // instance is constructed exactly once for the whole process.
      return new Proxy(
        {},
        {
          get(_target, prop: keyof FakeRedisInstance) {
            return activeRedisInstance[prop];
          },
        }
      );
    }
  },
}));
