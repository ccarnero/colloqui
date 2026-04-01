/**
 * Preload: stub @yoizen/database so unit tests do not load the full package
 * barrel (kubernetes/redis/nats implementations and optional peers).
 */
import { mock } from "bun:test";

const NATS_CONNECTION = "NATS_CONNECTION";
const REDIS_CLIENT = "REDIS_CLIENT";

mock.module("@yoizen/database", () => ({
  NATS_CONNECTION,
  REDIS_CLIENT,
  createNatsConnectionProvider: () => ({
    provide: NATS_CONNECTION,
    useFactory: async (): Promise<unknown> => ({}),
  }),
  createRedisProvider: () => ({
    provide: REDIS_CLIENT,
    useFactory: (): unknown => ({}),
  }),
  ensureStream: mock(async () => {}),
  ensureConsumer: mock(async () => {}),
}));
