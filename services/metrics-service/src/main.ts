import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapSplitService,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { metricsServiceConfig } from "./config";

runNestFastifyServiceMain("metrics-service", async () => {
  await bootstrapSplitService({
    baseServiceName: "metrics-service",
    module: AppModule,
    port: metricsServiceConfig.port,
    apiOptions: {
      withValidationPipe: true,
    },
  });
});
