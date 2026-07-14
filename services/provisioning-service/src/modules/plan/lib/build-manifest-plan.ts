// T03 orchestrator: dependency-ordered resolver + read-only planner.
//
// NEVER mutates anything — every downstream call is `findByName` (GET-only)
// against the injected `PlatformResourceClients`. Downstream failures are
// caught and surfaced as typed `downstream_error` preconditions, never
// thrown. Verbose logging at every stage per SPEC.md's "nothing fails
// silently" constraint.

import type { IntegrationManifest } from "@yoizen/shared";
import type {
  CycleDetectedError,
  ManifestPlan,
  PlanPrecondition,
  ResourcePlanEntry,
} from "../domain/plan.interfaces";
import type { PlatformResourceClients } from "../domain/platform-resource-client.interface";
import { desiredFieldsOfResource } from "./desired-fields-of-resource";
import { diffResource } from "./diff-resource";
import { gatherSecretReferences } from "./gather-secret-references";
import { listManifestResources } from "./list-manifest-resources";
import { NOOP_PLAN_LOGGER, type PlanLogger } from "./plan-logger.interface";
import { computeResourceOrder } from "./topological-resource-order";

export type BuildManifestPlanResult =
  | { readonly ok: true; readonly value: ManifestPlan }
  | { readonly ok: false; readonly error: CycleDetectedError };

export async function buildManifestPlan(
  manifest: IntegrationManifest,
  tenantId: string,
  clients: PlatformResourceClients,
  logger: PlanLogger = NOOP_PLAN_LOGGER
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
    const lookup = await client.findByName(tenantId, name);

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
    logger.log(
      `plan: secret '${binding.name}' (scope ${binding.scope.kind}/${binding.scope.owner}) reported as a missing-secret precondition — real Secret verification arrives in T05`
    );
    preconditions.push({
      kind: "missing_secret",
      resourceKind: binding.scope.kind,
      resourceName: binding.scope.owner,
      refType: "secretRef",
      refValue: binding.name,
      message: `secret "${binding.name}" referenced by ${binding.scope.kind} "${binding.scope.owner}" has no verified value yet (Secret checks land in T05)`,
    });
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
    },
  };
}
