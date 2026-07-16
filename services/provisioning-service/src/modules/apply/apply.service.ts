import { Inject, Injectable, Optional } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { IntegrationManifest, SymbolicRefType } from "@yoizen/shared";
import { err, ok, type Result } from "../../lib/result";
import type { KbBundle, KbReconcileError } from "../kb/domain/kb.interfaces";
import {
  type IKnowledgeBaseReconciler,
  KB_RECONCILER,
  NOOP_KB_RECONCILER,
} from "../kb/domain/kb.interfaces";
import {
  type IManifestRevisionRepository,
  MANIFEST_REVISION_REPOSITORY,
} from "../manifests/domain/manifest-revision.repository.interface";
import type { CycleDetectedError } from "../plan/domain/plan.interfaces";
import type { PlatformResourceClients } from "../plan/domain/platform-resource-client.interface";
import { PLATFORM_RESOURCE_CLIENTS } from "../plan/domain/platform-resource-client.interface";
import { buildManifestPlan } from "../plan/lib/build-manifest-plan";
import { resourceKindOfRefType } from "../plan/lib/resource-kind-of-ref-type";
import type {
  ManifestApplyFailure,
  ManifestApplySuccess,
} from "./domain/apply.interfaces";
import type { IApplyEventPublisher } from "./domain/apply-event-publisher.interface";
import { APPLY_EVENT_PUBLISHER } from "./domain/apply-event-publisher.interface";
import type { PlatformResourceWriters } from "./domain/platform-resource-writer.interface";
import { PLATFORM_RESOURCE_WRITERS } from "./domain/platform-resource-writer.interface";
import type { ReconcileKnowledgeBasesResult } from "./lib/apply-manifest";
import { applyManifestPlan } from "./lib/apply-manifest";

export interface ManifestNotFoundApplyError {
  readonly kind: "manifest_not_found";
  readonly name: string;
}

export type ApplyError =
  | ManifestNotFoundApplyError
  | CycleDetectedError
  | KbReconcileError
  | ManifestApplyFailure;

@Injectable()
export class ApplyService {
  private readonly logger = new PinoLoggerService(ApplyService.name);

  constructor(
    @Inject(MANIFEST_REVISION_REPOSITORY)
    private readonly manifestRepository: IManifestRevisionRepository,
    @Inject(PLATFORM_RESOURCE_CLIENTS)
    private readonly clients: PlatformResourceClients,
    @Inject(PLATFORM_RESOURCE_WRITERS)
    private readonly writers: PlatformResourceWriters,
    @Inject(APPLY_EVENT_PUBLISHER)
    private readonly events: IApplyEventPublisher,
    // T06: optional so pre-T06 call sites (existing unit tests instantiate
    // `ApplyService` with 4 positional args) keep working unchanged — a
    // manifest with no `knowledgeBases` never even touches this.
    @Optional()
    @Inject(KB_RECONCILER)
    private readonly kbReconciler: IKnowledgeBaseReconciler = NOOP_KB_RECONCILER
  ) {}

  /**
   * Loads the latest stored revision of `name`, builds a FRESH plan against
   * current live state (so a re-apply after a partial failure always resumes
   * from reality, never a stale cached plan), then executes the T04 apply
   * engine — which now (manual-loops/provisioning-manifest-gaps-2.md T03,
   * gap 2) reconciles `knowledgeBases` MID-RUN, via the
   * `reconcileKnowledgeBases` hook, right after connectors resolve and
   * before agents, so a KB's `ingestion_config.provider_connector_id` can
   * resolve a connector created in THIS SAME apply. Never mutates anything
   * the planner did not already mark `create`/`update`.
   */
  async apply(
    tenantId: string,
    name: string,
    bundle?: KbBundle
  ): Promise<Result<ManifestApplySuccess, ApplyError>> {
    this.logger.log(`apply: loading manifest='${name}' tenant='${tenantId}'`);
    const revision = await this.manifestRepository.getLatest(tenantId, name);
    if (!revision) {
      this.logger.warn(
        `apply: no manifest named '${name}' found for tenant='${tenantId}'`
      );
      return err({ kind: "manifest_not_found", name });
    }

    const planResult = await buildManifestPlan(
      revision.manifest,
      tenantId,
      this.clients
    );
    if (!planResult.ok) {
      return err(planResult.error);
    }

    const result = await applyManifestPlan({
      manifest: revision.manifest,
      tenantId,
      plan: planResult.value,
      revision: revision.revision,
      writers: this.writers,
      events: this.events,
      reconcileKnowledgeBases: (connectorResolvedIds) =>
        // Close over the SAME `revision.manifest` snapshot the plan and apply
        // run were built from — never re-query `getLatest` mid-run (avoids a
        // TOCTOU race where a concurrent PUT between the initial load and this
        // hook, arbitrarily delayed by connector-writer I/O, would reconcile
        // KBs against a DIFFERENT, newer revision than the rest of this run).
        this.reconcileKnowledgeBases(
          tenantId,
          revision.manifest,
          bundle,
          connectorResolvedIds
        ),
    });

    if (!result.ok) {
      return err(result.error);
    }
    return ok(result.value);
  }

  /**
   * T03 (gaps-2), gap 2 — wraps `IKnowledgeBaseReconciler.reconcile` with a
   * `resolveRef` closure over the apply run's `connectorResolvedIds`
   * (`"connector:<name>" -> realId`, only connectors are relevant here since
   * `provider_connector_id` is the only ref kind currently allowed inside
   * `ingestion_config`), converting the connector-only lookup into the
   * generic `(refType, name) -> realId` shape `substitute-kb-ingestion-config.ts`
   * expects — mirrors `build-substituted-resource.ts`'s own `resolveRef`
   * closure exactly.
   *
   * `manifest` is the EXACT snapshot `apply()` loaded ONCE at the top of the
   * run (and used for BOTH `buildManifestPlan` and `applyManifestPlan`) — it
   * is passed in, NEVER re-fetched here, so plan, execution, and KB
   * reconciliation are guaranteed to operate on ONE consistent revision even
   * if a concurrent PUT lands mid-run (no `getLatest` round-trip, no TOCTOU
   * race).
   */
  private async reconcileKnowledgeBases(
    tenantId: string,
    manifest: IntegrationManifest,
    bundle: KbBundle | undefined,
    connectorResolvedIds: ReadonlyMap<string, string>
  ): Promise<ReconcileKnowledgeBasesResult> {
    const resolveRef = (
      refType: SymbolicRefType,
      refName: string
    ): string | undefined => {
      const targetKind = resourceKindOfRefType(refType);
      if (!targetKind) {
        return undefined;
      }
      return connectorResolvedIds.get(`${targetKind}:${refName}`);
    };

    const kbResult = await this.kbReconciler.reconcile(
      tenantId,
      manifest.metadata.name,
      manifest,
      bundle,
      undefined,
      resolveRef
    );
    if (!kbResult.ok) {
      this.logger.warn(
        `apply: knowledge-base reconciliation FAILED for manifest='${manifest.metadata.name}' tenant='${tenantId}': ${kbResult.error.message}`
      );
      return {
        ok: false,
        error: {
          kind: kbResult.error.kind,
          resourceKind: "knowledgeBase",
          resourceName: kbResult.error.kbName,
          message: kbResult.error.message,
        },
      };
    }

    return {
      ok: true,
      value: {
        externalIdsByName: new Map(
          kbResult.value.map((kb) => [kb.kbName, kb.kbExternalId])
        ),
        outcomes: kbResult.value,
      },
    };
  }
}
