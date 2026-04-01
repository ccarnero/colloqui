import { Injectable } from "@nestjs/common";
import type { EventEnvelope } from "@yoizen/shared";
import type {
  PipelineStage,
  PipelineContext,
} from "./pipeline-stage.interface";

export type PayloadTransformer = (
  payload: Record<string, unknown>,
) => Record<string, unknown>;

@Injectable()
export class TransformStage implements PipelineStage {
  readonly order = 30;

  private readonly transformers: PayloadTransformer[] = [];

  registerTransformer(fn: PayloadTransformer): void {
    this.transformers.push(fn);
  }

  async process(
    envelope: EventEnvelope,
    _context: PipelineContext,
  ): Promise<EventEnvelope> {
    if (this.transformers.length === 0) return envelope;

    let payload: Record<string, unknown> =
      envelope.data.payload ?? {};
    for (let i = 0; i < this.transformers.length; i++) {
      payload = this.transformers[i](payload);
    }

    return {
      ...envelope,
      data: { ...envelope.data, payload },
    };
  }
}
