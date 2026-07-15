# SPEC — declarative provisioning (manifest apply + secrets broker)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/connector-invoke-api.md` (shipped — gateway proxy
> route + TAXONOMY patterns reused). Sequencing per user decision: run AFTER
> `manual-loops/crm-support-telegram.md` and `manual-loops/samples-reorg.md`
> complete — the .sh demo is the "before" this feature turns into "after".
> Origin: user decisions 2026-07-14 (Cowork session, declarative provisioning design).
> Engram topic: 'platform/declarative-provisioning'.

## Goal

A tenant can describe a full integration in ONE YAML manifest (channels,
connectors, agents, knowledge bases, hosted-service references, workflows) and
have a NEW `provisioning-service` reconcile it against reality:

1. `plan` shows the diff (create/update/no-op, missing secrets, KB re-embed
   cost) WITHOUT touching anything.
2. `apply` converges in dependency order, resolving symbolic refs
   (`channelRef`/`agentRef`/`serviceRef`/`secretRef`) to real ids — no more
   hand-written UUID-by-slug resolution.
3. Secrets are first-class, tenant-scoped, one k8s Secret per resource,
   write-only, delivered to consumers only through the service's built-in
   secrets broker with scope-binding enforcement and audit events.
4. Result: an integration example goes from N provisioning scripts to
   1 manifest + 1 apply.

## User decisions (human boundary — do not reinterpret)

1. Server-side engine (option B): a NEW `provisioning-service` — not an
   SDK-CLI client-side applier.
2. Manifest schema rule: at least ONE inbound channel and ONE process (agent
   or workflow) per manifest.
3. The YAML holds structure and wiring ONLY. Secrets and heavy KB content
   travel through adjacent channels (secret store, content bundle) — never
   inline credentials.
4. Secrets: ONE k8s Secret per resource (never a per-tenant bag) in
   `<tenant>-<env>-ns`, labels `{tenant, kind, owner}`, created out-of-band,
   write-only API, referenced from the manifest via `secretRef`.
5. The secrets broker lives INSIDE `provisioning-service` (not tenant-service):
   single RBAC-privileged reader; consumers present service identity + the
   resource they act for; broker enforces the scope binding, delivers
   ephemerally, emits audit events. Per-resource isolation is application-layer
   (k8s RBAC cannot filter by label) — consistent with the platform's
   no-NATS-ACLs stance.
6. KB sources: discriminated union `inline` | `file` (content bundle shipped
   with the manifest, content-addressed sha256) | `url` (server-side fetch with
   SSRF guard). Checksums drive re-embedding: unchanged content is never
   re-embedded; `plan` reports the embedding cost before it is paid.
7. Hosted services receive their bound secrets k8s-natively (env from the
   Secret in their Knative spec) — user code sees plain env vars.
8. v1 apply is create-or-update only — NO prune/delete semantics (destructive
   reconciliation needs its own design round).
9. Delivery method: manual-loop (this SPEC), not SDD.

## Prior art (validated 2026-07-14 — REUSE, do not duplicate)

- `services/agent-ai-service/src/modules/llm/credential-resolver.service.ts` —
  today's THREE credential modes (profile/connector/env); unification to
  `secretRef` is a future follow-up, but the broker contract must not preclude it.
- `services/agent-admin-service/src/modules/knowledge-bases/documents.service.ts` —
  KB file-upload + `api_base_url` ingestion paths to reuse from T06, not rebuild.
- Per-tenant NATS object store (`PAYLOAD-<TENANT>`, DOCS/messaging/service-bus.md
  claim-check) — storage target for content-addressed KB bundles.
- `validateOutboundUrl` (connector-runtime) — SSRF guard for `url:` KB sources;
  its known DNS-resolution gap (flagged in connector-invoke-api SPEC) gets MORE
  urgent with server-side fetches: carry the follow-up forward, do not silently
  inherit it.
- `services/api-gateway/src/modules/connector-invoke/` +
  `downstreamJsonProxyWithStatus` — the gateway proxy-route pattern (including
  non-200 passthrough) for the new `/provisioning/*` routes.
- `services/connector-runtime` three-Deployment split (engram #717) and
  TAXONOMY rule-21 subject naming — precedent for deployment shape and for
  naming the new audit/event subjects.
- `services/tenant-service` — owner of tenant namespaces; provisioning-service
  consumes its namespace naming, never reimplements it.
- `services/registry-service` — hosted-service records; `serviceRef` resolves
  through it (UUID by slug), same rule as workflow `serviceCall`.
- Existing internal service APIs (channels, connectors, agents, workflows) —
  the reconciler calls THEM; it must not write to their tables directly.

## Constraints (apply to every task)

- New service follows the existing NestJS-on-Bun service conventions
  (structure, config, health endpoint, Dockerfile, kustomize overlay entry,
  `services.conf`, smoke-test lists — see engram #590: every workload wired
  1:1 in `knative/services/base/kustomization.yaml`).
- Tenant isolation everywhere: `x-yoizen-tenant` header, tenant-scoped JWT,
  per-tenant data.
- Reconciliation is idempotent by name/externalId; applying the same manifest
  twice is a no-op plan.
- Secret VALUES never appear in logs, events, API responses, plan output, or
  the database — names and bindings only. Automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- All artifacts in English.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — provisioning-service tests (from T02 onward)
cd services/provisioning-service && bun test
# G2 — provisioning-service typecheck (from T02 onward)
cd services/provisioning-service && bunx tsc -p tsconfig.json --noEmit
# G3 — shared package tests (schema lives in packages/shared, from T01 onward)
cd packages/shared && bun test
# G4 — api-gateway tests (from T07 onward)
cd services/api-gateway && bun test
# G5 — sdk tests (from T08 onward)
cd sdk && bun test
# G6a — ITERATION (per attempt, source-mounted dev mode)
./dev-mode.sh deps && ./dev-mode.sh provisioning-service on && ./scripts/e2e-manifest-apply.sh
# G6b — COMMIT GATE (once per task, built image)
./dev-mode.sh provisioning-service off && ./rebuild-redeploy.sh provisioning-service dev && ./scripts/e2e-manifest-apply.sh
```

Gate rules: identical to `manual-loops/trace-console.md`. G6a/G6b apply from
T04 onward (the first task with cluster-observable behavior);
`scripts/e2e-manifest-apply.sh` is created in T04 and grows with each task.

PRECONDITION: `./scripts/validate-dev-mode.sh --with-e2e` green once before
T01; if it fails, skip G6a and rely solely on G6b.

E2E CLEANUP: `e2e-manifest-apply.sh` provisions with account-scoped,
e2e-prefixed names and tears down what it creates (trap-guarded, idempotent).

Commits only happen with dev-mode OFF and the built image live.

---

## Task queue

### T01 — Manifest schema + validator (pure lib)

- `packages/shared/src/provisioning/`: manifest types + zod schema. Sections:
  `channels`, `connectors`, `agents`, `knowledgeBases`, `services` (hosted
  refs: image/buildRef only — never code), `workflows`, `secrets` (bindings
  only: `{name, scope: {kind, owner}}` — never values).
- Symbolic ref types (`channelRef`, `agentRef`, `serviceRef`, `secretRef`) and
  the KB source discriminated union (`inline` | `file` | `url`).
- Structural rules as validators: ≥1 inbound channel, ≥1 process (agent or
  workflow), refs must resolve within the manifest or be marked `external: true`,
  no unknown keys (fail loud).
- HUMAN APPROVES the YAML schema shape (field names, section names) BEFORE
  implementation — it is the public contract of the feature.
- Unit tests: valid manifest, each structural-rule violation, each ref-error
  case, unknown-key rejection.

**Accept**
```
cd packages/shared && bun test && bunx tsc -p tsconfig.json --noEmit
```

### T02 — provisioning-service scaffold + validate endpoint

- `services/provisioning-service`: NestJS-on-Bun scaffold per conventions
  (health, config, Dockerfile, `services.conf`, kustomize + smoke-test list
  entries), tenant-scoped persistence for manifests + revisions (tenant DB).
- `POST /manifests/validate` (schema + structural rules, returns typed error
  list), `PUT /manifests/:name` (store revision), `GET /manifests/:name`.
- Unit tests: revision storage round-trip, validation error surfaces, tenant
  isolation on every route.

**Accept**
```
cd services/provisioning-service && bun test && bunx tsc -p tsconfig.json --noEmit
```

### T03 — Resolver + planner (read-only diff)

- Dependency-ordered resolver: channel → connector → agent → service →
  workflow; resolves every symbolic ref against live platform state via the
  existing internal APIs (channels, connectors, agents, registry, workflows).
- `POST /manifests/:name/plan`: per-resource verdict `create` | `update`
  (field-level diff) | `noop`, plus unsatisfied preconditions: missing secrets
  (by name), unresolvable external refs, KB re-embed estimates (from T06
  onward). Plan NEVER mutates anything.
- Unit tests: diff correctness per resource kind, ref-resolution order,
  missing-secret reporting, cycle detection (workflow → service → workflow).

**Accept**
```
cd services/provisioning-service && bun test && bunx tsc -p tsconfig.json --noEmit
```

### T04 — Apply engine (reconcile, create-or-update) + e2e script

- `POST /manifests/:name/apply`: executes the T03 plan in dependency order via
  the existing service APIs (create-or-update by name/externalId; NO direct
  table writes; NO deletes — decision 8). Partial-failure semantics: stop at
  first error, report applied/pending per resource, re-apply resumes (idempotent).
- Apply emits audit events per resource action (TAXONOMY subjects approved by
  the human BEFORE code, rule-21 style).
- `scripts/e2e-manifest-apply.sh` (v1): minimal manifest (http channel +
  jsFunction workflow) → plan shows creates → apply → second plan is all-noop
  → second apply is a no-op → teardown.
- Unit tests: ordering, resume-after-partial-failure, noop stability.

**Accept**
```
cd services/provisioning-service && bun test && bunx tsc -p tsconfig.json --noEmit
./scripts/e2e-manifest-apply.sh
```

### T05 — Secrets: resource CRUD + broker with scope binding

- Write-only Secret API: `PUT /secrets/:name` (value + scope binding
  `{kind, owner}`) creates/updates ONE k8s Secret `psec-<kind>-<owner>` in
  `<tenant>-<env>-ns` with labels `{tenant, kind, owner}`; `GET /secrets`
  lists names + bindings ONLY; no endpoint ever returns a value.
- Broker resolve (internal-only route): caller presents service identity +
  acting resource (tenant, kind, owner, correlationId); broker checks the
  binding matches, reads the k8s Secret, returns the value ephemerally, emits
  an audit event (who, which secret, for which resource — never the value).
- RBAC manifest granting provisioning-service read on tenant-namespace
  secrets: Claude writes it, the HUMAN applies it the first time.
- Plan integration: T03's missing-secret precondition now checks real Secrets.
- Unit tests: binding enforcement (wrong consumer/kind/owner → denied +
  audited), write-only guarantee, label/name conventions, value-never-logged
  (assert on log sink).

**Accept**
```
cd services/provisioning-service && bun test && bunx tsc -p tsconfig.json --noEmit
./scripts/e2e-manifest-apply.sh
```

### T06 — KB sources: inline / file bundle / url

- `inline`: content in the manifest (size-capped, validator enforces).
- `file`: apply accepts manifest + tar bundle (multipart); blobs stored
  content-addressed (sha256) in the tenant PAYLOAD object store; KB ingestion
  reuses `documents.service.ts` paths.
- `url`: server-side fetch guarded by `validateOutboundUrl`; carry forward its
  DNS-resolution gap as an explicit follow-up in Progress (do not fix here, do
  not ignore it).
- Checksum reconciliation: unchanged sha → skip re-embedding; changed → re-index
  only that document; plan reports "will re-embed N documents (~M chunks)".
- e2e script grows: manifest with a KB (inline + file) → apply → re-apply with
  one changed doc → plan/apply shows exactly one re-embed.
- Unit tests: checksum decisions, bundle extraction safety (path traversal
  rejected), size caps, SSRF-guard invocation on url sources.

**Accept**
```
cd services/provisioning-service && bun test && bunx tsc -p tsconfig.json --noEmit
./scripts/e2e-manifest-apply.sh
```

### T07 — Gateway routes + authz

- api-gateway proxy module `/api/provisioning/*` → provisioning-service
  (validate/plan/apply/manifests/secrets), reusing the
  `downstreamJsonProxyWithStatus` pattern (plan/apply return non-200 statuses
  that must pass through).
- Route scopes: tenant-operator JWT for manifests; secrets PUT requires the
  tenant admin scope; broker resolve route is INTERNAL ONLY (never exposed
  through the gateway).
- Unit tests: route wiring, scope enforcement, broker route absent from
  gateway.

**Accept**
```
cd services/api-gateway && bun test
cd services/provisioning-service && bun test
```

### T08 — SDK resource: `client.manifests` + `client.secrets`

- `sdk/src/resources/manifests/`: `validate(yaml)`, `plan(name)`,
  `apply(name, {bundle?})`, `get/put`; `sdk/src/resources/secrets/`:
  `set(name, value, scope)`, `list()` (names + bindings only). Mirror the
  connectors-invoke client style (typed results, per-call retry override).
- sdk/README.md section with the manifest example and the plan→apply flow.
- Unit tests per client following existing SDK test conventions.

**Accept**
```
cd sdk && bun test && bunx tsc -p tsconfig.json --noEmit
```

### T09 — Full e2e: the demo manifest, end to end

- Extend `scripts/e2e-manifest-apply.sh` to the full showcase shape: manifest
  with telegram-style channel (http fallback for CI), connector with
  `secretRef`, agent, KB, workflow wiring them — apply via SDK, assert:
  plan-before/after, secret binding enforced (NEGATIVE test: a consumer with a
  mismatched binding is denied and audited), audit events present in tracking,
  second apply all-noop.
- Record runtime numbers (plan latency, apply latency per resource) in the
  Progress entry — they feed the future demo narrative.

**Accept**
```
./scripts/e2e-manifest-apply.sh
```

### T10 — Docs + index

- `services/provisioning-service/README.md`: manifest lifecycle, plan/apply
  contracts, secrets model (per-resource Secret, broker, bindings), KB source
  types + checksum semantics, explicit "no prune in v1" note.
- `DOCS/architecture/overview.md` service map + roles table entry;
  `DOCS/messaging/service-bus.md` new audit subjects; `sdk/README.md` cross-links.
- `cowork/INDEX.md` entry; decision log (rule, why, evidence, engram topic).

**Accept**
```
grep -n "provisioning-service" DOCS/architecture/overview.md cowork/INDEX.md
grep -n "manifests" sdk/README.md
```

---

- [x] T01 manifest schema + validator
- [x] T02 service scaffold + validate endpoint
- [x] T03 resolver + planner
- [x] T04 apply engine + e2e script
- [ ] T05 secrets CRUD + broker
- [ ] T06 KB sources (inline/file/url)
- [ ] T07 gateway routes + authz
- [ ] T08 SDK manifests + secrets clients
- [ ] T09 full e2e (demo manifest + negative secret test)
- [ ] T10 docs + index

## Out of scope (explicit)

- Prune/delete reconciliation — destructive semantics need their own design
  round (user decision 8).
- Migrating existing LLM credential modes and connector auth to `secretRef` —
  future unification loop; the broker contract only must not preclude it.
- SOPS/sealed-secret values inside the YAML — v2 for GitOps-purist teams.
- GitOps repo watch/sync (auto-apply on push) — v2; v1 is explicit apply.
- Admin-console UI for manifests/plans — follow-up loop after the API settles.
- Rewriting existing samples/integrations/demos as manifests — that is the
  "after" showcase, a separate loop once this ships.
- Fixing `validateOutboundUrl`'s DNS-resolution SSRF gap — carried forward as
  an explicit flagged follow-up, not silently inherited.

## Human boundaries for this change

- Human approves this SPEC before the first run — and this loop MUST NOT start
  until `crm-support-telegram` and `samples-reorg` are complete (sequencing
  decision).
- Human approves the manifest YAML schema shape (T01) BEFORE implementation —
  it is the feature's public contract.
- Human approves new TAXONOMY event subjects (T04/T05) BEFORE code.
- Human applies the RBAC manifest granting provisioning-service access to
  tenant-namespace secrets (T05) the first time.
- Human runs the first apply that touches a real tenant namespace and the
  first e2e with real secret values.
- Any change to the secrets model (per-resource granularity, broker placement,
  write-only guarantee) requires human sign-off — they are user decisions 4-5.
