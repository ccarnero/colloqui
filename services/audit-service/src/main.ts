import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { auditServiceConfig } from "./config";

runNestFastifyServiceMain("audit-service", async () => {
  await bootstrapFastifyApp({
    serviceName: "audit-service",
    module: AppModule,
    port: auditServiceConfig.port,
    withValidationPipe: true,
  });
});
