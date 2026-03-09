import { Injectable } from '@nestjs/common';
import type { EventEnvelope } from '@yoizen/shared';
import type { PipelineContext, PipelineStage } from './pipeline-stage.interface';
import { ValidationStage } from './validation.stage';
import { EnrichmentStage } from './enrichment.stage';
import { TransformStage } from './transform.stage';

@Injectable()
export class PipelineRunner {
  private readonly stages: PipelineStage[];

  constructor(
    validation: ValidationStage,
    enrichment: EnrichmentStage,
    transform: TransformStage,
  ) {
    this.stages = [validation, enrichment, transform].sort(
      (a, b) => a.order - b.order,
    );
  }

  async run(
    envelope: EventEnvelope,
    context: PipelineContext,
  ): Promise<EventEnvelope> {
    let result = envelope;
    for (let i = 0; i < this.stages.length; i++) {
      result = await this.stages[i].process(result, context);
    }
    return result;
  }
}
