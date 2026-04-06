import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { schedulerServiceConfig } from "./config";

runNestFastifyServiceMain("scheduler-service", async () => {
  await bootstrapFastifyApp({
    serviceName: "scheduler-service",
    module: AppModule,
    port: schedulerServiceConfig.port,
    withValidationPipe: true,
  });
});
