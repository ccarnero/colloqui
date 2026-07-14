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

export interface AdapterDto {
  readonly id: string;
  readonly name: string;
  readonly context: string;
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

// Connector: existence-only. connector-admin models a structured adapter
// (`context` + baseUrl + auth material) with no faithful mapping to the
// manifest's free-form `{ type, config }`, and its credential fields must
// never be projected. No comparable value field today, so create/noop is
// decided purely by whether a same-named connector exists live.
export const connectorComparable: ComparableFieldsContract<
  Connector,
  AdapterDto
> = {
  fromManifest: () => ({}),
  fromLive: () => ({}),
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
