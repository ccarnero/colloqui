import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { authServiceConfig } from "./config";

runNestFastifyServiceMain("auth-service", async () => {
  await bootstrapFastifyApp({
    serviceName: "auth-service",
    module: AppModule,
    port: authServiceConfig.port,
    withValidationPipe: true,
  });
});
