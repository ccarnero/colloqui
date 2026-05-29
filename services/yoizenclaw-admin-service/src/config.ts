import { resolveStorageEngine, type StorageEngine } from "@yoizen/database";
import path from "node:path";

type YoizenclawAdminServiceConfig = {
  readonly port: number;
  readonly dbEngine: StorageEngine;
  readonly platformEnvironment: string;
  readonly validateAdapterRefs: boolean;
  readonly adapterServiceUrl: string;
  readonly natsUrl: string;
  readonly templatesYamlPath: string;
  readonly chatRequestTimeoutMs: number;
};

/** Lazy getters so tests can set `process.env` before first consumer reads config. */
export const yoizenclawAdminServiceConfig: YoizenclawAdminServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get dbEngine() {
    return resolveStorageEngine();
  },
  get platformEnvironment() {
    return process.env.PLATFORM_ENVIRONMENT ?? "dev";
  },
  get validateAdapterRefs() {
    return (process.env.VALIDATE_ADAPTER_REFS ?? "true") !== "false";
  },
  get adapterServiceUrl() {
    return (
      process.env.CONNECTOR_ADMIN_URL ??
      process.env.ADAPTER_SERVICE_URL ??
      "http://connector-admin-api:3000"
    );
  },
  get natsUrl() {
    return process.env.NATS_URL ?? "nats://localhost:4222";
  },
  get templatesYamlPath() {
    return path.join(process.cwd(), "data", "templates.yaml");
  },
  get chatRequestTimeoutMs() {
    return Number.parseInt(
      process.env.YOIZENCLAW_CHAT_REQUEST_TIMEOUT_MS ?? "30000",
      10,
    );
  },
};
