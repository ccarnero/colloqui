import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapSplitService,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { workflowServiceConfig } from "./config";

runNestFastifyServiceMain("workflow-service", async () => {
  await bootstrapSplitService({
    baseServiceName: "workflow-service",
    module: AppModule,
    port: workflowServiceConfig.port,
    apiOptions: {
      withValidationPipe: false,
    },
  });
});
