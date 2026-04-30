import { Global, Module } from "@nestjs/common";
import {
  NATS_CONNECTION,
  TenantConnectionManager as BaseTenantConnectionManager,
  TenantDeletionEvictionListener,
  TenantReadySchemaListener,
  createNatsConnectionProvider,
} from "@yoizen/database";
import { ObservabilityModule, resolveServiceName } from "@yoizen/observability";
import { KubernetesModule } from "./providers/kubernetes.provider";
import { TenantConnectionManager } from "./providers/tenant-connection-manager";
import { SchedulesModule } from "./modules/schedules/schedules.module";
import { ExecutionsModule } from "./modules/executions/executions.module";
import { EngineModule } from "./engine/engine.module";
import { ExecutorsModule } from "./executors/executors.module";
import { HealthModule } from "./modules/health/health.module";

/**
 * NATS connection used for two best-effort, fire-and-forget fan-out
 * subjects:
 *  - `platform.tenant.deleted` → per-tenant pool eviction
 *    ({@link TenantDeletionEvictionListener}).
 *  - `platform.tenant.ready`   → proactive per-tenant DDL warm-up
 *    ({@link TenantReadySchemaListener}) so the first scheduler tick
 *    after a fresh provision doesn't race the lazy `ensureSchema` and
 *    return `relation "schedules" does not exist` to the caller.
 *
 * scheduler-service is otherwise NATS-free, so the surface area is
 * intentionally minimal: a single eager Core NATS connection + two
 * listeners. JetStream is NOT wired here — both events are best-effort
 * and the secondary self-heal in `BaseTenantConnectionManager.verifyConnectivity`
 * (deletion) and the lazy `ensureSchema` path (ready) cover any miss.
 */
const natsProvider = createNatsConnectionProvider(
  resolveServiceName("scheduler-service"),
);

/** Registers shared infrastructure (K8s, tenant connections) as global providers. */
@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "scheduler-service" }),
    KubernetesModule,
    EngineModule,
    ExecutorsModule,
    SchedulesModule,
    ExecutionsModule,
    HealthModule,
  ],
  providers: [
    natsProvider,
    TenantConnectionManager,
    // Both listeners depend on the base `TenantConnectionManager` token
    // from `@yoizen/database`; the local class above is a *different*
    // class symbol, so an explicit alias is required so eviction +
    // schema-warm act on the same pool cache rather than spinning up
    // parallel ones.
    {
      provide: BaseTenantConnectionManager,
      useExisting: TenantConnectionManager,
    },
    TenantDeletionEvictionListener,
    TenantReadySchemaListener,
  ],
  exports: [NATS_CONNECTION, TenantConnectionManager],
})
export class AppModule {}
