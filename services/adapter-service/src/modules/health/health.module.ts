import { Module } from "@nestjs/common";
import { InternalSyncModule } from "../internal-sync/internal-sync.module";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

/**
 * Health module — Phase 4 mode-aware probes (REQ-AST-002/003/004/005).
 *
 * The module is loaded into `AppModule` regardless of `SERVICE_MODE`
 * (api or worker). Imports stay constant to keep the DI graph
 * deterministic across roles; the runtime gates inside
 * {@link HealthService} branch on `isWorkerMode()` so the api role
 * skips the worker-only checks (NATS, durables) and the worker role
 * applies them.
 *
 * `NATS_CONNECTION` and `AdapterTenantConnectionManager` come from
 * the global `ProvidersModule`; `InternalSyncService` is exported by
 * `InternalSyncModule` so the health probe can read its read-only
 * runner-health snapshot without reaching into private state.
 */
@Module({
  imports: [InternalSyncModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
