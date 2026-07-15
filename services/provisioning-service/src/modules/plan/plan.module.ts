import { Module } from "@nestjs/common";
import { ManifestsModule } from "../manifests/manifests.module";
import type { ISecretsStore } from "../secrets/domain/secrets-store.interface";
import { SECRETS_STORE } from "../secrets/domain/secrets-store.interface";
import { SecretsModule } from "../secrets/secrets.module";
import { PLATFORM_RESOURCE_CLIENTS } from "./domain/platform-resource-client.interface";
import { SECRET_EXISTENCE_CHECKER } from "./domain/secret-existence-checker.interface";
import { createK8sSecretExistenceChecker } from "./infrastructure/k8s-secret-existence-checker";
import { buildPlatformResourceClients } from "./infrastructure/platform-resource-clients.provider";
import { PlanController } from "./plan.controller";
import { PlanService } from "./plan.service";

@Module({
  imports: [ManifestsModule, SecretsModule],
  providers: [
    PlanService,
    {
      provide: PLATFORM_RESOURCE_CLIENTS,
      useFactory: buildPlatformResourceClients,
    },
    {
      // T05: real k8s Secret existence check, backed by the SAME
      // ISecretsStore the secrets broker uses — never a value, existence only.
      provide: SECRET_EXISTENCE_CHECKER,
      useFactory: (store: ISecretsStore) =>
        createK8sSecretExistenceChecker(store),
      inject: [SECRETS_STORE],
    },
  ],
  controllers: [PlanController],
  // PLATFORM_RESOURCE_CLIENTS is exported so ApplyModule (T04) can reuse the
  // SAME read-only client factory to build a fresh plan right before every
  // apply, instead of re-instantiating a parallel client set.
  exports: [PlanService, PLATFORM_RESOURCE_CLIENTS],
})
export class PlanModule {}
