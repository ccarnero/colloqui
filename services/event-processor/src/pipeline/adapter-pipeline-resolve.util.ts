import type { AdapterClient, ResolvedAdapterRequest } from "@yoizen/shared";
import { buildAdapterPipelineRequestHeaders } from "./adapter-pipeline-headers-merge.util";

/** Resolves adapter endpoint and merges pipeline headers (O(1) extra header keys). */
export interface IResolveAdapterPipelineRequestParams {
  readonly adapterClient: AdapterClient;
  readonly tenantId: string;
  readonly adapterId: string;
  readonly endpointId: string;
  readonly extraHeaders: Record<string, string>;
}

/**
 * Resolves adapter endpoint config and merges pipeline headers (O(1) extra header keys).
 */
export async function resolveAdapterPipelineRequest(
  params: IResolveAdapterPipelineRequestParams,
): Promise<{
  resolved: ResolvedAdapterRequest;
  headers: Record<string, string>;
}> {
  const { adapterClient, tenantId, adapterId, endpointId, extraHeaders } =
    params;
  const resolved = await adapterClient.resolveRequest(
    tenantId,
    adapterId,
    endpointId,
  );
  const headers = buildAdapterPipelineRequestHeaders(
    tenantId,
    resolved.headers,
    extraHeaders,
  );
  return { resolved, headers };
}
