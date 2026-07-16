// T03 orchestrator: dependency-ordered resolver + read-only planner.
//
// NEVER mutates anything — every downstream call is `findByName` (GET-only)
// against the injected `PlatformResourceClients`. Downstream failures are
// caught and surfaced as typed `downstream_error` preconditions, never
// thrown. Verbose logging at every stage per SPEC.md's "nothing fails
// silently" constraint.

import type { IntegrationManifest } from "@yoizen/shared";
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
import { desiredFieldsOfResource } from "./desired-fields-of-resource";
import { diffResource } from "./diff-resource";
import { gatherSecretReferences } from "./gather-secret-references";
import { listManifestResources } from "./list-manifest-resources";
import { NOOP_PLAN_LOGGER, type PlanLogger } from "./plan-logger.interface";
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

    const desired = desiredFieldsOfResource(kind, entry.resource);
    const live = lookup.value;
    const { verdict, diff } = diffResource(desired, live?.fields ?? null);

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
