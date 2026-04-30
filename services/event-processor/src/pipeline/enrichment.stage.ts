import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "@yoizen/shared";
import type {
  IPipelineStage,
  IPipelineContext,
} from "./pipeline-stage.interface";

@Injectable()
export class EnrichmentStage implements IPipelineStage {
  readonly order = 20;

  async process(
    envelope: EventEnvelope,
    context: IPipelineContext,
  ): Promise<EventEnvelope> {
    const receivedAt = envelope.data.received_at || new Date().toISOString();
    const correlationId =
      envelope.correlation_id || context.correlationId || randomUUID();

    return {
      ...envelope,
      correlation_id: correlationId,
      source: context.subject,
      data: {
        ...envelope.data,
        received_at: receivedAt,
      },
    };
  }
}
