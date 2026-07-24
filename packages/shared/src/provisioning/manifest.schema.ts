// Zod schema + inferred types for the declarative provisioning
// `IntegrationManifest` (manual-loops/declarative-provisioning.md, task T01).
//
// This is the feature's public YAML contract, human-approved BEFORE
// implementation. Do not change field/section names without a new
// human approval round.
//
// The manifest holds structure and wiring ONLY:
// - `services` carries hosted-service REFERENCES (image or buildRef) —
//   never inline code.
// - `secrets` carries name + scope BINDINGS only — never values.
//
// Every object schema is `.strict()` so unknown keys fail loud instead of
// being silently dropped.

import { z } from "zod";
import { AdapterCacheMethod } from "../adapter.interfaces";
import type { VariableType } from "../variable.interfaces";

/** Size cap for inline KB document content (bytes, UTF-8). */
export const KB_INLINE_CONTENT_MAX_BYTES = 64 * 1024;

/** Reconciliation ids are by `name`: non-empty, slug-like, unique per section. */
export const nameSchema = z
  .string()
  .min(1, "name must not be empty")
  .max(63, "name must be at most 63 characters")
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    "name must be slug-like: lowercase alphanumeric characters and hyphens, not starting or ending with a hyphen"
  );

// ---------------------------------------------------------------------------
// Symbolic refs — plain string names resolved against the manifest's own
// sections (or against an `external: true` entry declared for out-of-band
// resources).
// ---------------------------------------------------------------------------

export const channelRefSchema = nameSchema;
export const agentRefSchema = nameSchema;
export const serviceRefSchema = nameSchema;
export const secretRefSchema = nameSchema;
// manual-loops/provisioning-manifest-gaps.md T03, gap 3 — lets a workflow/
// agent definition reference a connector by manifest name, mirroring
// channelRef/agentRef/serviceRef exactly (same `nameSchema`, same
// resolve-by-name-at-apply-time semantics).
export const connectorRefSchema = nameSchema;
// manual-loops/provisioning-manifest-gaps.md T06, gap 6 — lets a workflow
// `mcpCall` action's `serverId` argument reference an `mcpServers[]` entry by
// manifest name, resolved to the real MCP server id at apply time exactly
// like connectorRef/agentRef/serviceRef (see
// `services/provisioning-service/.../substitution-allowlist.ts`'s `serverId`
// entry). NOT used for an agent's own MCP-server enablement list — see
// `agentSchema.enabledMcpServerRefs` below for why that field resolves to the
// manifest NAME, never a real id.
export const mcpServerRefSchema = nameSchema;
// manual-loops/provisioning-manifest-gaps-3.md T02, workstream a — lets an
// agent's `profile.model_config.subagents[].catalog_skill_id` reference a
// `skills[]` entry by manifest name, resolved to the real skill id at apply
// time exactly like connectorRef/mcpServerRef (see
// `services/provisioning-service/.../substitution-allowlist.ts`'s
// `catalog_skill_id` entry).
export const skillRefSchema = nameSchema;

export const SYMBOLIC_REF_KEYS = [
  "channelRef",
  "agentRef",
  "serviceRef",
  "secretRef",
  "connectorRef",
  "mcpServerRef",
  "skillRef",
] as const;

export type SymbolicRefType = (typeof SYMBOLIC_REF_KEYS)[number];

// ---------------------------------------------------------------------------
// Knowledge base sources — discriminated union: inline | file | url.
// ---------------------------------------------------------------------------

const kbSourceInlineSchema = z
  .object({
    type: z.literal("inline"),
    content: z
      .string()
      .min(1, "inline content must not be empty")
      .max(
        KB_INLINE_CONTENT_MAX_BYTES,
        `inline content must be at most ${KB_INLINE_CONTENT_MAX_BYTES} bytes`
      ),
  })
  .strict();

const kbSourceFileSchema = z
  .object({
    type: z.literal("file"),
    path: z.string().min(1, "file path must not be empty"),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i, "sha256 must be a 64-character hex digest"),
  })
  .strict();

const kbSourceUrlSchema = z
  .object({
    type: z.literal("url"),
    url: z.url("url must be a valid absolute URL"),
  })
  .strict();

export const kbSourceSchema = z.discriminatedUnion("type", [
  kbSourceInlineSchema,
  kbSourceFileSchema,
  kbSourceUrlSchema,
]);

export type KbSource = z.infer<typeof kbSourceSchema>;

const kbDocumentSchema = z
  .object({
    name: nameSchema,
    source: kbSourceSchema,
  })
  .strict();

export type KbDocument = z.infer<typeof kbDocumentSchema>;

const knowledgeBaseSchema = z
  .object({
    name: nameSchema,
    documents: z
      .array(kbDocumentSchema)
      .min(1, "knowledge base must declare at least one document"),
    // manual-loops/provisioning-manifest-gaps-2.md T03, gap 2 — opaque
    // passthrough record, mirroring `agentSchema.profile`'s precedent
    // (`agent-admin-service`'s `CreateKnowledgeBaseDto.ingestion_config` is
    // itself `@IsObject()` with no typed sub-fields, so there is nothing to
    // model structurally here). Field name kept snake_case verbatim
    // (matching `mcpServerSchema.transport_type`'s precedent of mirroring
    // the target platform field name exactly) since this whole object is
    // passed through to `POST/PATCH /admin/knowledge-bases` unchanged except
    // for manifest-time `provider_connector_id` substitution (see
    // `substitution-allowlist.ts`). May embed `{ connectorRef: <name> }` at
    // `provider_connector_id` — resolved to the real connector-admin id by
    // `substitute-kb-ingestion-config.ts` before the KB reconciler CREATES a
    // new (non-external) knowledge base; an ALREADY-EXISTING KB's
    // `ingestion_config` is not reconciled (see
    // `reconcile-knowledge-base.ts`'s pre-existing "no mutable KB fields to
    // reconcile in T06" limitation, unchanged by this task).
    ingestion_config: z.record(z.string(), z.unknown()).optional(),
    external: z.boolean().optional(),
  })
  .strict();

export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;

// ---------------------------------------------------------------------------
// Channels — at least one with direction "inbound" is required manifest-wide.
// ---------------------------------------------------------------------------

const channelDirectionSchema = z.enum(["inbound", "outbound"]);

const channelSchema = z
  .object({
    name: nameSchema,
    type: z.string().min(1, "channel type must not be empty"),
    direction: channelDirectionSchema,
    config: z.record(z.string(), z.unknown()).optional(),
    secretRef: secretRefSchema.optional(),
    external: z.boolean().optional(),
  })
  .strict();

// Named `ManifestChannel` (not `Channel`) to avoid colliding with the
// existing top-level `Channel` provider-kind type in channel.interfaces.ts.
export type ManifestChannel = z.infer<typeof channelSchema>;
export type ChannelDirection = z.infer<typeof channelDirectionSchema>;

// ---------------------------------------------------------------------------
// Connectors — credential wiring (manual-loops/provisioning-manifest-gaps.md
// T01, decision 3 ruling 2026-07-16): secretRef-ONLY, with NESTED-FIELD
// TARGETING. There is no literal inline `authConfig` field — a plaintext
// credential in the manifest is impossible by schema. Instead a connector
// declares an `auth` block: `authType` plus, per authType, the exact
// connector-admin `authConfig` field(s) each `secretRef` targets (mirrors
// `channelSchema.secretRef`, extended because different authTypes need
// different — and for `basic`, multiple — authConfig keys). Values are
// resolved through the secrets broker only, never persisted to the manifest.
// ---------------------------------------------------------------------------

const connectorSecretFieldSchema = z
  .object({
    secretRef: secretRefSchema,
  })
  .strict();

export type ConnectorSecretField = z.infer<typeof connectorSecretFieldSchema>;

const connectorBearerAuthSchema = z
  .object({
    authType: z.literal("bearer"),
    bearerToken: connectorSecretFieldSchema,
  })
  .strict();

const connectorApiKeyAuthSchema = z
  .object({
    authType: z.literal("api-key"),
    apiKey: connectorSecretFieldSchema,
    // Non-secret: the HEADER NAME the resolved key is sent under, never a value.
    apiKeyHeader: z.string().min(1).optional(),
  })
  .strict();

const connectorBasicAuthSchema = z
  .object({
    authType: z.literal("basic"),
    basicUsername: connectorSecretFieldSchema,
    basicPassword: connectorSecretFieldSchema,
  })
  .strict();

export const connectorAuthSchema = z.discriminatedUnion("authType", [
  connectorBearerAuthSchema,
  connectorApiKeyAuthSchema,
  connectorBasicAuthSchema,
]);

export type ConnectorAuth = z.infer<typeof connectorAuthSchema>;
export type ConnectorAuthType = ConnectorAuth["authType"];

// ---------------------------------------------------------------------------
// Connector endpoints (manual-loops/provisioning-manifest-gaps.md T02, gap 2)
// — mirrors `sdk/src/resources/connectors/types.ts` `CreateConnectorEndpointInput`
// (itself `CreateEndpointDto` in connector-admin: `label`/`method`/`path`/
// `cache`). Endpoint uniqueness downstream is `(method, path)` per connector,
// not a manifest-declared id — the writer matches on that pair to decide
// add-vs-update (T02). No secrets: endpoints carry only routing metadata.
// ---------------------------------------------------------------------------

// manual-loops/provisioning-manifest-gaps-2.md T06, gap 2 — derived from
// `AdapterCacheMethod` (`adapter.interfaces.ts`) instead of a parallel string
// literal so the two never drift.
const connectorEndpointCacheMethodSchema = z.enum(
  Object.values(AdapterCacheMethod) as [string, ...string[]]
);

const connectorEndpointCacheSchema = z
  .object({
    enabled: z.boolean(),
    ttlSeconds: z.number().int().min(1),
    methods: z.array(connectorEndpointCacheMethodSchema).optional(),
    keyHeaders: z.array(z.string()).optional(),
    keyQueryParams: z.union([z.array(z.string()), z.literal("all")]).optional(),
    keyBody: z.boolean().optional(),
  })
  .strict();

export type ConnectorEndpointCache = z.infer<
  typeof connectorEndpointCacheSchema
>;

const connectorEndpointHttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const connectorEndpointSchema = z
  .object({
    label: z.string().min(1, "endpoint label must not be empty"),
    method: connectorEndpointHttpMethodSchema,
    path: z.string().min(1, "endpoint path must not be empty"),
    cache: connectorEndpointCacheSchema.optional(),
  })
  .strict();

export type ConnectorEndpointManifest = z.infer<typeof connectorEndpointSchema>;

// manual-loops/provisioning-manifest-gaps-2.md T07 batch B — connector `tags`
// fidelity fix (migration-exposed, SAME class as the parent T02 endpoints
// addition, NOT a new gap kind). connector-admin's `CreateAdapterDto`/
// `UpdateAdapterDto` both accept `tags?: string[]` (stored as the `n` column,
// surfaced verbatim as `tags` by `mapAdapter`); agent-admin's credential
// resolver REQUIRES the referenced LLM adapter to carry the `llm` tag, so an
// LLM connector created without it makes every agent referencing it fail
// (`Adapter '<id>' is not tagged as 'llm'`). The deleted AI-sample setup.ts
// scripts all sent `tags: ["llm"]` on their LLM connectors — this field lets a
// migrated manifest express that same tag. Optional/additive: an omitted
// `tags` leaves live state untouched (create-or-update, no prune). Non-secret
// routing metadata only — never credential-bearing.
const connectorSchema = z
  .object({
    name: nameSchema,
    type: z.string().min(1, "connector type must not be empty"),
    config: z.record(z.string(), z.unknown()).optional(),
    auth: connectorAuthSchema.optional(),
    endpoints: z.array(connectorEndpointSchema).optional(),
    tags: z.array(z.string()).optional(),
    external: z.boolean().optional(),
  })
  .strict();

export type Connector = z.infer<typeof connectorSchema>;

// ---------------------------------------------------------------------------
// MCP servers (manual-loops/provisioning-manifest-gaps.md T06, gap 6) —
// mirrors `sdk/src/resources/mcp-servers/types.ts` `CreateMcpServerInput`
// (`name`/`description`/`transport_type`/`url`/`headers`/`authType`/
// `authConfig`/`enabled`/`scope`), backed by agent-admin-service's
// `admin/mcp-servers` route.
//
// AUTH (per the SPEC's own T06 note: "follows whatever decision-3 ruling T01
// established for connector auth, for consistency"): the raw SDK/live shape
// (`authType` + free-form `authConfig: Record<string, unknown>`) would let a
// literal credential live in the checked-in manifest — the exact hole
// decision 3 closed for connectors. So, exactly like `connectorAuthSchema`,
// this manifest schema replaces that pair with a discriminated `auth` block:
// `authType` plus, per type, the exact `authConfig` field(s) each `secretRef`
// targets (field NAMES verified against the SDK's own doc comment:
// `{ headerName?, key }` for `api-key`, `{ token }` for `bearer`,
// `{ username, password }` for `basic` — deliberately DIFFERENT field names
// than `connectorAuthSchema`'s `bearerToken`/`apiKey`/`basicUsername`/
// `basicPassword`, because they map into a different downstream `authConfig`
// shape). Omitting `auth` entirely means `authType: "none"` (the platform's
// own create-time default) — mirrors `connectorSchema.auth` exactly, no
// separate "none" variant needed.
//
// HEADERS: `CreateMcpServerInput.headers` is a free-form
// `Record<string, string>` the live MCP client sends verbatim on every
// upstream call — this is EXACTLY the kind of custom-auth escape hatch (e.g.
// a non-standard `X-Api-Key`/`X-Telegram-Bot-Api-Secret-Token` style header)
// that a structured `authType` enum cannot cover, so a header VALUE can
// legitimately be a credential. To preserve the "no plaintext credential
// value in the manifest" invariant (decision 3) for this escape hatch too,
// each header value is EITHER a plain non-secret string OR the SAME nested
// `{ secretRef }` targeting `auth` uses — never a literal secret string
// disguised as a header. The writer resolves any `{ secretRef }` header
// value through the broker at apply time, exactly like `auth` fields; a
// header whose value the author believes is a real credential MUST use the
// `{ secretRef }` form (impossible to enforce by schema alone which literal
// strings "are" secrets, but the escape hatch to do it safely always
// exists — the plain-string branch is for genuinely non-secret metadata
// headers only, e.g. `X-Request-Source`).
// ---------------------------------------------------------------------------

const mcpServerTransportTypeSchema = z.enum(["http", "sse"]);

export type McpServerTransportType = z.infer<
  typeof mcpServerTransportTypeSchema
>;

const mcpServerBearerAuthSchema = z
  .object({
    authType: z.literal("bearer"),
    token: connectorSecretFieldSchema,
  })
  .strict();

const mcpServerApiKeyAuthSchema = z
  .object({
    authType: z.literal("api-key"),
    key: connectorSecretFieldSchema,
    // Non-secret: the HEADER NAME the resolved key is sent under, never a value.
    headerName: z.string().min(1).optional(),
  })
  .strict();

const mcpServerBasicAuthSchema = z
  .object({
    authType: z.literal("basic"),
    username: connectorSecretFieldSchema,
    password: connectorSecretFieldSchema,
  })
  .strict();

export const mcpServerAuthSchema = z.discriminatedUnion("authType", [
  mcpServerBearerAuthSchema,
  mcpServerApiKeyAuthSchema,
  mcpServerBasicAuthSchema,
]);

export type McpServerAuth = z.infer<typeof mcpServerAuthSchema>;
export type McpServerAuthType = McpServerAuth["authType"];

const mcpServerHeaderValueSchema = z.union([
  z.string().min(1, "header value must not be empty"),
  connectorSecretFieldSchema,
]);

export type McpServerHeaderValue = z.infer<typeof mcpServerHeaderValueSchema>;

const mcpServerSchema = z
  .object({
    name: nameSchema,
    description: z.string().min(1).optional(),
    transport_type: mcpServerTransportTypeSchema,
    url: z.url("url must be a valid absolute URL"),
    headers: z.record(z.string(), mcpServerHeaderValueSchema).optional(),
    auth: mcpServerAuthSchema.optional(),
    enabled: z.boolean().optional(),
    scope: z.enum(["external", "internal"]).optional(),
    external: z.boolean().optional(),
  })
  .strict();

export type ManifestMcpServer = z.infer<typeof mcpServerSchema>;

// ---------------------------------------------------------------------------
// Skills — a standalone, reusable CATALOG resource (T01,
// manual-loops/provisioning-manifest-gaps-3.md, workstream a). Mirrors
// `services/agent-admin-service/src/modules/skills/skills.dto.ts`
// `CreateSkillDto`/`UpdateSkillDto`/`SkillFileDto` field-for-field (decision
// 4). Placed BEFORE `agentSchema`: an agent's `profile.model_config.subagents[]`
// entry references a skill by id via `catalog_skill_id` (a `skillRef`
// symbolic ref, T02), so skills must resolve/create first — same reasoning
// as the mcpServer-before-agent ordering above.
//
// NO field here is credential-capable — verified against every field in
// `CreateSkillDto`/`UpdateSkillDto` (no auth/token/key/secret field anywhere)
// — so `skillSchema` carries no `secretRef` field of its own.
// ---------------------------------------------------------------------------

const skillFileTypeSchema = z.enum(["script", "reference", "asset"]);

export type SkillFileType = z.infer<typeof skillFileTypeSchema>;

// `SkillFileDto` — the "content" field is a plain inline string source only;
// a file/url source variant (like `kbSourceSchema`'s discriminated union) is
// explicitly out of scope for this task (see SPEC "Out of scope").
const skillFileSchema = z
  .object({
    name: z.string().min(1, "skill file name must not be empty"),
    path: z.string().min(1, "skill file path must not be empty"),
    type: skillFileTypeSchema,
    content: z.string(),
  })
  .strict();

export type SkillFile = z.infer<typeof skillFileSchema>;

const skillModeSchema = z.enum(["router", "llm_driven", "inline"]);

export type SkillMode = z.infer<typeof skillModeSchema>;

const skillSchema = z
  .object({
    name: nameSchema,
    description: z.string().min(1).optional(),
    system_prompt: z.string().min(1, "system_prompt must not be empty"),
    icon: z.string().min(1).optional(),
    color: z.string().min(1).optional(),
    trigger_commands: z.array(z.string()).optional(),
    when_to_use: z.string().min(1).optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    allowed_tools: z.array(z.string()).optional(),
    mode: skillModeSchema.optional(),
    files: z.array(skillFileSchema).optional(),
    // Mirrors the existing section shape (name + payload fields + external
    // flag) every other full `ResourceKind` section carries.
    external: z.boolean().optional(),
  })
  .strict();

export type ManifestSkill = z.infer<typeof skillSchema>;

// ---------------------------------------------------------------------------
// Agents — a "process" for the >=1-process structural rule.
// ---------------------------------------------------------------------------

const agentSchema = z
  .object({
    name: nameSchema,
    profile: z.record(z.string(), z.unknown()),
    knowledgeBaseRefs: z.array(nameSchema).optional(),
    // manual-loops/provisioning-manifest-gaps.md T06, gap 6 — the MCP
    // servers this agent has enabled, referenced by manifest NAME.
    //
    // DELIBERATELY NOT run through the generic symbolic-ref id-substitution
    // mechanism (`substitution-allowlist.ts`/`substitute-symbolic-refs.ts`)
    // the way `serverId` inside a workflow `mcpCall` action is: agent-admin
    // and agent-ai-service's own `enabled_mcp_servers`/`ns` field is keyed by
    // MCP server NAME, not id (`agent-ai-service`'s `tool-bridge.service.ts`
    // filters `McpClientService.getConnectedServers()`, which only ever
    // returns names — see the regression test
    // `services/agent-ai-service/test/unit/tool-bridge.service.spec.ts`
    // "drops all MCP tools when the allowlist contains the server's id
    // instead of its name", fixing a real admin-console bug that saved this
    // field by id). Substituting these refs to a real externalId would
    // silently reintroduce that exact bug. So `enabledMcpServerRefs` stays a
    // plain array of manifest NAMES (validated to resolve against
    // `spec.mcpServers[].name` by `validate-structural-rules.ts`, exactly
    // like `knowledgeBaseRefs`), and `agents-writer.ts` passes those names
    // straight through to `PATCH /admin/agents/:id/mcp-servers` — no id
    // lookup, ever, for this one field.
    enabledMcpServerRefs: z.array(mcpServerRefSchema).optional(),
    // manual-loops/provisioning-manifest-gaps-2.md T04, gap 4 — per-tool MCP
    // allowlist, mirroring `mcp-connections/src/setup.ts:352-374`'s
    // `client.agents.updateEnabledMcpTools` payload shape exactly:
    // `Record<mcpServerName, string[] | null>`, `null` meaning "all tools
    // enabled" for that server. Per decision 6 (mirrors T06's
    // `enabledMcpServerRefs` precedent above): the outer key is the MCP
    // server manifest NAME, never substituted to an id — same reasoning as
    // `enabledMcpServerRefs`'s header comment (agent-ai-service's
    // `tool-bridge.service.ts` filters by name, not id). The inner tool-name
    // strings are NOT `nameSchema`-constrained: they come from the MCP
    // server's own tool list, an external namespace this manifest does not
    // own. Validated structurally against `spec.mcpServers[].name` (+
    // external mcpServers) by `validate-structural-rules.ts`'s
    // `checkRefResolution`, exactly like `enabledMcpServerRefs`.
    enabledMcpTools: z
      .record(z.string(), z.union([z.array(z.string()), z.null()]))
      .optional(),
    // manual-loops/provisioning-manifest-gaps-2.md T04, gap 4 — per-tool
    // description overrides, mirroring
    // `client.agents.updateToolDescriptionOverrides`'s payload shape exactly:
    // `Record<string, string>`. Two legal key shapes, per the live DTO
    // (`agent-admin-service`'s `UpdateToolDescriptionOverridesDto`):
    //   - `"<serverName>__<toolName>"` for an MCP tool (agent-mcp-tool-naming.md
    //     T01, Option B — was `"<serverName>:<toolName>"` before T01; the
    //     legacy colon form is no longer accepted — see the SPEC's Progress
    //     log, zero-row measured migration surface) — the `<serverName>`
    //     prefix (up to the FIRST separator) is validated
    //     against `spec.mcpServers[].name` (+ external), same as
    //     `enabledMcpTools`' outer keys, never substituted to an id
    //     (decision 6).
    //   - a plain key with no separator, for an adapter/builtin tool — NOT
    //     validated against `mcpServers` (it names a tool the agent runtime
    //     itself exposes, not an MCP server), left as free-form per the live
    //     DTO's own lack of a separator requirement.
    toolDescriptionOverrides: z.record(z.string(), z.string()).optional(),
    external: z.boolean().optional(),
  })
  .strict();

export type Agent = z.infer<typeof agentSchema>;

// ---------------------------------------------------------------------------
// Hosted services — REFERENCES only (image or buildRef), never inline code.
// ---------------------------------------------------------------------------

// manual-loops/provisioning-manifest-gaps-2.md T05, gap 5 (2026-07-16) —
// ROUND 1.
// BEFORE that task, `ServiceEnvVar` was `{ name, secretRef? }` — an env var
// could ONLY ever be a secret binding (never a plain value), and
// `registry-services-writer.ts`'s `checkEnvSupport()` rejected ANY non-empty
// `env` outright. Nothing shipped ever used that shape (the three shipped
// manifests declare no `env`; `hosted-services-api`'s `YOIZEN_SAMPLE` marker
// was inexpressible under it, the exact gap that task closed).
//
// T05's FIRST ATTEMPT widened `value` to `string | { secretRef }`, resolving
// the `secretRef` branch to PLAINTEXT inside `provisioning-service` and
// shipping it in `registry-services-writer.ts`'s `envVars` request body — a
// reviewer proved this bakes the literal secret into the Knative spec
// (etcd-persisted, `kubectl get ksvc -o yaml` visible), contradicting
// `declarative-provisioning.md` decision 7 verbatim: "Hosted services
// receive their bound secrets k8s-natively (env from the Secret in their
// Knative spec) — user code sees plain env vars"
// (`manual-loops/declarative-provisioning.md:51-52`, a FOUNDING decision).
// HUMAN RULING (2026-07-16, `provisioning-manifest-gaps-2.md:650-658`):
// PLAIN STRINGS ONLY — `value: z.string()`, the `secretRef` branch REMOVED —
// with an explicit recorded FOLLOW-UP
// (`provisioning-manifest-gaps-2.md:662-664`): "k8s-native secretKeyRef env
// design — needs its own decision round (provisioning ensures the k8s
// Secret; registry/knative-builder emits valueFrom.secretKeyRef; touches
// registry-service)."
//
// `manual-loops/provisioning-manifest-gaps-4.md` (2026-07-24) — ROUND 2, the
// decision round the FOLLOW-UP above promised. That SPEC's decision 1
// weighed Option A (plaintext resolution, mirrors connector/channel auth —
// i.e. redoing round 1's rejected attempt) against Option B (k8s-native
// `valueFrom.secretKeyRef`, matching decision 7 and the recorded
// FOLLOW-UP). HUMAN RULING (2026-07-24): Option B. `value` widens to a
// 4-shape union:
//   1. a bare string (unchanged from round 1 — a non-secret literal, e.g.
//      `YOIZEN_TENANT`).
//   2. `{ secretRef: <binding-name> }` — `provisioning-service` verifies the
//      binding EXISTS only (scope `kind: "service", owner: <service name>`);
//      the resolved VALUE never crosses `provisioning-service` as plaintext
//      — `registry-service` receives a REFERENCE and emits k8s's native
//      `valueFrom.secretKeyRef` from the SAME `psec-service-<owner>` Secret
//      every other secretRef consumer already uses
//      (`secret-resource-name.ts:29-31`), so k8s itself injects the value at
//      pod start — the mechanism decision 7 always intended. (Apply-time
//      resolution ships in gaps-4 T04; this schema widening + validate-time
//      existence check is T01.)
//   3. `{ connectorRef: <name> }` — the connector's OWN id, resolved via the
//      EXISTING apply-time `resolvedIds` map (gaps-4 T02).
//   4. `{ connectorRef: <name>, endpointMethod: <method>, endpointPath:
//      <path> }` — ONE of that connector's endpoint ids, matched by
//      `(method, path)` exactly like `connectors-writer.ts` already
//      reconciles endpoints (gaps-4 T03) — endpoints have no
//      manifest-declared `name`, so this is the only addressing scheme
//      available.
// T01 (gaps-4) widens the schema and adds validate-time name-existence
// checks for shapes 2-4 only (no live endpoint/(method,path) check at
// validate time — see `checkRefResolution`'s service block for why).
// Apply-time resolution for every ref shape ships across gaps-4 T02-T04.
const serviceEnvSecretRefValueSchema = z
  .object({
    secretRef: secretRefSchema,
  })
  .strict();

const serviceEnvConnectorRefValueSchema = z
  .object({
    connectorRef: connectorRefSchema,
  })
  .strict();

const serviceEnvConnectorEndpointRefValueSchema = z
  .object({
    connectorRef: connectorRefSchema,
    endpointMethod: connectorEndpointHttpMethodSchema,
    endpointPath: z.string().min(1, "endpointPath must not be empty"),
  })
  .strict();

const serviceEnvValueSchema = z.union([
  z.string().min(1, "env var value must not be empty"),
  serviceEnvSecretRefValueSchema,
  serviceEnvConnectorRefValueSchema,
  serviceEnvConnectorEndpointRefValueSchema,
]);

export type ServiceEnvVarValue = z.infer<typeof serviceEnvValueSchema>;

const serviceEnvVarSchema = z
  .object({
    name: z.string().min(1, "env var name must not be empty"),
    value: serviceEnvValueSchema,
  })
  .strict();

export type ServiceEnvVar = z.infer<typeof serviceEnvVarSchema>;

// ---------------------------------------------------------------------------
// Hosted service scaling fields + routes (manual-loops/provisioning-manifest-
// gaps.md T05, gap 5) — mirrors `sdk/src/resources/registry/types.ts`
// `RegisterServiceInput` (`port`/`minScale`/`maxScale`/`concurrencyTarget`)
// and `CreateRouteInput` (`pathPrefix`/`methods`/`isPublic`/`stripPrefix`).
//
// Scaling fields are ALL optional and, per decision 6, default to NOTHING
// client-side: an omitted field means the manifest sends nothing for it and
// registry-service's own server-side default wins. The manifest never
// invents/guesses that default (see `comparable-fields.ts`'s
// `serviceComparable` for how the planner honors this — a field is only ever
// compared when the manifest actually declares it).
//
// `routes` is a NEW nested array reconciled through
// `client.registry.routes` (create/list/remove only — no update verb exists
// server-side; see `registry-services-writer.ts` for the documented
// reconciliation mechanics: no-op if unchanged, remove-then-recreate if
// changed, since this is reconciliation of a sub-resource the owning
// service's manifest entry manages, not prune semantics of decision 2).
//
// DECISION 6 RULING (2026-07-16): `registry.routes` are NOT tenant-isolated
// at the live gateway proxy layer (see the SDK's own CAUTION note in
// `sdk/src/resources/registry/types.ts`) — a manifest-declared `pathPrefix`
// that collides with an existing route owned by a DIFFERENT
// service/manifest/tenant now FAILS LOUD (both at plan time, as a
// `route_collision` precondition, and again at apply time, inside the
// writer, before any route is written) instead of silently overwriting or
// shadowing another tenant's route. Same-service collisions (the manifest's
// own previously-created route) are a normal reconcile, not a collision.
// ---------------------------------------------------------------------------

export const serviceRouteMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const serviceRouteSchema = z
  .object({
    pathPrefix: z
      .string()
      .min(1, "pathPrefix must not be empty")
      .startsWith("/", "pathPrefix must start with '/'"),
    methods: z.array(serviceRouteMethodSchema).optional(),
    isPublic: z.boolean().optional(),
    stripPrefix: z.boolean().optional(),
  })
  .strict();

export type ManifestServiceRoute = z.infer<typeof serviceRouteSchema>;

const serviceSchema = z
  .object({
    name: nameSchema,
    image: z.string().min(1).optional(),
    buildRef: z.string().min(1).optional(),
    env: z.array(serviceEnvVarSchema).optional(),
    port: z.number().int().positive().optional(),
    minScale: z.number().int().min(0).optional(),
    maxScale: z.number().int().positive().optional(),
    concurrencyTarget: z.number().int().positive().optional(),
    routes: z.array(serviceRouteSchema).optional(),
    external: z.boolean().optional(),
  })
  .strict()
  .superRefine((service, ctx) => {
    const hasImage = service.image !== undefined;
    const hasBuildRef = service.buildRef !== undefined;
    if (hasImage === hasBuildRef) {
      ctx.addIssue({
        code: "custom",
        message:
          "exactly one of image or buildRef must be set — hosted services are referenced by image or build, never by inline code",
        path: ["image"],
      });
    }
  });

export type HostedService = z.infer<typeof serviceSchema>;

// ---------------------------------------------------------------------------
// System variables (manual-loops/provisioning-manifest-gaps.md T04, gap 4)
// — mirrors `sdk/src/resources/system-variables/types.ts`
// `CreateSystemVariableInput` (`name`/`type`/`value`/`label?`/`description?`)
// plus the existing section shape's `external` flag (decision 5: "mirror the
// existing section shape — name + payload fields + external flag — no
// special-casing"). This is a LEAF node: nothing refs a systemVariable and
// it refs nothing back (per SPEC's Prior-art note, `ai-system-variables`'s
// consumption is a RUNTIME resolution point in workflow-service, not a
// manifest-time one) — no symbolic-ref participation, no dependency-graph
// edges.
//
// `value` here is CONFIG (thresholds/flags), never a secret VALUE — unlike
// `secretRef`-bearing fields elsewhere in this schema, a system variable's
// `value` is a plain manifest value by design, matching
// `CreateSystemVariableInput.value`.
//
// TYPE ENUM — single source of truth: the platform-wide `VariableType`
// (`packages/shared/src/variable.interfaces.ts`), the SAME type
// agent-admin-service's own `CreateSystemVariableDto`/`UpdateSystemVariableDto`
// import. We do NOT re-declare the literal union here; instead the full enum
// is derived from `VariableType` and a compile-time `satisfies` check makes
// the build FAIL if `VariableType` ever drifts from this array (adds/removes a
// member) — so the two can never silently diverge.
//
// SECRET-TYPE REJECTION (attempt-2 reviewer ruling, both reviewers): the
// MANIFEST surface REJECTS `type: "secret"` entirely for now. A secret-typed
// system variable would carry a PLAINTEXT `value` in the checked-in
// `manifest.yaml`, and that `value` is echoed verbatim into plan output
// (`FieldDiff.current/.desired`) and downstream API responses — a direct
// violation of the SPEC's "secret VALUES never appear in ... plan output ...
// or the manifest file itself" hard rule. This mirrors decision 3's
// resolution for connector credentials (no plaintext secret values in the
// repo). The platform API / SDK keep the FULL `VariableType` enum (including
// `"secret"`) untouched — this restriction is manifest-surface-only, pending
// the human ruling recorded in the SPEC's T04 progress entry. When that
// ruling lands (e.g. secret-typed sysvars sourced via `secretRef` instead of
// an inline `value`), lift the rejection here.
// ---------------------------------------------------------------------------

// Full platform enum, kept in lock-step with `VariableType` by the compile-
// time `satisfies` check below (drift breaks the build, never silently).
const SYSTEM_VARIABLE_TYPES = [
  "string",
  "number",
  "boolean",
  "json",
  "array",
  "secret",
] as const satisfies readonly VariableType[];

// Reverse guard: every `VariableType` member must be present in the array
// above. If a new member is added to `VariableType` without being added here,
// this assignment fails to compile.
type _AssertNoMissingVariableType =
  VariableType extends (typeof SYSTEM_VARIABLE_TYPES)[number] ? true : never;
const _assertNoMissingVariableType: _AssertNoMissingVariableType = true;
void _assertNoMissingVariableType;

/** The full platform `VariableType` enum as a zod schema (all members). */
export const systemVariableTypeSchema = z.enum(SYSTEM_VARIABLE_TYPES);

export type SystemVariableType = z.infer<typeof systemVariableTypeSchema>;

// Manifest-accepted subset: the full enum MINUS "secret" (see the header's
// SECRET-TYPE REJECTION note). Derived from the same source array so it, too,
// tracks `VariableType` automatically — only the deliberate `"secret"`
// exclusion is hand-listed, with a fail-loud message.
const MANIFEST_SYSTEM_VARIABLE_TYPES = SYSTEM_VARIABLE_TYPES.filter(
  (type) => type !== "secret"
) as Exclude<(typeof SYSTEM_VARIABLE_TYPES)[number], "secret">[];

const manifestSystemVariableTypeSchema = z.enum(
  MANIFEST_SYSTEM_VARIABLE_TYPES as [
    Exclude<SystemVariableType, "secret">,
    ...Exclude<SystemVariableType, "secret">[],
  ],
  {
    message:
      'system variable type "secret" is not yet expressible in a manifest: a secret-typed variable carries a plaintext value that must never live in the repo or plan output. Store the value via the secrets flow instead (pending human ruling — see manual-loops/provisioning-manifest-gaps.md T04 progress). Allowed types: string, number, boolean, json, array.',
  }
);

const systemVariableSchema = z
  .object({
    name: nameSchema,
    type: manifestSystemVariableTypeSchema,
    value: z
      .unknown()
      .refine((value) => value !== undefined, "value must not be empty"),
    label: z.string().min(1, "label must not be empty").optional(),
    description: z.string().min(1, "description must not be empty").optional(),
    external: z.boolean().optional(),
  })
  .strict();

// Named `ManifestSystemVariable` (not `SystemVariable`) to avoid colliding
// with the SDK's own `SystemVariable` response type, mirroring the
// `ManifestChannel` naming convention above.
export type ManifestSystemVariable = z.infer<typeof systemVariableSchema>;

// ---------------------------------------------------------------------------
// Workflows — the other "process" kind. `definition` is an opaque record
// whose steps may embed channelRef/agentRef/serviceRef/secretRef/
// connectorRef keys at any depth; those are walked and resolved by the
// structural-rule validators, not by this schema. `connectorRef` (T03,
// gap 3) additionally participates in manifest-time real-ID substitution
// (see `services/provisioning-service/.../substitution-allowlist.ts`) —
// this schema only validates the ref's own shape (a plain name string),
// never the substitution semantics.
// ---------------------------------------------------------------------------

const workflowSchema = z
  .object({
    name: nameSchema,
    definition: z.record(z.string(), z.unknown()),
    external: z.boolean().optional(),
  })
  .strict();

export type Workflow = z.infer<typeof workflowSchema>;

// ---------------------------------------------------------------------------
// Secrets — bindings only: {name, scope: {kind, owner}}. Never values.
// ---------------------------------------------------------------------------

// T04 (manual-loops/provisioning-manifest-gaps.md, gap 4): "systemVariable"
// added so `ResourceKind` (provisioning-service's
// `plan/domain/plan.interfaces.ts`, deliberately the SAME union as this
// schema's `SecretScopeKind`) can carry systemVariables through the generic
// plan/apply pipeline. System variables have no secretRef wiring of their
// own (`value` is plain config, see the systemVariableSchema comment above),
// so this addition does not by itself enable secret-scope BINDINGS to a
// systemVariable owner — whether `sdk/src/cli/extract-secret-bindings.ts`'s
// separate `VALID_SCOPE_KINDS` constant also needs "systemVariable" is T07's
// explicit scope, not decided here.
// T06 (manual-loops/provisioning-manifest-gaps.md, gap 6): "mcpServer" added
// so secret bindings can be scoped to an mcpServers[] owner (this section's
// `auth`/`headers` fields both target secretRefs — see `mcpServerSchema`
// above) and so `ResourceKind` gains the member `mcp-servers-writer.ts` /
// `resource-kind-of-ref-type.ts` need. NOTE: the T06 task text asserted this
// member already existed "since T04's plumbing" — verified FALSE (T04 only
// added "systemVariable"); added here for the first time.
// T01 (manual-loops/provisioning-manifest-gaps-3.md, workstream a): "skill"
// added as PLUMBING ONLY, mirroring the "systemVariable" precedent above
// EXACTLY, so the `ResourceKind = SecretScopeKind` type alias
// (`services/provisioning-service/src/modules/plan/domain/plan.interfaces.ts`)
// keeps compiling and `skill` can flow through the generic plan/apply
// pipeline (`RESOURCE_KIND_ORDER`, `PlatformResourceWriters`). NOT to enable
// secret-scope bindings: `skillSchema` (above) has NO credential-capable
// field (verified against every field in `CreateSkillDto`/`UpdateSkillDto`),
// so a skill-scoped secret binding would be schema-valid but semantically
// INERT - no writer or resolver ever consumes one. `skill` is therefore
// DELIBERATELY EXCLUDED from both hand-kept `VALID_SCOPE_KINDS` copies
// (`sdk/src/cli/valid-scope-kinds.ts`,
// `services/provisioning-service/src/modules/secrets/secrets.controller.ts`),
// which reject it up front - the same posture already established for
// "systemVariable".
const secretScopeKindSchema = z.enum([
  "channel",
  "connector",
  "agent",
  "service",
  "systemVariable",
  "mcpServer",
  "workflow",
  "skill",
]);

const secretScopeSchema = z
  .object({
    kind: secretScopeKindSchema,
    owner: nameSchema,
  })
  .strict();

export type SecretScope = z.infer<typeof secretScopeSchema>;
export type SecretScopeKind = z.infer<typeof secretScopeKindSchema>;

const secretSchema = z
  .object({
    name: nameSchema,
    scope: secretScopeSchema,
    external: z.boolean().optional(),
  })
  .strict();

export type SecretBinding = z.infer<typeof secretSchema>;

// ---------------------------------------------------------------------------
// Manifest root
// ---------------------------------------------------------------------------

const manifestMetadataSchema = z
  .object({
    name: nameSchema,
  })
  .strict();

export type IntegrationManifestMetadata = z.infer<
  typeof manifestMetadataSchema
>;

const manifestSpecSchema = z
  .object({
    channels: z.array(channelSchema).default([]),
    connectors: z.array(connectorSchema).default([]),
    // T06, gap 6 — placed before agents: agents may reference an mcpServers[]
    // entry by name (`agentSchema.enabledMcpServerRefs`), so mcpServers must
    // resolve/create first (RESOURCE_KIND_ORDER mirrors this section order).
    mcpServers: z.array(mcpServerSchema).default([]),
    // T01 (manual-loops/provisioning-manifest-gaps-3.md, workstream a) -
    // placed before agents: an agent's `profile.model_config.subagents[]`
    // entry references a skill by id via `catalog_skill_id` (a `skillRef`
    // symbolic ref, T02), so skills must resolve/create first
    // (RESOURCE_KIND_ORDER mirrors this section order).
    skills: z.array(skillSchema).default([]),
    agents: z.array(agentSchema).default([]),
    knowledgeBases: z.array(knowledgeBaseSchema).default([]),
    services: z.array(serviceSchema).default([]),
    // T04, gap 4 — leaf node, placed before workflows (no refs in/out today).
    systemVariables: z.array(systemVariableSchema).default([]),
    workflows: z.array(workflowSchema).default([]),
    secrets: z.array(secretSchema).default([]),
  })
  .strict();

export type IntegrationManifestSpec = z.infer<typeof manifestSpecSchema>;

// `kind` (manual-loops/provisioning-manifest-gaps-2.md T01, gap 1, decision 3
// ruling 2026-07-16): a manifest-level marker, mirroring how Kubernetes'
// own `kind` field distinguishes resource shapes. Widened from the fixed
// literal `"IntegrationManifest"` to a two-member enum so a manifest can
// declare itself `kind: LibraryManifest` — a manifest that exists ONLY to
// provision shared resources (connectors/mcpServers/services/
// systemVariables) other manifests reference, never a channel/process of
// its own. Additive: every existing manifest already declares
// `kind: IntegrationManifest` explicitly, so defaulting the field when
// absent is a pure convenience, not a behavior change for them.
// `validate-structural-rules.ts` reads this field to decide whether the
// >=1-inbound-channel and >=1-process checks apply (waived for
// `LibraryManifest`, replaced there by a >=1-real-resource check).
export const manifestKindSchema = z
  .enum(["IntegrationManifest", "LibraryManifest"])
  .default("IntegrationManifest");

export type ManifestKind = z.infer<typeof manifestKindSchema>;

export const integrationManifestSchema = z
  .object({
    apiVersion: z.literal("yoizen.io/v1"),
    kind: manifestKindSchema,
    metadata: manifestMetadataSchema,
    spec: manifestSpecSchema,
  })
  .strict();

export type IntegrationManifest = z.infer<typeof integrationManifestSchema>;
