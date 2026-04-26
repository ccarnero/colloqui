import { describe, it, expect, beforeAll } from 'bun:test';
import { getRawBaseUrl, getBaseUrl, httpGet, poll } from './helpers';

const GW = getRawBaseUrl('api-gateway');
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

/**
 * Total budget for the gateway's aggregate health to converge to `ok`.
 * This is the worst-case stack-wide cold-start: every downstream coming
 * up from 0 in parallel after `warmup.ts` finishes its initial poke.
 *
 * `gateway-health.service.ts` uses a 3s per-downstream timeout, so any
 * service still cold-starting is reported `unreachable` for that probe;
 * we re-check until the aggregate flips to `ok`.
 */
const HEALTH_CONVERGENCE_BUDGET_MS = 120_000;
const HEALTH_POLL_INITIAL_MS = 1_000;
const HEALTH_POLL_MAX_MS = 5_000;

describe('E2E: health checks', () => {
  let gatewayHealth: GatewayHealthResponse;

  beforeAll(async () => {
    gatewayHealth = await poll<GatewayHealthResponse>(
      async () => {
        const { status, body } = await httpGet<GatewayHealthResponse>(
          `${GW}/health`,
        );
        // The gateway aggregator returns 200 even when degraded, so we
        // gate on the `status` field — `unreachable` downstreams flip the
        // aggregate to `degraded` while pods are still cold-starting.
        if (status !== 200) return null;
        if (body.status === 'ok') return body;
        return null;
      },
      {
        timeoutMs: HEALTH_CONVERGENCE_BUDGET_MS,
        initialDelayMs: HEALTH_POLL_INITIAL_MS,
        maxDelayMs: HEALTH_POLL_MAX_MS,
      },
    );
  }, HEALTH_CONVERGENCE_BUDGET_MS + 5_000);

  it('api-gateway /health should report ok with all dependencies', () => {
    expect(gatewayHealth).toBeDefined();
    expect(gatewayHealth.status).toBe('ok');
    expect(gatewayHealth.nats).toBe('connected');
    expect(gatewayHealth.redis).toBe('connected');
    expect(gatewayHealth.services).toBeDefined();
  });

  for (const svc of DOWNSTREAM_SERVICES) {
    it(`${svc} should be healthy (via gateway)`, () => {
      expect(gatewayHealth).toBeDefined();

      const svcHealth = gatewayHealth.services[svc];
      expect(svcHealth).not.toBe('unreachable');
      expect(typeof svcHealth).toBe('object');
      expect((svcHealth as ServiceHealth).status).toBe('ok');
    });
  }

  it('event-processor /health should report ok (direct)', async () => {
    if (!process.env.EVENT_PROCESSOR_URL) return;
    const { status, body } = await httpGet<{ status: string; nats: boolean; redis: boolean }>(
      `${EP}/health`,
    );
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.nats).toBe(true);
    expect(body.redis).toBe(true);
  });

  it('cache-service /health should report ok (direct)', async () => {
    if (!process.env.CACHE_SERVICE_URL) return;
    const { status, body } = await httpGet<{ status: string; redis: string }>(
      `${CS}/health`,
    );
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.redis).toBe('connected');
  });
});
