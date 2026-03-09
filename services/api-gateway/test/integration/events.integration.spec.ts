import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from '../../src/app.module';
import Redis from 'ioredis';
import { connect, type NatsConnection, type JetStreamClient } from 'nats';

describe('api-gateway integration', () => {
  let app: NestFastifyApplication;
  let redis: Redis;
  let nc: NatsConnection;
  let js: JetStreamClient;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    redis = new Redis({ host: 'localhost', port: 6379 });
    nc = await connect({ servers: 'nats://localhost:4222' });
    js = nc.jetstream();
  });

  afterAll(async () => {
    await redis.quit();
    await nc.close();
    await app.close();
  });

  it('POST /events should publish to NATS and write pending to Redis', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'integration-test', payload: { foo: 42 } },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.status).toBe('accepted');
    expect(typeof body.id).toBe('string');

    const pending = await redis.get(`pending:${body.id}`);
    expect(pending).not.toBeNull();
    const parsed = JSON.parse(pending!);
    expect(parsed.id).toBe(body.id);
    expect(parsed.status).toBe('pending');

    await redis.del(`pending:${body.id}`);
  });

  it('GET /results/:id should return result from Redis', async () => {
    const id = 'integration-test-result';
    const data = { eventId: id, type: 'test', processed: true, timestamp: Date.now() };
    await redis.set(`result:${id}`, JSON.stringify(data));

    const response = await app.inject({
      method: 'GET',
      url: `/results/${id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(data);

    await redis.del(`result:${id}`);
  });

  it('GET /results/:id should return 404 for missing result', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/results/nonexistent-id',
    });

    expect(response.statusCode).toBe(404);
  });

  it('GET /health should report ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.nats).toBe('connected');
    expect(body.redis).toBe('connected');
  });
});
