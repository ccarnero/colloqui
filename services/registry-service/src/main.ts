import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { registryServiceConfig } from "./config";

runNestFastifyServiceMain("registry-service", async () => {
  await bootstrapFastifyApp({
    serviceName: "registry-service",
    module: AppModule,
    port: registryServiceConfig.port,
    withValidationPipe: true,
  });
});
