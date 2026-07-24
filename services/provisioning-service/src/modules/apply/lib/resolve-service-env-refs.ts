// manual-loops/provisioning-manifest-gaps-4.md T02 — apply-time
// `{ connectorRef }` (whole-connector) substitution for a hosted service's
// `env[]`.
//
// A NEW, narrowly-scoped tree root — NOT a `SUBSTITUTION_ALLOWLIST` entry
// (see `build-substituted-resource.ts`'s header comment and the SPEC's own
// Prior art for why `service.env[].value` cannot safely reuse the generic
// `substituteSymbolicRefs` walker's `"value"` key: it is an extremely common
// property name that would create false-positive substitutions elsewhere).
// `service.env[]` is a small, independently-typed, non-free-form array, so
// this function walks it directly instead.
//
// Handles ONLY the whole-connector shape, `{ connectorRef: <name> }` (a
// single-key object whose one key is `connectorRef`). Two other ref shapes
// `ServiceEnvVarValue` allows are DELIBERATELY left untouched here:
//   - `{ connectorRef, endpointMethod, endpointPath }` (the endpoint-ref
//     shape) — T03's scope, distinguished from the whole-connector shape by
//     its extra keys. Passing it through unresolved means it still reaches
//     `registry-services-writer.ts`'s `buildEnvVars` guard as a non-string
//     value and fails loud there, exactly like today (never silently
//     stringified or resolved to the wrong thing).
//   - `{ secretRef: <binding> }` — T04's scope, same "pass through, still
//     fails loud downstream" reasoning.
//
// Fail-loud semantics mirror `substitute-symbolic-refs.ts`'s scalar
// `SUBSTITUTION_ALLOWLIST` case exactly: `unresolved_symbolic_ref`, a
// value-free message (never logs the resolved id), naming the env var's
// path as `env[M].value.connectorRef`.
//
// Pure: never mutates the `HostedService` passed in — always returns a NEW
// `env` array; literal string entries are copied by reference (already
// immutable), ref-shaped entries that ARE resolved are replaced with the
// real id, ref-shaped entries that are NOT handled here are copied through
// unchanged.

import type {
  HostedService,
  ServiceEnvVar,
  SymbolicRefType,
} from "@yoizen/shared";
import type { ApplyWriteError } from "../domain/apply.interfaces";

export type ResolveServiceEnvRefsResult =
  | { readonly ok: true; readonly value: readonly ServiceEnvVar[] }
  | { readonly ok: false; readonly error: ApplyWriteError };

export function resolveServiceEnvRefs(args: {
  readonly service: HostedService;
  /** Resolves `(refType, manifestName) -> realId`, `undefined` if unresolved. */
  readonly resolveRef: (
    refType: SymbolicRefType,
    name: string
  ) => string | undefined;
}): ResolveServiceEnvRefsResult {
  const declared = args.service.env ?? [];
  const out: ServiceEnvVar[] = [];

  for (let i = 0; i < declared.length; i++) {
    const envVar = declared[i] as ServiceEnvVar;

    if (typeof envVar.value === "string") {
      out.push(envVar);
      continue;
    }

    const valueKeys = Object.keys(envVar.value);
    const isWholeConnectorRef =
      valueKeys.length === 1 && valueKeys[0] === "connectorRef";

    if (!isWholeConnectorRef) {
      // Endpoint-ref shape (T03) or secretRef shape (T04) — not this
      // function's scope, pass through untouched so it still fails loud
      // downstream instead of being silently resolved or dropped.
      out.push(envVar);
      continue;
    }

    // manual-loops/provisioning-manifest-gaps-4.md T02 — whole-connector
    // ref, resolved via the SAME `resolveRef` closure the workflow/agent
    // branches thread (reuses `resolvedIds`, not a new allowlist entry).
    const connectorName = (envVar.value as { connectorRef: string })
      .connectorRef;
    const path = `env[${String(i)}].value.connectorRef`;
    const realId = args.resolveRef("connectorRef", connectorName);
    if (realId === undefined) {
      return {
        ok: false,
        error: {
          kind: "unresolved_symbolic_ref",
          resourceKind: "service",
          resourceName: args.service.name,
          message: `service '${args.service.name}' at ${path} references unresolved connectorRef '${connectorName}' — no real id available for it (never created/resolved, or a dependency-order gap)`,
        },
      };
    }

    out.push({ name: envVar.name, value: realId });
  }

  return { ok: true, value: out };
}
