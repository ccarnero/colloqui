type WorkflowServiceConfig = {
  readonly port: number;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly natsUrl: string;
  readonly redisHost: string;
  readonly redisPort: number;
  /**
   * `true` when the operator explicitly set `REDIS_HOST`. Used by the
   * agent-call activity to log a loud warning at boot when Redis is
   * silently falling back to `localhost` — the most common cause of
   * `MaxRetriesPerRequestError` in production.
   */
  readonly redisHostExplicit: boolean;
};

/**
 * Runtime config for the workflow-service.
 *
 * Postgres settings are intentionally absent: workflow data is stored
 * per-tenant via `WorkflowTenantConnectionManager`, which reads only
 * `POSTGRES_USER` / `POSTGRES_PASSWORD` from the environment to
 * authenticate against each tenant's own Postgres instance
 * (`postgres.{tenant}-{env}-ns.svc.cluster.local`). Platform-level
 * `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` are no longer
 * consumed.
 *
 * Redis is consumed by the worker process only (the `executeAgentCall`
 * activity uses Redis as a circuit-breaker store and as the
 * `YoizenClawExecutionClient` status cache). The API process does not
 * touch Redis but reads the same config to keep a single source of
 * truth.
 */
export const workflowServiceConfig: WorkflowServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
  redisHost: process.env.REDIS_HOST ?? "localhost",
  redisPort: Number.parseInt(process.env.REDIS_PORT ?? "6379", 10),
  redisHostExplicit: typeof process.env.REDIS_HOST === "string"
    && process.env.REDIS_HOST.length > 0,
};
