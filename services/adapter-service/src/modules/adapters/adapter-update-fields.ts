/**
 * DTO keys accepted by PATCH /adapters/:id and their SQL column names.
 * Keep service `fieldKeys` and repository updates aligned with this map (O(1) lookup).
 */
export const ADAPTER_UPDATE_FIELD_MAP = {
  name: "name",
  baseUrl: "base_url",
  authType: "auth_type",
  authConfig: "auth_config",
  headers: "headers",
  timeoutMs: "timeout_ms",
  maxRetries: "max_retries",
  retryBackoffMs: "retry_backoff_ms",
  healthCheckPath: "health_check_path",
  status: "status",
} as const;

type AdapterUpdateDtoKey = keyof typeof ADAPTER_UPDATE_FIELD_MAP;

export const ADAPTER_UPDATE_FIELD_KEYS = Object.keys(
  ADAPTER_UPDATE_FIELD_MAP,
) as AdapterUpdateDtoKey[];
