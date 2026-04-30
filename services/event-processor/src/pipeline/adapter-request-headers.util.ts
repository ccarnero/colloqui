import { TENANT_HEADER } from "@yoizen/shared";
import { SOURCE_HEADER, SOURCE_VALUE } from "./constants";

/**
 * Merges resolved adapter headers with tenant and internal source markers.
 */
export function mergeAdapterPipelineHeaders(
  tenantId: string,
  resolvedHeaders: Record<string, string>,
): Record<string, string> {
  return {
    ...resolvedHeaders,
    [TENANT_HEADER]: tenantId,
    [SOURCE_HEADER]: SOURCE_VALUE,
  };
}
