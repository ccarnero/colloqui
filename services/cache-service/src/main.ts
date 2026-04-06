import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { cacheServiceConfig } from "./config";

runNestFastifyServiceMain("cache-service", async () => {
  await bootstrapFastifyApp({
    serviceName: "cache-service",
    module: AppModule,
    port: cacheServiceConfig.port,
    withValidationPipe: true,
  });
});
