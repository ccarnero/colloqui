import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
  PinoLoggerService,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { agentSchedulerServiceConfig } from "./config";

const SERVICE_NAME = "agent-scheduler-service";
const BOOTSTRAP_CONTEXT = "Bootstrap";
const bootstrapLogger = new PinoLoggerService(SERVICE_NAME);

runNestFastifyServiceMain(SERVICE_NAME, async () => {
  await bootstrapFastifyApp({
    serviceName: SERVICE_NAME,
    module: AppModule,
    port: agentSchedulerServiceConfig.port,
    withValidationPipe: true,
  });
  bootstrapLogger.log(
    `HTTP server listening on 0.0.0.0:${agentSchedulerServiceConfig.port}`,
    BOOTSTRAP_CONTEXT,
  );
});
