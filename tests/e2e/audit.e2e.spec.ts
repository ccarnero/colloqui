import { describe, it, expect } from 'bun:test';
import { getBaseUrl, httpPost, httpGet, poll } from './helpers';
import { authHeaders } from './auth.setup';

const GW = getBaseUrl('api-gateway');

interface PublishResponse {
  id: string;
  status: string;
}

async function publishEvent(type: string, payload: object): Promise<string> {
  const h = await authHeaders();
  const { status, body } = await httpPost<PublishResponse>(
    `${GW}/events`,
    { type, payload },
    { headers: h },
  );
  expect(status).toBe(202);
  return body.id;
}

describe('E2E: audit-service', () => {
  let publishedEventId: string;

  it('should publish events to generate audit data', async () => {
    publishedEventId = await publishEvent('audit-e2e-created', { source: 'e2e-audit' });
    expect(publishedEventId).toBeDefined();

    await publishEvent('audit-e2e-updated', { source: 'e2e-audit', field: 'name' });
    await publishEvent('audit-e2e-deleted', { source: 'e2e-audit', reason: 'cleanup' });

    await Bun.sleep(3_000);
  }, 30_000);

  it('should query audit events', async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<{ events: unknown[]; limit: number; offset: number }>(
      `${GW}/audit/events?limit=10&offset=0`,
      { headers: h },
    );

    expect(status).toBe(200);
    expect(body.events).toBeDefined();
    expect(Array.isArray(body.events)).toBe(true);
  });

  it('should filter audit events by type', async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<{ events: unknown[] }>(
      `${GW}/audit/events?type=audit-e2e-created&limit=5`,
      { headers: h },
    );

    expect(status).toBe(200);
    expect(body.events).toBeDefined();
  });

  it('should support pagination', async () => {
    const h = await authHeaders();
    const page1 = await httpGet<{ events: unknown[]; limit: number; offset: number }>(
      `${GW}/audit/events?limit=2&offset=0`,
      { headers: h },
    );
    expect(page1.status).toBe(200);

    const page2 = await httpGet<{ events: unknown[]; limit: number; offset: number }>(
      `${GW}/audit/events?limit=2&offset=2`,
      { headers: h },
    );
    expect(page2.status).toBe(200);
  });

  it('should get a specific audit event by ID', async () => {
    if (!publishedEventId) return;

    const h = await authHeaders();

    const event = await poll(
      async () => {
        const res = await httpGet<{ id: string }>(`${GW}/audit/events/${publishedEventId}`, {
          headers: h,
        });
        if (res.status === 200) return res.body;
        return null;
      },
      { timeoutMs: 15_000 },
    );

    expect(event).toBeDefined();
    expect(event.id).toBe(publishedEventId);
  });

  it('should return 404 for a nonexistent audit event', async () => {
    const h = await authHeaders();
    const { status } = await httpGet(`${GW}/audit/events/nonexistent-e2e-id`, { headers: h });

    expect(status).toBe(404);
  });
});
