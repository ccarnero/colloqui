import {
  buildGatewayHeaders,
  getRuntimeConfig,
  resolveGatewayApiUrl,
} from "./env.js";

const CREDENTIAL_MODE = {
  ADMIN: "admin",
  CLIENT: "client",
} as const;

type CredentialMode = (typeof CREDENTIAL_MODE)[keyof typeof CREDENTIAL_MODE];

interface AuthContext {
  tenant: string;
  token: string;
}

interface TenantResponse {
  name: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

const authContextCache = new Map<string, Promise<AuthContext>>();
const tokenCache = new Map<CredentialMode, Promise<TokenResponse>>();

async function parseJsonSafely<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

async function requestJson<T>(
  url: string,
  init?: RequestInit
): Promise<{ body: T; status: number }> {
  const response = await fetch(url, init);
  const body = await parseJsonSafely<T>(response);
  return { body, status: response.status };
}

function getCredentialMode(): CredentialMode {
  const hasAdmin = Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD);
  const hasClient = Boolean(
    process.env.E2E_CLIENT_ID && process.env.E2E_CLIENT_SECRET
  );

  if (hasAdmin) {
    return CREDENTIAL_MODE.ADMIN;
  }

  if (hasClient) {
    return CREDENTIAL_MODE.CLIENT;
  }

  throw new Error(
    "Missing credentials: set ADMIN_EMAIL/ADMIN_PASSWORD or E2E_CLIENT_ID/E2E_CLIENT_SECRET."
  );
}

async function loginWithAdmin(): Promise<TokenResponse> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required.");
  }

  const { body, status } = await requestJson<TokenResponse>(
    resolveGatewayApiUrl("/auth/login"),
    {
      body: JSON.stringify({ email, password }),
      headers: buildGatewayHeaders({
        "Content-Type": "application/json",
      }),
      method: "POST",
    }
  );

  if (status < 200 || status >= 300) {
    throw new Error(`Admin auth failed (${status}).`);
  }

  return body;
}

async function loginWithClient(): Promise<TokenResponse> {
  const clientId = process.env.E2E_CLIENT_ID;
  const clientSecret = process.env.E2E_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("E2E_CLIENT_ID and E2E_CLIENT_SECRET are required.");
  }

  const { body, status } = await requestJson<TokenResponse>(
    resolveGatewayApiUrl("/auth/token"),
    {
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
      headers: buildGatewayHeaders({
        "Content-Type": "application/json",
      }),
      method: "POST",
    }
  );

  if (status < 200 || status >= 300) {
    throw new Error(`Client credentials auth failed (${status}).`);
  }

  return body;
}

async function getToken(): Promise<TokenResponse> {
  const mode = getCredentialMode();
  const cached = tokenCache.get(mode);
  if (cached) {
    return cached;
  }

  const tokenPromise =
    mode === CREDENTIAL_MODE.ADMIN ? loginWithAdmin() : loginWithClient();
  tokenCache.set(mode, tokenPromise);
  return tokenPromise;
}

async function ensureTenant(token: string, tenant: string): Promise<void> {
  const authHeaders = buildGatewayHeaders({
    Authorization: `Bearer ${token}`,
  });

  const tenantUrl = resolveGatewayApiUrl(`/tenants/${encodeURIComponent(tenant)}`);
  const existing = await requestJson<TenantResponse>(tenantUrl, {
    headers: authHeaders,
    method: "GET",
  });

  if (existing.status === 200) {
    return;
  }

  const createResult = await requestJson<TenantResponse>(
    resolveGatewayApiUrl("/tenants"),
    {
      body: JSON.stringify({ name: tenant }),
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  );

  if (createResult.status !== 201) {
    throw new Error(`Failed to create tenant '${tenant}' (${createResult.status}).`);
  }
}

async function buildAuthContext(): Promise<AuthContext> {
  const runtime = getRuntimeConfig();
  const tokenResponse = await getToken();
  await ensureTenant(tokenResponse.access_token, runtime.tenant);
  return {
    tenant: runtime.tenant,
    token: tokenResponse.access_token,
  };
}

export async function getAuthContext(): Promise<AuthContext> {
  const tenant = getRuntimeConfig().tenant;
  const cached = authContextCache.get(tenant);
  if (cached) {
    return cached;
  }

  const contextPromise = buildAuthContext().catch((error: unknown) => {
    authContextCache.delete(tenant);
    tokenCache.clear();
    throw error;
  });

  authContextCache.set(tenant, contextPromise);
  return contextPromise;
}
