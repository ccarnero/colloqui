import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@yoizen/shared';
import type { PipelineStage, PipelineContext } from './pipeline-stage.interface';

@Injectable()
export class EnrichmentStage implements PipelineStage {
  readonly order = 20;

  async process(
    envelope: EventEnvelope,
    context: PipelineContext,
  ): Promise<EventEnvelope> {
    return {
      ...envelope,
      metadata: {
        ...envelope.metadata,
        receivedAt: envelope.metadata?.receivedAt ?? Date.now(),
        correlationId:
          envelope.metadata?.correlationId ??
          context.correlationId ??
          randomUUID(),
        source: context.subject,
      },
    };
  }
}
