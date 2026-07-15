// T06 knowledge-base module: wires the checksum repository (Postgres),
// the NATS Object Store blob store, and the agent-admin HTTP client into a
// single `IKnowledgeBaseReconciler`, exported for `PlanModule` (checksum
// reads for the plan estimate) and `ApplyModule` (full reconciliation).

import { Global, Module } from "@nestjs/common";
import type { JetStreamClient } from "nats";
import { provisioningServiceConfig } from "../../config";
import { NatsModule } from "../../providers/nats.module";
import { JETSTREAM } from "../../providers/nats.provider";
import { KB_RECONCILER } from "./domain/kb.interfaces";
import type { IKbBlobStore } from "./domain/kb-blob-store.interface";
import { KB_BLOB_STORE } from "./domain/kb-blob-store.interface";
import type { IKbChecksumRepository } from "./domain/kb-checksum-repository.interface";
import { KB_CHECKSUM_REPOSITORY } from "./domain/kb-checksum-repository.interface";
import { createAgentAdminKbClient } from "./infrastructure/agent-admin-kb-client";
import { KbChecksumPostgresRepository } from "./infrastructure/kb-checksum.postgres.repository";
import { createNatsKbBlobStore } from "./infrastructure/nats-kb-blob-store";
import { createKnowledgeBaseReconciler } from "./lib/reconcile-knowledge-base";

// NATS connection + JetStream come from the single shared `NatsModule`
// (@Global) — NOT re-declared here, so KB and Apply share ONE connection
// instead of each opening its own at boot (see nats.module.ts header).
// `ProvisioningTenantConnectionManager` is provided by the `@Global()`
// `ProvidersModule` already (imported by `AppModule`). `@Global()` on THIS
// module lets `PlanModule`/`ApplyModule` inject `KB_CHECKSUM_REPOSITORY`/
// `KB_RECONCILER` without an explicit `imports` wire, same convenience
// `ProvidersModule` gives the rest of the service.
@Global()
@Module({
  imports: [NatsModule],
  providers: [
    KbChecksumPostgresRepository,
    {
      provide: KB_CHECKSUM_REPOSITORY,
      useExisting: KbChecksumPostgresRepository,
    },
    {
      provide: KB_BLOB_STORE,
      useFactory: (js: JetStreamClient) => createNatsKbBlobStore(js),
      inject: [JETSTREAM],
    },
    {
      provide: KB_RECONCILER,
      useFactory: (
        checksumRepository: IKbChecksumRepository,
        blobStore: IKbBlobStore
      ) =>
        createKnowledgeBaseReconciler({
          kbClient: createAgentAdminKbClient(
            provisioningServiceConfig.downstreamServiceUrls.agents
          ),
          checksumRepository,
          blobStore,
        }),
      inject: [KB_CHECKSUM_REPOSITORY, KB_BLOB_STORE],
    },
  ],
  exports: [KB_CHECKSUM_REPOSITORY, KB_RECONCILER],
})
export class KbModule {}
