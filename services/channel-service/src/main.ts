import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapFastifyApp,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { channelServiceConfig } from "./config";

runNestFastifyServiceMain("channel-service", async () => {
  await bootstrapFastifyApp({
    serviceName: "channel-service",
    module: AppModule,
    port: channelServiceConfig.port,
    withValidationPipe: true,
    fastifyAdapterOptions: { bodyLimit: 1_048_576 },
    nestApplicationOptions: { rawBody: true },
  });
});
