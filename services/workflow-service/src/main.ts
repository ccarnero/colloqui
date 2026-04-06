import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { workflowServiceConfig } from "./config";

runNestFastifyServiceMain("workflow-service", async () => {
  await bootstrapFastifyApp({
    serviceName: "workflow-service",
    module: AppModule,
    port: workflowServiceConfig.port,
    withValidationPipe: true,
  });
});
