/**
 * Access-token value object + pure expiry/scope helpers. No I/O, no clock dependency —
 * callers pass `now` so this stays deterministic and unit-testable.
 *
 * @typedef {Object} Token
 * @property {string} accessToken
 * @property {number} expiresAt        epoch ms when the access token expires
 * @property {string} [scope]          "platform" | "tenant:<id>"
 * @property {string} [refreshToken]
 * @property {number} [refreshExpiresAt] epoch ms when the refresh token expires
 */

/** Refresh tokens live 24h server-side (REFRESH_TOKEN_TTL). */
const REFRESH_TOKEN_TTL_MS = 86_400 * 1000;

const SCOPE_TENANT_RE = /^tenant:([a-z0-9]([a-z0-9-]*[a-z0-9])?)$/;

/**
 * @param {{ accessToken: string, expiresIn: number, refreshToken?: string, scope?: string, obtainedAt: number }} p
 * @returns {Token}
 */
export function makeToken({ accessToken, expiresIn, refreshToken, scope, obtainedAt }) {
  /** @type {Token} */
  const token = {
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
 * @param {Token | null | undefined} token
 * @param {number} now epoch ms
 * @param {number} [bufferMs=0] refresh this many ms early
 * @returns {boolean}
 */
export function isExpired(token, now, bufferMs = 0) {
  if (!token || typeof token.expiresAt !== "number") return true;
  return now >= token.expiresAt - bufferMs;
}

/**
 * Can we still use the refresh token instead of a full re-login?
 * @param {Token | null | undefined} token
 * @param {number} now epoch ms
 * @returns {boolean}
 */
export function canRefresh(token, now) {
  return Boolean(
    token &&
      token.refreshToken &&
      (typeof token.refreshExpiresAt !== "number" || now < token.refreshExpiresAt),
  );
}

/**
 * Extract the tenant id from a token scope ("tenant:acme" -> "acme").
 * @param {string | undefined} scope
 * @returns {string | null}
 */
export function tenantFromScope(scope) {
  if (typeof scope !== "string") return null;
  const m = SCOPE_TENANT_RE.exec(scope);
  return m ? m[1] : null;
}
