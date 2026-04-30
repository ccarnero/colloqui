const DEFAULT_POSTGRES_HOST = "postgres.support-services-dev.svc.cluster.local";

type RegistryServiceConfig = {
  readonly port: number;
  readonly defaultPostgresHost: string;
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

export const registryServiceConfig: RegistryServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  defaultPostgresHost: process.env.POSTGRES_HOST ?? DEFAULT_POSTGRES_HOST,
  platformEnvironment: process.env.PLATFORM_ENVIRONMENT ?? "dev",
  emitAdapterSync: parseBoolEnv(process.env.REGISTRY_EMIT_ADAPTER_SYNC, false),
};
