import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapSplitService,
  PinoLoggerService,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { agentAdminServiceConfig } from "./config";

const SERVICE_NAME = "agent-admin-service";
const bootstrapLogger = new PinoLoggerService(SERVICE_NAME);

async function bootstrap(): Promise<void> {
  await bootstrapSplitService({
    baseServiceName: SERVICE_NAME,
    module: AppModule,
    port: agentAdminServiceConfig.port,
    apiOptions: { withValidationPipe: true },
  });
}

bootstrap().catch((err: unknown) => {
  const detail =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "string"
        ? err
        : JSON.stringify(err);
  const stack = err instanceof Error ? err.stack : undefined;
  bootstrapLogger.error(
    `Bootstrap failed — ${detail}`,
    stack ?? detail,
  );
  process.exit(1);
});
