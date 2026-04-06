import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { webhookServiceConfig } from "./config";

runNestFastifyServiceMain("webhook-service", async () => {
  await bootstrapFastifyApp({
    serviceName: "webhook-service",
    module: AppModule,
    port: webhookServiceConfig.port,
    withValidationPipe: true,
  });
});
