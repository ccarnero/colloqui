import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { aiAgentGatewayConfig } from "./config";

runNestFastifyServiceMain("ai-agent-gateway", async () => {
  await bootstrapFastifyApp({
    serviceName: "ai-agent-gateway",
    module: AppModule,
    port: aiAgentGatewayConfig.port,
    withValidationPipe: true,
  });
});
