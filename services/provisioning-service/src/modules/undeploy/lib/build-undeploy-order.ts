// Computes the REVERSE dependency order undeploy deletes in
// (PENDIENTES/12-undeploy.spec.md T01).
//
// Derived from apply's OWN order, never re-derived independently: it calls
// `plan/lib/topological-resource-order.ts`'s `computeResourceOrder` — the
// exact function `buildManifestPlan` uses to order an apply run — and
// reverses it. So "reverse of apply" is true BY CONSTRUCTION: any future
// change to `RESOURCE_KIND_ORDER` or to the ref graph automatically flows
// into undeploy, and no second ordering rule can drift from the first.
//
// Knowledge bases are spliced in at the position apply reconciles them
// (BEFORE reversal): `apply/lib/apply-manifest.ts` runs its
// `reconcileKnowledgeBases` hook right before the first resource whose kind
// ranks AFTER "connector" in `RESOURCE_KIND_ORDER` — and, when the plan has
// no such resource at all, once after the main loop. This mirrors BOTH
// branches, so after reversal a knowledge base is deleted AFTER the agents
// that consume it and BEFORE the connectors its `ingestion_config` points at
// — the exact inverse of the create order.
//
// A dependency cycle is the same typed `CycleDetectedError` the planner
// raises — never a hang, never a partial order.

import type { IntegrationManifest } from "@yoizen/shared";
import type { Result } from "../../../lib/result";
import { err, ok } from "../../../lib/result";
import type { CycleDetectedError } from "../../plan/domain/plan.interfaces";
import { RESOURCE_KIND_ORDER } from "../../plan/domain/plan.interfaces";
import { listManifestResources } from "../../plan/lib/list-manifest-resources";
import { computeResourceOrder } from "../../plan/lib/topological-resource-order";
import type { UndeployResourceKind } from "../domain/undeploy.interfaces";

/** One resource undeploy will attempt to delete, in the order it will try. */
export interface UndeployTarget {
  readonly kind: UndeployResourceKind;
  readonly name: string;
  /** `external: true` in the manifest — never owned, so never deleted. */
  readonly external: boolean;
}

const CONNECTOR_RANK = RESOURCE_KIND_ORDER.indexOf("connector");
const KIND_RANK: ReadonlyMap<string, number> = new Map(
  RESOURCE_KIND_ORDER.map((kind, index) => [kind, index])
);

export function buildUndeployOrder(
  manifest: IntegrationManifest
): Result<UndeployTarget[], CycleDetectedError> {
  const applyOrder = computeResourceOrder(manifest);
  if (!applyOrder.ok) {
    return err(applyOrder.error);
  }

  const externalByKey = new Map(
    listManifestResources(manifest).map((entry) => [
      `${entry.kind}:${entry.name}`,
      entry.external,
    ])
  );

  const kbTargets: UndeployTarget[] = manifest.spec.knowledgeBases.map(
    (kb) => ({
      kind: "knowledgeBase" as const,
      name: kb.name,
      external: kb.external ?? false,
    })
  );

  const applyTargets: UndeployTarget[] = applyOrder.value.map((entry) => ({
    kind: entry.kind,
    name: entry.name,
    external: externalByKey.get(`${entry.kind}:${entry.name}`) ?? false,
  }));

  // Same splice point apply's KB hook fires at: before the first
  // post-connector resource, or at the very end when there is none.
  const firstPostConnectorIndex = applyTargets.findIndex(
    (target) => (KIND_RANK.get(target.kind) ?? 0) > CONNECTOR_RANK
  );
  const spliceAt =
    firstPostConnectorIndex === -1
      ? applyTargets.length
      : firstPostConnectorIndex;

  const inApplyOrder = [
    ...applyTargets.slice(0, spliceAt),
    ...kbTargets,
    ...applyTargets.slice(spliceAt),
  ];

  return ok([...inApplyOrder].reverse());
}
