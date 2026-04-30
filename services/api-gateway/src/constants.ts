/** Hostname pattern: `<env>.<tenant>.yplatform.com` — capture group 1 is tenant id. */
export const HOST_PATTERN = /^[^.]+\.([^.]+)\.yplatform\.com$/;

/** Proxy timeout for all upstream HTTP calls (ms). */
export const PROXY_TIMEOUT_MS = 30_000;

/** Prefix used to identify tenant-scoped JWT tokens. */
export const TENANT_SCOPE_PREFIX = "tenant:";

export interface ISseEvent {
  data: string | object;
  id?: string;
  type?: string;
}
