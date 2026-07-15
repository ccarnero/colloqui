// T05 secrets module: write-only Secret CRUD + the internal-only broker.
// K8s wiring follows the same `KubernetesModule.register()` pattern
// `tenant-service`/`registry-service` use (`@yoizen/database`), standard
// in-cluster serviceaccount credentials — see
// `knative/services/rbac/cluster-role.yaml` for the RBAC this needs
// (human-applied, see module doc in that file).

import type { CoreV1Api } from "@kubernetes/client-node";
import { Module } from "@nestjs/common";
import { K8S_CORE_API, KubernetesModule } from "@yoizen/database";
import {
  jetStreamManagerProvider,
  jetStreamProvider,
  natsProvider,
} from "../../providers/nats.provider";
import { SecretsBrokerController } from "./broker/secrets-broker.controller";
import { SecretsBrokerService } from "./broker/secrets-broker.service";
import { SECRET_AUDIT_PUBLISHER } from "./domain/secret-audit-publisher.interface";
import { SECRETS_BROKER } from "./domain/secret-broker.interfaces";
import { SECRETS_STORE } from "./domain/secrets-store.interface";
import { createK8sSecretsStore } from "./infrastructure/k8s-secrets-store";
import { SecretAuditPublisher } from "./infrastructure/secret-audit.publisher";
import { SecretsController } from "./secrets.controller";
import { SecretsService } from "./secrets.service";

@Module({
  imports: [KubernetesModule.register()],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    SecretAuditPublisher,
    { provide: SECRET_AUDIT_PUBLISHER, useExisting: SecretAuditPublisher },
    {
      provide: SECRETS_STORE,
      useFactory: (coreApi: CoreV1Api) => createK8sSecretsStore(coreApi),
      inject: [K8S_CORE_API],
    },
    SecretsService,
    SecretsBrokerService,
    { provide: SECRETS_BROKER, useExisting: SecretsBrokerService },
  ],
  controllers: [SecretsController, SecretsBrokerController],
  exports: [SECRETS_STORE, SecretsBrokerService, SecretsService],
})
export class SecretsModule {}
