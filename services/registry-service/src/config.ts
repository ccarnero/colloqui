import { resolveStorageEngine, type StorageEngine } from "@yoizen/database";

const DEFAULT_MONGO_HOST = "mongo.support-services-dev.svc.cluster.local";
const DEFAULT_POSTGRES_HOST =
  "postgres.support-services-dev.svc.cluster.local";

type RegistryServiceConfig = {
  readonly port: number;
  readonly dbEngine: StorageEngine;
  readonly defaultMongoHost: string;
  readonly defaultPostgresHost: string;
  readonly mongoDatabase: string;
  readonly platformEnvironment: string;
  /**
   * Feature flag: when `true`, registry-service publishes
   * `service.{upserted,deleted}.v1` events to NATS on every
   * register/update/remove. Consumed by adapter-service to build
   * internal-adapter mirrors. Defaults to `false` for safe rollout.
   */
  readonly emitAdapterSync: boolean;
};

function parseBoolEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return fallback;
}

/** Lazy getters so tests can set `process.env` before first consumer reads config. */
export const registryServiceConfig: RegistryServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get dbEngine() {
    return resolveStorageEngine();
  },
  get defaultMongoHost() {
    return process.env.MONGO_HOST ?? DEFAULT_MONGO_HOST;
  },
  get defaultPostgresHost() {
    return process.env.POSTGRES_HOST ?? DEFAULT_POSTGRES_HOST;
  },
  get mongoDatabase() {
    return process.env.MONGO_DB ?? "yoizen";
  },
  get platformEnvironment() {
    return process.env.PLATFORM_ENVIRONMENT ?? "dev";
  },
  get emitAdapterSync() {
    return parseBoolEnv(process.env.REGISTRY_EMIT_ADAPTER_SYNC, false);
  },
};
