import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { adapterServiceConfig } from "./config";

runNestFastifyServiceMain("adapter-service", async () => {
  await bootstrapFastifyApp({
    serviceName: "adapter-service",
    module: AppModule,
    port: adapterServiceConfig.port,
    withValidationPipe: true,
  });
});
