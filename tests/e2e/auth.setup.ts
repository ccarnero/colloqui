import { getBaseUrl, httpPost, httpGet, httpDelete, poll } from './helpers';

const GW = getBaseUrl('api-gateway');

/**
 * Valid tenant database tiers (mirrored from `@yoizen/shared`'s
 * `TenantDatabaseTier`). Inlined to keep this file dependency-free for
 * the e2e harness (which has no `@yoizen/shared` import).
 */
const TENANT_TIERS = new Set<string>(['shared', 'dedicated']);
type TenantTier = 'shared' | 'dedicated';

const E2E_TENANT = process.env.E2E_TENANT ?? 'acme-'+Date.now().toString(12);

function readTier(): TenantTier {
  const raw = (process.env.E2E_TENANT_TIER ?? 'shared').toLowerCase();
  if (!TENANT_TIERS.has(raw)) {
    throw new Error(
      `Invalid E2E_TENANT_TIER='${raw}' (must be one of: ${Array.from(TENANT_TIERS).join(', ')})`,
    );
  }
  return raw as TenantTier;
}

const E2E_TENANT_TIER: TenantTier = readTier();

/**
 * Per-tier provisioning budgets (ms).
 *  • `shared` — tenant-service only runs INIT_SQL against the shared
 *    CNPG cluster + creates a per-tenant role/database. ~5-15s.
 *  • `dedicated` — provisions a fresh CNPG `Cluster` (3 instances) +
 *    `Pooler` + bootstrap. End-to-end takes ~120-180s on minikube,
 *    longer on cold image-pull. 300s leaves comfortable margin.
 */
const PROVISION_TIMEOUT_MS_BY_TIER: Record<TenantTier, number> = {
  shared: 180_000,
  dedicated: 300_000,
};

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

export function getTenantTier(): TenantTier {
  return E2E_TENANT_TIER;
}

interface ITenantDetailResponse {
  name: string;
  tier?: TenantTier;
  provisioningStatus: 'pending' | 'provisioning' | 'ready' | 'failed';
  provisioningError?: string | null;
}

async function createTenant(token: string): Promise<void> {
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  const { status, body } = await httpPost<{ message?: string }>(
    `${GW}/tenants`,
    { name: E2E_TENANT, tier: E2E_TENANT_TIER },
    { headers: h },
  );
  // tenant-service returns 202 Accepted for async provisioning;
  // tolerate 201 for backwards compat with older builds.
  if (status !== 201 && status !== 202) {
    throw new Error(
      `Failed to provision E2E tenant '${E2E_TENANT}' (tier=${E2E_TENANT_TIER}, status=${status}): ${JSON.stringify(body)}`,
    );
  }
}

async function deleteFailedTenant(token: string): Promise<void> {
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  const { status } = await httpDelete(
    `${GW}/tenants/${encodeURIComponent(E2E_TENANT)}`,
    { headers: h },
  );
  if (status !== 200 && status !== 202 && status !== 204 && status !== 404) {
    throw new Error(
      `Failed to delete failed E2E tenant '${E2E_TENANT}' (${status})`,
    );
  }

  await poll(
    async () => {
      const res = await httpGet<ITenantDetailResponse>(
        `${GW}/tenants/${encodeURIComponent(E2E_TENANT)}`,
        { headers: h },
      );
      return res.status === 404 ? true : null;
    },
    { timeoutMs: 60_000, initialDelayMs: 500, maxDelayMs: 2_000 },
  );
}

/**
 * Provisions the E2E tenant if it doesn't exist and waits until BOTH its
 * per-tenant `postgres` and `postgres-usage` StatefulSets are Ready.
 *
 * `tenant-service` flips `provisioningStatus` to `'ready'` only after
 * `TenantProvisioningExecutor.run()` awaits `waitForReady` for both DBs,
 * so polling that single field covers both backends in O(1) per poll.
 *
 * Uses GET-then-POST as an idempotent check before creation. If the
 * existing tenant has a different tier than the requested one, it is
 * deleted first so the run always exercises the requested tier.
 */
async function ensureTenantProvisioned(): Promise<void> {
  const token = await getAuthToken();
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };

  const existing = await httpGet<ITenantDetailResponse>(
    `${GW}/tenants/${encodeURIComponent(E2E_TENANT)}`,
    { headers: h },
  );

  if (existing.status === 200 && existing.body.provisioningStatus === 'failed') {
    await deleteFailedTenant(token);
    await createTenant(token);
  } else if (
    existing.status === 200 &&
    existing.body.tier !== undefined &&
    existing.body.tier !== E2E_TENANT_TIER
  ) {
    // Tenant exists but with a different tier than requested. Re-provision
    // so the suite actually exercises the targeted backend.
    await deleteFailedTenant(token);
    await createTenant(token);
  } else if (existing.status !== 200) {
    await createTenant(token);
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
    {
      timeoutMs: PROVISION_TIMEOUT_MS_BY_TIER[E2E_TENANT_TIER],
      initialDelayMs: 2_000,
      maxDelayMs: 5_000,
    },
  );
}

/**
 * Deletes the E2E tenant. Idempotent: a 404 is treated as success.
 *
 * Used by `zz-cleanup.e2e.spec.ts` to keep dev clusters clean across
 * runs. For shared tier, drops the per-tenant database + role on the
 * shared CNPG cluster. For dedicated tier, tears down the entire
 * `Cluster` CR + Pooler + bootstrap secrets.
 */
export async function destroyTenant(): Promise<void> {
  const token = await getAuthToken();
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  const { status } = await httpDelete(
    `${GW}/tenants/${encodeURIComponent(E2E_TENANT)}`,
    { headers: h },
  );
  if (status !== 200 && status !== 202 && status !== 204 && status !== 404) {
    throw new Error(
      `Failed to delete E2E tenant '${E2E_TENANT}' (${status})`,
    );
  }
  // Wait for tenant-service to confirm the tenant is gone (terminating
  // → 404). Dedicated tier needs longer because CNPG must drain the
  // Cluster CR; shared just drops the database.
  await poll(
    async () => {
      const res = await httpGet<ITenantDetailResponse>(
        `${GW}/tenants/${encodeURIComponent(E2E_TENANT)}`,
        { headers: h },
      );
      return res.status === 404 ? true : null;
    },
    {
      timeoutMs: E2E_TENANT_TIER === 'dedicated' ? 120_000 : 60_000,
      initialDelayMs: 500,
      maxDelayMs: 2_000,
    },
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
