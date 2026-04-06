import { Injectable } from "@nestjs/common";
import type { EventEnvelope } from "@yoizen/shared";
import type {
  IPipelineContext,
  IPipelineStage,
} from "./pipeline-stage.interface";
import { ValidationStage } from "./validation.stage";
import { EnrichmentStage } from "./enrichment.stage";
import { AdapterEnrichmentStage } from "./adapter-enrichment.stage";
import { TransformStage } from "./transform.stage";
import { AdapterForwardStage } from "./adapter-forward.stage";

@Injectable()
export class PipelineRunner {
  private readonly stages: IPipelineStage[];

  constructor(
    validation: ValidationStage,
    enrichment: EnrichmentStage,
    adapterEnrichment: AdapterEnrichmentStage,
    transform: TransformStage,
    adapterForward: AdapterForwardStage,
  ) {
    this.stages = [
      validation,
      enrichment,
      adapterEnrichment,
      transform,
      adapterForward,
    ].sort((a, b) => a.order - b.order);
  }

  async run(
    envelope: EventEnvelope,
    context: IPipelineContext,
  ): Promise<EventEnvelope> {
    let result = envelope;
    for (let i = 0; i < this.stages.length; i++) {
      result = await this.stages[i].process(result, context);
    }
    return result;
  }
}
