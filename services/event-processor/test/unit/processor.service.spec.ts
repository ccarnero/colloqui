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
      const envelope: EventEnvelope = {
        id: 'evt-1',
        type: 'created',
        payload: { data: true },
      };
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
        await service.processEvent({ id: `id-${type}`, type, payload: {} });
        const parsed = JSON.parse(mockRedis.setex.mock.calls[0][2]);
        expect(parsed.processed).toBe(true);
      }
    });

    it('should set processed=false for unknown type with falsy payload', async () => {
      await service.processEvent({
        id: 'evt-2',
        type: 'unknown',
        payload: {},
      });

      const parsed = JSON.parse(mockRedis.setex.mock.calls[0][2]);
      expect(parsed.processed).toBe(false);
    });

    it('should set processed=true for unknown type with truthy payload', async () => {
      await service.processEvent({
        id: 'evt-3',
        type: 'custom',
        payload: { data: 1 },
      });

      const parsed = JSON.parse(mockRedis.setex.mock.calls[0][2]);
      expect(parsed.processed).toBe(true);
    });
  });

  describe('getStats / type counting', () => {
    it('should track event counts per type in O(1) Map', async () => {
      await service.processEvent({ id: 'a1', type: 'created', payload: {} });
      await service.processEvent({ id: 'a2', type: 'created', payload: {} });
      await service.processEvent({ id: 'a3', type: 'created', payload: {} });
      await service.processEvent({ id: 'b1', type: 'updated', payload: {} });
      await service.processEvent({ id: 'b2', type: 'updated', payload: {} });

      const stats = service.getStats();
      expect(stats.get('created')).toBe(3);
      expect(stats.get('updated')).toBe(2);
      expect(stats.has('deleted')).toBe(false);
    });

    it('should return a copy of the map (not the internal reference)', async () => {
      await service.processEvent({ id: 'x', type: 'test', payload: {} });

      const stats = service.getStats();
      stats.set('test', 999);

      const freshStats = service.getStats();
      expect(freshStats.get('test')).toBe(1);
    });
  });
});
