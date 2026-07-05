import type { AuthPort, Clock } from "../application/ports.js";
import type { Transport } from "../core/transport.js";
import { AuthError, SdkError } from "../domain/errors.js";
import { makeToken } from "../domain/token.js";

export interface AuthAdapterDeps {
  transport: Transport;
  clock: Clock;
}

interface LoginResponseBody {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * AuthPort implementation over the auth-service login/refresh endpoints, via
 * the shared {@link Transport}. Login/refresh happen pre-token, so every
 * call is made with `auth: false` — this is the transport's unauthenticated
 * path.
 */
export function createAuthAdapter({
  transport,
  clock,
}: AuthAdapterDeps): AuthPort {
  function toToken(body: LoginResponseBody) {
    return makeToken({
      accessToken: body.access_token as string,
      expiresIn: body.expires_in as number,
      refreshToken: body.refresh_token,
      scope: body.scope,
      obtainedAt: clock.now(),
    });
  }

  async function login({
    email,
    password,
    tenant,
  }: {
    email: string;
    password: string;
    tenant?: string;
  }) {
    const reqBody: Record<string, unknown> = { email, password };
    if (tenant) {
      reqBody.tenant_id = tenant;
    }

    let body: LoginResponseBody | undefined;
    try {
      const result = await transport.request<LoginResponseBody>({
        path: "/auth/login",
        method: "POST",
        body: reqBody,
        auth: false,
      });
      body = result.body;
    } catch (err) {
      throw toAuthError(err);
    }

    if (!body?.access_token) {
      throw new AuthError("login failed", { details: { body } });
    }
    return toToken(body);
  }

  async function refresh(refreshToken: string) {
    let body: LoginResponseBody | undefined;
    try {
      const result = await transport.request<LoginResponseBody>({
        path: "/auth/refresh",
        method: "POST",
        body: { refresh_token: refreshToken },
        auth: false,
      });
      body = result.body;
    } catch (err) {
      throw toAuthError(err);
    }

    if (!body?.access_token) {
      throw new AuthError("refresh failed", { details: { body } });
    }
    return toToken(body);
  }

  return { login, refresh };
}

/** Any transport failure on login/refresh surfaces as `AuthError` (preserving the pre-transport contract). */
function toAuthError(err: unknown): AuthError {
  if (err instanceof AuthError) {
    return err;
  }
  if (err instanceof SdkError) {
    return new AuthError(err.message, { cause: err, details: err.details });
  }
  return new AuthError("login failed", { cause: err });
}
