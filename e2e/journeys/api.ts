import type { APIRequestContext } from "@playwright/test";
import { env, TENANT_HEADER } from "./env";

// The API side of every journey: a bearer token for the demo user and a request helper that always sends the
// tenant header. Journeys assert on status codes and ids; they never parse HTML.
export type Session = { token: string; tenant: string };

export const login = async (request: APIRequestContext, tenant = env.tenant): Promise<Session> => {
  const res = await request.post(`${env.apiUrl}/api/auth/login`, {
    headers: { [TENANT_HEADER]: tenant },
    data: { email: env.email, password: env.password, tenant_id: tenant },
  });
  if (!res.ok()) throw new Error(`login failed: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as Record<string, unknown>;
  const token = (body.accessToken ?? body.access_token ?? body.token) as string | undefined;
  if (!token) throw new Error(`login returned no token: ${JSON.stringify(body).slice(0, 200)}`);
  return { token, tenant };
};

export const headers = (s: Session | null, tenant = s?.tenant ?? env.tenant): Record<string, string> => ({
  [TENANT_HEADER]: tenant,
  ...(s ? { authorization: `Bearer ${s.token}` } : {}),
});

export const api = (request: APIRequestContext, s: Session | null) => ({
  get: (path: string, tenant?: string) => request.get(`${env.apiUrl}/api${path}`, { headers: headers(s, tenant) }),
  post: (path: string, data: unknown, tenant?: string) => request.post(`${env.apiUrl}/api${path}`, { headers: headers(s, tenant), data }),
  patch: (path: string, data: unknown) => request.patch(`${env.apiUrl}/api${path}`, { headers: headers(s), data }),
  delete: (path: string) => request.delete(`${env.apiUrl}/api${path}`, { headers: headers(s) }),
});
