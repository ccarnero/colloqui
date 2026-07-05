/**
 * Access-token value object + pure expiry/scope helpers. No I/O, no clock dependency —
 * callers pass `now` so this stays deterministic and unit-testable.
 */

export interface Token {
  accessToken: string;
  /** epoch ms when the access token expires */
  expiresAt: number;
  /** "platform" | "tenant:<id>" */
  scope?: string;
  refreshToken?: string;
  /** epoch ms when the refresh token expires */
  refreshExpiresAt?: number;
}

/** Refresh tokens live 24h server-side (REFRESH_TOKEN_TTL). */
const REFRESH_TOKEN_TTL_MS = 86_400 * 1000;

const SCOPE_TENANT_RE = /^tenant:([a-z0-9]([a-z0-9-]*[a-z0-9])?)$/;

export interface MakeTokenArgs {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  scope?: string;
  obtainedAt: number;
}

export function makeToken({
  accessToken,
  expiresIn,
  refreshToken,
  scope,
  obtainedAt,
}: MakeTokenArgs): Token {
  const token: Token = {
    accessToken,
    expiresAt: obtainedAt + expiresIn * 1000,
    scope,
  };
  if (refreshToken) {
    token.refreshToken = refreshToken;
    token.refreshExpiresAt = obtainedAt + REFRESH_TOKEN_TTL_MS;
  }
  return token;
}

/**
 * @param now epoch ms
 * @param bufferMs refresh this many ms early
 */
export function isExpired(
  token: Token | null | undefined,
  now: number,
  bufferMs = 0
): boolean {
  if (!token || typeof token.expiresAt !== "number") {
    return true;
  }
  return now >= token.expiresAt - bufferMs;
}

/**
 * Can we still use the refresh token instead of a full re-login?
 * @param now epoch ms
 */
export function canRefresh(
  token: Token | null | undefined,
  now: number
): boolean {
  return Boolean(
    token &&
      token.refreshToken &&
      (typeof token.refreshExpiresAt !== "number" ||
        now < token.refreshExpiresAt)
  );
}

/**
 * Extract the tenant id from a token scope ("tenant:acme" -> "acme").
 */
export function tenantFromScope(scope: string | undefined): string | null {
  if (typeof scope !== "string") {
    return null;
  }
  const m = SCOPE_TENANT_RE.exec(scope);
  return m ? m[1] : null;
}
