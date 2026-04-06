import type { EventEnvelope } from "@yoizen/shared";

export interface IPipelineContext {
  subject: string;
  correlationId?: string;
  tenantId?: string;
}

export interface IPipelineStage {
  readonly order: number;
  process(
    envelope: EventEnvelope,
    context: IPipelineContext,
  ): Promise<EventEnvelope>;
}
