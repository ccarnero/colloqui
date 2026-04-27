import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapSplitService,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { auditServiceConfig } from "./config";

runNestFastifyServiceMain("audit-service", async () => {
  await bootstrapSplitService({
    baseServiceName: "audit-service",
    module: AppModule,
    port: auditServiceConfig.port,
    apiOptions: {
      withValidationPipe: true,
    },
  });
});
