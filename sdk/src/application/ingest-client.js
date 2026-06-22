import { normalizeMessage } from "../domain/message.js";
import { isExpired, canRefresh, tenantFromScope } from "../domain/token.js";
import { ValidationError, IngestError, AuthError } from "../domain/errors.js";

const DEFAULT_BUFFER_MS = 60_000;

/**
 * The use-case orchestrator. Owns the lazy token + appSecret lifecycle and exposes the
 * `send` / `sendText` primitives. Pure application logic — it talks only to injected
 * ports, never to fetch/env/Date directly.
 *
 * @param {{
 *   ports: { auth: import("./ports.js").AuthPort, channelDirectory: import("./ports.js").ChannelDirectoryPort, ingest: import("./ports.js").IngestPort },
 *   config: { tenant: string, email: string, password: string, defaultFrom?: string, appSecret?: string|null, channelSelector?: object, instance?: string|null, tokenExpiryBufferMs?: number, onWarn?: (msg: string) => void },
 *   clock: import("./ports.js").Clock,
 * }} deps
 */
export function createIngestClient({ ports, config, clock }) {
  const { auth, channelDirectory, ingest } = ports;
  const tenant = config.tenant;
  const bufferMs = config.tokenExpiryBufferMs ?? DEFAULT_BUFFER_MS;
  const defaultFrom = config.defaultFrom ?? config.email;

  /** @type {import("../domain/token.js").Token | null} */
  let token = null;
  /** @type {Promise<import("../domain/token.js").Token> | null} */
  let tokenPromise = null;
  /** @type {string | null} */
  let appSecret = config.appSecret ?? null;
  /** @type {Promise<string> | null} */
  let secretPromise = null;
  /**
   * Account externalId for the per-instance ingress URL. Seeded from explicit
   * config / channelSelector; otherwise filled from the directory resolution.
   * @type {string | null}
   */
  let instance =
    config.instance ?? config.channelSelector?.externalId ?? null;

  function login() {
    return auth.login({ email: config.email, password: config.password, tenant });
  }

  async function fetchToken() {
    if (canRefresh(token, clock.now())) {
      try {
        return await auth.refresh(/** @type {string} */ (token.refreshToken));
      } catch (err) {
        if (!(err instanceof AuthError)) throw err;
        // refresh rejected -> fall through to a full login
      }
    }
    return login();
  }

  function checkTenantScope(t) {
    const scoped = tenantFromScope(t.scope);
    if (scoped && scoped !== tenant && typeof config.onWarn === "function") {
      config.onWarn(
        `token scope tenant "${scoped}" differs from configured tenant "${tenant}"`,
      );
    }
  }

  function ensureToken() {
    if (token && !isExpired(token, clock.now(), bufferMs)) return Promise.resolve(token);
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

  function ensureSecret() {
    if (appSecret) return Promise.resolve(appSecret);
    if (!secretPromise) {
      secretPromise = ensureToken()
        .then((t) =>
          channelDirectory.resolveHttpSecret({
            token: t.accessToken,
            tenant,
            selector: config.channelSelector,
          }),
        )
        .then(({ appSecret: resolved, externalId }) => {
          appSecret = resolved;
          if (!instance && typeof externalId === "string" && externalId.length > 0) {
            instance = externalId;
          }
          return resolved;
        })
        .finally(() => {
          secretPromise = null;
        });
    }
    return secretPromise;
  }

  function invalidateSecret() {
    // Only drop secrets we resolved ourselves; keep an explicitly-configured one.
    if (!config.appSecret) appSecret = null;
  }

  async function ingestOnce(body) {
    await ensureToken();
    const secret = await ensureSecret();
    return ingest.ingest({ tenant, appSecret: secret, body, instance });
  }

  /**
   * @param {Record<string, unknown>} [message]
   * @returns {Promise<{ status: string, tenant: string, accountId?: string, messageId?: string }>}
   */
  async function send(message = {}) {
    const from = message.from ?? defaultFrom;
    const body = normalizeMessage({ ...message, from });

    let result;
    try {
      result = await ingestOnce(body);
    } catch (err) {
      const isMismatch =
        err instanceof IngestError && err.ingestStatus === "signature_mismatch";
      if (isMismatch && !config.appSecret) {
        invalidateSecret();
        result = await ingestOnce(body); // one retry with a freshly-resolved secret
      } else {
        throw err;
      }
    }

    return {
      status: result.status,
      tenant,
      accountId: result.accountId,
      messageId: result.messageId,
    };
  }

  /**
   * @param {string} text
   * @param {{ from?: string, type?: string, raw?: object }} [opts]
   */
  function sendText(text, opts = {}) {
    if (typeof text !== "string" || text.trim().length === 0) {
      return Promise.reject(new ValidationError("`text` must be a non-empty string"));
    }
    return send({ from: opts.from, text, type: opts.type, raw: opts.raw });
  }

  return { send, sendText };
}
