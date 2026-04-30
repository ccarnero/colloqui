import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { tenantServiceConfig } from "./config";

runNestFastifyServiceMain("tenant-service", async () => {
  await bootstrapFastifyApp({
    serviceName: "tenant-service",
    module: AppModule,
    port: tenantServiceConfig.port,
    withValidationPipe: true,
  });
});
