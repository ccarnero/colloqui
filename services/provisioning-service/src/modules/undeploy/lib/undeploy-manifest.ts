// The undeploy engine (PENDIENTES/12-undeploy.spec.md T01): executes an
// already-computed REVERSE dependency order (`build-undeploy-order.ts`) via
// the injected `PlatformResourceDeleters`, then reports what happened.
//
// Mirrors `apply/lib/apply-manifest.ts` deliberately, step for step:
//   - iterates a pre-ordered target list (there, dependency order; here, its
//     inverse) and STOPS AT THE FIRST ERROR, reporting what was processed
//     and what it never reached (`pending`);
//   - never throws — every downstream failure is a typed error;
//   - logs every single target it touches ("nothing fails silently").
//
// What it deliberately does NOT do (kept in `undeploy.service.ts`, exactly
// like apply keeps manifest loading and planning in `apply.service.ts`):
// loading the stored manifest, the decision-4 shared-resource guard, and the
// cleanup of provisioning's OWN state (`kb_document_checksums` rows + the
// stored manifest record). That cleanup runs ONLY after this function
// returns ok — a partial undeploy keeps the manifest stored so a re-run
// resumes.
//
// Secrets (decision 2 of the spec: "secrets die with the manifest") are
// deleted right AFTER their owner resource's step, never before: the owner is
// gone by then, so the credential cannot outlive a resource that still uses
// it. A binding whose `scope.owner` is not a resource this manifest declares
// is processed after every resource, so nothing is left behind. A binding the
// manifest marks `external: true` is never deleted, mirroring the resource
// rule.
//
// A binding is deleted even when its owner resource came back `not_found`:
// the secret is provisioning's OWN k8s object, declared by THIS manifest, and
// a half-torn-down state (resource already gone, credential still on the
// cluster) is exactly what teardown exists to clean. The only skip is
// `external: true`.

import type { IntegrationManifest, SecretBinding } from "@yoizen/shared";
import type { PlanLogger } from "../../plan/lib/plan-logger.interface";
import { NOOP_PLAN_LOGGER } from "../../plan/lib/plan-logger.interface";
import type { PlatformResourceDeleters } from "../domain/platform-resource-deleter.interface";
import type {
  ManifestUndeployFailure,
  ResourceUndeployOutcome,
  SecretUndeployOutcome,
  UndeployStepError,
} from "../domain/undeploy.interfaces";
import type { UndeployTarget } from "./build-undeploy-order";

/**
 * Deletes ONE secret binding. Wired in `undeploy.service.ts` to
 * `SecretsService.delete` (the SAME write-only service `PUT /secrets/:name`
 * and the new `DELETE /secrets/:name` use) — a closure instead of a port, the
 * same shape apply uses for `fetchConnectorEndpoints`/`reconcileKnowledgeBases`.
 * `deleted: false` means no such key existed (already gone) — never an error.
 */
export type DeleteSecret = (
  tenantId: string,
  name: string,
  scope: SecretBinding["scope"]
) => Promise<
  | { readonly ok: true; readonly value: { readonly deleted: boolean } }
  | { readonly ok: false; readonly error: string }
>;

export interface UndeployManifestArgs {
  readonly manifest: IntegrationManifest;
  readonly tenantId: string;
  /** REVERSE dependency order, from `buildUndeployOrder`. */
  readonly targets: readonly UndeployTarget[];
  readonly deleters: PlatformResourceDeleters;
  readonly deleteSecret: DeleteSecret;
  readonly logger?: PlanLogger;
}

/** Everything the engine itself knows; the service adds its own-state counts. */
export interface UndeployRunReport {
  readonly manifestName: string;
  readonly resources: readonly ResourceUndeployOutcome[];
  readonly secrets: readonly SecretUndeployOutcome[];
  readonly deletedCount: number;
  readonly notFoundCount: number;
  readonly skippedCount: number;
}

export type UndeployManifestResult =
  | { readonly ok: true; readonly value: UndeployRunReport }
  | { readonly ok: false; readonly error: ManifestUndeployFailure };

export async function undeployManifest(
  args: UndeployManifestArgs
): Promise<UndeployManifestResult> {
  const { manifest, tenantId, targets, deleters, deleteSecret } = args;
  const logger = args.logger ?? NOOP_PLAN_LOGGER;
  const manifestName = manifest.metadata.name;
  const startedAt = Date.now();

  logger.log(
    `undeploy: starting manifest='${manifestName}' tenant='${tenantId}' resources=${String(targets.length)} secrets=${String(manifest.spec.secrets.length)}`
  );

  const resources: ResourceUndeployOutcome[] = [];
  const secrets: SecretUndeployOutcome[] = [];
  let deletedCount = 0;
  let notFoundCount = 0;
  let skippedCount = 0;

  // `<scope.kind>:<scope.owner>` -> bindings, so each binding is processed
  // immediately after the target that owns it.
  const bindingsByOwner = new Map<string, SecretBinding[]>();
  for (const binding of manifest.spec.secrets) {
    const key = `${binding.scope.kind}:${binding.scope.owner}`;
    const existing = bindingsByOwner.get(key);
    if (existing) {
      existing.push(binding);
    } else {
      bindingsByOwner.set(key, [binding]);
    }
  }

  const failure = (
    error: UndeployStepError,
    fromIndex: number
  ): UndeployManifestResult => {
    logger.warn(
      `undeploy: STOPPING manifest='${manifestName}' at ${error.resourceKind} '${error.resourceName}' (${error.kind}): ${error.message}`
    );
    return {
      ok: false,
      error: {
        kind: "undeploy_failed",
        manifestName,
        resources,
        secrets,
        pending: targets
          .slice(fromIndex)
          .map((target) => ({ kind: target.kind, name: target.name })),
        failure: error,
        manifestRecordDeleted: false,
        durationMs: Date.now() - startedAt,
      },
    };
  };

  /** Pops the bindings owned by `ownerKey`. `null` = every one still pending. */
  const takeBindings = (ownerKey: string | null): SecretBinding[] => {
    if (ownerKey === null) {
      const all = [...bindingsByOwner.values()].flat();
      bindingsByOwner.clear();
      return all;
    }
    const owned = bindingsByOwner.get(ownerKey) ?? [];
    bindingsByOwner.delete(ownerKey);
    return owned;
  };

  /**
   * The owner resource was SKIPPED, so it is still live — its credentials
   * must survive with it. Recorded with the owner's own skip reason instead
   * of being silently dropped from the report.
   */
  const skipBindingsOf = (
    ownerKey: string,
    action: "skipped_external" | "skipped_no_delete_api",
    why: string
  ): void => {
    for (const binding of takeBindings(ownerKey)) {
      logger.log(
        `undeploy: secret '${binding.name}' (${binding.scope.kind}/${binding.scope.owner}) kept — ${why}`
      );
      secrets.push({ name: binding.name, scope: binding.scope, action });
    }
  };

  /** Deletes every binding owned by `ownerKey`. `null` = the leftovers pass. */
  const processBindings = async (
    ownerKey: string | null
  ): Promise<UndeployStepError | null> => {
    const bindings = takeBindings(ownerKey);

    for (const binding of bindings) {
      if (binding.external) {
        logger.log(
          `undeploy: secret '${binding.name}' (${binding.scope.kind}/${binding.scope.owner}) is external — never deleted`
        );
        secrets.push({
          name: binding.name,
          scope: binding.scope,
          action: "skipped_external",
        });
        continue;
      }

      logger.log(
        `undeploy: deleting secret '${binding.name}' bound to ${binding.scope.kind}/${binding.scope.owner} (value NEVER logged)`
      );
      const result = await deleteSecret(tenantId, binding.name, binding.scope);
      if (!result.ok) {
        return {
          kind: "downstream_error",
          resourceKind: "secret",
          resourceName: binding.name,
          message: `deleting secret '${binding.name}' (${binding.scope.kind}/${binding.scope.owner}) failed: ${result.error}`,
        };
      }
      logger.log(
        `undeploy: secret '${binding.name}' ${result.value.deleted ? "deleted" : "was already absent"}`
      );
      secrets.push({
        name: binding.name,
        scope: binding.scope,
        action: result.value.deleted ? "deleted" : "not_found",
      });
    }
    return null;
  };

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (!target) {
      continue;
    }
    const label = `${target.kind} '${target.name}'`;

    if (target.external) {
      logger.log(
        `undeploy: ${label} is declared external — never owned, never deleted`
      );
      resources.push({
        kind: target.kind,
        name: target.name,
        action: "skipped_external",
      });
      skippedCount++;
      skipBindingsOf(
        `${target.kind}:${target.name}`,
        "skipped_external",
        `its owner ${label} is external and stays live`
      );
      continue;
    }

    const deleter = deleters[target.kind];
    if (!deleter) {
      logger.warn(
        `undeploy: ${label} has NO delete route on its downstream admin API — skipped (skipped_no_delete_api)`
      );
      resources.push({
        kind: target.kind,
        name: target.name,
        action: "skipped_no_delete_api",
      });
      skippedCount++;
      skipBindingsOf(
        `${target.kind}:${target.name}`,
        "skipped_no_delete_api",
        `its owner ${label} could not be deleted (no delete route) and stays live`
      );
      continue;
    }

    const found = await deleter.findOwnedId(
      tenantId,
      target.name,
      manifestName
    );
    if (!found.ok) {
      return failure(found.error, i);
    }

    if (found.value === null) {
      logger.log(
        `undeploy: ${label} — nothing live matched this kind's deletion key (manifest='${manifestName}'; already gone, never applied, or not apply-created)`
      );
      resources.push({
        kind: target.kind,
        name: target.name,
        action: "not_found",
      });
      notFoundCount++;
    } else {
      logger.log(
        `undeploy: deleting ${label} externalId='${found.value}' tenant='${tenantId}'`
      );
      const deleted = await deleter.deleteById(
        tenantId,
        found.value,
        target.name
      );
      if (!deleted.ok) {
        return failure(deleted.error, i);
      }
      if (deleted.value.deleted) {
        logger.log(`undeploy: ${label} deleted (externalId='${found.value}')`);
        resources.push({
          kind: target.kind,
          name: target.name,
          action: "deleted",
          externalId: found.value,
        });
        deletedCount++;
      } else {
        logger.log(
          `undeploy: ${label} vanished between lookup and delete — reported not_found`
        );
        resources.push({
          kind: target.kind,
          name: target.name,
          action: "not_found",
        });
        notFoundCount++;
      }
    }

    const bindingError = await processBindings(`${target.kind}:${target.name}`);
    if (bindingError) {
      return failure(bindingError, i + 1);
    }
  }

  // Bindings whose `scope.owner` matches no declared resource (or whose owner
  // kind cannot be a target, e.g. a stale binding left in the manifest) —
  // processed last so nothing this manifest declared is left on the cluster.
  const leftoverError = await processBindings(null);
  if (leftoverError) {
    return failure(leftoverError, targets.length);
  }

  logger.log(
    `undeploy: run finished manifest='${manifestName}' deleted=${String(deletedCount)} notFound=${String(notFoundCount)} skipped=${String(skippedCount)} secrets=${String(secrets.length)} durationMs=${String(Date.now() - startedAt)}`
  );

  return {
    ok: true,
    value: {
      manifestName,
      resources,
      secrets,
      deletedCount,
      notFoundCount,
      skippedCount,
    },
  };
}
