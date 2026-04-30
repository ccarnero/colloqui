import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapSplitService,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { channelServiceConfig } from "./config";

runNestFastifyServiceMain("channel-service", async () => {
  await bootstrapSplitService({
    baseServiceName: "channel-service",
    module: AppModule,
    port: channelServiceConfig.port,
    apiOptions: {
      withValidationPipe: true,
      fastifyAdapterOptions: { bodyLimit: 1_048_576 },
      nestApplicationOptions: { rawBody: true },
    },
  });
});
