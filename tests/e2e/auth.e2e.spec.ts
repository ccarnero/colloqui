import { describe, it, expect, afterAll } from 'bun:test';
import { getBaseUrl, httpPost, httpGet, httpDelete } from './helpers';
import { authHeaders, getCachedRefreshToken, getAuthToken } from './auth.setup';

const GW = getBaseUrl('api-gateway');

const cleanupClientIds: string[] = [];
const cleanupPublicRouteIds: string[] = [];

afterAll(async () => {
  const h = await authHeaders();
  await Promise.all(
    cleanupClientIds.map((id) => httpDelete(`${GW}/auth/clients/${id}`, { headers: h })),
  );
  await Promise.all(
    cleanupPublicRouteIds.map((id) =>
      httpDelete(`${GW}/auth/public-routes/${id}`, { headers: h }),
    ),
  );
});

describe('E2E: auth-service', () => {
  describe('login / token', () => {
    it('should login with valid admin credentials', async () => {
      const email = process.env.ADMIN_EMAIL;
      const password = process.env.ADMIN_PASSWORD;
      if (!email || !password) return;

      const { status, body } = await httpPost<{
        access_token: string;
        token_type: string;
        expires_in: number;
        scope: string;
        refresh_token?: string;
      }>(`${GW}/auth/login`, { email, password });

      expect(status).toBe(201);
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.expires_in).toBeGreaterThan(0);
      expect(body.scope).toBe('platform');
    });

    it('should reject invalid credentials with 401', async () => {
      const { status } = await httpPost(`${GW}/auth/login`, {
        email: 'nonexistent@e2e.test',
        password: 'wrongpassword',
      });

      expect(status).toBe(401);
    });

    it('should refresh a token', async () => {
      await getAuthToken();
      const refreshToken = getCachedRefreshToken();
      if (!refreshToken) return;

      const { status, body } = await httpPost<{
        access_token: string;
        token_type: string;
        expires_in: number;
        scope: string;
        refresh_token?: string;
      }>(`${GW}/auth/refresh`, { refresh_token: refreshToken });

      expect(status).toBe(201);
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
    });
  });

  describe('clients CRUD', () => {
    let createdClientId: string;
    let createdClientRawId: string;
    let createdClientSecret: string;

    it('should create an API client', async () => {
      const h = await authHeaders();
      const { status, body } = await httpPost<{
        id: string;
        client_id: string;
        client_secret: string;
        name: string;
        scope: string;
        is_active: boolean;
      }>(`${GW}/auth/clients`, { name: 'e2e-test-client', scope: 'platform' }, { headers: h });

      expect(status).toBe(201);
      expect(body.client_id).toBeDefined();
      expect(body.client_secret).toBeDefined();
      expect(body.name).toBe('e2e-test-client');
      expect(body.scope).toBe('platform');
      expect(body.is_active).toBe(true);

      createdClientId = body.client_id;
      createdClientRawId = body.id;
      createdClientSecret = body.client_secret;
      cleanupClientIds.push(body.id);
    });

    it('should list clients', async () => {
      const h = await authHeaders();
      const { status, body } = await httpGet<unknown[]>(`${GW}/auth/clients`, { headers: h });

      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });

    it('should obtain a token via client credentials', async () => {
      if (!createdClientId || !createdClientSecret) return;

      const { status, body } = await httpPost<{
        access_token: string;
        token_type: string;
        scope: string;
      }>(`${GW}/auth/token`, {
        grant_type: 'client_credentials',
        client_id: createdClientId,
        client_secret: createdClientSecret,
      });

      expect(status).toBe(201);
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.scope).toBe('platform');
    });

    it('should revoke a client', async () => {
      if (!createdClientRawId) return;
      const h = await authHeaders();
      const { status } = await httpDelete(`${GW}/auth/clients/${createdClientRawId}`, {
        headers: h,
      });

      expect(status).toBe(200);
      cleanupClientIds.splice(cleanupClientIds.indexOf(createdClientRawId), 1);
    });
  });

  describe('users CRUD', () => {
    it('should create a user', async () => {
      const h = await authHeaders();
      const { status, body } = await httpPost<{ id: string; email: string; role: string }>(
        `${GW}/auth/users`,
        { email: `e2e-${Date.now()}@test.io`, password: 'E2eTestPass1!', role: 'operator' },
        { headers: h },
      );

      expect(status).toBe(201);
      expect(body.id).toBeDefined();
      expect(body.role).toBe('operator');
    });

    it('should list users', async () => {
      const h = await authHeaders();
      const { status, body } = await httpGet<unknown[]>(`${GW}/auth/users`, { headers: h });

      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });
  });

  describe('public-routes CRUD', () => {
    let routeId: string;

    it('should create a public route', async () => {
      const h = await authHeaders();
      const { status, body } = await httpPost<{ id: string; method: string; path_pattern: string }>(
        `${GW}/auth/public-routes`,
        { method: 'GET', path_pattern: '/e2e-public-test', scope: 'platform' },
        { headers: h },
      );

      expect(status).toBe(201);
      expect(body.id).toBeDefined();
      routeId = body.id;
      cleanupPublicRouteIds.push(routeId);
    });

    it('should list public routes', async () => {
      const h = await authHeaders();
      const { status, body } = await httpGet<unknown[]>(`${GW}/auth/public-routes`, {
        headers: h,
      });

      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it('should delete a public route', async () => {
      if (!routeId) return;
      const h = await authHeaders();
      const { status } = await httpDelete(`${GW}/auth/public-routes/${routeId}`, {
        headers: h,
      });

      expect(status).toBe(200);
      cleanupPublicRouteIds.splice(cleanupPublicRouteIds.indexOf(routeId), 1);
    });
  });

  describe('authorization enforcement', () => {
    it('should reject requests without a token', async () => {
      const { status } = await httpGet(`${GW}/auth/users`, {
        headers: { 'x-yoizen-tenant': 'e2e-test' },
      });

      expect(status).toBe(401);
    });

    it('should reject requests with an invalid token', async () => {
      const { status } = await httpGet(`${GW}/auth/users`, {
        headers: { Authorization: 'Bearer invalid.token.here', 'x-yoizen-tenant': 'e2e-test' },
      });

      expect(status).toBe(401);
    });
  });
});
