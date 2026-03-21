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
export class AdapterForwardStage implements PipelineStage {
  readonly order = 40;
  private readonly logger = new Logger(AdapterForwardStage.name);
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
    if (!envelope.forwardAdapter) return envelope;

    const { adapterId, endpointId } = envelope.forwardAdapter;
    const tenantId = context.tenantId;
    if (!tenantId) {
      this.logger.warn(
        `Skipping adapter forward for event ${envelope.id}: no tenantId`,
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
        "Content-Type": "application/json",
      };

      const body = JSON.stringify(envelope.payload);
      let lastError: unknown;

      for (let attempt = 0; attempt <= resolved.maxRetries; attempt++) {
        if (attempt > 0) {
          const delay = resolved.retryBackoffMs * (1 << (attempt - 1));
          await new Promise((r) => setTimeout(r, delay));
        }

        try {
          const res = await tracedFetch(resolved.url, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.timeout(resolved.timeoutMs),
          });

          if (res.ok) {
            this.logger.log(
              `Forwarded event ${envelope.id} to ${resolved.url} (attempt ${attempt + 1})`,
            );
            return envelope;
          }

          lastError = new Error(`HTTP ${res.status}`);

          if (res.status < 500) break;
        } catch (err) {
          lastError = err;
          if (attempt === resolved.maxRetries) break;
        }
      }

      this.logger.error(
        `Adapter forward exhausted for event ${envelope.id} to ${resolved.url}: ${lastError instanceof Error ? lastError.message : lastError}`,
      );
    } catch (err) {
      this.logger.error(
        `Adapter forward error for event ${envelope.id}: ${err instanceof Error ? err.message : err}`,
      );
    }

    return envelope;
  }
}
