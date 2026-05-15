/**
 * JWT acquisition for k6 scenarios.
 *
 * Performed once at `setup()`. The resulting token + tenant are passed as
 * `setup data` to every VU iteration so we don't pay an auth round-trip per
 * iteration (auth itself isn't what we're stress-testing).
 */

import { fail } from "k6";
import http from "k6/http";

import {
  buildGatewayHeaders,
  getRuntimeConfig,
  resolveGatewayApiUrl,
} from "./env.ts";

export interface AuthContext {
  readonly tenant: string;
  readonly token: string;
}

interface TokenResponse {
  readonly access_token?: string;
  readonly token_type?: string;
}

interface TenantResponse {
  readonly name?: string;
}

interface EnvBag {
  readonly [key: string]: string | undefined;
}

function readEnv(): EnvBag {
  return (
    (globalThis as { __ENV?: Record<string, string | undefined> }).__ENV ?? {}
  );
}

function postJson<T>(
  url: string,
  body: unknown,
  extraHeaders?: Readonly<Record<string, string>>
): { status: number; body: T | null } {
  const response = http.post(url, JSON.stringify(body), {
    headers: buildGatewayHeaders(extraHeaders),
    tags: { phase: "auth" },
    timeout: "30s",
  });

  let parsed: T | null = null;
  if (response.body) {
    try {
      const text =
        typeof response.body === "string"
          ? response.body
          : new TextDecoder().decode(response.body as ArrayBuffer);
      parsed = text ? (JSON.parse(text) as T) : null;
    } catch {
      parsed = null;
    }
  }

  return { body: parsed, status: response.status };
}

function loginAsAdmin(env: EnvBag): TokenResponse {
  const email = env.ADMIN_EMAIL;
  const password = env.ADMIN_PASSWORD;
  if (!email || !password) {
    fail("ADMIN_EMAIL and ADMIN_PASSWORD are required for admin login.");
  }

  const url = resolveGatewayApiUrl("/auth/login");
  const result = postJson<TokenResponse>(url, { email, password });
  if (result.status < 200 || result.status >= 300 || !result.body) {
    fail(`Admin auth failed (status=${result.status}).`);
  }
  return result.body;
}

function loginAsClient(env: EnvBag): TokenResponse {
  const clientId = env.E2E_CLIENT_ID;
  const clientSecret = env.E2E_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    fail("E2E_CLIENT_ID and E2E_CLIENT_SECRET are required for client login.");
  }

  const url = resolveGatewayApiUrl("/auth/token");
  const result = postJson<TokenResponse>(url, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });
  if (result.status < 200 || result.status >= 300 || !result.body) {
    fail(`Client credentials auth failed (status=${result.status}).`);
  }
  return result.body;
}

function ensureTenant(token: string, tenant: string): void {
  const headers = buildGatewayHeaders({
    Authorization: `Bearer ${token}`,
  });

  const lookupUrl = resolveGatewayApiUrl(
    `/tenants/${encodeURIComponent(tenant)}`
  );
  const lookup = http.get(lookupUrl, {
    headers,
    tags: { phase: "auth" },
    timeout: "15s",
  });
  if (lookup.status === 200) {
    return;
  }

  const created = postJson<TenantResponse>(
    resolveGatewayApiUrl("/tenants"),
    { name: tenant },
    { Authorization: `Bearer ${token}` }
  );
  if (created.status !== 201 && created.status !== 200) {
    fail(`Failed to create tenant '${tenant}' (status=${created.status}).`);
  }
}

export function buildAuthContext(): AuthContext {
  const env = readEnv();
  const runtime = getRuntimeConfig();

  const skipAuth = env.STRESS_SKIP_AUTH === "true";
  if (skipAuth) {
    return Object.freeze({
      tenant: runtime.tenant,
      token: env.STRESS_STATIC_JWT ?? "",
    });
  }

  const token =
    env.ADMIN_EMAIL && env.ADMIN_PASSWORD
      ? loginAsAdmin(env)
      : loginAsClient(env);

  const accessToken = token.access_token;
  if (!accessToken) {
    fail("Auth response did not include access_token.");
  }

  ensureTenant(accessToken, runtime.tenant);

  return Object.freeze({
    tenant: runtime.tenant,
    token: accessToken,
  });
}
