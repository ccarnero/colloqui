import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { ProcessorService } from "./processor.service";
import { ProcessorPipelineDeps } from "./processor-pipeline-deps";
import { PipelineModule } from "../../pipeline/pipeline.module";
import {
  HandlerRegistry,
  DefaultHandler,
  CreatedHandler,
  UpdatedHandler,
  DeletedHandler,
  MetricsHandler,
} from "../../handlers";

@Module({
  imports: [DiscoveryModule, PipelineModule],
  providers: [
    ProcessorService,
    ProcessorPipelineDeps,
    HandlerRegistry,
    DefaultHandler,
    CreatedHandler,
    UpdatedHandler,
    DeletedHandler,
    MetricsHandler,
  ],
  exports: [ProcessorService],
})
export class ProcessorModule {}
