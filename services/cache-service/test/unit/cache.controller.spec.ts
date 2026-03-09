import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Test } from '@nestjs/testing';
import { CacheController } from '../../src/modules/cache/cache.controller';
import { CacheService } from '../../src/modules/cache/cache.service';
import { REDIS_CLIENT } from '../../src/providers/redis.provider';

describe('CacheController', () => {
  let controller: CacheController;
  let service: CacheService;

  beforeEach(async () => {
    const mockRedis = {
      get: mock(() => Promise.resolve(null)),
      set: mock(() => Promise.resolve('OK')),
      del: mock(() => Promise.resolve(1)),
      scan: mock(() => Promise.resolve(['0', []])),
      pipeline: mock(() => ({
        get: mock(function (this: any) { return this; }),
        exec: mock(() => Promise.resolve([])),
      })),
    };

    const module = await Test.createTestingModule({
      controllers: [CacheController],
      providers: [
        CacheService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    controller = module.get(CacheController);
    service = module.get(CacheService);
  });

  describe('GET /cache/:key', () => {
    it('should return value from service', async () => {
      service.get = mock(() => Promise.resolve({ data: 'hello' })) as any;
      const result = await controller.get('mykey');
      expect(result).toEqual({ data: 'hello' });
    });
  });

  describe('PUT /cache/:key', () => {
    it('should call set and return ok', async () => {
      service.set = mock(() => Promise.resolve()) as any;
      const result = await controller.set('mykey', {
        value: 'data',
        ttl: 300,
      });
      expect(result).toEqual({ ok: true });
      expect(service.set).toHaveBeenCalledWith('mykey', 'data', 300);
    });
  });

  describe('DELETE /cache/:key', () => {
    it('should call del and return ok', async () => {
      service.del = mock(() => Promise.resolve()) as any;
      const result = await controller.del('mykey');
      expect(result).toEqual({ ok: true });
      expect(service.del).toHaveBeenCalledWith('mykey');
    });
  });

  describe('GET /cache (listKeys)', () => {
    it('should return keys from scan', async () => {
      service.scan = mock(() => Promise.resolve(['a', 'b'])) as any;
      const result = await controller.listKeys('test*', '50');
      expect(result).toEqual(['a', 'b']);
      expect(service.scan).toHaveBeenCalledWith('test*', 50);
    });

    it('should use defaults when no params provided', async () => {
      service.scan = mock(() => Promise.resolve([])) as any;
      await controller.listKeys();
      expect(service.scan).toHaveBeenCalledWith('*', 100);
    });
  });

  describe('POST /cache/batch', () => {
    it('should return object from batchGet Map', async () => {
      const map = new Map<string, unknown>([
        ['k1', 'v1'],
        ['k2', 'v2'],
      ]);
      service.batchGet = mock(() => Promise.resolve(map)) as any;
      const result = await controller.batchGet({ keys: ['k1', 'k2'] });
      expect(result).toEqual({ k1: 'v1', k2: 'v2' });
    });
  });
});
