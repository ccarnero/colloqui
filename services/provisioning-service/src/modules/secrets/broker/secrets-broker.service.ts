// T05 secrets broker (SPEC.md decision 5) — the single RBAC-privileged
// reader living INSIDE provisioning-service. NEVER exposed via the
// api-gateway (T07's gateway module must not proxy the internal resolve
// route this service backs — see `secrets-broker.controller.ts`).
//
// Resolution mechanics: see the doc comment on `ResolveSecretRequest` in
// `../domain/secret-broker.interfaces.ts` for why a mismatched
// `actingResource` concretely fails as "the requested key is not present
// in THAT resource's Secret" rather than a separate stored-binding lookup.
//
// Every denial path is audited (`secret_access_denied`) with NO value in
// the payload; every success is audited (`secret_resolved`), also value-
// free. Verbose logging on every branch, values NEVER logged.

import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { ISecretAuditPublisher } from "../domain/secret-audit-publisher.interface";
import { SECRET_AUDIT_PUBLISHER } from "../domain/secret-audit-publisher.interface";
import type {
  ISecretsBroker,
  ResolveSecretRequest,
  ResolveSecretResult,
} from "../domain/secret-broker.interfaces";
import type { ISecretsStore } from "../domain/secrets-store.interface";
import { SECRETS_STORE } from "../domain/secrets-store.interface";
import { isConsumerAuthorized } from "../lib/secret-consumer-policy";

@Injectable()
export class SecretsBrokerService implements ISecretsBroker {
  private readonly logger = new PinoLoggerService(SecretsBrokerService.name);

  constructor(
    @Inject(SECRETS_STORE) private readonly store: ISecretsStore,
    @Inject(SECRET_AUDIT_PUBLISHER)
    private readonly audit: ISecretAuditPublisher
  ) {}

  async resolve(request: ResolveSecretRequest): Promise<ResolveSecretResult> {
    const {
      tenantId,
      consumerService,
      secretName,
      actingResource,
      correlationId,
    } = request;
    const { kind, owner } = actingResource;

    this.logger.log(
      `resolve: consumer='${consumerService}' secret='${secretName}' actingResource='${kind}/${owner}' tenant='${tenantId}' correlationId='${correlationId}' (value NEVER logged)`
    );

    // Consumer-identity authorization (SPEC.md decision 5: "broker checks
    // the binding matches"). Enforced BEFORE any k8s read so an
    // unauthorized identity never even triggers a credential read — a
    // caller reaching the internal route cannot impersonate another
    // service's role to read a resource secret it can merely name
    // (names/bindings are discoverable via the tenant-scoped GET /secrets,
    // so the consumer check is the layer that stops that discovery from
    // becoming a read). See `secret-consumer-policy.ts`.
    if (!isConsumerAuthorized(consumerService, kind)) {
      const reason = `consumer '${consumerService}' is not authorized to resolve '${kind}' secrets`;
      this.logger.warn(`resolve: DENIED (consumer_unauthorized) — ${reason}`);
      await this.audit.secretAccessDenied({
        tenantId,
        secretName,
        kind,
        owner,
        consumerService,
        correlationId,
        reason,
      });
      return {
        ok: false,
        error: { kind: "consumer_unauthorized", message: reason },
      };
    }

    const read = await this.store.readResourceSecret(tenantId, kind, owner);
    if (!read.ok) {
      const reason = `downstream error reading resource secret: ${read.error.message}`;
      this.logger.warn(`resolve: DENIED (downstream error) — ${reason}`);
      await this.audit.secretAccessDenied({
        tenantId,
        secretName,
        kind,
        owner,
        consumerService,
        correlationId,
        reason,
      });
      return {
        ok: false,
        error: { kind: "downstream_error", message: reason },
      };
    }

    if (read.value === null) {
      const reason = `no secret is bound to resource '${kind}/${owner}' yet`;
      this.logger.warn(`resolve: DENIED (not_found) — ${reason}`);
      await this.audit.secretAccessDenied({
        tenantId,
        secretName,
        kind,
        owner,
        consumerService,
        correlationId,
        reason,
      });
      return { ok: false, error: { kind: "not_found", message: reason } };
    }

    const value = read.value.get(secretName);
    if (value === undefined) {
      const reason = `secret '${secretName}' is not bound to resource '${kind}/${owner}' (binding mismatch)`;
      this.logger.warn(`resolve: DENIED (binding_mismatch) — ${reason}`);
      await this.audit.secretAccessDenied({
        tenantId,
        secretName,
        kind,
        owner,
        consumerService,
        correlationId,
        reason,
      });
      return {
        ok: false,
        error: { kind: "binding_mismatch", message: reason },
      };
    }

    this.logger.log(
      `resolve: GRANTED consumer='${consumerService}' secret='${secretName}' actingResource='${kind}/${owner}' (value NEVER logged)`
    );
    await this.audit.secretResolved({
      tenantId,
      secretName,
      kind,
      owner,
      consumerService,
      correlationId,
    });
    return { ok: true, value: { value } };
  }
}
