import type { IUpdateAdapterPayload } from "../../../../core/services/http-adapter.service";
import type { IHttpAdapter } from "../../../../shared/models/http-adapter.model";

/**
 * Builds the PATCH payload for an adapter edit.
 *
 * Mirrors `connectors.component.ts`'s `toUpdatePayload()` (duplicated per
 * T03 scope constraints — this folder only). Managed adapters omit
 * registry-owned fields (name/baseUrl/healthCheckPath) since the backend
 * rejects them with a 409; the sync from the owning registry is
 * authoritative for those fields.
 */
export function buildAdapterUpdatePayload(
  adapter: IHttpAdapter
): IUpdateAdapterPayload {
  const editable: IUpdateAdapterPayload = {
    authType: adapter.auth.type,
    authConfig: adapter.auth as unknown as Record<string, unknown>,
    headers: adapter.headers,
    defaultCache: adapter.defaultCache ?? null,
    timeoutMs: adapter.timeoutMs,
    maxRetries: adapter.maxRetries,
    retryBackoffMs: adapter.retryBackoffMs,
    tags: adapter.tags,
  };

  if (adapter.managedBy) {
    return editable;
  }

  return {
    ...editable,
    name: adapter.name,
    baseUrl: adapter.baseUrl,
    healthCheckPath: adapter.healthCheckPath,
  };
}
