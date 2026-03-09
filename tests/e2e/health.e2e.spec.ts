import { describe, it, expect } from 'bun:test';
import { getBaseUrl, httpGet } from './helpers';

const GW = getBaseUrl('api-gateway');
const EP = getBaseUrl('event-processor');
const CS = getBaseUrl('cache-service');

describe('E2E: health checks', () => {
  it('api-gateway /health should report ok', async () => {
    const { status, body } = await httpGet<{ status: string; nats: string; redis: string }>(
      `${GW}/health`,
    );
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.nats).toBe('connected');
    expect(body.redis).toBe('connected');
  });

  it('event-processor /health should report ok', async () => {
    const { status, body } = await httpGet<{ status: string; nats: boolean; redis: boolean }>(
      `${EP}/health`,
    );
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.nats).toBe(true);
    expect(body.redis).toBe(true);
  });

  it('cache-service /health should report ok', async () => {
    const { status, body } = await httpGet<{ status: string; redis: string }>(
      `${CS}/health`,
    );
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.redis).toBe('connected');
  });
});
