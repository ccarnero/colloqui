import { Module, OnModuleInit } from "@nestjs/common";
import { JsInlineExecutor } from "./js-inline.executor";
import { K8sJobExecutor } from "./k8s-job.executor";
import { EngineService } from "../engine/engine.service";
import { EngineModule } from "../engine/engine.module";

@Module({
  imports: [EngineModule],
  providers: [JsInlineExecutor, K8sJobExecutor],
  exports: [JsInlineExecutor, K8sJobExecutor],
})
export class ExecutorsModule implements OnModuleInit {
  constructor(
    private readonly engineService: EngineService,
    private readonly jsInlineExecutor: JsInlineExecutor,
    private readonly k8sJobExecutor: K8sJobExecutor,
  ) {}

  onModuleInit(): void {
    this.engineService.registerExecutor("js-inline", this.jsInlineExecutor);
    this.engineService.registerExecutor("js-k8s", this.k8sJobExecutor);
    this.engineService.registerExecutor("docker", this.k8sJobExecutor);
  }
}
