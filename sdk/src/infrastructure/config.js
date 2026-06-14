import { ConfigError } from "../domain/errors.js";

/** Dev cluster entry point (api-gateway). Override with baseUrl / YOIZEN_BASE_URL. */
export const DEFAULT_BASE_URL = "http://api-gateway.platform-services-dev.dev.local";

/**
 * Merge user args with environment variables, validate required fields, and return a
 * frozen config. Args take precedence over env.
 *
 * @param {object} [userConfig]
 * @param {Record<string, string|undefined>} [env]
 * @returns {Readonly<object>}
 * @throws {ConfigError}
 */
export function resolveConfig(userConfig = {}, env = process.env) {
  const tenant = userConfig.tenant ?? env.YOIZEN_TENANT;
  const email = userConfig.email ?? env.YOIZEN_EMAIL;
  const password = userConfig.password ?? env.YOIZEN_PASSWORD;

  const missing = [];
  if (!tenant) missing.push("tenant");
  if (!email) missing.push("email");
  if (!password) missing.push("password");
  if (missing.length > 0) {
    throw new ConfigError(`missing required config: ${missing.join(", ")}`, {
      details: { missing },
    });
  }

  const rawBaseUrl = userConfig.baseUrl ?? env.YOIZEN_BASE_URL ?? DEFAULT_BASE_URL;
  const baseUrl = String(rawBaseUrl).replace(/\/+$/, "");

  return Object.freeze({
    tenant,
    email,
    password,
    baseUrl,
    defaultFrom: userConfig.defaultFrom ?? env.YOIZEN_DEFAULT_FROM ?? email,
    appSecret: userConfig.appSecret ?? env.YOIZEN_HTTP_CHANNEL_TOKEN ?? null,
    channelSelector: userConfig.channelSelector,
    timeoutMs: userConfig.timeoutMs ?? 10_000,
    tokenExpiryBufferMs: userConfig.tokenExpiryBufferMs ?? 60_000,
    onWarn: userConfig.onWarn,
  });
}
