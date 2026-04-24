import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { usageAggregatorServiceConfig } from "./config";

runNestFastifyServiceMain("usage-aggregator-service", async () => {
  await bootstrapFastifyApp({
    serviceName: "usage-aggregator-service",
    module: AppModule,
    port: usageAggregatorServiceConfig.port,
    withValidationPipe: false,
  });
});
