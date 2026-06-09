import { resolveStorageEngine, type StorageEngine } from "@yoizen/database";

type AgentAiServiceConfig = {
  readonly port: number;
  readonly dbEngine: StorageEngine;
  readonly platformEnvironment: string;
  readonly natsUrl: string;
  readonly redisUrl: string;
  readonly memoryServiceUrl: string;
  readonly connectorAdminUrl: string;
  readonly toolDescriptionOverridesEnabled: boolean;
};

export const agentAiServiceConfig: AgentAiServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get dbEngine() {
    return resolveStorageEngine();
  },
  get platformEnvironment() {
    return process.env.PLATFORM_ENVIRONMENT ?? "dev";
  },
  get natsUrl() {
    return process.env.NATS_URL ?? "nats://localhost:4222";
  },
  get redisUrl() {
    return process.env.REDIS_URL ?? "redis://localhost:6379";
  },
  get memoryServiceUrl() {
    return (
      process.env.MEMORY_SERVICE_URL ??
      "http://agent-memory-service:3000"
    );
  },
  get connectorAdminUrl() {
    return (
      process.env.CONNECTOR_ADMIN_URL ??
      "http://connector-admin-api:3000"
    );
  },
  get toolDescriptionOverridesEnabled() {
    return (
      process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED === "true"
    );
  },
};
