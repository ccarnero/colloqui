import { Inject, Injectable } from "@nestjs/common";
import { AdapterClient, sleep } from "@yoizen/shared";
import type { EventEnvelope } from "@yoizen/shared";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { ADAPTER_CLIENT } from "../providers/adapter-client.provider";
import type {
  IPipelineContext,
  IPipelineStage,
} from "./pipeline-stage.interface";
import { resolveAdapterPipelineRefAndRequest } from "./adapter-pipeline-stage-base.util";

@Injectable()
export class AdapterForwardStage implements IPipelineStage {
  readonly order = 40;
  private readonly logger = new PinoLoggerService(AdapterForwardStage.name);

  constructor(
    @Inject(ADAPTER_CLIENT) private readonly adapterClient: AdapterClient,
  ) {}

  async process(
    envelope: EventEnvelope,
    context: IPipelineContext,
  ): Promise<EventEnvelope> {
    const pipelineResolved = await resolveAdapterPipelineRefAndRequest({
      envelope,
      context,
      field: "forward_adapter",
      logger: this.logger,
      label: "forward",
      adapterClient: this.adapterClient,
      extraHeaders: { "Content-Type": "application/json" },
    });
    if (!pipelineResolved) return envelope;

    try {
      const { resolved, headers } = pipelineResolved;

      const body = JSON.stringify(envelope.data.payload);
      let lastError: unknown;

      for (let attempt = 0; attempt <= resolved.maxRetries; attempt++) {
        if (attempt > 0) {
          const delay = resolved.retryBackoffMs * (1 << (attempt - 1));
          await sleep(delay);
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
