// T04 apply engine: executes a FRESH T03 plan in dependency order via the
// injected `PlatformResourceWriters` (create-or-update by name/externalId —
// NEVER direct table writes, NEVER deletes, user decision 8).
//
// Stop-at-first-error semantics: iterates `plan.resources` (already
// dependency-ordered by `buildManifestPlan`) and halts on the first write
// failure, reporting `applied` (resources already processed) and `pending`
// (resources not yet reached). Re-applying the same manifest resumes: the
// caller (`ApplyService`) always builds a FRESH plan right before calling
// this function, so previously-created resources come back `noop` on the
// next attempt and are skipped here — no special resume bookkeeping needed.
//
// `noop` resources are never written and never emit a `resource_applied`
// audit event (SPEC.md: that event covers `create`/`update` actions only).
//
// Verbose logging on every resource processed, per SPEC.md's
// "nothing fails silently" constraint.

import type { IntegrationManifest } from "@yoizen/shared";
import type { ReconcileKbOutcome } from "../../kb/domain/kb.interfaces";
import type {
  ManifestPlan,
  ResourceVerdict,
} from "../../plan/domain/plan.interfaces";
import { RESOURCE_KIND_ORDER } from "../../plan/domain/plan.interfaces";
import { listManifestResources } from "../../plan/lib/list-manifest-resources";
import type { PlanLogger } from "../../plan/lib/plan-logger.interface";
import { NOOP_PLAN_LOGGER } from "../../plan/lib/plan-logger.interface";
import type {
  ApplyWriteError,
  ManifestApplyFailure,
  ManifestApplySuccess,
  ResourceOutcome,
} from "../domain/apply.interfaces";
import type { IApplyEventPublisher } from "../domain/apply-event-publisher.interface";
import type { PlatformResourceWriters } from "../domain/platform-resource-writer.interface";
import { buildSubstitutedResource } from "./build-substituted-resource";

export type ApplyManifestResult =
  | { readonly ok: true; readonly value: ManifestApplySuccess }
  | { readonly ok: false; readonly error: ManifestApplyFailure };

/** manual-loops/provisioning-manifest-gaps-2.md T03, gap 2 — result shape for
 * `ApplyManifestArgs.reconcileKnowledgeBases`. */
export type ReconcileKnowledgeBasesResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly externalIdsByName: ReadonlyMap<string, string>;
        readonly outcomes: readonly ReconcileKbOutcome[];
      };
    }
  | { readonly ok: false; readonly error: ApplyWriteError };

export interface ApplyManifestArgs {
  readonly manifest: IntegrationManifest;
  readonly tenantId: string;
  readonly plan: ManifestPlan;
  readonly revision: number;
  readonly writers: PlatformResourceWriters;
  readonly events: IApplyEventPublisher;
  readonly logger?: PlanLogger;
  /**
   * manual-loops/provisioning-manifest-gaps-2.md T03, gap 2 — called ONCE,
   * with the `resolvedIds` accumulated so far, right BEFORE the first
   * resource whose kind ranks AFTER "connector" in `RESOURCE_KIND_ORDER` is
   * processed (i.e. after every "connector"-kind resource in this run's plan
   * has been created/updated/noop'd) — so a KB's `ingestion_config`
   * `provider_connector_id` can resolve a connector created in the SAME
   * apply. If the plan has NO resources ranked after "connector" (or no
   * resources at all), this is instead called once, after the main loop,
   * with the FINAL `resolvedIds`. Replaces the pre-T03-gap-2 contract where
   * the caller ran KB reconciliation BEFORE this function was ever called
   * (see `kb.interfaces.ts` for why that ordering could not see a
   * same-apply connector). Manifests with no `knowledgeBases` may omit this
   * argument entirely — falls back to the old `knowledgeBaseExternalIdsByName`
   * argument below (back-compat for callers/tests that never reconcile KBs).
   */
  readonly reconcileKnowledgeBases?: (
    connectorResolvedIds: ReadonlyMap<string, string>
  ) => Promise<ReconcileKnowledgeBasesResult>;
  /** Back-compat / no-KB-reconciliation call sites: a pre-computed
   * `kbName -> kbExternalId` map, used verbatim if `reconcileKnowledgeBases`
   * is not supplied. */
  readonly knowledgeBaseExternalIdsByName?: ReadonlyMap<string, string>;
}

const CONNECTOR_RANK = RESOURCE_KIND_ORDER.indexOf("connector");
const KIND_RANK: ReadonlyMap<string, number> = new Map(
  RESOURCE_KIND_ORDER.map((kind, index) => [kind, index])
);

export async function applyManifestPlan(
  args: ApplyManifestArgs
): Promise<ApplyManifestResult> {
  const { manifest, tenantId, plan, revision, writers, events } = args;
  const logger = args.logger ?? NOOP_PLAN_LOGGER;
  const startedAt = Date.now();

  logger.log(
    `apply: starting manifest='${plan.manifestName}' tenant='${tenantId}' resources=${String(plan.resources.length)}`
  );
  // The run root: its returned causal context (correlation_id = root id,
  // causation_id = root id) is threaded into every sibling event below so
  // the whole apply run forms ONE correlation chain (TAXONOMY.md rule 22
  // addendum + golden rows seq1322-1326).
  const runAudit = await events.applyStarted({
    tenantId,
    manifestName: plan.manifestName,
    revision,
    resourceCount: plan.resources.length,
  });

  const resourcesByKey = new Map(
    listManifestResources(manifest).map((entry) => [
      `${entry.kind}:${entry.name}`,
      entry.resource,
    ])
  );

  const outcomes: ResourceOutcome[] = [];
  let appliedCount = 0;
  let noopCount = 0;

  // T03, gap 3 — "<kind>:<name>" -> real platform id, populated as each
  // resource is processed. Since `plan.resources` is already in dependency
  // order (`topological-resource-order.ts`), by the time a workflow/agent
  // is reached every resource it may reference by symbolic ref is already
  // present here (create/update's fresh externalId, or noop/external's
  // plan-time externalId) — see `buildSubstitutedResource`.
  const resolvedIds = new Map<string, string>();

  // T03 (gaps-2), gap 2 — `kbName -> kbExternalId`, populated by the
  // `reconcileKnowledgeBases` hook (or seeded from the back-compat
  // `knowledgeBaseExternalIdsByName` argument for callers that don't
  // reconcile KBs at all) BEFORE the first post-connector resource is
  // processed; threaded into every `writerContext` from that point on so
  // `agents-writer.ts` keeps resolving `knowledgeBaseRefs` exactly as before.
  let knowledgeBaseExternalIdsByName: ReadonlyMap<string, string> =
    args.knowledgeBaseExternalIdsByName ?? new Map();
  let knowledgeBaseOutcomes: readonly ReconcileKbOutcome[] = [];
  let kbReconciled = false;

  const runKbReconciliationHook = async (): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly error: ApplyWriteError }
  > => {
    kbReconciled = true;
    if (!args.reconcileKnowledgeBases) {
      return { ok: true };
    }
    logger.log(
      `apply: reconciling knowledgeBases (connectors resolved=${String(resolvedIds.size)}) before the next resource kind`
    );
    const kbResult = await args.reconcileKnowledgeBases(new Map(resolvedIds));
    if (!kbResult.ok) {
      return { ok: false, error: kbResult.error };
    }
    knowledgeBaseExternalIdsByName = kbResult.value.externalIdsByName;
    knowledgeBaseOutcomes = kbResult.value.outcomes;
    logger.log(
      `apply: knowledgeBases reconciled -> ${String(knowledgeBaseOutcomes.length)} kb(s)`
    );
    return { ok: true };
  };

  for (let i = 0; i < plan.resources.length; i++) {
    const entry = plan.resources[i];
    if (!entry) {
      continue;
    }

    if (!kbReconciled && (KIND_RANK.get(entry.kind) ?? 0) > CONNECTOR_RANK) {
      const kbHookResult = await runKbReconciliationHook();
      if (!kbHookResult.ok) {
        logger.warn(
          `apply: knowledgeBases reconciliation FAILED (${kbHookResult.error.kind}): ${kbHookResult.error.message}`
        );
        await events.applyFailed({
          tenantId,
          manifestName: plan.manifestName,
          failure: kbHookResult.error,
          appliedSoFar: outcomes.map((o) => ({ kind: o.kind, name: o.name })),
          correlationId: runAudit.correlationId,
          causationId: runAudit.causationId,
        });
        const pending = buildPending(plan, i);
        return {
          ok: false,
          error: {
            kind: "apply_failed",
            manifestName: plan.manifestName,
            applied: outcomes,
            pending,
            failure: kbHookResult.error,
            durationMs: Date.now() - startedAt,
          },
        };
      }
    }

    if (entry.external || entry.verdict === "noop") {
      logger.log(
        `apply: ${entry.kind} '${entry.name}' verdict='noop' — nothing to write`
      );
      outcomes.push({
        kind: entry.kind,
        name: entry.name,
        verdict: "noop",
        externalId: entry.externalId,
      });
      if (entry.externalId) {
        resolvedIds.set(`${entry.kind}:${entry.name}`, entry.externalId);
      }
      noopCount++;
      continue;
    }

    const resource = resourcesByKey.get(`${entry.kind}:${entry.name}`);
    if (!resource) {
      // Defensive: should never happen, the plan is derived from the same
      // manifest resource list.
      continue;
    }

    const writer = writers[entry.kind];
    const verdict: "create" | "update" = entry.verdict;

    // T03, gap 3 — substitute allowlisted symbolic refs in the workflow
    // `definition` / agent `profile` BEFORE the writer ever sees the
    // resource. Works on a WORKING COPY only (see
    // `substitute-symbolic-refs.ts`) — never mutates `resource`, which is
    // backed by the manifest object `PUT /manifests/:name` stored.
    const substituted = buildSubstitutedResource({
      kind: entry.kind,
      resource,
      resolvedIds,
      logger,
    });
    if (!substituted.ok) {
      logger.warn(
        `apply: ${entry.kind} '${entry.name}' FAILED (${substituted.error.kind}): ${substituted.error.message}`
      );
      await events.applyFailed({
        tenantId,
        manifestName: plan.manifestName,
        failure: substituted.error,
        appliedSoFar: outcomes.map((o) => ({ kind: o.kind, name: o.name })),
        correlationId: runAudit.correlationId,
        causationId: runAudit.causationId,
      });
      const pending = buildPending(plan, i + 1);
      return {
        ok: false,
        error: {
          kind: "apply_failed",
          manifestName: plan.manifestName,
          applied: outcomes,
          pending,
          failure: substituted.error,
          durationMs: Date.now() - startedAt,
        },
      };
    }

    logger.log(
      `apply: ${entry.kind} '${entry.name}' verdict='${verdict}' — writing via ${entry.kind} writer`
    );

    // T05: threads the run's correlationId into the writer so a
    // secretRef resolution (channels/connectors) audits as a SIBLING of
    // this apply run (see `secret-audit-publisher.interface.ts`).
    // T06 / T03 (gaps-2): threads the KB reconciler's name->externalId map
    // (now populated MID-LOOP by `runKbReconciliationHook`, see above) so
    // `agents-writer.ts` can resolve `knowledgeBaseRefs`.
    const writerContext = {
      correlationId: runAudit.correlationId,
      knowledgeBaseExternalIds: knowledgeBaseExternalIdsByName,
    };
    const result =
      verdict === "create"
        ? await writer.create(tenantId, substituted.value, writerContext)
        : await writer.update(
            tenantId,
            entry.externalId ?? "",
            substituted.value,
            entry.diff,
            writerContext
          );

    if (!result.ok) {
      logger.warn(
        `apply: ${entry.kind} '${entry.name}' FAILED (${result.error.kind}): ${result.error.message}`
      );
      await events.applyFailed({
        tenantId,
        manifestName: plan.manifestName,
        failure: result.error,
        appliedSoFar: outcomes.map((o) => ({ kind: o.kind, name: o.name })),
        correlationId: runAudit.correlationId,
        causationId: runAudit.causationId,
      });
      const pending = buildPending(plan, i + 1);
      return {
        ok: false,
        error: {
          kind: "apply_failed",
          manifestName: plan.manifestName,
          applied: outcomes,
          pending,
          failure: result.error,
          durationMs: Date.now() - startedAt,
        },
      };
    }

    logger.log(
      `apply: ${entry.kind} '${entry.name}' ${verdict}d -> externalId='${result.value.externalId}'`
    );
    outcomes.push({
      kind: entry.kind,
      name: entry.name,
      verdict,
      externalId: result.value.externalId,
    });
    resolvedIds.set(`${entry.kind}:${entry.name}`, result.value.externalId);
    appliedCount++;
    await events.resourceApplied({
      tenantId,
      manifestName: plan.manifestName,
      kind: entry.kind,
      name: entry.name,
      verdict,
      externalId: result.value.externalId,
      correlationId: runAudit.correlationId,
      causationId: runAudit.causationId,
    });
  }

  // T03 (gaps-2), gap 2 — fallback: the plan had NO resource ranked after
  // "connector" (e.g. a `kind: library` manifest with only connectors +
  // knowledgeBases, zero agents/workflows/services/systemVariables) so the
  // per-entry check inside the loop above never fired. Reconcile now, with
  // whatever `resolvedIds` the loop DID accumulate (every connector in the
  // plan, since nothing ranked at/after connector remains unprocessed).
  if (!kbReconciled) {
    const kbHookResult = await runKbReconciliationHook();
    if (!kbHookResult.ok) {
      logger.warn(
        `apply: knowledgeBases reconciliation FAILED (${kbHookResult.error.kind}): ${kbHookResult.error.message}`
      );
      await events.applyFailed({
        tenantId,
        manifestName: plan.manifestName,
        failure: kbHookResult.error,
        appliedSoFar: outcomes.map((o) => ({ kind: o.kind, name: o.name })),
        correlationId: runAudit.correlationId,
        causationId: runAudit.causationId,
      });
      return {
        ok: false,
        error: {
          kind: "apply_failed",
          manifestName: plan.manifestName,
          applied: outcomes,
          pending: [],
          failure: kbHookResult.error,
          durationMs: Date.now() - startedAt,
        },
      };
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.log(
    `apply: completed manifest='${plan.manifestName}' tenant='${tenantId}' applied=${String(appliedCount)} noop=${String(noopCount)} durationMs=${String(durationMs)}`
  );
  await events.applyCompleted({
    tenantId,
    manifestName: plan.manifestName,
    appliedCount,
    noopCount,
    durationMs,
    correlationId: runAudit.correlationId,
    causationId: runAudit.causationId,
  });

  return {
    ok: true,
    value: {
      manifestName: plan.manifestName,
      resources: outcomes,
      appliedCount,
      noopCount,
      durationMs,
      knowledgeBases: knowledgeBaseOutcomes,
    },
  };
}

function buildPending(
  plan: ManifestPlan,
  fromIndex: number
): readonly {
  kind: ManifestPlan["resources"][number]["kind"];
  name: string;
  verdict: ResourceVerdict;
}[] {
  const pending: {
    kind: ManifestPlan["resources"][number]["kind"];
    name: string;
    verdict: ResourceVerdict;
  }[] = [];
  for (let i = fromIndex; i < plan.resources.length; i++) {
    const entry = plan.resources[i];
    if (!entry) {
      continue;
    }
    pending.push({
      kind: entry.kind,
      name: entry.name,
      verdict: entry.verdict,
    });
  }
  return pending;
}
