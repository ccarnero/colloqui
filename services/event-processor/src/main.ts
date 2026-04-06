import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { eventProcessorConfig } from "./config";

runNestFastifyServiceMain("event-processor", async () => {
  await bootstrapFastifyApp({
    serviceName: "event-processor",
    module: AppModule,
    port: eventProcessorConfig.port,
    withValidationPipe: true,
  });
});
