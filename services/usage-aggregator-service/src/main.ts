import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapSplitService,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { usageAggregatorServiceConfig } from "./config";

// Base name uses the short form ("usage-aggregator") because the K8s
// resources are `usage-aggregator-api` / `usage-aggregator-worker`, dropping
// the historical `-service` suffix carried by the package directory.
runNestFastifyServiceMain("usage-aggregator", async () => {
  await bootstrapSplitService({
    baseServiceName: "usage-aggregator",
    module: AppModule,
    port: usageAggregatorServiceConfig.port,
    apiOptions: {
      withValidationPipe: false,
    },
  });
});
