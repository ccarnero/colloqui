import { describe, it, expect } from 'bun:test';
import { getBaseUrl, httpGet } from './helpers';

const GW = getBaseUrl('api-gateway');
const EP = getBaseUrl('event-processor');
const CS = getBaseUrl('cache-service');

interface ServiceHealth {
  status: string;
  [key: string]: unknown;
}

interface GatewayHealthResponse {
  status: string;
  nats: string;
  redis: string;
  services: Record<string, ServiceHealth | 'unreachable'>;
}

const DOWNSTREAM_SERVICES = [
  'auth-service',
  'cache-service',
  'webhook-service',
  'audit-service',
  'event-processor',
  'metrics-service',
  'tenant-service',
  'registry-service',
  'workflow-service',
] as const;

describe('E2E: health checks', () => {
  let gatewayHealth: GatewayHealthResponse;

  it('api-gateway /health should report ok with all dependencies', async () => {
    const { status, body } = await httpGet<GatewayHealthResponse>(`${GW}/health`);

    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.nats).toBe('connected');
    expect(body.redis).toBe('connected');
    expect(body.services).toBeDefined();
    gatewayHealth = body;
  });

  for (const svc of DOWNSTREAM_SERVICES) {
    it(`${svc} should be healthy (via gateway)`, async () => {
      expect(gatewayHealth).toBeDefined();

      const svcHealth = gatewayHealth.services[svc];
      expect(svcHealth).not.toBe('unreachable');
      expect(typeof svcHealth).toBe('object');
      expect((svcHealth as ServiceHealth).status).toBe('ok');
    });
  }

  it('event-processor /health should report ok (direct)', async () => {
    const { status, body } = await httpGet<{ status: string; nats: boolean; redis: boolean }>(
      `${EP}/health`,
    );
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.nats).toBe(true);
    expect(body.redis).toBe(true);
  });

  it('cache-service /health should report ok (direct)', async () => {
    const { status, body } = await httpGet<{ status: string; redis: string }>(
      `${CS}/health`,
    );
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.redis).toBe('connected');
  });
});
