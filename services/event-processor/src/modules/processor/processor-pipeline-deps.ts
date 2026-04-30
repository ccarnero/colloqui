import { Injectable } from "@nestjs/common";
import { HandlerRegistry } from "../../handlers/handler-registry";
import { DefaultHandler } from "../../handlers/default.handler";
import { PipelineRunner } from "../../pipeline/pipeline-runner";

/**
 * Groups handler resolution + pipeline so {@link ProcessorService} stays under
 * the constructor dependency budget.
 */
@Injectable()
export class ProcessorPipelineDeps {
  constructor(
    readonly registry: HandlerRegistry,
    readonly defaultHandler: DefaultHandler,
    readonly pipeline: PipelineRunner,
  ) {}
}
