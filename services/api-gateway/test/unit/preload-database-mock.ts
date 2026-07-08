/**
 * Preload: stub @yoizen/database so unit tests do not load the full package
 * barrel (kubernetes/redis/nats implementations and optional peers).
 */
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? "test-jwt-secret-key-minimum-32-characters-long!!";

import { mock } from "bun:test";

const NATS_CONNECTION = "NATS_CONNECTION";
const REDIS_CLIENT = "REDIS_CLIENT";

const stubRedisProvider = {
  provide: REDIS_CLIENT,
  useFactory: (): unknown => ({}),
};

mock.module("@yoizen/database", () => ({
  NATS_CONNECTION,
  REDIS_CLIENT,
  createNatsConnectionProvider: () => ({
    provide: NATS_CONNECTION,
    useFactory: async (): Promise<unknown> => ({}),
  }),
  createRedisProvider: () => stubRedisProvider,
  redisProvider: stubRedisProvider,
  ensureStream: mock(async () => {}),
  ensureConsumer: mock(async () => {}),
  ensureTenantIngressStream: mock(async () => {}),
  /** Mirrors `packages/database/src/health-checks.ts` so gateway health tests stay accurate. */
  checkNats: (nc: { isClosed: () => boolean }): boolean => {
    try {
      return !nc.isClosed();
    } catch {
      return false;
    }
  },
  checkRedis: async (redis: {
    ping: () => Promise<string>;
  }): Promise<boolean> => {
    try {
      await redis.ping();
      return true;
    } catch {
      return false;
    }
  },
}));
