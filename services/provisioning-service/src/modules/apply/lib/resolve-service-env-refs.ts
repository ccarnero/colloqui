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
// Handles the whole-connector shape, `{ connectorRef: <name> }` (a
// single-key object whose one key is `connectorRef`), AND (T03) the
// endpoint-ref shape, `{ connectorRef, endpointMethod, endpointPath }`.
// `{ secretRef: <binding> }` is DELIBERATELY left untouched here — T04's
// scope. Passing it through unresolved means it still reaches
// `registry-services-writer.ts`'s `buildEnvVars` guard as a non-string
// value and fails loud there, exactly like today (never silently
// stringified or resolved to the wrong thing).
//
// T02 fail-loud semantics (whole-connector ref) mirror
// `substitute-symbolic-refs.ts`'s scalar `SUBSTITUTION_ALLOWLIST` case
// exactly: `unresolved_symbolic_ref`, a value-free message (never logs the
// resolved id), naming the env var's path as `env[M].value.connectorRef`.
//
// T03 (endpoint-ref shape) extends this: the connector's OWN id is resolved
// FIRST via the exact same `resolveRef` logic (an unresolvable connector
// name still fails with `unresolved_symbolic_ref` — connector resolution
// always happens before any endpoint lookup is attempted). Once the
// connector id is known, ONE live `GET /connectors/:id` is issued (via the
// injected `fetchConnectorEndpoints`, kept as a closure argument so this
// function stays unit-testable with a stubbed fetcher — mirrors how
// `resolveRef` is already threaded in rather than this function reaching
// into a concrete HTTP client itself) and the connector's `.endpoints[]` is
// matched by `(method, path)`, the EXACT comparison
// `connectors-writer.ts`'s `reconcileConnectorEndpoints` already uses
// (case-insensitive method, exact path). No match -> the NEW
// `endpoint_ref_not_found` kind (see `apply.interfaces.ts` for why a new
// kind, rather than reusing `unresolved_symbolic_ref`, is justified: the
// PARENT (connector) resolved fine here, only the CHILD (one specific
// endpoint) is missing — a different failure a caller may want to handle
// differently, e.g. "the connector manifest is stale" vs. "the connector
// doesn't exist/wasn't created in this apply").
//
// ALTERNATIVE considered and rejected for the live re-fetch: widening
// `CreateOrUpdateResult` (`platform-resource-writer.interface.ts`) so
// `connectors-writer.ts`'s `create`/`update` return nested endpoint ids
// alongside the connector's own `externalId`, avoiding the extra GET
// entirely. Rejected because `CreateOrUpdateResult` is a SHARED interface
// every writer (channel/connector/agent/service/workflow/...) implements —
// widening it for the benefit of exactly ONE new, narrow consumer
// (`service.env[]` endpoint refs) would force every OTHER writer to either
// implement a field it never populates or the type to carry an
// always-`undefined` optional forever. A single extra `GET`, already a
// proven pattern (`connectors-writer.ts`'s own `fetchLiveConnectorEndpoints`
// on its update path, and the deleted `02-hubspot-connector.ts` smoke
// check), is the smaller, narrower mechanism.
//
// The live GET's own failure (network error, non-2xx, malformed response)
// is surfaced by the injected `fetchConnectorEndpoints` as an
// `ApplyWriteError` already (never thrown, never silently treated as "ref
// unresolved") — this function forwards that error as-is.
//
// Pure aside from the injected `fetchConnectorEndpoints` side effect: never
// mutates the `HostedService` passed in — always returns a NEW `env` array;
// literal string entries are copied by reference (already immutable),
// ref-shaped entries that ARE resolved are replaced with the real id,
// ref-shaped entries that are NOT handled here (`secretRef`, T04) are
// copied through unchanged.

import type {
  HostedService,
  ServiceEnvVar,
  SymbolicRefType,
} from "@yoizen/shared";
import type { ApplyWriteError } from "../domain/apply.interfaces";

export type ResolveServiceEnvRefsResult =
  | { readonly ok: true; readonly value: readonly ServiceEnvVar[] }
  | { readonly ok: false; readonly error: ApplyWriteError };

/** One endpoint entry off a connector's live `GET /connectors/:id` response. */
export interface LiveConnectorEndpointRef {
  readonly id: string;
  readonly method: string;
  readonly path: string;
}

export type FetchConnectorEndpointsOutcome =
  | {
      readonly ok: true;
      readonly endpoints: readonly LiveConnectorEndpointRef[];
    }
  | { readonly ok: false; readonly error: ApplyWriteError };

/**
 * Injected side effect: issues the live `GET /connectors/:id` and returns
 * its `.endpoints[]`. Kept as a plain closure (not a concrete HTTP client
 * type) so `resolveServiceEnvRefs` stays unit-testable with a stubbed
 * fetcher — the real implementation (`connector-endpoint-fetcher.ts`) is
 * wired in at the composition root, mirroring how `resolveRef` is threaded
 * in from `build-substituted-resource.ts` rather than this function owning
 * `resolvedIds` itself.
 */
export type FetchConnectorEndpoints = (
  tenantId: string,
  connectorExternalId: string
) => Promise<FetchConnectorEndpointsOutcome>;

export async function resolveServiceEnvRefs(args: {
  readonly service: HostedService;
  readonly tenantId: string;
  /** Resolves `(refType, manifestName) -> realId`, `undefined` if unresolved. */
  readonly resolveRef: (
    refType: SymbolicRefType,
    name: string
  ) => string | undefined;
  /**
   * Required only to resolve the T03 endpoint-ref shape; if a manifest
   * never declares one, this is never called. Optional so callers that
   * cannot wire live connector access (e.g. tests exercising only the T02
   * whole-connector shape) still compile — encountering the endpoint-ref
   * shape with no fetcher wired fails loud below rather than silently
   * leaving the ref unresolved.
   */
  readonly fetchConnectorEndpoints?: FetchConnectorEndpoints;
}): Promise<ResolveServiceEnvRefsResult> {
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
    const isEndpointRef =
      valueKeys.length === 3 &&
      valueKeys.includes("connectorRef") &&
      valueKeys.includes("endpointMethod") &&
      valueKeys.includes("endpointPath");

    if (!isWholeConnectorRef && !isEndpointRef) {
      // secretRef shape (T04) — not this function's scope, pass through
      // untouched so it still fails loud downstream instead of being
      // silently resolved or dropped.
      out.push(envVar);
      continue;
    }

    // Both shapes resolve the connector's OWN id first, via the SAME
    // `resolveRef` closure the workflow/agent branches thread (reuses
    // `resolvedIds`, not a new allowlist entry) — T02's logic, unchanged.
    const connectorName = (envVar.value as { connectorRef: string })
      .connectorRef;
    const path = isWholeConnectorRef
      ? `env[${String(i)}].value.connectorRef`
      : `env[${String(i)}].value`;
    const connectorId = args.resolveRef("connectorRef", connectorName);
    if (connectorId === undefined) {
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

    if (isWholeConnectorRef) {
      out.push({ name: envVar.name, value: connectorId });
      continue;
    }

    // manual-loops/provisioning-manifest-gaps-4.md T03 — endpoint-ref shape.
    // Connector resolved above; now match ONE of its live endpoints by
    // `(method, path)`.
    const { endpointMethod, endpointPath } = envVar.value as {
      endpointMethod: string;
      endpointPath: string;
    };

    if (!args.fetchConnectorEndpoints) {
      return {
        ok: false,
        error: {
          kind: "downstream_error",
          resourceKind: "service",
          resourceName: args.service.name,
          message: `service '${args.service.name}' at ${path} needs connector '${connectorName}'s live endpoints (endpointMethod='${endpointMethod}', endpointPath='${endpointPath}') but no connector-endpoint fetcher is wired for this apply run`,
        },
      };
    }

    const liveEndpoints = await args.fetchConnectorEndpoints(
      args.tenantId,
      connectorId
    );
    if (!liveEndpoints.ok) {
      return liveEndpoints;
    }

    // Mirrors `connectors-writer.ts:280-311`'s own endpoint-matching
    // comparison exactly: case-insensitive method, exact path.
    const match = liveEndpoints.endpoints.find(
      (endpoint) =>
        endpoint.method.toUpperCase() === endpointMethod.toUpperCase() &&
        endpoint.path === endpointPath
    );
    if (!match) {
      return {
        ok: false,
        error: {
          // NEW kind — see `apply.interfaces.ts` for why no existing kind
          // fits "parent (connector) resolved, child (endpoint) missing".
          kind: "endpoint_ref_not_found",
          resourceKind: "service",
          resourceName: args.service.name,
          message: `service '${args.service.name}' at ${path} references connector '${connectorName}' endpoint (${endpointMethod} ${endpointPath}) — connector resolved but no live endpoint matches that method/path`,
        },
      };
    }

    out.push({ name: envVar.name, value: match.id });
  }

  return { ok: true, value: out };
}
