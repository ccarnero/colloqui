// Write-only Secret API service (SPEC.md decision 4). `write` creates/
// updates ONE k8s Secret `psec-<kind>-<owner>`; `list` returns names +
// bindings ONLY — this file (and everything it calls) NEVER returns a
// secret value to a controller.

import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { err, ok, type Result } from "../../lib/result";
import type { ResourceKind } from "../plan/domain/plan.interfaces";
import type { ISecretAuditPublisher } from "./domain/secret-audit-publisher.interface";
import { SECRET_AUDIT_PUBLISHER } from "./domain/secret-audit-publisher.interface";
import type {
  ISecretsStore,
  SecretBindingSummary,
  SecretsStoreError,
} from "./domain/secrets-store.interface";
import { SECRETS_STORE } from "./domain/secrets-store.interface";

export interface WriteSecretInput {
  readonly value: string;
  readonly scope: { readonly kind: ResourceKind; readonly owner: string };
}

@Injectable()
export class SecretsService {
  private readonly logger = new PinoLoggerService(SecretsService.name);

  constructor(
    @Inject(SECRETS_STORE) private readonly store: ISecretsStore,
    @Inject(SECRET_AUDIT_PUBLISHER)
    private readonly audit: ISecretAuditPublisher
  ) {}

  /** Never returns the value — the write-only guarantee starts here. */
  async write(
    tenantId: string,
    name: string,
    input: WriteSecretInput
  ): Promise<
    Result<
      { name: string; scope: WriteSecretInput["scope"] },
      SecretsStoreError
    >
  > {
    this.logger.log(
      `write: secret='${name}' scope='${input.scope.kind}/${input.scope.owner}' tenant='${tenantId}' (value NEVER logged)`
    );
    const result = await this.store.write(
      tenantId,
      name,
      input.value,
      input.scope
    );
    if (!result.ok) {
      this.logger.error(
        `write: FAILED secret='${name}': ${result.error.message}`
      );
      return err(result.error);
    }
    this.logger.log(`write: secret='${name}' persisted (k8s Secret upserted)`);
    await this.audit.secretWritten({
      tenantId,
      secretName: name,
      kind: input.scope.kind,
      owner: input.scope.owner,
    });
    return ok({ name, scope: input.scope });
  }

  /**
   * PENDIENTES/12-undeploy.spec.md T01 item 4 / decision 2 ("secrets die with
   * the manifest"): removes ONE named secret from its owning resource's k8s
   * Secret. Idempotent — deleting an absent secret returns
   * `deleted: false`, never an error, so `undeploy` is safe to run twice.
   * Like every other method here, it never reads or returns a value.
   */
  async delete(
    tenantId: string,
    name: string,
    scope: WriteSecretInput["scope"]
  ): Promise<
    Result<
      { name: string; scope: WriteSecretInput["scope"]; deleted: boolean },
      SecretsStoreError
    >
  > {
    this.logger.log(
      `delete: secret='${name}' scope='${scope.kind}/${scope.owner}' tenant='${tenantId}'`
    );
    const result = await this.store.deleteKey(tenantId, name, scope);
    if (!result.ok) {
      this.logger.error(
        `delete: FAILED secret='${name}': ${result.error.message}`
      );
      return err(result.error);
    }
    this.logger.log(
      `delete: secret='${name}' ${result.value.deleted ? "removed from the k8s Secret" : "was already absent"}`
    );
    // NO audit event: `ISecretAuditPublisher` has no `secret_deleted` kind,
    // and adding one is a NEW event kind in the taxonomy (human-approved
    // registration, TAXONOMY rule 23) — out of scope for this task and
    // reported as a finding instead of quietly reusing `secret_written`.
    return ok({ name, scope, deleted: result.value.deleted });
  }

  /** Names + bindings ONLY — never a value. */
  async list(
    tenantId: string
  ): Promise<Result<readonly SecretBindingSummary[], SecretsStoreError>> {
    this.logger.log(`list: secrets tenant='${tenantId}'`);
    const result = await this.store.list(tenantId);
    if (!result.ok) {
      this.logger.error(
        `list: FAILED tenant='${tenantId}': ${result.error.message}`
      );
      return err(result.error);
    }
    this.logger.log(`list: ${String(result.value.length)} binding(s) found`);
    return ok(result.value);
  }
}
