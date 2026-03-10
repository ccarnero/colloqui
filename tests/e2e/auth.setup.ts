import { getBaseUrl, httpPost } from './helpers';

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

export async function authHeaders(tenant?: string): Promise<Record<string, string>> {
  const token = await getAuthToken();
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  const t = tenant ?? E2E_TENANT;
  if (t) h['x-yoizen-tenant'] = t;
  return h;
}
