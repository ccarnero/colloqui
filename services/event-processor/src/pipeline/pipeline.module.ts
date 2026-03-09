import { Module } from '@nestjs/common';
import { ValidationStage } from './validation.stage';
import { EnrichmentStage } from './enrichment.stage';
import { TransformStage } from './transform.stage';
import { PipelineRunner } from './pipeline-runner';

@Module({
  providers: [ValidationStage, EnrichmentStage, TransformStage, PipelineRunner],
  exports: [PipelineRunner, ValidationStage, TransformStage],
})
export class PipelineModule {}
