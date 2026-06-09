import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
  PinoLoggerService,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { agentAiServiceConfig } from "./config";

const SERVICE_NAME = "agent-ai-service";
const BOOTSTRAP_CONTEXT = "Bootstrap";
const bootstrapLogger = new PinoLoggerService(SERVICE_NAME);

runNestFastifyServiceMain(SERVICE_NAME, async () => {
  await bootstrapFastifyApp({
    serviceName: SERVICE_NAME,
    module: AppModule,
    port: agentAiServiceConfig.port,
    withValidationPipe: true,
  });
  bootstrapLogger.log(
    `HTTP server listening on 0.0.0.0:${agentAiServiceConfig.port}`,
    BOOTSTRAP_CONTEXT,
  );
});
