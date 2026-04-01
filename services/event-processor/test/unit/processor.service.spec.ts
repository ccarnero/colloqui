import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Test } from '@nestjs/testing';
import { DiscoveryModule } from '@nestjs/core';
import { ProcessorService } from '../../src/modules/processor/processor.service';
import { JETSTREAM_CLIENT, JETSTREAM_PUBLISHER } from '../../src/providers/nats.provider';
import { REDIS_CLIENT } from '../../src/providers/redis.provider';
import { HandlerRegistry } from '../../src/handlers/handler-registry';
import { DefaultHandler } from '../../src/handlers/default.handler';
import { CreatedHandler } from '../../src/handlers/created.handler';
import { UpdatedHandler } from '../../src/handlers/updated.handler';
import { DeletedHandler } from '../../src/handlers/deleted.handler';
import { PipelineRunner } from '../../src/pipeline/pipeline-runner';
import type { EventEnvelope } from '@yoizen/shared';

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

describe('ProcessorService', () => {
  let service: ProcessorService;
  let mockRedis: { setex: ReturnType<typeof mock> };

  beforeEach(async () => {
    mockRedis = { setex: mock(() => Promise.resolve('OK')) };

    const mockConsumer = {
      consume: mock(() =>
        Promise.resolve({
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ done: true, value: undefined }),
          }),
          stop: mock(),
        }),
      ),
    };

    const mockPublisher = {
      publish: mock(() => Promise.resolve({ seq: 1 })),
    };

    const mockPipelineRunner = {
      run: mock((envelope: EventEnvelope) => Promise.resolve(envelope)),
    };

    const module = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [
        ProcessorService,
        HandlerRegistry,
        DefaultHandler,
        CreatedHandler,
        UpdatedHandler,
        DeletedHandler,
        { provide: PipelineRunner, useValue: mockPipelineRunner },
        { provide: JETSTREAM_CLIENT, useValue: mockConsumer },
        { provide: JETSTREAM_PUBLISHER, useValue: mockPublisher },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    await module.init();
    service = module.get(ProcessorService);
  });

  describe('processEvent', () => {
    it('should write result to Redis with correct key and TTL', async () => {
      const envelope = makeEnvelope({
        id: 'evt-1',
        type: 'created',
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
      expect(key).toBe('result:evt-1');
      expect(ttl).toBe(3600);

      const parsed = JSON.parse(value);
      expect(parsed.eventId).toBe('evt-1');
      expect(parsed.type).toBe('created');
      expect(parsed.processed).toBe(true);
      expect(typeof parsed.timestamp).toBe('number');
    });

    it('should set processed=true for known types (created, updated, deleted)', async () => {
      for (const type of ['created', 'updated', 'deleted']) {
        mockRedis.setex = mock(() => Promise.resolve('OK'));
        await service.processEvent(makeEnvelope({ id: `id-${type}`, type }));
        const parsed = JSON.parse(mockRedis.setex.mock.calls[0][2]);
        expect(parsed.processed).toBe(true);
      }
    });

    it('should set processed=false for unknown type with falsy payload', async () => {
      await service.processEvent(makeEnvelope({
        id: 'evt-2',
        type: 'unknown',
      }));

      const parsed = JSON.parse(mockRedis.setex.mock.calls[0][2]);
      expect(parsed.processed).toBe(false);
    });

    it('should set processed=true for unknown type with truthy payload', async () => {
      await service.processEvent(makeEnvelope({
        id: 'evt-3',
        type: 'custom',
        data: {
          received_at: new Date().toISOString(),
          payload_inline: true,
          payload_ref: null,
          payload_bytes: 0,
          payload_checksum: "",
          payload: { data: 1 },
        },
      }));

      const parsed = JSON.parse(mockRedis.setex.mock.calls[0][2]);
      expect(parsed.processed).toBe(true);
    });
  });
});
