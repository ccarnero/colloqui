# provisioning-service

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

Dependency order (channel -> connector -> agent -> service -> workflow) is computed by
`build-dependency-graph.ts` / `topological-resource-order.ts`; a cycle in the ref graph
(e.g. workflow -> service -> workflow) is reported as a typed `cycle_detected` error
(HTTP 409), never a hang.

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
