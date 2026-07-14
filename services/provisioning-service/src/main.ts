import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  PinoLoggerService,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { provisioningServiceConfig } from "./config";

const SERVICE_NAME = "provisioning-service";
const BOOTSTRAP_CONTEXT = "Bootstrap";
const bootstrapLogger = new PinoLoggerService(SERVICE_NAME);

runNestFastifyServiceMain(SERVICE_NAME, async () => {
  await bootstrapFastifyApp({
    serviceName: SERVICE_NAME,
    module: AppModule,
    port: provisioningServiceConfig.port,
    withValidationPipe: true,
  });
  bootstrapLogger.log(
    `HTTP server listening on 0.0.0.0:${provisioningServiceConfig.port}`,
    BOOTSTRAP_CONTEXT
  );
});
