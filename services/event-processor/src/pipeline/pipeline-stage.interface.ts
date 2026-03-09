import type { EventEnvelope } from '@yoizen/shared';

export interface PipelineContext {
  subject: string;
  correlationId?: string;
  tenantId?: string;
}

export interface PipelineStage {
  readonly order: number;
  process(
    envelope: EventEnvelope,
    context: PipelineContext,
  ): Promise<EventEnvelope>;
}
