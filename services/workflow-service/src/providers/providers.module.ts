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
  ],
  exports: [
    TEMPORAL_CLIENT,
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_PUBLISHER,
    WorkflowTenantConnectionManager,
    TENANT_DB_CONNECTION_MANAGER,
  ],
})
export class ProvidersModule {}
