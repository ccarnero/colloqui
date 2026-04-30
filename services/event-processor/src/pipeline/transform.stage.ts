import { Injectable } from "@nestjs/common";
import type { EventEnvelope } from "@yoizen/shared";
import type {
  IPipelineStage,
  IPipelineContext,
} from "./pipeline-stage.interface";

type PayloadTransformer = (
  payload: Record<string, unknown>,
) => Record<string, unknown>;

@Injectable()
export class TransformStage implements IPipelineStage {
  readonly order = 30;

  private readonly transformers: PayloadTransformer[] = [];

  registerTransformer(fn: PayloadTransformer): void {
    this.transformers.push(fn);
  }

  async process(
    envelope: EventEnvelope,
    _context: IPipelineContext,
  ): Promise<EventEnvelope> {
    if (this.transformers.length === 0) return envelope;

    let payload: Record<string, unknown> = envelope.data.payload ?? {};
    for (let i = 0; i < this.transformers.length; i++) {
      payload = this.transformers[i](payload);
    }

    return {
      ...envelope,
      data: { ...envelope.data, payload },
    };
  }
}
