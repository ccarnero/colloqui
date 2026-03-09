import { describe, it, expect, mock } from 'bun:test';
import { Test } from '@nestjs/testing';
import { HealthController } from '../../src/modules/health/health.controller';
import { NATS_CONNECTION } from '../../src/providers/nats.provider';
import { REDIS_CLIENT } from '../../src/providers/redis.provider';

describe('HealthController (event-processor)', () => {
  const createController = async (natsOk: boolean, redisOk: boolean) => {
    const mockNats = { isClosed: mock(() => !natsOk) };
    const mockRedis = {
      ping: redisOk
        ? mock(() => Promise.resolve('PONG'))
        : mock(() => Promise.reject(new Error('connection refused'))),
    };

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: NATS_CONNECTION, useValue: mockNats },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    return module.get(HealthController);
  };

  it('should return ok when both healthy', async () => {
    const controller = await createController(true, true);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.nats).toBe(true);
    expect(result.redis).toBe(true);
  });

  it('should return degraded when NATS is down', async () => {
    const controller = await createController(false, true);
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.nats).toBe(false);
  });

  it('should return degraded when Redis is down', async () => {
    const controller = await createController(true, false);
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.redis).toBe(false);
  });
});
