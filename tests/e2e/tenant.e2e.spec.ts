import { describe, it, expect, afterAll } from 'bun:test';
import { getBaseUrl, httpPost, httpGet, httpDelete } from './helpers';
import { authHeaders } from './auth.setup';

const GW = getBaseUrl('api-gateway');

const TENANT_NAME = `e2e-t-${Date.now().toString(36)}`;
const createdTenants: string[] = [];

afterAll(async () => {
  const h = await authHeaders();
  await Promise.all(
    createdTenants.map((name) => httpDelete(`${GW}/tenants/${name}`, { headers: h })),
  );
});

describe('E2E: tenant-service', () => {
  it('should create a tenant', async () => {
    const h = await authHeaders();
    const { status, body } = await httpPost<{ name: string }>(
      `${GW}/tenants`,
      { name: TENANT_NAME },
      { headers: h },
    );

    expect(status).toBe(201);
    expect(body.name).toBe(TENANT_NAME);
    createdTenants.push(TENANT_NAME);
  }, 30_000);

  it('should list tenants including the created one', async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<Array<{ name: string }>>(`${GW}/tenants`, {
      headers: h,
    });

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const names = body.map((t) => t.name);
    expect(names).toContain(TENANT_NAME);
  });

  it('should get a specific tenant', async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<{ name: string }>(
      `${GW}/tenants/${TENANT_NAME}`,
      { headers: h },
    );

    expect(status).toBe(200);
    expect(body.name).toBe(TENANT_NAME);
  });

  it('should delete the tenant', async () => {
    const h = await authHeaders();
    const { status } = await httpDelete(`${GW}/tenants/${TENANT_NAME}`, { headers: h });

    expect(status).toBe(204);
    createdTenants.splice(createdTenants.indexOf(TENANT_NAME), 1);
  }, 30_000);

  it('should show tenant as terminating after delete', async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<{
      name: string;
      namespaces?: Array<{ phase: string }>;
    }>(`${GW}/tenants/${TENANT_NAME}`, { headers: h });

    if (status === 404) return;

    expect(status).toBe(200);
    expect(body.namespaces?.[0]?.phase).toBe('Terminating');
  });
});
