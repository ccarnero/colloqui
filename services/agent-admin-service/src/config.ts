import path from "node:path";
import { resolveStorageEngine, type StorageEngine } from "@yoizen/database";
import { platformServiceUrl } from "@yoizen/shared";

type AgentAdminServiceConfig = {
  readonly port: number;
  readonly dbEngine: StorageEngine;
  readonly platformEnvironment: string;
  readonly validateAdapterRefs: boolean;
  readonly adapterServiceUrl: string;
  readonly memoryServiceUrl: string;
  readonly memoryServiceTimeoutMs: number;
  readonly natsUrl: string;
  readonly templatesYamlPath: string;
  readonly chatRequestTimeoutMs: number;
  readonly toolDescriptionOverridesEnabled: boolean;
};

/** Lazy getters so tests can set `process.env` before first consumer reads config. */
export const agentAdminServiceConfig: AgentAdminServiceConfig = {
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
  get memoryServiceUrl() {
    return (
      process.env.AGENT_MEMORY_SERVICE_URL ??
      platformServiceUrl("agent-memory-service", this.platformEnvironment)
    );
  },
  get memoryServiceTimeoutMs() {
    return Number.parseInt(
      process.env.AGENT_MEMORY_SERVICE_TIMEOUT_MS ?? "8000",
      10
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
      process.env.PLATFORM_CHAT_REQUEST_TIMEOUT_MS ?? "30000",
      10
    );
  },
  get toolDescriptionOverridesEnabled() {
    return process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED === "true";
  },
};
