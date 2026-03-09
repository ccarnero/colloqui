import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Test } from '@nestjs/testing';
import { EventsService } from '../../src/modules/events/events.service';
import { JETSTREAM } from '../../src/providers/nats.provider';
import { REDIS_CLIENT } from '../../src/providers/redis.provider';

describe('EventsService', () => {
  let service: EventsService;
  let mockJs: { publish: ReturnType<typeof mock> };
  let mockRedis: {
    setex: ReturnType<typeof mock>;
    get: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    mockJs = { publish: mock(() => Promise.resolve({ seq: 1 })) };
    mockRedis = {
      setex: mock(() => Promise.resolve('OK')),
      get: mock(() => Promise.resolve(null)),
    };

    const module = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: JETSTREAM, useValue: mockJs },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get(EventsService);
  });

  describe('publish', () => {
    it('should publish to JetStream with correct subject', async () => {
      const id = await service.publish('created', { name: 'test' });

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(mockJs.publish).toHaveBeenCalledTimes(1);

      const [subject, data] = mockJs.publish.mock.calls[0];
      expect(subject).toBe('events.created');

      const decoded = JSON.parse(new TextDecoder().decode(data));
      expect(decoded.id).toBe(id);
      expect(decoded.type).toBe('created');
      expect(decoded.payload).toEqual({ name: 'test' });
    });

    it('should store pending status in Redis with TTL', async () => {
      const id = await service.publish('updated', {});

      expect(mockRedis.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, value] = mockRedis.setex.mock.calls[0];
      expect(key).toBe(`pending:${id}`);
      expect(ttl).toBe(3600);
      const parsed = JSON.parse(value);
      expect(parsed.id).toBe(id);
      expect(parsed.status).toBe('pending');
    });

    it('should generate unique IDs for each call', async () => {
      const id1 = await service.publish('a', {});
      const id2 = await service.publish('b', {});
      expect(id1).not.toBe(id2);
    });
  });

  describe('getResult', () => {
    it('should return null when not in L1 cache or Redis', async () => {
      mockRedis.get = mock(() => Promise.resolve(null));
      const result = await service.getResult('nonexistent');
      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledTimes(1);
    });

    it('should return parsed result from Redis on L1 miss', async () => {
      const data = { eventId: 'abc', type: 'test', processed: true };
      mockRedis.get = mock(() => Promise.resolve(JSON.stringify(data)));

      const result = await service.getResult('abc');
      expect(result).toEqual(data);
      expect(mockRedis.get).toHaveBeenCalledWith('result:abc');
    });

    it('should return from L1 cache on second call (no Redis hit)', async () => {
      const data = { eventId: 'abc', processed: true };
      mockRedis.get = mock(() => Promise.resolve(JSON.stringify(data)));

      await service.getResult('abc');
      mockRedis.get = mock(() => Promise.resolve(null));

      const result = await service.getResult('abc');
      expect(result).toEqual(data);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('should evict oldest L1 entry when cache exceeds 1024', async () => {
      for (let i = 0; i < 1025; i++) {
        const d = { i };
        mockRedis.get = mock(() => Promise.resolve(JSON.stringify(d)));
        await service.getResult(`id-${i}`);
      }

      mockRedis.get = mock(() => Promise.resolve(null));
      const evicted = await service.getResult('id-0');
      expect(evicted).toBeNull();

      const stillCached = await service.getResult('id-1');
      expect(stillCached).toEqual({ i: 1 });
      expect(mockRedis.get).toHaveBeenCalledTimes(1);
    });
  });
});
