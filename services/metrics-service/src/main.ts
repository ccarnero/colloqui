import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { metricsServiceConfig } from "./config";

runNestFastifyServiceMain("metrics-service", async () => {
  await bootstrapFastifyApp({
    serviceName: "metrics-service",
    module: AppModule,
    port: metricsServiceConfig.port,
    withValidationPipe: true,
  });
});
