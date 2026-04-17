import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { DiscoveryModule } from "@nestjs/core";
import { ProcessorService } from "../../src/modules/processor/processor.service";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
  NATS_CONNECTION,
} from "../../src/providers/nats.provider";
import { REDIS_CLIENT } from "@yoizen/database";
import { HandlerRegistry } from "../../src/handlers/handler-registry";
import { DefaultHandler } from "../../src/handlers/default.handler";
import {
  CreatedHandler,
  DeletedHandler,
  UpdatedHandler,
} from "../../src/handlers/lifecycle-handlers";
import { PipelineRunner } from "../../src/pipeline/pipeline-runner";
import { ProcessorPipelineDeps } from "../../src/modules/processor/processor-pipeline-deps";
import type { EventEnvelope } from "@yoizen/shared";

function makeEnvelope(
  overrides: Partial<EventEnvelope> & { id: string; type: string },
): EventEnvelope {
  const { id, type } = overrides;
  return {
    specversion: "1.0",
    id,
    source: `events.${type}`,
    type,
    resource: type,
    time: new Date().toISOString(),
    traceid: id,
    causation_id: null,
    correlation_id: id,
    tenant: "test-tenant",
    producer: "test",
    domain: "platform",
    channel: "events",
    provider: "test",
    accountid: "test-tenant",
    idempotencykey: id,
    transport: { method: "stream", protocol: "internal" },
    data: {
      received_at: new Date().toISOString(),
      payload_inline: true,
      payload_ref: null,
      payload_bytes: 0,
      payload_checksum: "",
      payload: {},
    },
    ...overrides,
  };
}

describe("ProcessorService", () => {
  let service: ProcessorService;
  let mockRedis: { setex: ReturnType<typeof mock> };
  let mockPublisher: { publish: ReturnType<typeof mock> };

  beforeEach(async () => {
    mockRedis = { setex: mock(() => Promise.resolve("OK")) };

    const mockNc = {
      subscribe: mock(() => ({ unsubscribe: mock(() => {}) })),
    };

    const mockJsm = {
      streams: {
        info: mock(() => Promise.resolve({})),
        add: mock(() => Promise.resolve({})),
      },
    };

    mockPublisher = {
      publish: mock(() => Promise.resolve({ seq: 1 })),
    };

    const mockPipelineRunner = {
      run: mock((envelope: EventEnvelope) => Promise.resolve(envelope)),
    };

    const module = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [
        ProcessorService,
        ProcessorPipelineDeps,
        HandlerRegistry,
        DefaultHandler,
        CreatedHandler,
        UpdatedHandler,
        DeletedHandler,
        { provide: PipelineRunner, useValue: mockPipelineRunner },
        { provide: NATS_CONNECTION, useValue: mockNc },
        { provide: JETSTREAM_MANAGER, useValue: mockJsm },
        { provide: JETSTREAM_PUBLISHER, useValue: mockPublisher },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    await module.init();
    service = module.get(ProcessorService);
  });

  describe("processEvent", () => {
    it("should write result to Redis with correct key and TTL", async () => {
      const envelope = makeEnvelope({
        id: "evt-1",
        type: "created",
        data: {
          received_at: new Date().toISOString(),
          payload_inline: true,
          payload_ref: null,
          payload_bytes: 0,
          payload_checksum: "",
          payload: { data: true },
        },
      });
      await service.processEvent(envelope);

      expect(mockRedis.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, value] = mockRedis.setex.mock.calls[0];
      expect(key).toBe("result:evt-1");
      expect(ttl).toBe(3600);

      const parsed = JSON.parse(value);
      expect(parsed.eventId).toBe("evt-1");
      expect(parsed.type).toBe("created");
      expect(parsed.processed).toBe(true);
      expect(typeof parsed.timestamp).toBe("number");
    });

    it("should set processed=true for known types (created, updated, deleted)", async () => {
      for (const type of ["created", "updated", "deleted"]) {
        mockRedis.setex = mock(() => Promise.resolve("OK"));
        await service.processEvent(makeEnvelope({ id: `id-${type}`, type }));
        const parsed = JSON.parse(mockRedis.setex.mock.calls[0][2]);
        expect(parsed.processed).toBe(true);
      }
    });

    it("should set processed=false for unknown type with falsy payload", async () => {
      await service.processEvent(
        makeEnvelope({
          id: "evt-2",
          type: "unknown",
        }),
      );

      const parsed = JSON.parse(mockRedis.setex.mock.calls[0][2]);
      expect(parsed.processed).toBe(false);
    });

    it("should set processed=true for unknown type with truthy payload", async () => {
      await service.processEvent(
        makeEnvelope({
          id: "evt-3",
          type: "custom",
          data: {
            received_at: new Date().toISOString(),
            payload_inline: true,
            payload_ref: null,
            payload_bytes: 0,
            payload_checksum: "",
            payload: { data: 1 },
          },
        }),
      );

      const parsed = JSON.parse(mockRedis.setex.mock.calls[0][2]);
      expect(parsed.processed).toBe(true);
    });

    it("wraps completion in an envelope with causation_id=incoming.id and depth+1", async () => {
      const incoming = makeEnvelope({
        id: "parent-1",
        type: "created",
        correlation_id: "corr-xyz",
        transport: { method: "stream", protocol: "internal", depth: 2 },
      });

      await service.processEvent(incoming, "test-tenant");

      const publishCall = mockPublisher.publish.mock.calls[0];
      expect(publishCall).toBeDefined();
      const [subject, body, opts] = publishCall;
      expect(subject).toBe(
        "evt.test-tenant.event-processor.platform.events.gateway.completed.v1",
      );

      const envelope = JSON.parse(new TextDecoder().decode(body));
      expect(envelope.causation_id).toBe("parent-1");
      expect(envelope.correlation_id).toBe("corr-xyz");
      expect(envelope.transport.depth).toBe(3);
      expect(envelope.idempotencykey).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(opts.headers.get("Nats-Msg-Id")).toBe(envelope.idempotencykey);
      expect(opts.headers.get("X-Correlation-Id")).toBe("corr-xyz");
      expect(opts.headers.get("X-Causation-Id")).toBe("parent-1");
    });
  });
});
