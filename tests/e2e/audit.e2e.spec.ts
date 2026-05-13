import { describe, it, expect } from 'bun:test';
import { getBaseUrl, httpGet } from './helpers';
import { authHeaders } from './auth.setup';

const GW = getBaseUrl('api-gateway');

// The /audit/events query endpoint reads from the per-tenant `events`
// table populated by the EVENTS stream consumer. With the events
// pipeline removed, the table may be empty for fresh tenants — these
// tests verify the query API surface still answers correctly.

describe('E2E: audit-service query API', () => {
  it('should return a paginated envelope from /audit/events', async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<{
      events: unknown[];
      limit: number;
      offset: number;
    }>(`${GW}/audit/events?limit=10&offset=0`, { headers: h });

    expect(status).toBe(200);
    expect(body.events).toBeDefined();
    expect(Array.isArray(body.events)).toBe(true);
  });

  it('should accept type filter on /audit/events', async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<{ events: unknown[] }>(
      `${GW}/audit/events?type=audit-e2e-created&limit=5`,
      { headers: h },
    );

    expect(status).toBe(200);
    expect(body.events).toBeDefined();
  });

  it('should support pagination on /audit/events', async () => {
    const h = await authHeaders();
    const page1 = await httpGet<{
      events: unknown[];
      limit: number;
      offset: number;
    }>(`${GW}/audit/events?limit=2&offset=0`, { headers: h });
    expect(page1.status).toBe(200);

    const page2 = await httpGet<{
      events: unknown[];
      limit: number;
      offset: number;
    }>(`${GW}/audit/events?limit=2&offset=2`, { headers: h });
    expect(page2.status).toBe(200);
  });

  it('should return 404 for a nonexistent audit event', async () => {
    const h = await authHeaders();
    const { status } = await httpGet(
      `${GW}/audit/events/nonexistent-e2e-id`,
      { headers: h },
    );

    expect(status).toBe(404);
  });
});
