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
  ManifestMcpServer,
  ManifestSkill,
  ManifestSystemVariable,
  Workflow,
} from "@yoizen/shared";
import { DEFAULT_ROUTE_METHODS } from "../../../lib/default-route-methods";
import { secretResourceName } from "../../secrets/lib/secret-resource-name";

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
  // manual-loops/provisioning-manifest-gaps-2.md T07 batch B — connector-admin's
  // `mapAdapter` surfaces `tags: row.tags ?? []` on BOTH the list and get
  // responses, so tags ARE faithfully readable off the live row (unlike
  // `authConfig`, which is deliberately excluded above). Tags are routing
  // metadata (e.g. `["llm"]`), never credential-bearing, so projecting them
  // does not violate this file's secret-projection rule.
  readonly tags?: readonly string[];
}

/**
 * Live shape from `GET /admin/agents` (agent-admin-service's `IAgent`,
 * `AGENT_ROW_COLUMNS`). `enabled_mcp_tools`/`tool_description_overrides`
 * (T04, manual-loops/provisioning-manifest-gaps-2.md gap 4) round-trip 1:1 —
 * unlike `system_prompt`/`model_config`, these two ARE faithfully readable
 * off the live row, so they join the comparable projection below (unlike the
 * rest of `AgentDto`, which stays existence-only). Neither field is
 * credential-bearing (tool names/allowlists/description text, never secret
 * values), so nothing here violates this file's secret-projection rule.
 */
export interface AgentDto {
  readonly id: string;
  readonly name: string;
  readonly enabled_mcp_tools?: Record<string, string[] | null> | null;
  readonly tool_description_overrides?: Record<string, string> | null;
}

/**
 * Live route shape (T05, gap 5) — mirrors `sdk/src/resources/registry/types.ts`
 * `ServiceRoute` MINUS `id`/`createdAt` (the manifest has no route id; the
 * writer matches by `pathPrefix` instead, see `registry-services-writer.ts`).
 * Populated by `registry-services-client.ts` via a per-matched-service
 * `GET /services/:id/routes` call — absent when the service itself has no
 * live match yet (→ `create`).
 */
export interface RegisteredServiceRouteDto {
  readonly pathPrefix: string;
  readonly methods: readonly string[];
  readonly isPublic: boolean;
  readonly stripPrefix: boolean;
}

/**
 * registry-service's k8s-native secretKeyRef reference (manual-loops/
 * provisioning-manifest-gaps-4.md T04, Option B) — an env var bound to a
 * Secret, never a resolved plaintext value. Mirrors `knative-builder.ts`'s
 * `KnativeEnvEntry`'s `valueFrom.secretKeyRef` shape verbatim (registry-
 * service persists/echoes `envVars` JSONB unchanged — see
 * `registry-row-mappers.ts`'s `mapRegisteredServiceRow`).
 */
export interface RegisteredServiceEnvSecretRef {
  readonly secretKeyRef: { readonly name: string; readonly key: string };
}

/**
 * manual-loops/demos/crm-support-telegram.md T04 findings ("STALE-STATE MASKING")
 * — the incident this type closes: registry-service's `GET /services` was
 * previously (mis)typed here as `Record<string, string>`, discarding the
 * `{ secretKeyRef }` shape a live env var can legitimately hold. That
 * mistyping is what let a plaintext credential sit in the Knative spec
 * un-detected — the comparable projection only ever read `Object.keys(...)`
 * (names), never the value's SHAPE, so a secretRef-declared var whose live
 * value had regressed to a plaintext literal still reported `noop`. This
 * widened type is what `serviceEnvMechanismComparable` (below) needs to
 * catch that drift.
 */
export type RegisteredServiceEnvValue = string | RegisteredServiceEnvSecretRef;

export interface RegisteredServiceDto {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly envVars?: Record<string, RegisteredServiceEnvValue>;
  // T05, gap 5 — scaling fields registry-service ALWAYS reports a real value
  // for (server-side defaults are applied at creation, never left absent).
  // See `serviceComparable` below for why these are only COMPARED when the
  // manifest itself declares the field.
  readonly port?: number;
  readonly minScale?: number;
  readonly maxScale?: number;
  readonly concurrencyTarget?: number;
  readonly routes?: readonly RegisteredServiceRouteDto[];
}

/**
 * Live shape from `GET /workflows` (workflow-service's `toCreateResult`).
 * Deliberately EXCLUDES `id`/`tenantId`/`status`/`createdAt` — server-only
 * fields with no manifest counterpart (`status` has its own separate PATCH
 * endpoint, no manifest field maps to it; `tenantId`/`createdAt` are pure
 * bookkeeping). `application`/`actions`/`trigger`/`variables` round-trip
 * VERBATIM — workflow-service injects no server-side defaults for them — so
 * they ARE faithfully comparable (see `workflowComparable` below).
 */
export interface WorkflowDto {
  readonly id: string;
  readonly name: string;
  readonly application: string;
  readonly actions: readonly unknown[];
  readonly trigger?: unknown;
  readonly variables?: unknown;
}

/** Live shape from `GET /admin/system-variables` (agent-admin-service's `ISystemVariable`). */
export interface SystemVariableDto {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly value: unknown;
}

/**
 * Live shape from `GET /admin/mcp-servers` (agent-admin-service's
 * `IMcpServer`, T06, gap 6). Deliberately EXCLUDES `headers`/`authType`/
 * `authConfig` — `headers` values can be credential-capable (a header may
 * carry a resolved `secretRef`, see `manifest.schema.ts`'s
 * `mcpServerSchema` comment) and `authConfig` always is (see
 * `AdapterDto`'s header comment for the same reasoning on connectors) — so
 * neither is even READABLE from this DTO, making an accidental projection
 * impossible.
 */
export interface McpServerDto {
  readonly id: string;
  readonly name: string;
  readonly transport_type: string;
  readonly url: string;
  readonly enabled: boolean;
}

/**
 * Live shape from `GET /admin/skills` (agent-admin-service's `ISkill`, T01,
 * manual-loops/provisioning-manifest-gaps-3.md workstream a). `SkillsService.findAll`
 * runs `SELECT *`, so every field this DTO lists round-trips 1:1 — an
 * HONEST projection, per the task brief, not an assumed one. None of these
 * fields is credential-capable (verified against every field in
 * `CreateSkillDto`/`UpdateSkillDto`), so nothing here violates this file's
 * secret-projection rule. `id`/`metadata`/`is_active`/timestamps are
 * deliberately excluded — not part of the manifest-declared shape.
 */
export interface SkillDto {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly system_prompt: string;
  readonly icon: string;
  readonly color: string;
  readonly trigger_commands: string[];
  readonly when_to_use: string;
  readonly priority: number;
  readonly allowed_tools: string[];
  readonly mode: string;
  readonly files: readonly {
    readonly name: string;
    readonly path: string;
    readonly type: string;
    readonly content: string;
  }[];
}

export interface ComparableFieldsContract<TManifest, TLive> {
  readonly fromManifest: (resource: TManifest) => Record<string, unknown>;
  /**
   * `declared` (T05, gap 5) is an OPTIONAL second argument: the manifest's
   * own desired resource, when the caller has it. Every existing kind
   * ignores it — only `serviceComparable` uses it, to decide which OPTIONAL
   * scaling fields to include in the live projection (see that contract's
   * comment for why this is required for idempotency).
   */
  readonly fromLive: (
    live: TLive,
    declared?: TManifest
  ) => Record<string, unknown>;
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
  fromManifest: (connector) => {
    const fields: Record<string, unknown> = {
      endpoints: sortedNormalizedEndpoints(connector.endpoints ?? []),
    };
    // manual-loops/provisioning-manifest-gaps-2.md T07 batch B — `tags` use the
    // SAME declared-gate idiom `serviceComparable` established for scaling
    // fields: only compared when the manifest declares them, so a connector
    // that never declares `tags` does not diff forever against a live row whose
    // `tags` default to `[]`. Sorted for order-insensitive comparison, mirroring
    // the endpoint/route normalization above.
    if (connector.tags !== undefined) {
      fields.tags = [...connector.tags].sort();
    }
    return fields;
  },
  fromLive: (live, declared) => {
    const fields: Record<string, unknown> = {
      endpoints: sortedNormalizedEndpoints(live.endpoints ?? []),
    };
    if (declared?.tags !== undefined) {
      fields.tags = [...(live.tags ?? [])].sort();
    }
    return fields;
  },
};

// Agent (manual-loops/provisioning-manifest-gaps-2.md T04, gap 4):
// `system_prompt`/`model_config`/knowledge-base UUIDs stay existence-only,
// unchanged from T03 (different identifier spaces, no faithful mapping yet).
// `enabledMcpTools`/`toolDescriptionOverrides` ARE faithfully comparable —
// agent-admin-service's `IAgent` round-trips both 1:1 (`AGENT_ROW_COLUMNS`) —
// so they join the projection using the SAME "only compare what the manifest
// declares" idiom `serviceComparable` established for scaling fields above:
// unconditionally projecting them would diff forever for any agent that
// never declares them (the live column defaults to `null`, an object still
// present on only one side).
//
// Both fields key by MCP server NAME (never substituted to an id — decision
// 6, mirrors `enabledMcpServerRefs`'s precedent). Normalization sorts object
// keys and (for `enabledMcpTools`) each server's tool-name array, so manifest
// declaration order never causes a false `update`, mirroring
// `sortedNormalizedEndpoints`/`sortedNormalizedRoutes` above.
function normalizeEnabledMcpTools(
  value: Record<string, string[] | null> | null | undefined
): Record<string, string[] | null> {
  const normalized: Record<string, string[] | null> = {};
  for (const key of Object.keys(value ?? {}).sort()) {
    const tools = (value ?? {})[key];
    normalized[key] = tools === null ? null : [...tools].sort();
  }
  return normalized;
}

function normalizeToolDescriptionOverrides(
  value: Record<string, string> | null | undefined
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const key of Object.keys(value ?? {}).sort()) {
    normalized[key] = (value ?? {})[key];
  }
  return normalized;
}

export const agentComparable: ComparableFieldsContract<Agent, AgentDto> = {
  fromManifest: (agent) => {
    const fields: Record<string, unknown> = {};
    if (agent.enabledMcpTools !== undefined) {
      fields.enabledMcpTools = normalizeEnabledMcpTools(agent.enabledMcpTools);
    }
    if (agent.toolDescriptionOverrides !== undefined) {
      fields.toolDescriptionOverrides = normalizeToolDescriptionOverrides(
        agent.toolDescriptionOverrides
      );
    }
    return fields;
  },
  fromLive: (live, declared) => {
    const fields: Record<string, unknown> = {};
    if (declared?.enabledMcpTools !== undefined) {
      fields.enabledMcpTools = normalizeEnabledMcpTools(live.enabled_mcp_tools);
    }
    if (declared?.toolDescriptionOverrides !== undefined) {
      fields.toolDescriptionOverrides = normalizeToolDescriptionOverrides(
        live.tool_description_overrides
      );
    }
    return fields;
  },
};

// Hosted service: compare env var NAMES only (sorted). Never values, never
// the manifest-only `secretRef` bindings the live side cannot supply.
// image/buildRef are excluded from BOTH sides: registry-service resolves a
// buildRef to an image server-side and exposes no `buildRef`, so comparing
// either would break idempotency for buildRef-declared services (a one-sided
// key). Build provenance comparison is a follow-up once registry exposes it.
//
// T05 (manual-loops/provisioning-manifest-gaps.md, gap 5) — scaling fields
// (port/minScale/maxScale/concurrencyTarget) and `routes` join the
// comparison:
//
// SCALING FIELDS: registry-service ALWAYS reports a real value (its own
// server-side default when the manifest omitted the field at create time —
// decision 6: "the manifest never invents defaults client-side"). If we
// projected these unconditionally on both sides, a manifest that never
// declares `port` would diff FOREVER against whatever real port the server
// assigned — exactly the "key present on only one side diffs forever" trap
// this file's header warns about. So each scaling field is included in the
// projection ONLY when the MANIFEST declares it: `fromManifest` includes the
// key only if the field is set, and `fromLive` mirrors that decision via its
// optional `declared` (the same manifest resource) — never inventing a
// comparison the manifest never asked for. A declared field that changed
// still produces an honest `update` verdict.
//
// ROUTES: unlike scaling fields, `routes` is a manifest-managed nested list
// (like T02's connector `endpoints`) — always projected as a normalized,
// sorted array on BOTH sides (empty array when nothing is declared/live),
// mirroring `connectorComparable`'s endpoint-diffing precedent exactly.
function normalizeRouteForCompare(route: {
  readonly pathPrefix: string;
  readonly methods?: readonly string[];
  readonly isPublic?: boolean;
  readonly stripPrefix?: boolean;
}): {
  readonly pathPrefix: string;
  readonly methods: readonly string[];
  readonly isPublic: boolean;
  readonly stripPrefix: boolean;
} {
  return {
    pathPrefix: route.pathPrefix,
    methods: [...(route.methods ?? DEFAULT_ROUTE_METHODS)]
      .map((method) => method.toUpperCase())
      .sort(),
    isPublic: route.isPublic ?? false,
    stripPrefix: route.stripPrefix ?? true,
  };
}

function sortedNormalizedRoutes(
  routes: readonly {
    readonly pathPrefix: string;
    readonly methods?: readonly string[];
    readonly isPublic?: boolean;
    readonly stripPrefix?: boolean;
  }[]
): readonly {
  readonly pathPrefix: string;
  readonly methods: readonly string[];
  readonly isPublic: boolean;
  readonly stripPrefix: boolean;
}[] {
  return routes
    .map(normalizeRouteForCompare)
    .sort((a, b) => a.pathPrefix.localeCompare(b.pathPrefix));
}

export const serviceComparable: ComparableFieldsContract<
  HostedService,
  RegisteredServiceDto
> = {
  fromManifest: (service) => {
    const fields: Record<string, unknown> = {
      envNames: (service.env ?? []).map((envVar) => envVar.name).sort(),
      routes: sortedNormalizedRoutes(service.routes ?? []),
    };
    if (service.port !== undefined) {
      fields.port = service.port;
    }
    if (service.minScale !== undefined) {
      fields.minScale = service.minScale;
    }
    if (service.maxScale !== undefined) {
      fields.maxScale = service.maxScale;
    }
    if (service.concurrencyTarget !== undefined) {
      fields.concurrencyTarget = service.concurrencyTarget;
    }
    return fields;
  },
  fromLive: (live, declared) => {
    const fields: Record<string, unknown> = {
      envNames: Object.keys(live.envVars ?? {}).sort(),
      routes: sortedNormalizedRoutes(live.routes ?? []),
    };
    if (declared?.port !== undefined) {
      fields.port = live.port;
    }
    if (declared?.minScale !== undefined) {
      fields.minScale = live.minScale;
    }
    if (declared?.maxScale !== undefined) {
      fields.maxScale = live.maxScale;
    }
    if (declared?.concurrencyTarget !== undefined) {
      fields.concurrencyTarget = live.concurrencyTarget;
    }
    return fields;
  },
};

// Service env MECHANISM-aware comparator (manual-loops/demos/crm-support-telegram.md
// T04 findings, "STALE-STATE MASKING" gap). `serviceComparable` above
// deliberately stays envNames-only — it is REUSED verbatim as this
// contract's plan-time fallback (see `build-manifest-plan.ts`'s service
// branch), mirroring `workflowExistenceOnlyComparable`'s role for workflows.
//
// THE INCIDENT this closes: a live registered service whose env var has the
// SAME NAME but a DIFFERENT MECHANISM (plaintext literal vs a service-scoped
// `secretRef` -> `valueFrom.secretKeyRef` vs a resolved connector/endpoint
// ref) reported `noop` under envNames-only comparison — YOIZEN credentials
// sat as PLAINTEXT values in the Knative spec and `apply` never re-converged
// them to the k8s-native secretRef mechanism decision 7 requires.
//
// MECHANISM MODEL — only two buckets are actually OBSERVABLE on the live
// side (`registry-row-mappers.ts`'s `mapRegisteredServiceRow` echoes
// `envVars` JSONB verbatim, see `RegisteredServiceEnvValue` above):
//   - `"secretKeyRef"` — the live value is `{ secretKeyRef: { name, key } }`.
//     Identity-comparable (name/key), never a value to leak.
//   - `"plain"` — the live value is a bare string. This bucket
//     UNAVOIDABLY collapses two manifest-side origins that registry-service
//     itself cannot tell apart once resolved: a manifest literal (schema-
//     guaranteed non-secret) and a resolved `{ connectorRef }`/
//     endpoint-ref (a connector/endpoint id, also non-secret) — both are
//     sent to registry-service as the SAME plain string
//     (`registry-services-writer.ts`'s `buildEnvVars`), so registry-service
//     persists/reports them identically. Distinguishing "this plain value
//     came from connectorRef X" after the fact is NOT possible from live
//     data alone — a documented, accepted limitation (mirrors this file's
//     other documented follow-ups, e.g. connector `cache`-only diffs).
//   - `"unresolved"` — PLAN time could not determine what this entry's
//     mechanism SHOULD be (an endpoint-ref shape, which never resolves
//     before apply time, or a `{ connectorRef }` whose target has no live
//     id yet this run). Projected IDENTICALLY on both the manifest and live
//     sides for that one entry (never compares the live value at all), so
//     that ONE unresolvable entry can never forever-diff — see the
//     PER-ENTRY DEGRADATION note below. This is what fixes a fresh-context
//     review finding (manual-loops/demos/crm-support-telegram.md T04 follow-up):
//     degrading the WHOLE service the moment ANY entry was unresolvable
//     defeated the feature for its own motivating case (a service mixing a
//     `secretRef` var with an endpoint-ref var — e.g.
//     `demos/crm-support-telegram/manifest.yaml`'s `priority-scorer` — never
//     got its secretRef var mechanism-checked, because an endpoint-ref
//     shape is ALWAYS unresolvable at plan time).
//
// SECRET-LEAK DEFENSE (two-sided, mirrors `systemVariableComparable`'s
// redaction precedent, HARDENED against a second fresh-context review
// finding — see BYTE-FOR-BYTE GATING below): the MANIFEST side may always
// include a `"plain"` entry's value — manifest literals are non-secret by
// schema, and a resolved connectorRef/endpoint-ref value is an id, never a
// credential. The LIVE side must NEVER assume the manifest's declared
// mechanism proves the ACTUAL live value is safe — a live row can drift
// out-of-band (exactly the incident: someone/something writes a live
// credential under a name the manifest declares as a plain literal or a
// resolved ref). So:
//   - manifest declares `{ secretRef }` (expects `"secretKeyRef"`) but live
//     is a bare string -> THE INCIDENT shape: live value is NEVER read into
//     the projection, only `mechanism: "plain"` (no `value`) — the mechanism
//     mismatch alone (`"plain"` vs the manifest's own `"secretKeyRef"`)
//     surfaces an honest `update` with zero live-secret exposure.
//   - manifest declares a literal/resolved-ref (expects `"plain"` with a
//     KNOWN expected value `V`) and live is ALSO a bare string -> BYTE-FOR-
//     BYTE GATING: the live value is echoed ONLY when it is IDENTICAL to
//     `V` (an equal string reveals nothing the manifest doesn't already
//     contain). When it differs, `value` is OMITTED from the live
//     projection entirely (`{ mechanism: "plain" }`, same shape the
//     secretKeyRef-mismatch path projects) — NEVER the actual live string,
//     and never a fixed redaction sentinel either: a sentinel could
//     coincide with a manifest literal that EQUALS the sentinel string and
//     deepEqual into a false noop. The desired side always projects
//     `value` for a literal, so the missing key alone surfaces an honest
//     `update` without ever echoing a live-only credential.
//   - the var is UNDECLARED (live-only, extra) -> no independent proof of
//     safety, `value` is never echoed (mechanism only).
//
// PLAN-TIME RESOLUTION for `{ connectorRef }` (whole-connector) entries
// reuses the SAME `resolvedIds` map / `resolveRef` closure
// `build-manifest-plan.ts`'s workflow branch already threads through
// (manual-loops/provisioning-manifest-gaps-5.md) — no parallel resolution
// mechanism invented. `fromLive` needs the SAME `resolveConnectorRef`
// closure `fromManifest` does — NOT to resolve anything on the live side
// itself (live values are always already-real), but to classify the
// DECLARED counterpart of each live entry identically to how `fromManifest`
// classifies it, so the two projections can only ever differ on a REAL
// mechanism/value disagreement, never on which side happened to resolve a
// ref. The endpoint-ref shape (`{ connectorRef, endpointMethod,
// endpointPath }`) needs a LIVE `GET /connectors/:id` to resolve a specific
// endpoint id (`resolve-service-env-refs.ts` only does this at APPLY time)
// — plan time has no such call wired, so it is always classified
// `"unresolved"`.
//
// PER-ENTRY DEGRADATION: classification never throws and never fails the
// whole service — a malformed/unrecognized value shape also classifies as
// `"unresolved"` defensively for THAT entry only. `build-manifest-plan.ts`
// no longer needs (or has) a whole-service fallback contract; every service
// always gets the full mechanism-aware projection, entry by entry.
export interface ServiceEnvMechanismEntry {
  readonly name: string;
  readonly mechanism: "plain" | "secretKeyRef" | "unresolved";
  readonly value?: string;
  readonly secretKeyRef?: { readonly name: string; readonly key: string };
}

/** The manifest-side classification of one env var's declared value — the ONE place both `fromManifest` and `fromLive` derive "what mechanism/value SHOULD this entry have". */
type DeclaredEnvClassification =
  | { readonly kind: "literal"; readonly value: string }
  | {
      readonly kind: "secretKeyRef";
      readonly secretKeyRef: { readonly name: string; readonly key: string };
    }
  | { readonly kind: "unresolved" };

function classifyDeclaredEnvValue(
  service: HostedService,
  value: unknown,
  resolveConnectorRef?: (connectorName: string) => string | undefined
): DeclaredEnvClassification {
  if (typeof value === "string") {
    return { kind: "literal", value };
  }

  if (typeof value !== "object" || value === null) {
    // Defensive: a malformed/unexpected shape (should never happen against
    // a schema-validated manifest) — degrades ONLY this entry, never throws.
    return { kind: "unresolved" };
  }

  const valueKeys = Object.keys(value);

  if (valueKeys.length === 1 && valueKeys[0] === "secretRef") {
    const secretRef = (value as { secretRef: string }).secretRef;
    return {
      kind: "secretKeyRef",
      secretKeyRef: {
        // secret-resource-name.ts:29-31 — the ONE naming source of truth,
        // reused verbatim (mirrors `registry-services-writer.ts`'s
        // `buildEnvVars`).
        name: secretResourceName("service", service.name),
        key: secretRef,
      },
    };
  }

  if (valueKeys.length === 1 && valueKeys[0] === "connectorRef") {
    const connectorName = (value as { connectorRef: string }).connectorRef;
    const resolved = resolveConnectorRef?.(connectorName);
    return resolved === undefined
      ? { kind: "unresolved" }
      : { kind: "literal", value: resolved };
  }

  // Endpoint-ref shape (`connectorRef` + `endpointMethod` + `endpointPath`)
  // — always unresolved at plan time (see header comment). Any other
  // shape also degrades here defensively.
  return { kind: "unresolved" };
}

function projectDeclaredClassification(
  name: string,
  classification: DeclaredEnvClassification
): ServiceEnvMechanismEntry {
  switch (classification.kind) {
    case "literal":
      return { name, mechanism: "plain", value: classification.value };
    case "secretKeyRef":
      return {
        name,
        mechanism: "secretKeyRef",
        secretKeyRef: classification.secretKeyRef,
      };
    case "unresolved":
      return { name, mechanism: "unresolved" };
  }
}

function sortedByName(
  entries: ServiceEnvMechanismEntry[]
): ServiceEnvMechanismEntry[] {
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Strips the `serviceComparable`-projected `envNames` key, keeping every other (routes/scaling) key unchanged. */
function withoutEnvNames(
  fields: Record<string, unknown>
): Record<string, unknown> {
  const { envNames: _envNames, ...rest } = fields;
  return rest;
}

export const serviceEnvMechanismComparable = {
  fromManifest: (
    service: HostedService,
    resolveConnectorRef?: (connectorName: string) => string | undefined
  ): Record<string, unknown> => {
    const declared = service.env ?? [];
    const entries = declared.map((envVar) =>
      projectDeclaredClassification(
        envVar.name,
        classifyDeclaredEnvValue(service, envVar.value, resolveConnectorRef)
      )
    );

    return {
      ...withoutEnvNames(serviceComparable.fromManifest(service)),
      env: sortedByName(entries),
    };
  },

  fromLive: (
    live: RegisteredServiceDto,
    declared?: HostedService,
    resolveConnectorRef?: (connectorName: string) => string | undefined
  ): Record<string, unknown> => {
    const declaredValueByName = new Map(
      (declared?.env ?? []).map((envVar) => [envVar.name, envVar.value])
    );
    const entries: ServiceEnvMechanismEntry[] = [];

    for (const [name, liveValue] of Object.entries(live.envVars ?? {})) {
      const declaredValue = declaredValueByName.get(name);
      const classification =
        declaredValue === undefined
          ? undefined
          : classifyDeclaredEnvValue(
              declared as HostedService,
              declaredValue,
              resolveConnectorRef
            );

      // Unresolvable at plan time (endpoint-ref shape, or a connectorRef
      // with no live id yet) — project IDENTICALLY to what `fromManifest`
      // projects for this SAME name, regardless of the live value's actual
      // shape/content, so this one entry can never forever-diff.
      if (classification?.kind === "unresolved") {
        entries.push({ name, mechanism: "unresolved" });
        continue;
      }

      const liveIsSecretKeyRef =
        typeof liveValue === "object" &&
        liveValue !== null &&
        "secretKeyRef" in liveValue;

      if (liveIsSecretKeyRef) {
        // Identity only — never a value to leak, safe regardless of what
        // the manifest expects (a mismatch vs. the manifest's OWN
        // `secretKeyRef`/`"plain"` projection still surfaces honestly via
        // `deepEqual` on the whole entry).
        const secretKeyRef = (
          liveValue as { secretKeyRef: { name: string; key: string } }
        ).secretKeyRef;
        entries.push({
          name,
          mechanism: "secretKeyRef",
          secretKeyRef: { name: secretKeyRef.name, key: secretKeyRef.key },
        });
        continue;
      }

      // Live value is a bare string ("plain"). Decide whether it is safe
      // to echo — see this contract's header comment ("SECRET-LEAK
      // DEFENSE") for the full reasoning:
      //   - undeclared (no manifest counterpart) -> never echo.
      //   - manifest expects `secretKeyRef` (THE INCIDENT shape) -> never
      //     echo; the mechanism mismatch alone is the signal.
      //   - manifest expects a literal/resolved-ref value `V` -> echo ONLY
      //     when the live string is BYTE-FOR-BYTE equal to `V`; otherwise
      //     OMIT `value` entirely (same shape the secretKeyRef-mismatch
      //     path projects). The desired side always projects `value` for a
      //     literal, so the missing key alone yields an honest `update` —
      //     and unlike a fixed redaction sentinel, an omitted key cannot
      //     collide with a manifest literal that happens to EQUAL the
      //     sentinel string (which would deepEqual into a false noop and
      //     mask the drift).
      if (classification === undefined) {
        entries.push({ name, mechanism: "plain" });
        continue;
      }
      if (classification.kind === "secretKeyRef") {
        entries.push({ name, mechanism: "plain" });
        continue;
      }
      // classification.kind === "literal"
      if (liveValue === classification.value) {
        entries.push({ name, mechanism: "plain", value: classification.value });
      } else {
        entries.push({ name, mechanism: "plain" });
      }
    }

    return {
      ...withoutEnvNames(serviceComparable.fromLive(live, declared)),
      env: sortedByName(entries),
    };
  },
};

// Workflow (manual-loops/provisioning-manifest-gaps-5.md — content-aware
// workflow comparator): the manifest's `definition.application`/`.actions`/
// `.trigger`/`.variables` map 1:1 onto workflow-service's own columns
// (`WorkflowDto` above) — `workflows-writer.ts`'s `create()` already reads
// EXACTLY these four keys off `definition` to build its POST body, so
// projecting the same four keys here is an honest, already-proven mapping.
//
// THE CENTRAL TRAP (why this contract alone is not enough): the manifest's
// `definition` tree may embed SYMBOLIC ref-objects at allowlisted argument
// keys (`accountId: { channelRef }`, `adapterId: { connectorRef }`,
// `agentId: { agentRef }`, `serviceId: { serviceRef }`, `serverId:
// { mcpServerRef }`, `connectorId: { connectorRef }`, plus the plural
// `accountIds: [{ channelRef }, ...]`), while the LIVE `actions`/`trigger`
// this DTO reports already hold the SUBSTITUTED real platform ids — a naive
// diff between the two never converges (every workflow with a ref-bearing
// action forever `update`s). `fromManifest` therefore assumes its caller has
// ALREADY substituted every allowlisted ref in `resource.definition` with
// its real id BEFORE calling this function — `build-manifest-plan.ts` is
// the ONE call site that does this, using a plan-time `resolvedIds` map
// built from the SAME live lookups the planner already performs for every
// other resource kind (see that file for the graceful-degradation fallback
// to `workflowExistenceOnlyComparable` below when a ref cannot yet be
// resolved, e.g. its target is being created in the SAME plan).
//
// `{{...}}` runtime template strings are untouched by the substitution
// walker and appear byte-identical on both sides — safe to compare as-is.
//
// `actions` is compared ARRAY-ORDER-SENSITIVE (unlike the sorted-array
// idiom `connectorComparable`/`serviceComparable` use for endpoints/routes):
// action execution order is semantically meaningful, so `deepEqual`
// (order-sensitive for arrays) is exactly the right comparison — no
// normalization/sorting here.
//
// `trigger`/`variables` follow the SAME declared-gate idiom
// `serviceComparable`/`agentComparable` established: `workflows-writer.ts`'s
// `create()` only sends `trigger`/`variables` in the request body when
// `definition.trigger`/`.variables !== undefined`, so the comparator must
// mirror that OMIT-symmetry exactly — both sides omit the key when the
// manifest omits it, never comparing against a live `null`/absent value the
// manifest never declared an opinion about.
export const workflowComparable: ComparableFieldsContract<
  Workflow,
  WorkflowDto
> = {
  fromManifest: (workflow) => {
    const definition = workflow.definition;
    const fields: Record<string, unknown> = {
      application: definition.application,
      actions: definition.actions,
    };
    if (definition.trigger !== undefined) {
      fields.trigger = definition.trigger;
    }
    if (definition.variables !== undefined) {
      fields.variables = definition.variables;
    }
    return fields;
  },
  fromLive: (live, declared) => {
    const fields: Record<string, unknown> = {
      application: live.application,
      actions: live.actions,
    };
    if (declared?.definition.trigger !== undefined) {
      fields.trigger = live.trigger;
    }
    if (declared?.definition.variables !== undefined) {
      fields.variables = live.variables;
    }
    return fields;
  },
};

// Workflow FALLBACK (graceful degradation): the ORIGINAL T03 existence-only
// contract, kept verbatim as the safety net `build-manifest-plan.ts` falls
// back to for ONE workflow at a time when `substituteSymbolicRefs` cannot
// fully resolve that workflow's `definition` at plan time (e.g. a
// referenced resource is being created in the SAME plan and has no live id
// yet). Falling back to existence-only rather than failing the whole plan
// or diffing against a still-symbolic definition (which would emit a
// spurious `update` every single time) — see `build-manifest-plan.ts`'s
// workflow branch for where this is invoked.
export const workflowExistenceOnlyComparable: ComparableFieldsContract<
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

// MCP server (manual-loops/provisioning-manifest-gaps.md T06, gap 6):
// `transport_type`/`url`/`enabled` are faithfully comparable on both sides
// (agent-admin-service's `IMcpServer` round-trips them 1:1, identifier space
// is the manifest `name`, matched like every other kind here).
//
// SECRET-LEAK DEFENSE (this file's "secret VALUES never appear in a
// projection" hard rule): `auth`/`headers` are NEVER projected — `McpServerDto`
// (above) doesn't even carry `headers`/`authType`/`authConfig` fields, so
// there is nothing to accidentally read here, mirroring `connectorComparable`
// / `AdapterDto`'s precedent exactly. `headers` is additionally excluded
// because, unlike connector endpoints, a header VALUE can itself be
// credential-capable (a resolved `secretRef`) — diffing it would require
// reading the resolved plaintext value, which this file's header rule
// forbids outright. An mcpServer's `auth`/`headers`-only change therefore
// no-ops in the planner today (same documented limitation T02's endpoint
// follow-up (c) notes for connector cache-only changes): an mcpServer whose
// ONLY manifest change is `auth`/`headers` stays `noop` and `update()` is
// never invoked. `mcp-servers-writer.ts`'s `update()` DOES still resend the
// full desired `auth`/`headers` alongside whatever comparable field changed,
// so an auth/headers change bundled with a comparable field change is never
// dropped — only a pure auth/headers-only change is a known follow-up gap
// (documented in the writer, mirrors the connector cache-only precedent).
export const mcpServerComparable: ComparableFieldsContract<
  ManifestMcpServer,
  McpServerDto
> = {
  fromManifest: (mcpServer) => ({
    transport_type: mcpServer.transport_type,
    url: mcpServer.url,
    enabled: mcpServer.enabled ?? true,
  }),
  fromLive: (live) => ({
    transport_type: live.transport_type,
    url: live.url,
    enabled: live.enabled,
  }),
};

// Skill (T01, manual-loops/provisioning-manifest-gaps-3.md, workstream a):
// every non-identifier field `skillSchema` declares is faithfully comparable
// — `skills.service.ts`'s `findAll`/`create`/`update` round-trip all of them
// 1:1 (`SELECT *`, no derived/opaque columns). None is credential-capable
// (see `SkillDto`'s header comment).
//
// Without this case, `desiredFieldsOfResource` would fall through to
// `default: {}` for `kind: "skill"`, projecting an EMPTY desired shape while
// the live side (once T04's `skills-writer.ts` client ships) projects the
// real fields — every field a one-sided diff, a FOREVER `update` verdict
// exactly like `provisioning-manifest-gaps-2.md` T07 batch A's mcpServer
// finding (c). Both sides share this ONE contract instead.
//
// DEFAULTS: `skills.service.ts`'s `create()` applies fixed server-side
// defaults for every optional field the manifest omits (`icon` ->
// "smart_toy", `color` -> "#42a5f5", `mode` -> "llm_driven",
// `trigger_commands`/`allowed_tools`/`files` -> `[]`, `description`/
// `when_to_use` -> "", `priority` -> 0) — mirrored here on the MANIFEST side
// (`fromManifest`) so a skill that never declares e.g. `icon` compares
// cleanly against the live row's actual default value instead of diffing
// `undefined` vs `"smart_toy"` forever, mirroring `mcpServerComparable`'s
// `enabled ?? true` precedent (NOT the "declared-gate" idiom
// `serviceComparable` uses — that idiom is for fields whose live default
// varies per-resource; skills' defaults are fixed constants, so an
// unconditional two-sided comparison with the SAME constants stays honest).
export const skillComparable: ComparableFieldsContract<
  ManifestSkill,
  SkillDto
> = {
  fromManifest: (skill) => ({
    description: skill.description ?? "",
    system_prompt: skill.system_prompt,
    icon: skill.icon ?? "smart_toy",
    color: skill.color ?? "#42a5f5",
    trigger_commands: skill.trigger_commands ?? [],
    when_to_use: skill.when_to_use ?? "",
    priority: skill.priority ?? 0,
    allowed_tools: skill.allowed_tools ?? [],
    mode: skill.mode ?? "llm_driven",
    files: skill.files ?? [],
  }),
  fromLive: (live) => ({
    description: live.description,
    system_prompt: live.system_prompt,
    icon: live.icon,
    color: live.color,
    trigger_commands: live.trigger_commands,
    when_to_use: live.when_to_use,
    priority: live.priority,
    allowed_tools: live.allowed_tools,
    mode: live.mode,
    files: live.files,
  }),
};
