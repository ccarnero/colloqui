import { httpJson } from "./http.js";
import { makeToken } from "../domain/token.js";
import { AuthError } from "../domain/errors.js";

/**
 * AuthPort implementation over the auth-service login/refresh endpoints.
 *
 * @param {{ fetchImpl: typeof fetch, baseUrl: string, timeoutMs: number, clock: import("../application/ports.js").Clock }} deps
 * @returns {import("../application/ports.js").AuthPort}
 */
export function createAuthAdapter({ fetchImpl, baseUrl, timeoutMs, clock }) {
  function toToken(body) {
    return makeToken({
      accessToken: body.access_token,
      expiresIn: body.expires_in,
      refreshToken: body.refresh_token,
      scope: body.scope,
      obtainedAt: clock.now(),
    });
  }

  async function login({ email, password, tenant }) {
    const reqBody = { email, password };
    if (tenant) reqBody.tenant_id = tenant;
    const { status, ok, body } = await httpJson(fetchImpl, {
      url: `${baseUrl}/api/auth/login`,
      method: "POST",
      body: reqBody,
      timeoutMs,
    });
    if (!ok || !body?.access_token) {
      throw new AuthError("login failed", { details: { httpStatus: status, body } });
    }
    return toToken(body);
  }

  async function refresh(refreshToken) {
    const { status, ok, body } = await httpJson(fetchImpl, {
      url: `${baseUrl}/api/auth/refresh`,
      method: "POST",
      body: { refresh_token: refreshToken },
      timeoutMs,
    });
    if (!ok || !body?.access_token) {
      throw new AuthError("refresh failed", { details: { httpStatus: status, body } });
    }
    return toToken(body);
  }

  return { login, refresh };
}
