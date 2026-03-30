import { Inject, Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import {
  AdapterClient,
  DEFAULT_ADAPTER_SERVICE_URL,
  TENANT_HEADER,
} from "@yoizen/shared";
import type { EventEnvelope } from "@yoizen/shared";
import { tracedFetch } from "@yoizen/observability";
import { REDIS_CLIENT } from "../providers/redis.provider";
import type { PipelineContext, PipelineStage } from "./pipeline-stage.interface";

const SOURCE_HEADER = "X-Yoizen-Source";
const SOURCE_VALUE = "event-processor";

@Injectable()
export class AdapterEnrichmentStage implements PipelineStage {
  readonly order = 25;
  private readonly logger = new Logger(AdapterEnrichmentStage.name);
  private readonly adapterClient: AdapterClient;

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.adapterClient = new AdapterClient({
      baseUrl:
        process.env.ADAPTER_SERVICE_URL ?? DEFAULT_ADAPTER_SERVICE_URL,
      fetchFn: tracedFetch,
      cache: redis,
    });
  }

  async process(
    envelope: EventEnvelope,
    context: PipelineContext,
  ): Promise<EventEnvelope> {
    if (!envelope.enrichAdapter) return envelope;

    const { adapterId, endpointId } = envelope.enrichAdapter;
    const tenantId = context.tenantId;
    if (!tenantId) {
      this.logger.warn(
        `Skipping adapter enrichment for event ${envelope.id}: no tenantId`,
      );
      return envelope;
    }

    try {
      const resolved = await this.adapterClient.resolveRequest(
        tenantId,
        adapterId,
        endpointId,
      );

      const headers: Record<string, string> = {
        ...resolved.headers,
        [TENANT_HEADER]: tenantId,
        [SOURCE_HEADER]: SOURCE_VALUE,
        Accept: "application/json",
      };

      const res = await tracedFetch(resolved.url, {
        method: resolved.method,
        headers,
        body:
          resolved.method !== "GET"
            ? JSON.stringify(envelope.payload)
            : undefined,
        signal: AbortSignal.timeout(resolved.timeoutMs),
      });

      if (!res.ok) {
        this.logger.warn(
          `Adapter enrichment failed for event ${envelope.id}: HTTP ${res.status} from ${resolved.url}`,
        );
        return envelope;
      }

      const contentType = res.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json")
        ? await res.json()
        : await res.text();

      return {
        ...envelope,
        payload: {
          ...envelope.payload,
          _enriched: data,
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
