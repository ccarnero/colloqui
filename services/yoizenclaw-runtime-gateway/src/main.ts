import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { runtimeGatewayConfig } from "./config";

runNestFastifyServiceMain("yoizenclaw-runtime-gateway", async () => {
  await bootstrapFastifyApp({
    serviceName: "yoizenclaw-runtime-gateway",
    module: AppModule,
    port: runtimeGatewayConfig.port,
    withValidationPipe: true,
  });
});
