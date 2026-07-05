import type { AuthPort, Clock } from "../application/ports.js";
import { AuthError } from "../domain/errors.js";
import type { Token } from "../domain/token.js";
import { canRefresh, isExpired, tenantFromScope } from "../domain/token.js";

const DEFAULT_BUFFER_MS = 60_000;

export interface SessionConfig {
  tenant: string;
  email: string;
  password: string;
  /** Refresh this many ms before the access token's real expiry. Default 60s. */
  tokenExpiryBufferMs?: number;
  /** Called when the token's scoped tenant differs from the configured tenant. */
  onWarn?: (msg: string) => void;
}

export interface SessionDeps {
  auth: AuthPort;
  clock: Clock;
  config: SessionConfig;
}

export interface Session {
  /**
   * Returns a valid access token, transparently logging in, refreshing, or
   * falling back to a full login when a refresh is rejected. Concurrent
   * callers share a single in-flight request.
   */
  ensureToken(): Promise<Token>;
  /** Last known token, if any (may be expired) — does not trigger network I/O. */
  getToken(): Token | null;
}

/**
 * Reusable token-lifecycle component: login, refresh with an early-refresh
 * buffer, relogin fallback when refresh is rejected, and a tenant-scope
 * mismatch warning. Extracted from the original `ingest-client` so any
 * future resource client can share the same session instead of hand-rolling
 * token bookkeeping.
 */
export function createSession({ auth, clock, config }: SessionDeps): Session {
  const { tenant } = config;
  const bufferMs = config.tokenExpiryBufferMs ?? DEFAULT_BUFFER_MS;

  let token: Token | null = null;
  let tokenPromise: Promise<Token> | null = null;

  function login(): Promise<Token> {
    return auth.login({
      email: config.email,
      password: config.password,
      tenant,
    });
  }

  async function fetchToken(): Promise<Token> {
    if (canRefresh(token, clock.now())) {
      try {
        return await auth.refresh(token!.refreshToken as string);
      } catch (err) {
        if (!(err instanceof AuthError)) {
          throw err;
        }
        // refresh rejected -> fall through to a full login
      }
    }
    return login();
  }

  function checkTenantScope(t: Token): void {
    const scoped = tenantFromScope(t.scope);
    if (scoped && scoped !== tenant && typeof config.onWarn === "function") {
      config.onWarn(
        `token scope tenant "${scoped}" differs from configured tenant "${tenant}"`
      );
    }
  }

  function ensureToken(): Promise<Token> {
    if (token && !isExpired(token, clock.now(), bufferMs)) {
      return Promise.resolve(token);
    }
    if (!tokenPromise) {
      tokenPromise = fetchToken()
        .then((t) => {
          token = t;
          checkTenantScope(t);
          return t;
        })
        .finally(() => {
          tokenPromise = null;
        });
    }
    return tokenPromise;
  }

  function getToken(): Token | null {
    return token;
  }

  return { ensureToken, getToken };
}
