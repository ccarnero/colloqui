import { describe, it, expect } from 'bun:test';
import { getBaseUrl, httpPost, httpGet, poll } from './helpers';
import { authHeaders } from './auth.setup';

const GW = getBaseUrl('api-gateway');

/**
 * Bun's default per-test timeout is 5s, but this flow must wait for the
 * event-processor → webhook-service → httpbin.org round-trip. The internal
 * poll already caps at 30s; give the test enough budget to let that run and
 * tolerate slow cold-starts under full-suite contention.
 */
const SLOW_IT = { timeout: 90_000 };

describe('E2E: webhook-service', () => {
  it(
    'should accept inbound provider webhook through api-gateway',
    async () => {
      const tenantId = `webhook-e2e-${Date.now()}`;
      const { status, body } = await httpPost<{ status: string }>(
        `${GW}/webhooks/whatsapp/${tenantId}`,
        {
          object: 'whatsapp_business_account',
          entry: [],
        },
      );

      expect(status).toBe(200);
      expect(body.status).toBe('accepted');
    },
    SLOW_IT,
  );

  it(
    'should accept an event with callbackUrl and process it',
    async () => {
      const h = await authHeaders();
      const { status, body } = await httpPost<{ id: string; status: string }>(
        `${GW}/events`,
        {
          type: 'webhook-e2e-test',
          payload: { data: 'webhook-test' },
          callbackUrl: 'https://httpbin.org/post',
        },
        { headers: h },
      );

      expect(status).toBe(202);
      expect(body.id).toBeDefined();

      const eventId = body.id;
      const result = await poll(
        async () => {
          const res = await httpGet<{ eventId: string; processed: boolean }>(
            `${GW}/results/${eventId}`,
            { headers: h },
          );
          if (res.status === 200) return res.body;
          return null;
        },
        { timeoutMs: 60_000 },
      );

      expect(result).toBeDefined();
      expect(result.eventId).toBe(eventId);
    },
    SLOW_IT,
  );
});
