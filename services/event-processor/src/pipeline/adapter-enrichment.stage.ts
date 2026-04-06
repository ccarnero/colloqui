import { Inject, Injectable } from "@nestjs/common";
import { AdapterClient } from "@yoizen/shared";
import type { EventEnvelope } from "@yoizen/shared";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { ADAPTER_CLIENT } from "../providers/adapter-client.provider";
import type {
  IPipelineContext,
  IPipelineStage,
} from "./pipeline-stage.interface";
import { resolveAdapterPipelineRefAndRequest } from "./adapter-pipeline-stage-base.util";

@Injectable()
export class AdapterEnrichmentStage implements IPipelineStage {
  readonly order = 25;
  private readonly logger = new PinoLoggerService(AdapterEnrichmentStage.name);

  constructor(
    @Inject(ADAPTER_CLIENT) private readonly adapterClient: AdapterClient,
  ) {}

  async process(
    envelope: EventEnvelope,
    context: IPipelineContext,
  ): Promise<EventEnvelope> {
    const resolved = await resolveAdapterPipelineRefAndRequest({
      envelope,
      context,
      field: "enrich_adapter",
      logger: this.logger,
      label: "enrichment",
      adapterClient: this.adapterClient,
      extraHeaders: { Accept: "application/json" },
    });
    if (!resolved) return envelope;

    try {
      const { resolved: req, headers } = resolved;

      const res = await tracedFetch(req.url, {
        method: req.method,
        headers,
        body:
          req.method !== "GET"
            ? JSON.stringify(envelope.data.payload)
            : undefined,
        signal: AbortSignal.timeout(req.timeoutMs),
      });

      if (!res.ok) {
        this.logger.warn(
          `Adapter enrichment failed for event ${envelope.id}: HTTP ${res.status} from ${req.url}`,
        );
        return envelope;
      }

      const contentType = res.headers.get("content-type") ?? "";
      const enrichedData = contentType.includes("application/json")
        ? await res.json()
        : await res.text();

      return {
        ...envelope,
        data: {
          ...envelope.data,
          payload: {
            ...(envelope.data.payload ?? {}),
            _enriched: enrichedData,
          },
        },
      };
    } catch (err) {
      this.logger.warn(
        `Adapter enrichment error for event ${envelope.id}: ${err instanceof Error ? err.message : err}`,
      );
      return envelope;
    }
  }
}
