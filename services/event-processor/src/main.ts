import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapSplitService,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { eventProcessorConfig } from "./config";

runNestFastifyServiceMain("event-processor", async () => {
  await bootstrapSplitService({
    baseServiceName: "event-processor",
    module: AppModule,
    port: eventProcessorConfig.port,
    apiOptions: {
      withValidationPipe: true,
    },
  });
});
