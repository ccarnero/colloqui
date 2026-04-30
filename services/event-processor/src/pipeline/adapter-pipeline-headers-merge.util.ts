import { mergeAdapterPipelineHeaders } from "./adapter-request-headers.util";

/**
 * Merges tenant + adapter headers with stage-specific defaults (O(k) for k extra keys).
 */
export function buildAdapterPipelineRequestHeaders(
  tenantId: string,
  adapterHeaders: Record<string, string> | undefined,
  extra: Record<string, string>,
): Record<string, string> {
  return {
    ...mergeAdapterPipelineHeaders(tenantId, adapterHeaders ?? {}),
    ...extra,
  };
}
