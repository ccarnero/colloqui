import { Global, Module, type FactoryProvider } from "@nestjs/common";
import type {
  JetStreamClient,
  JetStreamManager,
  NatsConnection,
} from "nats";
import { temporalClientProvider, TEMPORAL_CLIENT } from "./temporal.provider";
import { WorkflowTenantConnectionManager } from "./tenant-connection-manager";
import { WorkflowTenantConnectionManagerMongo } from "./tenant-connection-manager.mongo";
import { WorkflowTenantConnectionManagerPostgres } from "./tenant-connection-manager.postgres";
import {
  createNatsConnectionProvider,
  NATS_CONNECTION,
  TENANT_DB_CONNECTION_MANAGER,
  TenantConnectionManager,
  TenantDeletionEvictionListener,
  TenantMongoConnectionManager,
  TenantMongoDeletionEvictionListener,
} from "@yoizen/database";
import { resolveServiceName } from "@yoizen/observability";
import { workflowServiceConfig } from "../config";

export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM_PUBLISHER = "JETSTREAM_PUBLISHER";

/**
 * DI token for the Postgres connection manager used exclusively by
 * {@link SystemVariablesProvider} to query the `system_variables`
 * table in each tenant's Postgres DB. Always backed by
 * `WorkflowTenantConnectionManagerPostgres`, regardless of the
 * workflow data storage engine.
 */
export const SYSTEM_VARIABLES_PG = Symbol("SYSTEM_VARIABLES_PG");

const engine = workflowServiceConfig.dbEngine;

const tenantManagerClass =
  engine === "postgres"
    ? WorkflowTenantConnectionManagerPostgres
    : WorkflowTenantConnectionManagerMongo;

const tenantBaseManagerToken =
  engine === "postgres" ? TenantConnectionManager : TenantMongoConnectionManager;

const tenantEvictionListener =
  engine === "postgres"
    ? TenantDeletionEvictionListener
    : TenantMongoDeletionEvictionListener;

const natsProvider = createNatsConnectionProvider(
  resolveServiceName("workflow-service"),
);

const jetStreamManagerProvider: FactoryProvider<Promise<JetStreamManager>> = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: (nc: NatsConnection): Promise<JetStreamManager> =>
    nc.jetstreamManager(),
};

const jetStreamPublisherProvider: FactoryProvider<JetStreamClient> = {
  provide: JETSTREAM_PUBLISHER,
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
  useFactory: (nc: NatsConnection, _jsm: JetStreamManager): JetStreamClient =>
    nc.jetstream(),
};

@Global()
@Module({
  providers: [
    temporalClientProvider,
    natsProvider,
    jetStreamManagerProvider,
    jetStreamPublisherProvider,
    {
      provide: WorkflowTenantConnectionManager,
      useClass: tenantManagerClass,
    },
    {
      provide: TENANT_DB_CONNECTION_MANAGER,
      useExisting: WorkflowTenantConnectionManager,
    },
    {
      provide: tenantBaseManagerToken,
      useExisting: WorkflowTenantConnectionManager,
    },
    tenantEvictionListener,
    // Postgres connection for system variables — always available,
    // regardless of the workflow data storage engine. When the engine
    // is "postgres", reuse the existing connection manager (same pool).
    // When "mongo", create a dedicated Postgres pool.
    {
      provide: SYSTEM_VARIABLES_PG,
      ...(engine === "postgres"
        ? { useExisting: WorkflowTenantConnectionManager }
        : { useClass: WorkflowTenantConnectionManagerPostgres }),
    },
  ],
  exports: [
    TEMPORAL_CLIENT,
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_PUBLISHER,
    WorkflowTenantConnectionManager,
    TENANT_DB_CONNECTION_MANAGER,
    SYSTEM_VARIABLES_PG,
  ],
})
export class ProvidersModule {}
