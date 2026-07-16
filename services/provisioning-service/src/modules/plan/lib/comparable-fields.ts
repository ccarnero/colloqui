// SINGLE SOURCE OF TRUTH for per-resource-kind field comparison.
//
// The planner diffs a manifest resource's DESIRED fields against the LIVE
// platform resource's projected fields (`diffResource`, which unions the key
// sets of BOTH sides). For that diff to be meaningful — and for the SPEC's
// idempotency criterion ("same manifest vs same state → all-noop") to hold —
// the desired side and the live side MUST project the EXACT SAME set of keys.
// A key present on only one side would diff forever and make `noop`
// unreachable for that kind.
//
// Therefore each kind declares ONE contract with two extractors:
//   - `fromManifest`: the desired shape, read off the manifest resource.
//   - `fromLive`:     the live shape, read off the downstream API response.
// Both MUST return the same key set. We deliberately include ONLY the fields
// that BOTH sides can faithfully represent today — the honest intersection.
// Fields a downstream API cannot supply (or supplies in an incomparable
// identifier space) are excluded from BOTH sides rather than aliased.
//
// SECURITY (SPEC hard rule — automatic rejection if violated): secret VALUES
// and any credential-bearing field NEVER appear in a projection. That is why
// the connector contract deliberately does NOT read connector-admin's
// `authConfig` (which stores apiKey/bearerToken/basicPassword in plaintext,
// see packages/shared/adapter-auth-headers.ts). Secrets are surfaced as
// preconditions by NAME/binding only (`gatherSecretReferences`), never as
// projected field values.

import type {
  Agent,
  Connector,
  HostedService,
  ManifestChannel,
  ManifestSystemVariable,
  Workflow,
} from "@yoizen/shared";

// ---------------------------------------------------------------------------
// Downstream response DTOs — only the NON-secret fields we are allowed to read.
// Auth/credential fields (e.g. adapter `authConfig`) are intentionally absent
// from `AdapterDto` so they cannot be projected even by accident.
// ---------------------------------------------------------------------------

export interface ChannelAccountDto {
  readonly id: string;
  readonly name: string;
  readonly channel: string;
}

/** Live endpoint shape from `GET /connectors` (mirrors `mapEndpoint`). Never carries auth material. */
export interface AdapterEndpointDto {
  readonly label: string;
  readonly method: string;
  readonly path: string;
}

export interface AdapterDto {
  readonly id: string;
  readonly name: string;
  readonly context: string;
  readonly endpoints?: readonly AdapterEndpointDto[];
}

export interface AgentDto {
  readonly id: string;
  readonly name: string;
}

export interface RegisteredServiceDto {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly envVars?: Record<string, string>;
}

export interface WorkflowDto {
  readonly id: string;
  readonly name: string;
}

/** Live shape from `GET /admin/system-variables` (agent-admin-service's `ISystemVariable`). */
export interface SystemVariableDto {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly value: unknown;
}

export interface ComparableFieldsContract<TManifest, TLive> {
  readonly fromManifest: (resource: TManifest) => Record<string, unknown>;
  readonly fromLive: (live: TLive) => Record<string, unknown>;
}

// Channel: only `type` is faithfully comparable. channel-service's
// `ChannelAccount` has no `direction`/`config`/`secretRef` counterpart, so
// those manifest fields are excluded from BOTH sides (a product-mapping
// follow-up once channel-service grows them). Manifest `type` maps to the
// live account's `channel`.
export const channelComparable: ComparableFieldsContract<
  ManifestChannel,
  ChannelAccountDto
> = {
  fromManifest: (channel) => ({ type: channel.type }),
  fromLive: (account) => ({ type: account.channel }),
};

// Connector: existence-only for `{ type, config }` — connector-admin models
// a structured adapter (`context` + baseUrl + auth material) with no
// faithful mapping to the manifest's free-form shape, and its credential
// fields must never be projected. `endpoints` (T02,
// manual-loops/provisioning-manifest-gaps.md gap 2) IS faithfully
// comparable on both sides (`label`/`method`/`path`, mirrored 1:1 by
// `mapEndpoint`), so it is projected and diffed — an endpoint-only change
// now produces an `update` verdict instead of silently no-opping.
//
// Normalization: each endpoint is reduced to its `(method, path)` uniqueness
// key plus `label`, method upper-cased; the array is then SORTED by
// `(method, path)` before comparison so manifest declaration order (which
// the writer still reconciles endpoints in, T02) never causes a false
// `update` by itself. `cache` is deliberately excluded from both sides for
// now — deep-diffing its nested arrays/`"all"` sentinel would break the
// "minimal, deterministic" contract this file follows elsewhere; a
// cache-aware diff is a follow-up once needed.
function normalizeEndpointForCompare(endpoint: {
  readonly label: string;
  readonly method: string;
  readonly path: string;
}): { readonly label: string; readonly method: string; readonly path: string } {
  return {
    label: endpoint.label,
    method: endpoint.method.toUpperCase(),
    path: endpoint.path,
  };
}

function sortedNormalizedEndpoints(
  endpoints: readonly {
    readonly label: string;
    readonly method: string;
    readonly path: string;
  }[]
): readonly {
  readonly label: string;
  readonly method: string;
  readonly path: string;
}[] {
  return endpoints.map(normalizeEndpointForCompare).sort((a, b) => {
    const methodCompare = a.method.localeCompare(b.method);
    if (methodCompare !== 0) {
      return methodCompare;
    }
    return a.path.localeCompare(b.path);
  });
}

export const connectorComparable: ComparableFieldsContract<
  Connector,
  AdapterDto
> = {
  fromManifest: (connector) => ({
    endpoints: sortedNormalizedEndpoints(connector.endpoints ?? []),
  }),
  fromLive: (live) => ({
    endpoints: sortedNormalizedEndpoints(live.endpoints ?? []),
  }),
};

// Agent: existence-only. agent-admin exposes system_prompt/model_config as
// separate columns and knowledge-base links as UUIDs, while the manifest
// carries a free-form `profile` and knowledge-base NAMES — different
// identifier spaces with no faithful value comparison yet.
export const agentComparable: ComparableFieldsContract<Agent, AgentDto> = {
  fromManifest: () => ({}),
  fromLive: () => ({}),
};

// Hosted service: compare env var NAMES only (sorted). Never values, never
// the manifest-only `secretRef` bindings the live side cannot supply.
// image/buildRef are excluded from BOTH sides: registry-service resolves a
// buildRef to an image server-side and exposes no `buildRef`, so comparing
// either would break idempotency for buildRef-declared services (a one-sided
// key). Build provenance comparison is a follow-up once registry exposes it.
export const serviceComparable: ComparableFieldsContract<
  HostedService,
  RegisteredServiceDto
> = {
  fromManifest: (service) => ({
    envNames: (service.env ?? []).map((envVar) => envVar.name).sort(),
  }),
  fromLive: (live) => ({
    envNames: Object.keys(live.envVars ?? {}).sort(),
  }),
};

// Workflow: existence-only. The manifest's opaque `definition` and
// workflow-service's `actions`/`trigger`/`variables` columns are not
// faithfully mappable yet.
export const workflowComparable: ComparableFieldsContract<
  Workflow,
  WorkflowDto
> = {
  fromManifest: () => ({}),
  fromLive: () => ({}),
};

// System variable (manual-loops/provisioning-manifest-gaps.md T04, gap 4):
// `type` and `value` are BOTH comparable — agent-admin-service's
// `ISystemVariable` round-trips them 1:1 (identifier space is the manifest
// `name`, matched by `name` like every other kind here).
//
// TWO-SIDED secret-leak defense (this file's "secret VALUES never appear in a
// projection" hard rule — automatic rejection if violated):
//
//   MANIFEST side (`fromManifest`): the manifest schema
//   (`manifest.schema.ts`'s `systemVariableSchema`) REJECTS `type: "secret"`
//   outright, so a manifest-declared variable is always plain CONFIG
//   (thresholds/flags) — its `value` is never a credential. No redaction
//   needed here.
//
//   LIVE side (`fromLive`): the live table is NOT so constrained — a
//   `type: "secret"` variable can be created out-of-band (admin UI / SDK),
//   and `findByName` matches by NAME ONLY (no type filter). So a live secret
//   variable whose name collides with a manifest string/number/etc variable
//   WOULD, if projected naively, echo its plaintext `value` straight into
//   `FieldDiff.current` in plan output. To close that vector, `fromLive`
//   OMITS `value` entirely when `live.type === "secret"` — the raw value (and
//   anything derived from it) is never read into the projection. The
//   name-collision still surfaces HONESTLY as an `update` verdict: the `type`
//   field differs ("secret" live vs the manifest's non-secret type), and the
//   unioned `value` key diffs as `current: undefined` (redacted) vs the
//   manifest's own safe config value — an accurate "these disagree, reconcile
//   me" signal with zero live-secret exposure.
export const systemVariableComparable: ComparableFieldsContract<
  ManifestSystemVariable,
  SystemVariableDto
> = {
  fromManifest: (systemVariable) => ({
    type: systemVariable.type,
    value: systemVariable.value,
  }),
  fromLive: (live) =>
    // Redact: never read a secret-typed live variable's `value` into the
    // projection (it would leak into plan output). Project `type` only so the
    // name-collision still diffs to an honest `update` verdict.
    live.type === "secret"
      ? { type: live.type }
      : { type: live.type, value: live.value },
};
