import { describe, it, expect } from 'bun:test';
import { getBaseUrl, httpPost, httpGet, poll } from './helpers';
import { authHeaders } from './auth.setup';

const GW = getBaseUrl('api-gateway');

describe('E2E: webhook-service', () => {
  it('should accept an event with callbackUrl and process it', async () => {
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
      { timeoutMs: 30_000 },
    );

    expect(result).toBeDefined();
    expect(result.eventId).toBe(eventId);
  });
});
