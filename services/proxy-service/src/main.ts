import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { proxyServiceConfig } from "./config";

runNestFastifyServiceMain("proxy-service", async () => {
  await bootstrapFastifyApp({
    serviceName: "proxy-service",
    module: AppModule,
    port: proxyServiceConfig.port,
    withValidationPipe: true,
  });
});
