type WorkflowServiceConfig = {
  readonly port: number;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly natsUrl: string;
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
 */
export const workflowServiceConfig: WorkflowServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
};
