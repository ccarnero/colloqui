import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { EventsService } from "../../src/modules/events/events.service";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
} from "../../src/providers/nats.provider";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";

const TENANT_ID = "test-tenant";

describe("EventsService", () => {
  let service: EventsService;
  let mockJs: { publish: ReturnType<typeof mock> };
  let mockNc: {
    subscribe: ReturnType<typeof mock>;
    isClosed: ReturnType<typeof mock>;
  };
  let mockRedis: {
    get: ReturnType<typeof mock>;
    pipeline: ReturnType<typeof mock>;
  };
  let mockPipeline: {
    setex: ReturnType<typeof mock>;
    exec: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    mockJs = { publish: mock(() => Promise.resolve({ seq: 1 })) };
    mockNc = {
      subscribe: mock(() => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ done: true, value: undefined }),
        }),
        unsubscribe: mock(),
      })),
      isClosed: mock(() => false),
    };
    mockPipeline = {
      setex: mock(function (this: unknown) {
        return this;
      }),
      exec: mock(() => Promise.resolve([])),
    };
    mockRedis = {
      get: mock(() => Promise.resolve(null)),
      pipeline: mock(() => mockPipeline),
    };

    const mockJsm = {
      streams: {
        info: mock(() => Promise.resolve({})),
        add: mock(() => Promise.resolve({})),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: JETSTREAM, useValue: mockJs },
        { provide: JETSTREAM_MANAGER, useValue: mockJsm },
        { provide: NATS_CONNECTION, useValue: mockNc },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get(EventsService);
  });

  describe("publish", () => {
    it("should publish to JetStream with correct subject", async () => {
      const id = await service.publish({
        type: "created",
        payload: { name: "test" },
        tenantId: TENANT_ID,
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
      expect(mockJs.publish).toHaveBeenCalledTimes(1);

      const [subject] = mockJs.publish.mock.calls[0];
      expect(subject).toBe(
        `evt.${TENANT_ID}.api-gateway.platform.events.gateway.created.v1`,
      );
    });

    it("should store pending status in Redis pipeline with TTL", async () => {
      const id = await service.publish({
        type: "updated",
        payload: {},
        tenantId: TENANT_ID,
      });

      expect(mockPipeline.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, value] = mockPipeline.setex.mock.calls[0];
      expect(key).toBe(`${TENANT_ID}:pending:${id}`);
      expect(ttl).toBe(3600);
      const parsed = JSON.parse(value);
      expect(parsed.id).toBe(id);
      expect(parsed.status).toBe("pending");
    });

    it("should generate unique IDs for each call", async () => {
      const id1 = await service.publish({
        type: "a",
        payload: {},
        tenantId: TENANT_ID,
      });
      const id2 = await service.publish({
        type: "b",
        payload: {},
        tenantId: TENANT_ID,
      });
      expect(id1).not.toBe(id2);
    });

    it("sets Nats-Msg-Id header equal to envelope.idempotencykey (sha256:)", async () => {
      await service.publish({
        type: "created",
        payload: { foo: "bar" },
        tenantId: TENANT_ID,
      });

      const [, payload, opts] = mockJs.publish.mock.calls[0];
      const envelope = JSON.parse(new TextDecoder().decode(payload));
      const natsMsgId = opts.headers.get("Nats-Msg-Id");
      expect(envelope.idempotencykey).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(natsMsgId).toBe(envelope.idempotencykey);
    });

    it("produces deterministic idempotencykey for identical payloads", async () => {
      await service.publish({
        type: "created",
        payload: { foo: "bar", baz: 42 },
        tenantId: TENANT_ID,
      });
      await service.publish({
        type: "created",
        payload: { baz: 42, foo: "bar" },
        tenantId: TENANT_ID,
      });

      const env1 = JSON.parse(
        new TextDecoder().decode(mockJs.publish.mock.calls[0][1]),
      );
      const env2 = JSON.parse(
        new TextDecoder().decode(mockJs.publish.mock.calls[1][1]),
      );
      expect(env1.idempotencykey).toBe(env2.idempotencykey);
    });

    it("propagates X-Correlation-Id and X-Causation-Id when supplied", async () => {
      await service.publish({
        type: "created",
        payload: {},
        tenantId: TENANT_ID,
        correlationId: "corr-123",
        causationId: "cause-123",
      });

      const [, payload, opts] = mockJs.publish.mock.calls[0];
      const envelope = JSON.parse(new TextDecoder().decode(payload));
      expect(envelope.correlation_id).toBe("corr-123");
      expect(envelope.causation_id).toBe("cause-123");
      expect(opts.headers.get("X-Correlation-Id")).toBe("corr-123");
      expect(opts.headers.get("X-Causation-Id")).toBe("cause-123");
    });
  });

  describe("getResult", () => {
    it("should return null when not in L1 cache or Redis", async () => {
      mockRedis.get = mock(() => Promise.resolve(null));
      const result = await service.getResult("nonexistent", TENANT_ID);
      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledTimes(1);
    });

    it("should return parsed result from Redis on L1 miss", async () => {
      const data = { eventId: "abc", type: "test", processed: true };
      mockRedis.get = mock(() => Promise.resolve(JSON.stringify(data)));

      const result = await service.getResult("abc", TENANT_ID);
      expect(result).toEqual(data);
      expect(mockRedis.get).toHaveBeenCalledWith(`${TENANT_ID}:result:abc`);
    });

    it("should return from L1 cache on second call (no Redis hit)", async () => {
      const data = { eventId: "abc", processed: true };
      mockRedis.get = mock(() => Promise.resolve(JSON.stringify(data)));

      await service.getResult("abc", TENANT_ID);
      mockRedis.get = mock(() => Promise.resolve(null));

      const result = await service.getResult("abc", TENANT_ID);
      expect(result).toEqual(data);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it("should evict oldest L1 entry when cache exceeds 1024", async () => {
      for (let i = 0; i < 1025; i++) {
        const d = { i };
        mockRedis.get = mock(() => Promise.resolve(JSON.stringify(d)));
        await service.getResult(`id-${i}`, TENANT_ID);
      }

      mockRedis.get = mock(() => Promise.resolve(null));
      const evicted = await service.getResult("id-0", TENANT_ID);
      expect(evicted).toBeNull();

      const stillCached = await service.getResult("id-1", TENANT_ID);
      expect(stillCached).toEqual({ i: 1 });
      expect(mockRedis.get).toHaveBeenCalledTimes(1);
    });
  });
});
