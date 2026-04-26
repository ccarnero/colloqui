import { getBaseUrl, httpPost, httpGet, poll } from './helpers';

const GW = getBaseUrl('api-gateway');

const E2E_TENANT = process.env.E2E_TENANT ?? 'acme';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

let cachedToken: string | null = null;
let cachedRefreshToken: string | null = null;
let tenantReady: Promise<void> | null = null;

async function loginWithAdmin(): Promise<TokenResponse> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('ADMIN_EMAIL / ADMIN_PASSWORD not set');

  const { status, body } = await httpPost<TokenResponse>(`${GW}/auth/login`, {
    email,
    password,
  });
  if (status < 200 || status >= 300) {
    throw new Error(`Admin login failed (${status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function loginWithClient(): Promise<TokenResponse> {
  const clientId = process.env.E2E_CLIENT_ID;
  const clientSecret = process.env.E2E_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('E2E_CLIENT_ID / E2E_CLIENT_SECRET not set');

  const { status, body } = await httpPost<TokenResponse>(`${GW}/auth/token`, {
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (status < 200 || status >= 300) {
    throw new Error(`Client credentials failed (${status}): ${JSON.stringify(body)}`);
  }
  return body;
}

export async function getAuthToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  let tokenRes: TokenResponse;

  const hasAdmin = process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD;
  const hasClient = process.env.E2E_CLIENT_ID && process.env.E2E_CLIENT_SECRET;

  if (hasAdmin) {
    tokenRes = await loginWithAdmin();
  } else if (hasClient) {
    tokenRes = await loginWithClient();
  } else {
    throw new Error(
      'No credentials available. Set ADMIN_EMAIL + ADMIN_PASSWORD or E2E_CLIENT_ID + E2E_CLIENT_SECRET.',
    );
  }

  cachedToken = tokenRes.access_token;
  if (tokenRes.refresh_token) cachedRefreshToken = tokenRes.refresh_token;
  return cachedToken;
}

export function getCachedRefreshToken(): string | null {
  return cachedRefreshToken;
}

export function getTenant(): string {
  return E2E_TENANT;
}

interface ITenantDetailResponse {
  name: string;
  provisioningStatus: 'pending' | 'provisioning' | 'ready' | 'failed';
  provisioningError?: string | null;
}

/**
 * Provisions the E2E tenant if it doesn't exist and waits until BOTH its
 * per-tenant `postgres` and `postgres-usage` StatefulSets are Ready.
 *
 * `tenant-service` flips `provisioningStatus` to `'ready'` only after
 * `TenantProvisioningExecutor.run()` awaits `waitForReady` for both DBs,
 * so polling that single field covers both backends in O(1) per poll.
 *
 * Uses GET-then-POST as an idempotent check before creation.
 */
async function ensureTenantProvisioned(): Promise<void> {
  const token = await getAuthToken();
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };

  const existing = await httpGet<ITenantDetailResponse>(
    `${GW}/tenants/${encodeURIComponent(E2E_TENANT)}`,
    { headers: h },
  );

  if (existing.status !== 200) {
    const { status } = await httpPost(
      `${GW}/tenants`,
      { name: E2E_TENANT },
      { headers: h },
    );
    // tenant-service returns 202 Accepted for async provisioning;
    // tolerate 201 for backwards compat with older builds.
    if (status !== 201 && status !== 202) {
      throw new Error(
        `Failed to provision E2E tenant '${E2E_TENANT}' (${status})`,
      );
    }
  }

  await poll<ITenantDetailResponse>(
    async () => {
      const res = await httpGet<ITenantDetailResponse>(
        `${GW}/tenants/${encodeURIComponent(E2E_TENANT)}`,
        { headers: h },
      );
      if (res.status !== 200) return null;
      const status = res.body.provisioningStatus;
      if (status === 'failed') {
        throw new Error(
          `Tenant '${E2E_TENANT}' provisioning failed: ${res.body.provisioningError ?? 'unknown'}`,
        );
      }
      if (status === 'ready') return res.body;
      return null;
    },
    { timeoutMs: 180_000, initialDelayMs: 2_000, maxDelayMs: 5_000 },
  );
}

function ensureTenant(): Promise<void> {
  if (!tenantReady) {
    tenantReady = ensureTenantProvisioned().catch((err) => {
      tenantReady = null;
      throw err;
    });
  }
  return tenantReady;
}

export async function authHeaders(tenant?: string): Promise<Record<string, string>> {
  const token = await getAuthToken();
  const t = tenant ?? E2E_TENANT;
  if (t === E2E_TENANT) await ensureTenant();
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (t) h['x-yoizen-tenant'] = t;
  return h;
}
