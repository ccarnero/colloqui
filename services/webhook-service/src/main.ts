import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapSplitService,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { webhookServiceConfig } from "./config";

runNestFastifyServiceMain("webhook-service", async () => {
  await bootstrapSplitService({
    baseServiceName: "webhook-service",
    module: AppModule,
    port: webhookServiceConfig.port,
    apiOptions: {
      withValidationPipe: true,
    },
  });
});
