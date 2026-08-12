import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { err, ok, type Result } from "../../lib/result";
import type { IKbChecksumTeardownRepository } from "../kb/domain/kb-checksum-teardown.repository.interface";
import { KB_CHECKSUM_TEARDOWN_REPOSITORY } from "../kb/domain/kb-checksum-teardown.repository.interface";
import {
  type IManifestRevisionRepository,
  MANIFEST_REVISION_REPOSITORY,
} from "../manifests/domain/manifest-revision.repository.interface";
import {
  type IManifestTeardownRepository,
  MANIFEST_TEARDOWN_REPOSITORY,
} from "../manifests/domain/manifest-teardown.repository.interface";
import type { CycleDetectedError } from "../plan/domain/plan.interfaces";
import { SecretsService } from "../secrets/secrets.service";
import type { PlatformResourceDeleters } from "./domain/platform-resource-deleter.interface";
import { PLATFORM_RESOURCE_DELETERS } from "./domain/platform-resource-deleter.interface";
import type {
  ManifestNotFoundUndeployError,
  ManifestUndeployFailure,
  ManifestUndeploySuccess,
  UndeployBlockedError,
} from "./domain/undeploy.interfaces";
import { buildUndeployOrder } from "./lib/build-undeploy-order";
import { findBlockingReferences } from "./lib/find-blocking-references";
import { undeployManifest } from "./lib/undeploy-manifest";

export type UndeployError =
  | ManifestNotFoundUndeployError
  | UndeployBlockedError
  | CycleDetectedError
  | ManifestUndeployFailure;

/**
 * The undeploy verb (PENDIENTES/12-undeploy.spec.md T01) — mirrors
 * `ApplyService`'s division of labour: this class does the I/O around the run
 * (load the stored manifest, guard, clean provisioning's own state) and
 * `lib/undeploy-manifest.ts` does the ordered deletion.
 *
 * Order of operations, all of it deliberate:
 *   1. load the STORED manifest (404 `manifest_not_found` if absent);
 *   2. decision 4 guard — refuse (409 `undeploy_blocked`) while ANOTHER
 *      stored manifest of this tenant consumes a resource this one owns;
 *   3. compute the REVERSE of apply's dependency order;
 *   4. delete resources (and each resource's secrets right after it);
 *   5. ONLY when every non-skipped outcome succeeded: drop the manifest's
 *      `kb_document_checksums` rows, then the stored manifest record LAST.
 *      A partial undeploy keeps the record so a re-run resumes.
 *
 * NO audit events are published, deliberately: apply emits
 * `apply_started`/`resource_applied`/`apply_completed`/`apply_failed`
 * (`apply/domain/apply-event-publisher.interface.ts`, TAXONOMY.md rule 22),
 * and the undeploy equivalents would be NEW event kinds — a human-approved
 * taxonomy registration, out of scope for this task. Reported as a finding
 * instead of quietly reusing the apply kinds for a teardown. Every step is
 * still fully logged below.
 */
@Injectable()
export class UndeployService {
  private readonly logger = new PinoLoggerService(UndeployService.name);

  constructor(
    @Inject(MANIFEST_REVISION_REPOSITORY)
    private readonly manifestRepository: IManifestRevisionRepository,
    @Inject(MANIFEST_TEARDOWN_REPOSITORY)
    private readonly manifestTeardown: IManifestTeardownRepository,
    @Inject(KB_CHECKSUM_TEARDOWN_REPOSITORY)
    private readonly kbChecksums: IKbChecksumTeardownRepository,
    @Inject(PLATFORM_RESOURCE_DELETERS)
    private readonly deleters: PlatformResourceDeleters,
    private readonly secrets: SecretsService
  ) {}

  async undeploy(
    tenantId: string,
    name: string
  ): Promise<Result<ManifestUndeploySuccess, UndeployError>> {
    const startedAt = Date.now();
    this.logger.log(
      `undeploy: loading manifest='${name}' tenant='${tenantId}'`
    );

    const revision = await this.manifestRepository.getLatest(tenantId, name);
    if (!revision) {
      this.logger.warn(
        `undeploy: no manifest named '${name}' found for tenant='${tenantId}'`
      );
      return err({ kind: "manifest_not_found", name });
    }

    const storedManifests =
      await this.manifestTeardown.listLatestManifests(tenantId);
    const dependents = findBlockingReferences(
      revision.manifest,
      storedManifests.map((stored) => stored.manifest)
    );
    if (dependents.length > 0) {
      const pairs = dependents
        .map((d) => `${d.manifestName}:${d.resourceKind}/${d.resourceName}`)
        .join(", ");
      this.logger.warn(
        `undeploy: BLOCKED manifest='${name}' tenant='${tenantId}' — ${String(dependents.length)} external reference(s) from other stored manifests: ${pairs}`
      );
      return err({
        kind: "undeploy_blocked",
        manifestName: name,
        dependents,
        message: `manifest '${name}' cannot be undeployed: ${String(dependents.length)} resource(s) it owns are referenced as external by other stored manifests (${pairs}). Undeploy or edit those manifests first.`,
      });
    }

    const order = buildUndeployOrder(revision.manifest);
    if (!order.ok) {
      this.logger.warn(
        `undeploy: manifest='${name}' has a dependency cycle: ${order.error.message}`
      );
      return err(order.error);
    }

    this.logger.log(
      `undeploy: manifest='${name}' revision=${String(revision.revision)} reverse order: ${order.value.map((t) => `${t.kind}:${t.name}`).join(" -> ")}`
    );

    const run = await undeployManifest({
      manifest: revision.manifest,
      tenantId,
      targets: order.value,
      deleters: this.deleters,
      deleteSecret: async (secretTenantId, secretName, scope) => {
        const result = await this.secrets.delete(
          secretTenantId,
          secretName,
          scope
        );
        return result.ok
          ? { ok: true, value: { deleted: result.value.deleted } }
          : { ok: false, error: result.error.message };
      },
      logger: this.logger,
    });

    if (!run.ok) {
      this.logger.warn(
        `undeploy: PARTIAL manifest='${name}' tenant='${tenantId}' — stored manifest KEPT so a re-run resumes (${String(run.error.pending.length)} resource(s) pending)`
      );
      return err(run.error);
    }

    // Own-state cleanup — reached only when every non-skipped outcome
    // succeeded (the engine stops at the first error).
    const checksumRowsDeleted = await this.kbChecksums.deleteByManifest(
      tenantId,
      name
    );
    this.logger.log(
      `undeploy: dropped ${String(checksumRowsDeleted)} kb_document_checksums row(s) for manifest='${name}'`
    );

    const revisionsDeleted = await this.manifestTeardown.deleteManifest(
      tenantId,
      name
    );
    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `undeploy: COMPLETED manifest='${name}' tenant='${tenantId}' deleted=${String(run.value.deletedCount)} notFound=${String(run.value.notFoundCount)} skipped=${String(run.value.skippedCount)} manifestRevisionsDeleted=${String(revisionsDeleted)} durationMs=${String(durationMs)}`
    );

    return ok({
      manifestName: run.value.manifestName,
      resources: run.value.resources,
      secrets: run.value.secrets,
      deletedCount: run.value.deletedCount,
      notFoundCount: run.value.notFoundCount,
      skippedCount: run.value.skippedCount,
      checksumRowsDeleted,
      manifestRecordDeleted: revisionsDeleted > 0,
      durationMs,
    });
  }
}
