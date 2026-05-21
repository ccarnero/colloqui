import "./instrumentation";
import "reflect-metadata";
import {
  bootstrapSplitService,
  runNestFastifyServiceMain,
} from "@yoizen/observability";
import { AppModule } from "./app.module";
import { adapterServiceConfig } from "./config";

/**
 * Allowed `SERVICE_MODE` env values. Anything else is a fatal startup
 * misconfiguration: REQ-AST-006 (mode misconfiguration scenario) and
 * REQ-AST-002 (mode misconfiguration error) require the process to
 * refuse to start rather than silently default into one role.
 *
 * Note: missing `SERVICE_MODE` falls through to the
 * `@yoizen/observability` runtime-mode helper which defaults to `api`
 * for backwards-compat with existing single-pod manifests; only an
 * explicitly-set unknown value aborts boot.
 */
const VALID_SERVICE_MODES = new Set<string>(["api", "worker"]);

/**
 * Validates `SERVICE_MODE` before any Nest factory work so an invalid
 * value crashes during bootstrap (exit code 1 via
 * `runNestFastifyServiceMain`) rather than booting the wrong role and
 * silently misbehaving (REQ-AST-006 scenario "Image without mode
 * setting (error)").
 */
function assertServiceModeOrThrow(): void {
  const raw = process.env.SERVICE_MODE;
  if (raw === undefined) return;
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return;
  if (!VALID_SERVICE_MODES.has(normalized)) {
    throw new Error(
      `Invalid SERVICE_MODE='${raw}'. Expected one of: ${Array.from(
        VALID_SERVICE_MODES,
      ).join(", ")}`,
    );
  }
}

runNestFastifyServiceMain("connector-admin", async () => {
  assertServiceModeOrThrow();
  await bootstrapSplitService({
    baseServiceName: "connector-admin",
    module: AppModule,
    port: adapterServiceConfig.port,
    apiOptions: {
      withValidationPipe: true,
    },
  });
});
