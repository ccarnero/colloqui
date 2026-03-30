import { Module } from '@nestjs/common';
import { ValidationStage } from './validation.stage';
import { EnrichmentStage } from './enrichment.stage';
import { AdapterEnrichmentStage } from './adapter-enrichment.stage';
import { TransformStage } from './transform.stage';
import { AdapterForwardStage } from './adapter-forward.stage';
import { PipelineRunner } from './pipeline-runner';

@Module({
  providers: [
    ValidationStage,
    EnrichmentStage,
    AdapterEnrichmentStage,
    TransformStage,
    AdapterForwardStage,
    PipelineRunner,
  ],
  exports: [PipelineRunner, ValidationStage, TransformStage],
})
export class PipelineModule {}
