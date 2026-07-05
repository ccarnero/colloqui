import type { RetryConfig } from "../core/retry.js";
import type { ApiVersion } from "../core/transport.js";
import { ConfigError } from "../domain/errors.js";

/** Dev cluster entry point (api-gateway). Override with baseUrl / YOIZEN_BASE_URL. */
export const DEFAULT_BASE_URL =
  "http://api-gateway.platform-services-dev.dev.local";

export interface UserConfig {
  tenant?: string;
  email?: string;
  password?: string;
  baseUrl?: string;
  defaultFrom?: string;
  appSecret?: string | null;
  channelSelector?: { name?: string; externalId?: string };
  instance?: string | null;
  timeoutMs?: number;
  tokenExpiryBufferMs?: number;
  onWarn?: (msg: string) => void;
  fetch?: typeof fetch;
  clock?: { now(): number };
  /**
   * Path-prefix version selector. Defaults to `"v1"`, targeting the
   * versioned `/api/v1/...` edge the gateway serves live in every route
   * family (auth, webhooks, and every admin/resource route) — verified via
   * live probe on 2026-07-05. Pass `null` to target the deprecated
   * unversioned `/api/...` alias instead.
   */
  apiVersion?: ApiVersion;
  /** Client-level retry default (see `src/core/retry.ts`); per-call options override this. */
  retry?: RetryConfig | false;
}

export interface ResolvedConfig {
  tenant: string;
  email: string;
  password: string;
  baseUrl: string;
  defaultFrom: string;
  appSecret: string | null;
  channelSelector?: { name?: string; externalId?: string };
  instance: string | null;
  timeoutMs: number;
  tokenExpiryBufferMs: number;
  onWarn?: (msg: string) => void;
  apiVersion: ApiVersion;
  retry?: RetryConfig | false;
}

/**
 * Merge user args with environment variables, validate required fields, and return a
 * frozen config. Args take precedence over env.
 *
 * @throws {ConfigError}
 */
export function resolveConfig(
  userConfig: UserConfig = {},
  env: Record<string, string | undefined> = process.env
): Readonly<ResolvedConfig> {
  const tenant = userConfig.tenant ?? env.YOIZEN_TENANT;
  const email = userConfig.email ?? env.YOIZEN_EMAIL;
  const password = userConfig.password ?? env.YOIZEN_PASSWORD;

  const missing: string[] = [];
  if (!tenant) {
    missing.push("tenant");
  }
  if (!email) {
    missing.push("email");
  }
  if (!password) {
    missing.push("password");
  }
  if (missing.length > 0) {
    throw new ConfigError(`missing required config: ${missing.join(", ")}`, {
      details: { missing },
    });
  }

  const rawBaseUrl =
    userConfig.baseUrl ?? env.YOIZEN_BASE_URL ?? DEFAULT_BASE_URL;
  const baseUrl = String(rawBaseUrl).replace(/\/+$/, "");

  return Object.freeze({
    tenant: tenant as string,
    email: email as string,
    password: password as string,
    baseUrl,
    defaultFrom:
      userConfig.defaultFrom ?? env.YOIZEN_DEFAULT_FROM ?? (email as string),
    appSecret: userConfig.appSecret ?? env.YOIZEN_HTTP_CHANNEL_TOKEN ?? null,
    channelSelector: userConfig.channelSelector,
    /**
     * Account `externalId` to address as a per-instance ingress URL
     * (`/api/webhooks/http/<tenant>/<instance>`). Explicit override; when
     * absent the SDK falls back to `channelSelector.externalId` and, failing
     * that, to the `externalId` returned while resolving the appSecret.
     */
    instance: userConfig.instance ?? env.YOIZEN_HTTP_CHANNEL_INSTANCE ?? null,
    timeoutMs: userConfig.timeoutMs ?? 10_000,
    tokenExpiryBufferMs: userConfig.tokenExpiryBufferMs ?? 60_000,
    onWarn: userConfig.onWarn,
    apiVersion: userConfig.apiVersion ?? "v1",
    retry: userConfig.retry,
  });
}
