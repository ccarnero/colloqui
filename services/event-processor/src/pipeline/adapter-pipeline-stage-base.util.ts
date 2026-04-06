import type { AdapterClient } from "@yoizen/shared";
import type { EventEnvelope } from "@yoizen/shared";
import type { PinoLoggerService } from "@yoizen/observability";
import { resolveAdapterPipelineRef } from "./adapter-pipeline-guards";
import { resolveAdapterPipelineRequest } from "./adapter-pipeline-resolve.util";
import type { IPipelineContext } from "./pipeline-stage.interface";

type AdapterRefField = "enrich_adapter" | "forward_adapter";

/**
 * Resolves adapter ref + request config in one step (shared by enrichment and forward stages).
 */
export async function resolveAdapterPipelineRefAndRequest(options: {
  readonly envelope: EventEnvelope;
  readonly context: IPipelineContext;
  readonly field: AdapterRefField;
  readonly logger: PinoLoggerService;
  readonly label: "enrichment" | "forward";
  readonly adapterClient: AdapterClient;
  readonly extraHeaders: Record<string, string>;
}): Promise<
  | {
      readonly tenantId: string;
      readonly resolved: Awaited<
        ReturnType<typeof resolveAdapterPipelineRequest>
      >["resolved"];
      readonly headers: Awaited<
        ReturnType<typeof resolveAdapterPipelineRequest>
      >["headers"];
    }
  | null
> {
  const resolvedRef = resolveAdapterPipelineRef({
    envelope: options.envelope,
    context: options.context,
    field: options.field,
    logger: options.logger,
    label: options.label,
  });
  if (!resolvedRef) return null;

  const { tenantId, adapterId, endpointId } = resolvedRef;
  const { resolved, headers } = await resolveAdapterPipelineRequest({
    adapterClient: options.adapterClient,
    tenantId,
    adapterId,
    endpointId,
    extraHeaders: options.extraHeaders,
  });
  return { tenantId, resolved, headers };
}
