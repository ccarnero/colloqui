// manual-loops/provisioning-manifest-gaps.md T03, gap 3.
//
// Runs `substituteSymbolicRefs` over the ONE tree each resource kind may
// embed allowlisted refs in — `Workflow.definition` and `Agent.profile` —
// and returns a NEW resource object with that tree replaced. Every other
// resource kind (channel/connector/service) passes through unchanged: they
// have no `definition`/`profile` tree for a workflow/agent action argument
// to live in.
//
// Never mutates the manifest resource passed in — `substituteSymbolicRefs`
// always rebuilds objects/arrays it touches, so the caller's original
// `Workflow`/`Agent` (ultimately backed by the stored manifest) is
// untouched; only the returned working copy carries substituted values.

import type { SymbolicRefType } from "@yoizen/shared";
import type { ResourceKind } from "../../plan/domain/plan.interfaces";
import type { AnyManifestResource } from "../../plan/lib/list-manifest-resources";
import type { PlanLogger } from "../../plan/lib/plan-logger.interface";
import { NOOP_PLAN_LOGGER } from "../../plan/lib/plan-logger.interface";
import { resourceKindOfRefType } from "../../plan/lib/resource-kind-of-ref-type";
import type { ApplyWriteError } from "../domain/apply.interfaces";
import { substituteSymbolicRefs } from "./substitute-symbolic-refs";

export type BuildSubstitutedResourceResult =
  | { readonly ok: true; readonly value: AnyManifestResource }
  | { readonly ok: false; readonly error: ApplyWriteError };

export function buildSubstitutedResource(args: {
  readonly kind: ResourceKind;
  readonly resource: AnyManifestResource;
  /** `"<ResourceKind>:<name>" -> realId`, populated from already-applied resources. */
  readonly resolvedIds: ReadonlyMap<string, string>;
  readonly logger?: PlanLogger;
}): BuildSubstitutedResourceResult {
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

  return { ok: true, value: args.resource };
}
