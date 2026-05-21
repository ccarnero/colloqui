import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import Redis from "ioredis";
import { createRedisClient, type RedisLike } from "../../src/redis-provider";

/**
 * Unit tests for `createRedisClient`. We do NOT open a real TCP
 * connection (`lazyConnect: true` keeps construction inert) — these
 * checks are purely on the runtime constructor branch chosen from
 * env vars, which is the contract the rest of the platform depends
 * on when wiring `REDIS_CLUSTER_MODE`.
 */
describe("createRedisClient", () => {
  const ENV_KEYS = ["REDIS_HOST", "REDIS_PORT", "REDIS_CLUSTER_MODE"] as const;
  const snapshot = new Map<(typeof ENV_KEYS)[number], string | undefined>();
  let openClients: RedisLike[] = [];

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      snapshot.set(k, process.env[k]);
      delete process.env[k];
    }
    openClients = [];
  });

  afterEach(async () => {
    for (const c of openClients) {
      try {
        await c.quit();
      } catch {
        c.disconnect();
      }
    }
    openClients = [];
    for (const k of ENV_KEYS) {
      const v = snapshot.get(k);
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns a standalone Redis client when REDIS_CLUSTER_MODE is unset", () => {
    process.env.REDIS_HOST = "127.0.0.1";
    process.env.REDIS_PORT = "6380";
    const client = createRedisClient();
    openClients.push(client);
    expect(client).toBeInstanceOf(Redis);
    expect(client).not.toBeInstanceOf(Redis.Cluster);
    expect(client.options.host).toBe("127.0.0.1");
    expect(client.options.port).toBe(6380);
    expect(client.options.lazyConnect).toBe(true);
    expect(client.options.enableReadyCheck).toBe(true);
  });

  it("returns a standalone Redis client when REDIS_CLUSTER_MODE is not exactly 'true'", () => {
    process.env.REDIS_CLUSTER_MODE = "1";
    const client = createRedisClient();
    openClients.push(client);
    expect(client).toBeInstanceOf(Redis);
    expect(client).not.toBeInstanceOf(Redis.Cluster);
  });

  it("returns a Cluster client when REDIS_CLUSTER_MODE === 'true'", () => {
    process.env.REDIS_CLUSTER_MODE = "true";
    process.env.REDIS_HOST = "redis-seed";
    process.env.REDIS_PORT = "6379";
    const client = createRedisClient();
    openClients.push(client);
    expect(client).toBeInstanceOf(Redis.Cluster);
    const cluster = client as InstanceType<typeof Redis.Cluster>;
    expect(cluster.options.enableReadyCheck).toBe(true);
    expect(cluster.options.lazyConnect).toBe(true);
    expect(cluster.options.scaleReads).toBe("slave");
    expect(cluster.options.slotsRefreshInterval).toBe(5000);
    expect(cluster.options.slotsRefreshTimeout).toBe(2000);
  });

  it("uses defaultHost / defaultPort options when env vars are unset", () => {
    const client = createRedisClient({
      defaultHost: "fallback.host",
      defaultPort: 16379,
    });
    openClients.push(client);
    expect(client).toBeInstanceOf(Redis);
    expect(client.options.host).toBe("fallback.host");
    expect(client.options.port).toBe(16379);
  });

  it("propagates maxRetriesPerRequest into redisOptions in cluster mode", () => {
    process.env.REDIS_CLUSTER_MODE = "true";
    const client = createRedisClient({ maxRetriesPerRequest: 1 });
    openClients.push(client);
    expect(client).toBeInstanceOf(Redis.Cluster);
    const cluster = client as InstanceType<typeof Redis.Cluster>;
    expect(cluster.options.redisOptions?.maxRetriesPerRequest).toBe(1);
  });

  it("propagates commandTimeout to the standalone client when provided", () => {
    const client = createRedisClient({ commandTimeout: 1000 });
    openClients.push(client);
    expect(client).toBeInstanceOf(Redis);
    expect(
      (client as InstanceType<typeof Redis>).options.commandTimeout,
    ).toBe(1000);
  });

  it("propagates commandTimeout into redisOptions in cluster mode", () => {
    process.env.REDIS_CLUSTER_MODE = "true";
    const client = createRedisClient({ commandTimeout: 1000 });
    openClients.push(client);
    expect(client).toBeInstanceOf(Redis.Cluster);
    const cluster = client as InstanceType<typeof Redis.Cluster>;
    expect(cluster.options.redisOptions?.commandTimeout).toBe(1000);
  });

  it("omits commandTimeout from options when not provided (backwards compat)", () => {
    const client = createRedisClient();
    openClients.push(client);
    expect(client).toBeInstanceOf(Redis);
    expect(
      (client as InstanceType<typeof Redis>).options.commandTimeout,
    ).toBeUndefined();
  });
});
