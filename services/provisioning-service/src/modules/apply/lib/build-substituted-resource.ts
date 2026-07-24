// manual-loops/provisioning-manifest-gaps.md T03, gap 3.
//
// Runs `substituteSymbolicRefs` over the ONE tree each resource kind may
// embed allowlisted refs in — `Workflow.definition` and `Agent.profile` —
// and returns a NEW resource object with that tree replaced. `channel`/
// `connector` pass through unchanged: they have no `definition`/`profile`
// tree for a workflow/agent action argument to live in.
//
// manual-loops/provisioning-manifest-gaps-4.md T02 adds a THIRD, narrowly-
// scoped branch for `kind === "service"`: `service.env[]` is a small,
// independently-typed array (not a free-form tree), so it is resolved via
// the dedicated `resolveServiceEnvRefs` walker rather than
// `substituteSymbolicRefs`'s generic entry point — see that function's
// header comment for the full reasoning (reuses `resolveRef`/`resolvedIds`,
// deliberately NOT a new `SUBSTITUTION_ALLOWLIST` entry).
//
// Never mutates the manifest resource passed in — both `substituteSymbolicRefs`
// and `resolveServiceEnvRefs` always rebuild the objects/arrays they touch,
// so the caller's original `Workflow`/`Agent`/`HostedService` (ultimately
// backed by the stored manifest) is untouched; only the returned working
// copy carries substituted values.

import type { HostedService, SymbolicRefType } from "@yoizen/shared";
import type { ResourceKind } from "../../plan/domain/plan.interfaces";
import type { AnyManifestResource } from "../../plan/lib/list-manifest-resources";
import type { PlanLogger } from "../../plan/lib/plan-logger.interface";
import { NOOP_PLAN_LOGGER } from "../../plan/lib/plan-logger.interface";
import { resourceKindOfRefType } from "../../plan/lib/resource-kind-of-ref-type";
import type { ApplyWriteError } from "../domain/apply.interfaces";
import type { FetchConnectorEndpoints } from "./resolve-service-env-refs";
import { resolveServiceEnvRefs } from "./resolve-service-env-refs";
import { substituteSymbolicRefs } from "./substitute-symbolic-refs";

export type BuildSubstitutedResourceResult =
  | { readonly ok: true; readonly value: AnyManifestResource }
  | { readonly ok: false; readonly error: ApplyWriteError };

export async function buildSubstitutedResource(args: {
  readonly kind: ResourceKind;
  readonly resource: AnyManifestResource;
  readonly tenantId: string;
  /** `"<ResourceKind>:<name>" -> realId`, populated from already-applied resources. */
  readonly resolvedIds: ReadonlyMap<string, string>;
  /** manual-loops/provisioning-manifest-gaps-4.md T03 — threaded to
   * `resolveServiceEnvRefs` for the `service` kind branch only; every other
   * kind ignores it. */
  readonly fetchConnectorEndpoints?: FetchConnectorEndpoints;
  readonly logger?: PlanLogger;
}): Promise<BuildSubstitutedResourceResult> {
  const logger = args.logger ?? NOOP_PLAN_LOGGER;
  const resolveRef = (
    refType: SymbolicRefType,
    name: string
  ): string | undefined => {
    const targetKind = resourceKindOfRefType(refType);
    if (!targetKind) {
      return undefined;
    }
    return args.resolvedIds.get(`${targetKind}:${name}`);
  };

  if (args.kind === "workflow") {
    const workflow = args.resource as Extract<
      AnyManifestResource,
      { definition: Record<string, unknown> }
    >;
    const result = substituteSymbolicRefs({
      value: workflow.definition,
      owningResourceKind: "workflow",
      owningResourceName: workflow.name,
      resolveRef,
      onSubstituted: (sub) => {
        logger.log(
          `apply: workflow '${workflow.name}' substituted ${sub.refType} '${sub.name}' -> realId at ${sub.path}`
        );
      },
    });
    if (!result.ok) {
      logger.warn(
        `apply: workflow '${workflow.name}' substitution FAILED: ${result.error.message}`
      );
      return result;
    }
    return {
      ok: true,
      value: {
        ...workflow,
        definition: result.value as Record<string, unknown>,
      },
    };
  }

  if (args.kind === "agent") {
    const agent = args.resource as Extract<
      AnyManifestResource,
      { profile: Record<string, unknown> }
    >;
    const result = substituteSymbolicRefs({
      value: agent.profile,
      owningResourceKind: "agent",
      owningResourceName: agent.name,
      resolveRef,
      onSubstituted: (sub) => {
        logger.log(
          `apply: agent '${agent.name}' substituted ${sub.refType} '${sub.name}' -> realId at ${sub.path}`
        );
      },
    });
    if (!result.ok) {
      logger.warn(
        `apply: agent '${agent.name}' substitution FAILED: ${result.error.message}`
      );
      return result;
    }
    return {
      ok: true,
      value: { ...agent, profile: result.value as Record<string, unknown> },
    };
  }

  if (args.kind === "service") {
    const service = args.resource as HostedService;
    const result = await resolveServiceEnvRefs({
      service,
      tenantId: args.tenantId,
      resolveRef,
      fetchConnectorEndpoints: args.fetchConnectorEndpoints,
    });
    if (!result.ok) {
      logger.warn(
        `apply: service '${service.name}' env substitution FAILED: ${result.error.message}`
      );
      return result;
    }
    logger.log(
      `apply: service '${service.name}' env refs resolved (${String(result.value.length)} entries)`
    );
    return {
      ok: true,
      // Only replace `env` when the manifest actually declared one — never
      // introduce an `env: []` where the original had no `env` at all.
      value: {
        ...service,
        env: service.env ? result.value : service.env,
      } as AnyManifestResource,
    };
  }

  return { ok: true, value: args.resource };
}
