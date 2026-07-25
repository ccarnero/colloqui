// T03 orchestrator: dependency-ordered resolver + read-only planner.
//
// NEVER mutates anything — every downstream call is `findByName` (GET-only)
// against the injected `PlatformResourceClients`. Downstream failures are
// caught and surfaced as typed `downstream_error` preconditions, never
// thrown. Verbose logging at every stage per SPEC.md's "nothing fails
// silently" constraint.

import type {
  HostedService,
  IntegrationManifest,
  SymbolicRefType,
  Workflow,
} from "@yoizen/shared";
import {
  buildKbPlan,
  type StoredKbChecksumLookup,
} from "../../kb/lib/build-kb-plan";
import type {
  CycleDetectedError,
  ManifestPlan,
  PlanPrecondition,
  ResourcePlanEntry,
} from "../domain/plan.interfaces";
import type { PlatformResourceClients } from "../domain/platform-resource-client.interface";
import type { RouteCollisionChecker } from "../domain/route-collision-checker.interface";
import { NOOP_ROUTE_COLLISION_CHECKER } from "../domain/route-collision-checker.interface";
import type { SecretExistenceChecker } from "../domain/secret-existence-checker.interface";
import { NOOP_SECRET_EXISTENCE_CHECKER } from "../domain/secret-existence-checker.interface";
import {
  type RegisteredServiceDto,
  serviceEnvMechanismComparable,
  workflowComparable,
  workflowExistenceOnlyComparable,
} from "./comparable-fields";
import { desiredFieldsOfResource } from "./desired-fields-of-resource";
import { diffResource } from "./diff-resource";
import { gatherSecretReferences } from "./gather-secret-references";
import { listManifestResources } from "./list-manifest-resources";
import { NOOP_PLAN_LOGGER, type PlanLogger } from "./plan-logger.interface";
import { resourceKindOfRefType } from "./resource-kind-of-ref-type";
import { substituteSymbolicRefs } from "./substitute-symbolic-refs";
import { computeResourceOrder } from "./topological-resource-order";

export type BuildManifestPlanResult =
  | { readonly ok: true; readonly value: ManifestPlan }
  | { readonly ok: false; readonly error: CycleDetectedError };

/** T06 default: no manifest has ever been applied before -> every document is `create`. */
const NOOP_KB_CHECKSUM_LOOKUP: StoredKbChecksumLookup = () => undefined;

export async function buildManifestPlan(
  manifest: IntegrationManifest,
  tenantId: string,
  clients: PlatformResourceClients,
  logger: PlanLogger = NOOP_PLAN_LOGGER,
  secretsChecker: SecretExistenceChecker = NOOP_SECRET_EXISTENCE_CHECKER,
  kbChecksumLookup: StoredKbChecksumLookup = NOOP_KB_CHECKSUM_LOOKUP,
  // T05, gap 5, decision 6 ruling (2026-07-16) — appended last so every
  // existing positional call site (unit tests, `ApplyService`) keeps
  // working unchanged; defaults to reporting no known live routes (see
  // that NOOP's own comment for why this is safe: the ACTUAL enforcement
  // point is `registry-services-writer.ts`, not this precondition).
  routeCollisionChecker: RouteCollisionChecker = NOOP_ROUTE_COLLISION_CHECKER
): Promise<BuildManifestPlanResult> {
  logger.log(
    `plan: resolving dependency order for manifest='${manifest.metadata.name}' tenant='${tenantId}'`
  );

  const order = computeResourceOrder(manifest);
  if (!order.ok) {
    logger.warn(`plan: cycle detected — ${order.error.message}`);
    return { ok: false, error: order.error };
  }

  const resourcesByKey = new Map(
    listManifestResources(manifest).map((entry) => [
      `${entry.kind}:${entry.name}`,
      entry,
    ])
  );

  const preconditions: PlanPrecondition[] = [];
  const resources: ResourcePlanEntry[] = [];

  // manual-loops/provisioning-manifest-gaps-5.md — plan-time id resolution
  // for the content-aware workflow comparator below. Populated as EACH
  // resource in dependency order is looked up against live platform state
  // (mirrors `apply-manifest.ts`'s `resolvedIds`, but built from `findByName`
  // reads here instead of writer results). Because `order.value` is already
  // dependency-ordered (`RESOURCE_KIND_ORDER` places every ref-target kind —
  // channel/connector/mcpServer/skill/agent/service — BEFORE `workflow`), by
  // the time a workflow is reached every resource its `definition` may
  // reference by symbolic ref has ALREADY been looked up in this SAME loop,
  // so this map is complete for that workflow's refs whenever their targets
  // already exist live.
  const resolvedIds = new Map<string, string>();

  // Shared `resolveRef` closure over `resolvedIds` — used by BOTH the
  // workflow branch (below) and the service env-mechanism branch (manual-
  // loops/crm-support-telegram.md T04 findings) so a `{ connectorRef }` env
  // value resolves through the EXACT SAME plan-time id map a workflow
  // symbolic ref does, rather than inventing a second resolution mechanism.
  const resolveRef = (
    refType: SymbolicRefType,
    refName: string
  ): string | undefined => {
    const targetKind = resourceKindOfRefType(refType);
    if (!targetKind) {
      return undefined;
    }
    return resolvedIds.get(`${targetKind}:${refName}`);
  };

  for (const { kind, name } of order.value) {
    const entry = resourcesByKey.get(`${kind}:${name}`);
    if (!entry) {
      continue; // defensive: should never happen, order is derived from the same list
    }

    const client = clients[kind];
    // T05, gap 5 — `entry.resource` is the manifest's OWN desired shape;
    // only `registry-services-client.ts` reads it (to decide which OPTIONAL
    // scaling fields to compare — see `serviceComparable`), every other
    // client ignores it.
    const lookup = await client.findByName(tenantId, name, entry.resource);

    if (!lookup.ok) {
      logger.warn(
        `plan: downstream lookup failed kind='${kind}' name='${name}' tenant='${tenantId}': ${lookup.error.message}`
      );
      preconditions.push({
        kind: "downstream_error",
        resourceKind: kind,
        resourceName: name,
        message: lookup.error.message,
      });
      continue;
    }

    if (entry.external) {
      if (lookup.value === null) {
        logger.warn(
          `plan: unresolvable external ref kind='${kind}' name='${name}' tenant='${tenantId}'`
        );
        preconditions.push({
          kind: "unresolvable_external_ref",
          resourceKind: kind,
          resourceName: name,
          message: `external ${kind} "${name}" was not found in live platform state`,
        });
        continue;
      }
      logger.log(
        `plan: external ${kind} '${name}' resolved to externalId='${lookup.value.externalId}'`
      );
      resolvedIds.set(`${kind}:${name}`, lookup.value.externalId);
      resources.push({
        kind,
        name,
        external: true,
        verdict: "noop",
        diff: [],
        externalId: lookup.value.externalId,
      });
      continue;
    }

    const live = lookup.value;
    if (live) {
      resolvedIds.set(`${kind}:${name}`, live.externalId);
    }

    let desired: Record<string, unknown>;
    let liveFieldsForDiff: Readonly<Record<string, unknown>> | null;

    if (kind === "workflow") {
      // manual-loops/provisioning-manifest-gaps-5.md — content-aware
      // workflow comparator. The manifest's `definition` may embed
      // allowlisted symbolic refs (`accountId: { channelRef }`, etc. — see
      // `substitution-allowlist.ts`) that the LIVE `actions`/`trigger`
      // already hold as REAL ids, so we must substitute BEFORE projecting
      // comparable fields, exactly like `apply-manifest.ts` does at apply
      // time — but using the `resolvedIds` accumulated from THIS plan's own
      // live lookups instead of already-applied writer results.
      const workflow = entry.resource as Workflow;
      const substitution = substituteSymbolicRefs({
        value: workflow.definition,
        owningResourceKind: "workflow",
        owningResourceName: name,
        resolveRef,
      });

      if (!substitution.ok) {
        // GRACEFUL DEGRADATION (design decision, manual-loops/
        // provisioning-manifest-gaps-5.md): a symbolic ref could not be
        // resolved at PLAN time — most commonly because its target
        // resource is itself being CREATED in this same plan and has no
        // live id yet (`unresolved_symbolic_ref`), but any substitution
        // failure is treated the same way here. Rather than failing the
        // whole plan or diffing a still-symbolic `definition` against the
        // live (already-substituted) actions — which would report a
        // spurious `update` on every single plan run — fall back to the
        // ORIGINAL existence-only comparison for THIS workflow only.
        // `applyManifestPlan` still fails loud on a genuinely malformed ref
        // (mismatched/unallowlisted/invalid-shape) when it re-runs this
        // exact substitution with the FULL resolvedIds at apply time.
        logger.log(
          `plan: workflow '${name}' definition could not be fully substituted for comparison (${substitution.error.kind}: ${substitution.error.message}) — falling back to existence-only comparison for this workflow`
        );
        desired = workflowExistenceOnlyComparable.fromManifest(workflow);
        // `workflowExistenceOnlyComparable.fromLive` ignores its argument
        // (always returns `{}`) — there is no substituted `WorkflowDto` to
        // pass it in this branch, so the call is skipped; `live`'s mere
        // presence/absence is all that matters for the create/noop verdict.
        liveFieldsForDiff = live ? {} : null;
      } else {
        const substitutedWorkflow: Workflow = {
          ...workflow,
          definition: substitution.value as Record<string, unknown>,
        };
        desired = workflowComparable.fromManifest(substitutedWorkflow);
        // `live.fields` was already projected by `workflows-client.ts` via
        // `workflowComparable.fromLive(item, declared)` at lookup time,
        // using the RAW (unsubstituted) manifest resource as `declared` —
        // that is fine because `fromLive`'s declared-gate only checks
        // trigger/variables KEY PRESENCE, which substitution never changes.
        liveFieldsForDiff = live?.fields ?? null;
      }
    } else if (kind === "service") {
      // manual-loops/demos/crm-support-telegram.md T04 findings ("STALE-STATE
      // MASKING") — mechanism-aware service env comparator. A `{
      // connectorRef }` env value needs the SAME plan-time `resolvedIds`
      // resolution the workflow branch above performs, reusing the SAME
      // `resolveRef` closure (never a parallel resolution mechanism).
      //
      // PER-ENTRY degradation (not whole-service): a fresh-context review
      // found that degrading the WHOLE service the moment ANY env var was
      // unresolvable defeated the feature for its own motivating case (a
      // service mixing a `secretRef` var with an always-unresolvable
      // endpoint-ref var never got its secretRef var mechanism-checked).
      // `serviceEnvMechanismComparable` now degrades PER ENTRY internally
      // (see its header comment) — this branch just calls both sides with
      // the SAME `resolveConnectorRef` closure, no fallback logic needed
      // here anymore.
      //
      // `live.raw` is the raw `RegisteredServiceDto` `registry-services-
      // client.ts` exposes (see that file's header comment) — this client
      // has no access to `resolvedIds`, so the mechanism-aware LIVE
      // projection must be computed HERE, not at lookup time, mirroring how
      // the workflow branch above is the one place that performs plan-time
      // substitution.
      const service = entry.resource as HostedService;
      const resolveConnectorRef = (connectorName: string) =>
        resolveRef("connectorRef", connectorName);

      desired = serviceEnvMechanismComparable.fromManifest(
        service,
        resolveConnectorRef
      );
      liveFieldsForDiff = live
        ? serviceEnvMechanismComparable.fromLive(
            live.raw as RegisteredServiceDto,
            service,
            resolveConnectorRef
          )
        : null;
    } else {
      desired = desiredFieldsOfResource(kind, entry.resource);
      liveFieldsForDiff = live?.fields ?? null;
    }

    const { verdict, diff } = diffResource(desired, liveFieldsForDiff);

    logger.log(
      `plan: ${kind} '${name}' verdict='${verdict}' fieldsChanged=${String(diff.length)}`
    );

    resources.push({
      kind,
      name,
      external: false,
      verdict,
      diff,
      externalId: live?.externalId,
    });
  }

  for (const secretReference of gatherSecretReferences(manifest)) {
    const binding = manifest.spec.secrets.find(
      (secret) => secret.name === secretReference.secretName
    );
    if (!binding || binding.external) {
      continue;
    }

    // T05: verify against the REAL k8s Secret (via the same k8s client the
    // secrets broker uses) instead of unconditionally reporting every
    // non-external secret as missing (the T04 placeholder behavior, still
    // the default when no checker is injected — see NOOP_SECRET_EXISTENCE_CHECKER).
    const existence = await secretsChecker.exists(
      tenantId,
      binding.scope.kind,
      binding.scope.owner,
      binding.name
    );

    if (existence.ok && existence.value) {
      logger.log(
        `plan: secret '${binding.name}' (scope ${binding.scope.kind}/${binding.scope.owner}) verified present in the k8s Secret — no precondition`
      );
      continue;
    }

    const reason = existence.ok
      ? "no matching key found in the resource's k8s Secret"
      : `existence check failed: ${existence.error}`;
    logger.warn(
      `plan: secret '${binding.name}' (scope ${binding.scope.kind}/${binding.scope.owner}) reported as a missing-secret precondition — ${reason}`
    );
    preconditions.push({
      kind: "missing_secret",
      resourceKind: binding.scope.kind,
      resourceName: binding.scope.owner,
      refType: "secretRef",
      refValue: binding.name,
      message: `secret "${binding.name}" referenced by ${binding.scope.kind} "${binding.scope.owner}" is not yet available (${reason})`,
    });
  }

  // T05, gap 5, decision 6 ruling (2026-07-16): cross-manifest/tenant route
  // collision check. ONE global routes list call for the whole plan run
  // (the ruling's accepted cost), reused for every declared route across
  // every service — never once per route. A pathPrefix that already exists
  // on a DIFFERENT service/tenant fails loud as a `route_collision`
  // precondition; the SAME service/tenant owning it already is a normal
  // reconcile, not a collision.
  const servicesWithRoutes = manifest.spec.services.filter(
    (service) => (service.routes?.length ?? 0) > 0
  );
  if (servicesWithRoutes.length > 0) {
    logger.log(
      `plan: checking ${String(servicesWithRoutes.length)} service(s) with declared routes for cross-manifest/tenant pathPrefix collisions`
    );
    const liveRoutes = await routeCollisionChecker.listAll();
    if (!liveRoutes.ok) {
      logger.warn(
        `plan: route collision check FAILED to list live routes — ${liveRoutes.error}`
      );
      for (const service of servicesWithRoutes) {
        preconditions.push({
          kind: "downstream_error",
          resourceKind: "service",
          resourceName: service.name,
          message: `route collision check could not list live routes: ${liveRoutes.error}`,
        });
      }
    } else {
      for (const service of servicesWithRoutes) {
        for (const route of service.routes ?? []) {
          const collision = liveRoutes.value.find(
            (existing) =>
              existing.pathPrefix === route.pathPrefix &&
              !(
                existing.tenantId === tenantId &&
                existing.serviceName === service.name
              )
          );
          if (!collision) {
            continue;
          }
          logger.warn(
            `plan: route collision pathPrefix='${route.pathPrefix}' declared by service='${service.name}' tenant='${tenantId}' already owned by service='${collision.serviceName}' tenant='${collision.tenantId}'`
          );
          preconditions.push({
            kind: "route_collision",
            resourceKind: "service",
            resourceName: service.name,
            refValue: route.pathPrefix,
            message: `route pathPrefix '${route.pathPrefix}' declared by service '${service.name}' collides with an existing route owned by service '${collision.serviceName}' (tenant '${collision.tenantId}') — registry.routes are not tenant-isolated at the live gateway proxy layer`,
          });
        }
      }
    }
  }

  // T06: KB reembed estimate — read-only (`kbChecksumLookup` is a sync read
  // of this service's own checksum bookkeeping, never a mutation).
  const knowledgeBases = buildKbPlan(manifest, kbChecksumLookup);
  for (const kb of knowledgeBases) {
    logger.log(`plan: ${kb.summary}`);
  }

  logger.log(
    `plan: completed manifest='${manifest.metadata.name}' tenant='${tenantId}' resources=${String(resources.length)} preconditions=${String(preconditions.length)}`
  );

  return {
    ok: true,
    value: {
      manifestName: manifest.metadata.name,
      resources,
      preconditions,
      knowledgeBases,
    },
  };
}
