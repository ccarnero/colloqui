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
import type {
  ManifestPlan,
  ResourceVerdict,
} from "../../plan/domain/plan.interfaces";
import { listManifestResources } from "../../plan/lib/list-manifest-resources";
import type { PlanLogger } from "../../plan/lib/plan-logger.interface";
import { NOOP_PLAN_LOGGER } from "../../plan/lib/plan-logger.interface";
import type {
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

export interface ApplyManifestArgs {
  readonly manifest: IntegrationManifest;
  readonly tenantId: string;
  readonly plan: ManifestPlan;
  readonly revision: number;
  readonly writers: PlatformResourceWriters;
  readonly events: IApplyEventPublisher;
  readonly logger?: PlanLogger;
  /** T06: `kbName -> kbExternalId` map from the KB reconciler, run before this call. */
  readonly knowledgeBaseExternalIdsByName?: ReadonlyMap<string, string>;
}

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

  for (let i = 0; i < plan.resources.length; i++) {
    const entry = plan.resources[i];
    if (!entry) {
      continue;
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
    // T06: threads the KB reconciler's name->externalId map so
    // `agents-writer.ts` can resolve `knowledgeBaseRefs`.
    const writerContext = {
      correlationId: runAudit.correlationId,
      knowledgeBaseExternalIds: args.knowledgeBaseExternalIdsByName,
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
