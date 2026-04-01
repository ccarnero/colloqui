import { describe, it, expect } from 'bun:test';
import { getBaseUrl, httpGet } from './helpers';

const MS = getBaseUrl('metrics-service');

const skip = !process.env.METRICS_SERVICE_URL;

describe('E2E: metrics-service (direct — requires METRICS_SERVICE_URL)', () => {
  it('should skip if METRICS_SERVICE_URL is not set', () => {
    if (skip) {
      console.log('METRICS_SERVICE_URL not set, skipping metrics-service tests');
    }
    expect(true).toBe(true);
  });

  it('should query metrics with pagination', async () => {
    if (skip) return;
    const { status, body } = await httpGet<{ data: unknown[] }>(
      `${MS}/metrics?limit=10&offset=0`,
      { headers: { 'x-yoizen-tenant': process.env.E2E_TENANT ?? 'acme' } },
    );

    expect(status).toBe(200);
    expect(body).toBeDefined();
  });

  it('should filter metrics by source', async () => {
    if (skip) return;
    const { status } = await httpGet(
      `${MS}/metrics?source=e2e&limit=5`,
      { headers: { 'x-yoizen-tenant': process.env.E2E_TENANT ?? 'acme' } },
    );

    expect(status).toBe(200);
  });

  it('should return 404 for nonexistent metric ID', async () => {
    if (skip) return;
    const { status } = await httpGet(`${MS}/metrics/nonexistent-e2e-id`, {
      headers: { 'x-yoizen-tenant': process.env.E2E_TENANT ?? 'acme' },
    });

    expect(status).toBe(404);
  });
});
