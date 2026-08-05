# provisioning-service

Class: descriptive
Summary: The declarative provisioning engine: how one manifest is planned and applied across channels, connectors, agents, knowledge bases, hosted services and workflows.

Declarative provisioning engine (`manual-loops/declarative-provisioning.md`). A tenant
describes a full integration — channels, connectors, agents, knowledge bases,
hosted-service references, workflows — in ONE manifest, then `plan`s the diff and
`apply`s to converge. This service is the server-side reconciler (SPEC.md decision 1:
a NEW service, not a client-side SDK applier); it never writes to other services'
tables directly — it calls their existing internal APIs (channels, connectors, agents,
registry, workflows).

## Manifest lifecycle: put -> plan -> apply, revisions

1. `POST /manifests/validate` — schema + structural-rule validation only, never
   persists, never mutates. Returns `{ valid: boolean, errors: [] }`. Structural rules
   (from `packages/shared/src/provisioning/`): at least one inbound channel, at least
   one process (agent or workflow), every symbolic ref (`channelRef`/`agentRef`/
   `serviceRef`/`secretRef`) resolves within the manifest or is marked `external: true`,
   no unknown keys.
2. `PUT /manifests/:name` — validates, then stores a new tenant-scoped **revision**.
   Revisions are append-only (never overwritten); `GET /manifests/:name` returns the
   latest one. Tenant isolation is enforced by `TenantGuard` on every route.
3. `POST /manifests/:name/plan` — read-only diff against live platform state. Never
   mutates anything.
4. `POST /manifests/:name/apply` — executes the latest plan in dependency order.

## Plan contract

Dependency order (`RESOURCE_KIND_ORDER`, `plan/domain/plan.interfaces.ts`) is:

```
channel -> connector -> mcpServer -> skill -> agent -> service -> systemVariable -> workflow
```

`mcpServer` sits before `agent` because an agent's `enabledMcpServerRefs` and a workflow's
`mcpCall.serverId` both reference an `mcpServers[]` entry by name. `skill` sits before `agent` for
the same reason: an agent's `profile.model_config.subagents[].catalog_skill_id` references a
`skills[]` entry by name via `skillRef`. `systemVariable` is a leaf with no refs in or out (its
consumption is a runtime resolution point in workflow-service, not manifest-time), placed anywhere
before `workflow`. This order is computed by `build-dependency-graph.ts` /
`topological-resource-order.ts`; a cycle in the ref graph (e.g. workflow -> service -> workflow) is
reported as a typed `cycle_detected` error (HTTP 409), never a hang.

Each resource in `ManifestPlan.resources` carries a **verdict**:

| Verdict | Meaning |
|---|---|
| `create` | No live counterpart found by name/externalId |
| `update` | Live counterpart found; field-level diff is non-empty (`diff: FieldDiff[]`) |
| `noop` | Live counterpart found; desired fields already match |

`ManifestPlan.preconditions` reports what would block or affect apply, WITHOUT
mutating anything:

- `missing_secret` — a `secretRef` the manifest needs has no matching k8s Secret yet
  (checked against real Secrets via `K8sSecretExistenceChecker`, T05 onward).
- `unresolvable_external_ref` — a ref marked `external: true` does not resolve against
  live platform state.
- `downstream_error` — a resource-kind client (channels/connectors/agents/registry/
  workflows) returned an error while resolving state.

`ManifestPlan.knowledgeBases` (T06 onward) reports the KB re-embed cost BEFORE it is
paid — see "KB source types" below.

Re-running `plan` on an unchanged manifest against unchanged platform state is
idempotent: every resource verdict is `noop` and every KB document action is `skip`.

## Apply contract

`apply` executes the plan's resources in the same dependency order, calling the
existing internal service APIs per resource kind (`AgentsWriter`, `ChannelsWriter`,
`ConnectorsWriter`, `RegistryServicesWriter`, `WorkflowsWriter` — never a direct table
write). Semantics:

- **Create-or-update only** — there is **no prune/delete semantics in v1** (SPEC.md
  user decision 8). A resource removed from the manifest is left untouched on the
  platform; destructive reconciliation needs its own design round and is explicitly
  out of scope for this service today.
- **Partial-failure / resume**: apply stops at the FIRST resource-write error and
  reports `applied`/`pending` resources in the typed error body (HTTP 409,
  `error.details.body.error`). Re-applying the same manifest resumes correctly because
  already-applied resources verdict as `noop` on the next plan pass (idempotent by
  name/externalId).
- **KB bundle transport**: `POST /manifests/:name/apply` accepts an OPTIONAL
  `{ bundle: { contentBase64: string } }` JSON body field. The bundle bytes are a tar
  archive, **base64-encoded inside the JSON request body** — this is a **human decision
  (2026-07-15)**, a deliberate deviation from "true `multipart/form-data`": this
  service's dependency tree (and the workspace lockfile) has no multipart parser
  (`@fastify/multipart` or equivalent), and a base64-in-JSON body is functionally
  equivalent for the content-addressed extraction/storage semantics KB `file:` sources
  need. Wiring true multipart is a follow-up once that dependency is vendored (see
  "Known follow-ups" below). Bundle extraction enforces a per-entry byte cap
  (`KB_FILE_SOURCE_MAX_BYTES`, 10 MiB) and a total-bundle byte cap
  (`MAX_BUNDLE_TOTAL_BYTES`, 10x that), and rejects absolute paths and any
  `../`-style path-traversal entry (`extract-tar-bundle.ts`).
- **Audit events**: every apply run emits `apply_started` (run root), one
  `resource_applied` per resource action, and a terminal `apply_completed` or
  `apply_failed` — see "Audit events" below.

## Secrets model

**One k8s Secret per resource** (SPEC.md decision 4) — never a per-tenant bag. Name:
`psec-<kind>-<owner>` (`secret-resource-name.ts`), created in `<tenant>-<env>-ns`, with
labels `{tenant, kind, owner}` under the `provisioning.yoizen.io/` prefix
(`secret-labels.ts`). Multiple named secrets bound to the SAME resource (e.g. a
connector needing both `apiKey` and `apiSecret`) live as separate KEYS inside that one
Secret object's `data` map, not as separate Secret objects.

### Write-only Secret API

- `PUT /secrets/:name` — body `{ value, scope: { kind, owner } }`. Creates or updates
  the resource's Secret. Echoes back **only** `{ name, scope }` — never the value
  (write-only guarantee, enforced structurally: no code path in this controller or
  service ever returns the stored value).
- `GET /secrets` — lists `{ name, scope }` entries only, never values.

### Secrets broker (internal-only)

`POST /internal/secrets/resolve` is reachable only inside the cluster network — **it is
never exposed through the api-gateway** (T07 has a unit test asserting the route is
absent from the gateway's route table). A caller presents:

```
{ consumerService, secretName, actingResource: { kind, owner }, correlationId }
```

The broker (`SecretsBrokerService`) enforces two layers before reading the k8s Secret:

1. **Consumer-identity authorization** (`secret-consumer-policy.ts`) — a static map of
   which platform service identities may act for which resource kind. The apply
   engine's fixed identity (`provisioning-service-apply-engine`) may act for every
   kind (it is the reconciler that creates all of them); runtime consumers are scoped
   to the kind they legitimately consume (`channel-service` -> channel secrets,
   `connector-runtime` -> connector secrets, `agent-ai-service` -> agent secrets,
   `workflow-service` -> workflow secrets). `service` (hosted-service) secrets are
   delivered k8s-natively (decision 7 below) — only the apply engine touches them
   through the broker.
2. **Scope-binding match** — the `(kind, owner)` the caller claims to act for must
   match the Secret's own binding; a mismatch is denied even for an otherwise
   authorized consumer identity.

A successful resolve returns the value **ephemerally** — the response body is its only
hop, never logged and never persisted by the broker. A denied resolve (wrong consumer,
wrong kind, or wrong owner) is denied AND audited (`secret_access_denied`).

Per-resource isolation is application-layer (this policy + binding match), not RBAC —
**k8s RBAC cannot filter by Secret name or label**, so the granted ClusterRole
(`provisioning-service-secrets-manager`, see "RBAC" below) is intentionally broad at
the k8s layer, consistent with the platform's no-NATS-ACLs stance (SPEC.md decision 5).

### Hosted services receive secrets k8s-natively (decision 7)

Hosted services (`kind: "service"`) do not call the broker at runtime — their bound
secrets are wired as `env` sourced from the k8s Secret directly in their Knative spec.
User code inside the hosted service sees plain environment variables; only the apply
engine ever writes/reads `service`-kind secrets through the broker (during apply, to
materialize the Knative spec).

## `kind: LibraryManifest`

`kind` (`manifestKindSchema`, `packages/shared/src/provisioning/manifest.schema.ts`) is a
two-member enum, defaulting to `IntegrationManifest`. A `LibraryManifest` provisions ONLY shared
library resources — connectors, mcpServers, hosted services, or system variables — never a channel
or process of its own. `validate-structural-rules.ts`'s `checkAtLeastOneLibraryResource` waives the
`IntegrationManifest`'s ">=1 inbound channel" AND ">=1 process" checks for it, requiring instead
">=1 of connector/mcpServer/service/systemVariable". Used by 5 shipped samples: `http-connectors`,
`mcp-connections`, `ai-agent-playground`, `ai-knowledge-base-agent`, `ai-skill-support-agent` — see
`integrations/README.md`.

## Connectors: tags, endpoints, auth

`connectorSchema` (`manifest.schema.ts`) carries, beyond `name`/`type`/`config`/`external`:

- **`tags`** — `string[]`, non-secret routing metadata. `agent-ai-service`'s credential resolver
  requires an LLM connector to carry the `llm` tag; a connector created without it makes every
  agent referencing it fail (`Adapter '<id>' is not tagged as 'llm'`).
- **`endpoints`** — `ConnectorEndpointManifest[]` (`label`/`method`/`path`/`cache?`). Uniqueness
  downstream is `(method, path)` per connector, not a manifest-declared id — the writer matches on
  that pair to decide add-vs-update. `cache` mirrors connector-admin's per-endpoint cache shape
  (`enabled`/`ttlSeconds`/`methods`/`keyHeaders`/`keyQueryParams`/`keyBody`); there is no
  connector-level `defaultCache` field (see `integrations/http/http-connectors/manifest.yaml`'s own
  comment for the documented gap this creates for connectors with per-endpoint-varying methods).
- **`auth`** — a discriminated union (`bearer`/`api-key`/`basic`), each field a nested
  `{ secretRef }` — never a literal credential in the manifest (SPEC decision 3).

## Agents: MCP + skills fields

`agentSchema` carries, beyond `name`/`profile`/`knowledgeBaseRefs`/`external`:

- **`enabledMcpServerRefs`** — `string[]` of `mcpServers[]` manifest NAMES (NOT run through
  symbolic-ref id substitution — agent-ai-service's `enabled_mcp_servers`/`ns` field is keyed by MCP
  server NAME, not id; substituting to an id would reintroduce a real fixed bug, see
  `tool-bridge.service.spec.ts`).
- **`enabledMcpTools`** — `Record<mcpServerName, string[] | null>`, `null` meaning "all tools
  enabled" for that server. Outer key is the MCP server manifest NAME, never substituted.
- **`toolDescriptionOverrides`** — `Record<string, string>`; keys are either `"<serverName>:
  <toolName>"` (validated against `mcpServers[].name`) or a plain key with no colon (an
  adapter/builtin tool, unvalidated).
- **`profile.model_config.subagents[].catalog_skill_id`** — a manifest-time `skillRef` symbolic ref
  (allowlisted, see below), resolved to the real skill id inside the pre-existing agent `profile`
  tree walk.

## Knowledge bases: `ingestion_config` refs

`knowledgeBaseSchema.ingestion_config` is an open `Record<string, unknown>` mirroring
`CreateKnowledgeBaseDto.ingestion_config`. Its `provider_connector_id` field accepts a
`{ connectorRef }` symbolic ref (allowlisted, see below), resolved by
`modules/kb/lib/substitute-kb-ingestion-config.ts` — a NEW tree root (not the pre-existing
workflow/agent-profile walk) — right before the KB reconciler creates a new (non-external)
knowledge base. `ingestion_config` itself is NOT re-reconciled after creation (no mutable KB fields
to reconcile today).

## System variables

`systemVariableSchema` mirrors `CreateSystemVariableInput` (`name`/`type`/`value`/`label?`/
`description?`) plus the section's usual `external` flag. It is a LEAF resource kind: nothing
references a systemVariable and it references nothing back — `ai-system-variables`' runtime
consumption (`{{variables.system.<name>}}`) is a workflow-service RUNTIME resolution point, not a
manifest-time one. `type: "secret"` is REJECTED at the manifest surface (a secret-typed variable
would carry a plaintext `value` echoed into plan output and the checked-in manifest file) — allowed
types are `string`/`number`/`boolean`/`json`/`array`. The platform API/SDK keep the full
`VariableType` enum (including `secret`) untouched; this restriction is manifest-surface-only.

## Skills

`skillSchema` is a standalone, reusable CATALOG resource mirroring
`CreateSkillDto`/`UpdateSkillDto`/`SkillFileDto` field-for-field (`name`/`system_prompt`/
`trigger_commands?`/`when_to_use?`/`priority?`/`mode?`/`files?`/...). No field is credential-capable
— verified against every field in the live DTOs — so `skillSchema` carries no `secretRef` field of
its own, and a skill-scoped secret binding is schema-valid but semantically INERT (see "Secret
scope kinds" below). Skills are referenced from `agents[].profile.model_config.subagents[].
catalog_skill_id` via a `skillRef`.

## Symbolic-ref substitution: scalar + array allowlists

Manifest-time ID substitution walks ONLY the argument keys listed in two hand-kept allowlists —
never a structural walk that substitutes every key literally named `*Ref` wherever it appears (that
would risk substituting an unrelated same-named field).

**Scalar** (`modules/plan/lib/substitution-allowlist.ts`, `SUBSTITUTION_ALLOWLIST` — one ref-object
value per key):

| Arg key | Ref type | Source |
|---|---|---|
| `accountId` | `channelRef` | `ChannelSendArgs.accountId` |
| `adapterId` | `connectorRef` | `EndpointCallArgs.adapterId` |
| `agentId` | `agentRef` | `AgentCallArgs.agentId` |
| `serviceId` | `serviceRef` | `ServiceCallArgs.serviceId` |
| `serverId` | `mcpServerRef` | `McpCallArgs.serverId` |
| `connectorId` | `connectorRef` | agent `profile.model_config.llm.connectorId` |
| `provider_connector_id` | `connectorRef` | KB `ingestion_config.provider_connector_id` |
| `catalog_skill_id` | `skillRef` | agent `profile.model_config.subagents[].catalog_skill_id` |

**Array** (`modules/plan/lib/array-substitution-allowlist.ts`, `ARRAY_SUBSTITUTION_ALLOWLIST` —
an ARRAY of single-key ref-objects, substituted element-wise):

| Arg key | Ref type | Source |
|---|---|---|
| `accountIds` | `channelRef` | workflow trigger `config.accountIds` — the plural sibling of `accountId`; every migrated manifest pins its trigger to its own manifest-created channel this way |

`accountIds` is the ONLY known plural ref-bearing key today; a separate map (not a scalar-or-array
flag on the scalar entry shape) keeps the eight scalar entries' consuming code unchanged. (The
in-file comment in `array-substitution-allowlist.ts` still says "seven" — it predates the
`catalog_skill_id` entry; the list above is the current one.)

## Secret scope kinds exclude `systemVariable` and `skill` (inert)

The manifest schema's `secretScopeKindSchema` includes `systemVariable` and `skill` for PLUMBING
ONLY (so `ResourceKind`/`RESOURCE_KIND_ORDER` compile and flow through the generic plan/apply
pipeline) — neither has a credential-capable field, so a secret binding scoped to either would be
schema-valid but semantically INERT (no writer or resolver ever consumes one). Both are therefore
DELIBERATELY EXCLUDED from the two hand-kept `VALID_SCOPE_KINDS` rejection lists
(`sdk/src/cli/valid-scope-kinds.ts`, this service's `secrets.controller.ts`), which reject them up
front at the secrets-write API surface.

## Known limitations

- **Workflow comparability is existence-only.** `plan`'s verdict for an EXISTING workflow never
  inspects `definition`/`trigger` for changes — only whether a workflow with that name exists.
  Changing a workflow's `definition` or `trigger` in the manifest and re-applying is therefore a
  no-op against an already-created workflow. Remedy: delete the live workflow and re-apply (create
  path), or edit it directly via the admin API.
- **Connector endpoint cache changes are no-op after creation.** Only the endpoint's own existence
  (by `(method, path)`) is reconciled; changing an existing endpoint's `cache` block and re-applying
  does not update the live endpoint.
- **Secret-typed `systemVariable`s are rejected** at the manifest surface (see "System variables"
  above) — no plaintext-value system variable can ever be checked into a `manifest.yaml`.
- **Hosted-service `env` is plain-strings-only.** `serviceEnvVarSchema.value` is a required
  `z.string()` — a `{ secretRef }` value form is deliberately NOT offered, because resolving it to
  plaintext inside provisioning-service and shipping it in the registry `envVars` payload would bake
  the literal secret into the Knative spec (etcd-persisted, kubectl-visible), contradicting decision
  7's k8s-native secrets delivery. Secret-valued env vars for hosted services await a future
  `valueFrom.secretKeyRef`-shaped design.

## KB source types + checksum semantics

Discriminated union (`@yoizen/shared`'s `KbSource`): `inline` | `file` | `url`.

- **`inline`** — content lives in the manifest itself, size-capped
  (`KB_INLINE_CONTENT_MAX_BYTES`, validator-enforced at the schema layer).
- **`file`** — content ships as a file inside the apply-time tar bundle (see "KB bundle
  transport" above), referenced by `path` + a manifest-declared `sha256`.
  `resolveInlineOrFileSource` re-hashes the bundle's actual bytes and REJECTS the
  document if the computed sha256 doesn't match the manifest's declared checksum
  (`file_checksum_mismatch`), on top of a per-file 10 MiB cap
  (`KB_FILE_SOURCE_MAX_BYTES`).
- **`url`** — a server-side fetch, guarded by `validateOutboundUrl` (`@yoizen/shared`,
  reused from `connector-runtime`) BEFORE any network call is attempted. Capped at 10
  MiB (`KB_URL_SOURCE_MAX_BYTES`), 15s timeout.

**Checksum-driven re-embedding** (`decide-document-action.ts`): every KB document's
content is hashed (sha256). Compared against the last-stored checksum
(`kb-checksum.postgres.repository.ts`):

| Stored vs. current sha256 | Action |
|---|---|
| No stored checksum | `create` |
| Unchanged | `skip` — never re-embedded |
| Changed | `reembed` — only that document is re-indexed |

`plan` reports this cost BEFORE it is paid: `KbPlanEntry.summary` (e.g. "knowledge base
'kb-name': will re-embed 2 documents (~14 chunks)") and `reembedCount`/
`chunkEstimateTotal`. For `url:` sources specifically, the checksum is unknown until
apply performs the guarded fetch, so `plan` conservatively reports a `pending_fetch`
action (counted toward the re-embed estimate) rather than under-reporting cost.

## No prune in v1

**There is no delete/prune semantics anywhere in this service (SPEC.md user decision
8).** A resource removed from a manifest, or a KB document no longer referenced, is
left as-is on the platform. Destructive reconciliation (detecting and removing
resources no longer in the manifest) needs its own design round with explicit human
sign-off — it is not a gap to silently close, it is an intentional v1 boundary. This
also applies to secrets: the granted RBAC ClusterRole has no `delete` verb on Secrets.

## Audit events

Every apply run and every secrets operation emits best-effort, fire-and-forget
JetStream events on the tenant's `INGRESS-<tenant>` stream (never a dedicated stream —
same per-tenant subject family as every other producer). A publish failure is logged
and swallowed; it never fails the apply/secrets operation itself. See
`DOCS/messaging/service-bus.md` for the full subject family and causal-chain shape.
Secret VALUES never appear in any of these payloads — only name/kind/owner/
consumer/correlation metadata.

## RBAC / ServiceAccount requirements

- `provisioning-service` ServiceAccount (`knative/services/base/provisioning-service-sa.yaml`).
- `provisioning-service-secrets-manager` ClusterRole
  (`knative/services/rbac/cluster-role.yaml`): `create`/`get`/`list`/`update`/`patch`
  on `secrets` (no `delete` — "no prune" extends to secrets too), cluster-scoped
  because the service must reach EVERY tenant namespace (`<tenant>-<env>-ns`), the same
  shape `registry-service` already uses for cross-namespace Knative service management.
- `provisioning-service-secrets-manager-dev` ClusterRoleBinding
  (`knative/services/rbac/cluster-role-bindings.yaml`), developer-mode single-config
  (dev-only, `platform-services-dev` namespace). **A human must apply this binding the
  first time** — it is an explicit human boundary in the SPEC (a service that can read
  every tenant's secrets is not something CI should silently grant).

## Known follow-ups

These are carried-forward, explicitly flagged gaps — not silently inherited, not fixed
by this task:

- **Connector `authConfig` wiring**: the platform's three existing LLM credential
  modes (profile/connector/env, `agent-ai-service`'s `credential-resolver.service.ts`)
  are not yet unified onto `secretRef`. The broker contract is designed not to
  preclude this unification, but it has not happened yet — future loop.
- **`validateOutboundUrl` DNS-resolution SSRF gap**: the guard checks the literal
  hostname string only, with no DNS resolution — a public-looking hostname that
  resolves to a private/loopback address at fetch time (DNS rebinding) is not caught.
  This gap is MORE urgent here than at its original `connector-invoke-api` call site,
  because every tenant-supplied KB `url:` source is now a server-side fetch target.
  Not fixed by this task.
- **True `multipart/form-data`**: the apply bundle transport is base64-in-JSON (see
  "Apply contract" above) until a multipart parser dependency is vendored into the
  workspace.
- **LLM credential-mode unification**: see "Connector `authConfig` wiring" above —
  the broker must not preclude a future move to `secretRef` as the single credential
  model, but migrating existing modes is explicitly out of scope for this SPEC.

## Related documents

- `manual-loops/declarative-provisioning.md` — full SPEC, task queue, user decisions.
- `TAXONOMY.md` — classification rules 22 (`platform`/`provisioning`) and 23
  (`platform`/`secrets-audit`).
- `DOCS/messaging/service-bus.md` — audit event subject family and causal-chain shape.
- `DOCS/architecture/overview.md` — service map entry.
- `sdk/README.md` — `client.manifests` / `client.secrets` usage.
