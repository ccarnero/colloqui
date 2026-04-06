import type { EventEnvelope } from "@yoizen/shared";
import type { IPipelineContext } from "./pipeline-stage.interface";

/** Which envelope field carries the adapter reference. */
type AdapterRefField = "enrich_adapter" | "forward_adapter";

/** Minimal logger for pipeline guard warnings. */
interface IAdapterPipelineLogger {
  warn(message: string): void;
}

interface IResolveAdapterPipelineRefOptions {
  envelope: EventEnvelope;
  context: IPipelineContext;
  field: AdapterRefField;
  logger: IAdapterPipelineLogger;
  label: "enrichment" | "forward";
}

/**
 * Resolves tenant + adapter ids or returns `null` when the stage should no-op.
 * Logs when `tenantId` is missing on the pipeline context.
 */
export function resolveAdapterPipelineRef(
  options: IResolveAdapterPipelineRefOptions,
): { tenantId: string; adapterId: string; endpointId: string } | null {
  const { envelope, context, field, logger, label } = options;
  const ref = envelope[field];
  if (!ref) return null;

  const tenantId = context.tenantId;
  if (!tenantId) {
    logger.warn(
      `Skipping adapter ${label} for event ${envelope.id}: no tenantId`,
    );
    return null;
  }

  return {
    tenantId,
    adapterId: ref.adapterId,
    endpointId: ref.endpointId,
  };
}
