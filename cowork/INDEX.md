# Index — work from this session (cowork/)

Map of everything produced and where each piece lives. Start here.

## Prerequisites

What you need to run the stack and work with these docs:

| Prerequisite | Why / notes |
|---|---|
| **Bun 1.3+** | Runtime for all TypeScript services and scripts. |
| **Docker + a local Kubernetes** | **OrbStack** (macOS) or **minikube** (Linux/CI). The whole cluster runs locally. |
| **kubectl** | Talk to the cluster. |
| **kustomize ≥ 5.7.0** (standalone) | The kubectl-bundled version is too old; install the standalone binary. |
| **codebase-memory-mcp** on `PATH` | Code knowledge-graph MCP used by Claude Code (see "Tooling: codebase-memory-mcp" below). Optional but recommended. |
| **Claude Code** (this repo's config) | SDD subagents + `cheap`/`premium` model profiles + lint/test hooks live under `.claude/`. |
| **sudo** (Linux) | The minikube orchestrator needs it up-front for the Kourier port-forward. |

One-command startup once the prereqs are in place: `scripts/orbstack/startup.sh` (macOS) or `scripts/minikube/startup.sh` (Linux). See `CHECKPOINT.md` for the full runbook.

## Tooling: codebase-memory-mcp

A local code knowledge-graph MCP server (tree-sitter based) used by Claude Code to search, trace paths, and query the architecture of this repo.

| Where | What |
|---|---|
| `.mcp.json` | Registers `codebase-memory-mcp` for Claude Code at the repo level (binary resolved from `PATH`). |
| `scripts/cbm-reindex.sh` | Idempotent re-index script (respects `.cbmignore`). |
| `.cbmignore` | Excludes `node_modules/`, `dist/`, lockfiles, caches from the graph. |
| `.git/hooks/post-merge`, `.git/hooks/post-checkout` | Non-blocking auto-reindex on pull/branch switch (always `exit 0`). |

Full setup, install, and verification steps: `codebase-memory-mcp-setup.md`.

## Documents in `cowork/` (analysis)

| Doc | What it covers |
|---|---|
| `INDEX.md` | This index. |
| `CHECKPOINT.md` | Compact resume state: what's done, run-from-scratch runbook, next steps. |
| `ARCHITECTURE-ANALYSIS.md` | Full platform architecture (18 services, NATS, Temporal, multi-tenancy), verified against the code + evaluation of `codebase-memory-mcp`. |
| `DOC-VS-CODE-AUDIT.md` | Doc-vs-code audit of `DOCS/`: what matches and 3 discrepancies (200→400, stream tiers, durable name). |
| `SDK-http-sdk.md` | Documentation of the nascent `@yoizen/platform-sdk` (the TS `@yoizen/sdk` was removed). |
| `CACHE-architecture.md` | The 3 cache layers (cache-service L1/L2, per-service Redis, in-memory) + deep dive on the AdapterClient SWR + the L1 gotcha. |
| `TRACEABILITY-audit.md` | End-to-end, hop-by-hop traceability audit (OTel vs correlation) — **historical**: its P0 findings are already shipped/committed (see the banner at the top of that doc). |
| `CHANGES-for-dev.md` | **Handoff for the other dev**: what each change shipped, decisions, gaps, and how to close it out. ← start here to communicate. |
| `codebase-memory-mcp-setup.md` | How the `codebase-memory-mcp` tool was wired up. |

## Artifacts in the repo (outside `cowork/`)

| Location | What's there |
|---|---|
| `.sdd/changes/traceability-causal-chain-ingress/` | SDD record of change 1 (explore/design/adr/tasks/archive). |
| `.sdd/changes/traceability-audit-persist-ids/` | SDD record of change 2. |
| `.sdd/changes/traceability-channel-ingress-causal/`, `.sdd/changes/traceability-channel-chain-endpoint/` | SDD records of the ingress fix + the channel-events chain endpoint. |
| `services/audit-service/`, `services/api-gateway/`, `packages/shared/` | Code for the changes — **committed** on `main` (incl. `6292520`). |
| `DOCS/messaging/envelope.md` §8 · `services/audit-service/CLAUDE.md` | Official docs updated by the changes. |
| `.claude/agents/sdd-*.md`, `.claude/commands/sdd/*.md`, `.claude/settings.json`, `.claude/sdd-profiles.json` | Claude Code config (SDD subagents + profiles + commands + hooks). |
| `scripts/orbstack/startup.sh` | Full startup orchestrator for OrbStack (macOS): sudo, precheck, rebuild, bootstrap, readiness gate, setup-tenant, e2e. |
| `scripts/minikube/startup.sh` | Equivalent orchestrator for minikube (Linux/CI): uses `BUILD_PARALLELISM=2`, Kourier port-forward to localhost:8080, `READY_WAIT=300`. |
| `scripts/sdd-profile.mjs`, `scripts/claude-hook-lint-test.sh` | SDD profile switch + lint/test hook. |
| `scripts/cbm-reindex.sh`, `.cbmignore`, `.git/hooks/post-merge\|post-checkout` | Maintenance of the `codebase-memory-mcp` graph. |
| `.mcp.json` | Connects `codebase-memory-mcp` to Claude Code. |
| `services/tracking-ingester-service/` | **Message-tracking delivery** — bus→Postgres tracking ingester (classify + persist every bus event to `tracking.tracked_events`). Operational doc: `services/tracking-ingester-service/README.md`; classification rules: `TAXONOMY.md`; build-loop playbook: `cowork/LOOP-PLAYBOOK.md`. |

## Change: per-tenant workflow enable/disable (workflow-toggle)

Spec-driven change adding a per-tenant `status` (`enabled`/`disabled`) toggle to
workflow definitions: disabling blocks new executions and terminates running Temporal
executions; enabling restores normal behavior. Full task queue, gates, and human
decisions: `manual-loops/workflow-toggle.md`. Operational contract (schema, block point, 409
`WORKFLOW_DISABLED` body, termination semantics): `services/workflow-service/README.md`.

Decision cuádruple:
- **Rule**: disable = block new executions + terminate running ones (not hide, not
  drain) — `manual-loops/workflow-toggle.md` §User decisions.
- **Why**: per-tenant control of automation, so a tenant admin can stop a misbehaving
  or unwanted workflow immediately without waiting for in-flight runs to finish.
- **Evidence**: the single choke point is `WorkflowsService.executeWorkflow` in
  `services/workflow-service/src/modules/workflows/workflows.service.ts` — both the
  HTTP execute endpoint and the trigger-fired path go through it.

Post-delivery fix (2026-07-13): `GET /workflows` and `GET /workflows/:id` dropped the
`status` field (`toCreateResult` didn't project it), so disabled workflows rendered as
enabled in the console after a reload while executions stayed correctly blocked. Read
endpoints now echo the persisted status — contract in
`services/workflow-service/README.md` §"Read endpoints echo `status`", regression
tests in `test/unit/workflows.service.spec.ts`.

## Change: workflow step-event telemetry (workflow-step-events)

Spec-driven change making `workflow-service` observable at step level: every run now
emits `execution_started` plus per-action `action_started`/`action_completed` and
per-condition `condition_evaluated`, in addition to the pre-existing
`execution_completed`. Full task queue, gates, and human decisions:
`manual-loops/workflow-step-events.md`. Operational contract (kinds, payloads, causal
contract, depth math, volume cap): `services/workflow-service/README.md` §"Step-Event
Telemetry". Classification and golden set: `TAXONOMY.md` rule 19 (kind-agnostic,
no new rule needed), golden rows seq1312-1319. Envelope inventory entry: `SCHEMAS.md`
§12. Engram topic: `tracking/workflow-step-events`.

Decision cuádruple:
- **Rule**: step events are SIBLING hops off the run's `execution_started` event —
  `causation_id` is always the run's `execution_started` id, never the preceding step
  event; `transport.depth` stays CONSTANT (`execution_started.depth + 1`) regardless
  of action count — `TAXONOMY.md` rule 19 note.
- **Why**: a chained (step-to-step) causal design would grow depth per action and
  risk exceeding `MAX_DEPTH_BY_CATEGORY.internal_service` (ceiling 5) on workflows
  with many actions; the sibling design keeps depth bounded to 2-4 regardless of run
  size, which is also what makes the 100-event volume cap safe.
- **Evidence**: `reserveStepEmission` in
  `services/workflow-service/src/temporal/workflows.ts` — atomic, race-safe reservation
  of the 100-event-per-run cap across concurrent fork branches; past the cap exactly
  one `action_completed` (`actionType: "truncated"`, `status: "skipped"`) marker fires.
  Measured e2e multiplier: 13 events per run vs. baseline 3 (~4.3x).
- **Engram topic**: `workflows/tenant-toggle`.

## Change: durable payload capture, retention & admin payload viewer (payload-capture)

Spec-driven change closing the claim-check payload gap: the ingester now resolves
claim-checked payloads at ingest time (not just inline ones), a scheduled scrub
enforces a 30-day payload retention window while causal-chain metadata stays
unlimited, and a tenant-admin-only endpoint exposes a single event's payload with a
full audit trail. Full task queue, gates, and human decisions:
`manual-loops/payload-capture.md`. Operational contract (payload lifecycle state
machine, retention env var, scrub runbook, claim-check resolution semantics):
`services/tracking-ingester-service/README.md`. Console-facing contract (permission,
audit trail, status-specific UI messages): `DOCS/guides/trace-console.md`.

Decision cuádruple:
- **Rule**: capture ALL payloads (no per-flow opt-in), resolve claim-checks at
  ingest; retention is 30 days for payload content only (event metadata is kept
  forever); payload viewing is tenant-admin-only with an audit trail for every
  view — `manual-loops/payload-capture.md` §User decisions.
- **Why**: claim-checked payloads previously lived only in Redis until the claim-check
  TTL expired, making the trace console's "did this message actually carry X?"
  debugging scenario impossible once the cache entry was gone; unbounded payload
  storage was rejected in favor of a single global retention window.
- **Evidence**: the resolution choke point is `resolve-payload.ts` wrapping
  `resolveClaimCheckEnvelope` (`packages/database/src/claim-check.ts`), invoked from
  `makeTrackedEventHandler` before insert (`main.ts` sets
  `resolveClaimChecks: false` on the consumer manager so the shared middleware never
  resolves claim-checks itself, avoiding a resolve-then-nak poison loop on an expired
  ref); the read endpoint is guarded by `tracking:payload:read`
  (`services/api-gateway/src/modules/tracking/tracking.controller.ts`).
- **Engram topic**: `tracking/payload-capture`.

## Change: per-instance run view (run-view)

Spec-driven change adding a Temporal-UI-like, per-instance execution view to
the admin console: a run-scoped `GET /runs/:workflowId/:runId` endpoint on
the ingester (gateway wildcard proxy at `/api/tracking/runs/:workflowId/:runId`,
needed because the deployed gateway router does not match colon-bearing
named-param segments and `workflowId` itself contains colons), plus two
console entries (`processes/runs/:workflowId/:runId` from the Executions
row, and a "Run view" tab inside `processes/trace/:correlationId`). Full
task queue, gates, and human decisions: `manual-loops/run-view.md`.
Operational contract (endpoint response shape, run-scoping semantics,
404/`step_detail`): `services/tracking-ingester-service/README.md`.
Console-facing contract (two entries, view anatomy, degraded modes):
`DOCS/guides/trace-console.md`.

Decision cuádruple:
- **Rule**: the run view is a per-instance, sequence-ordered flow (equally
  spaced, NOT time-scaled) — complementary to, not a replacement for, the
  causal graph (cross-service causality) and the Tempo waterfall (span
  timing) — `manual-loops/run-view.md` §User decisions.
- **Why**: neither existing view answers "what did THIS run do, step by
  step" directly — the causal graph spans services/correlations and the
  waterfall is timing-first; operators debugging a single workflow
  execution needed a dedicated, plan-vs-executed step flow.
- **Evidence**: the endpoint resolves run scope via the run's
  `execution_started` row, then filters events by `causation_id` match
  (step events) or `executionId` match (`execution_completed`), excluding
  sibling runs that share a trigger's `correlation_id` — this is what
  makes the endpoint return exactly one run instead of the whole chain;
  domain layout (merge-run + layout-run) is a pure, exhaustively
  unit-tested core, components only bind the model.
- **Engram topic**: `tracking/run-view`.

## Change: causal trace views in the admin console (trace-console)

Spec-driven change adding per-correlation causal trace views to the admin
console, fed by `tracking.tracked_events`/`tracking.tracked_event_spans`
(the durable causal store) instead of the legacy client-side assembly
against audit endpoints: a `GET /chains/:correlationId` read endpoint on
`tracking-ingester-service` (gateway read-only proxy mirroring the `audit`
module), two console views under `processes/trace/:correlationId`
(waterfall — time-ordered, `causation_depth`-indented, span duration bars;
causal graph — `causation_id → event_id` node/edge graph with a
chain-completeness badge and event detail card), and removal of Grafana's
"Causal node graph" panel now that the console owns business causality.
Full task queue, gates, and human decisions: `manual-loops/trace-console.md`.
Operational contract (endpoint response shape, tenant scoping,
`has_envelope`/`orphan_count` semantics): `services/tracking-ingester-service/README.md`.
Console-facing contract (the two views, removal rationale): `DOCS/guides/trace-console.md`.

Decision cuádruple:
- **Rule**: rows with `tenant IS NULL` (drift/non-envelope) belonging to a
  correlation are INCLUDED in the chain response, not excluded, but flagged
  via `has_envelope`/`compliance` — `manual-loops/trace-console.md` §User
  decisions 4.
- **Why**: excluding null-tenant rows would silently truncate causal chains
  at exactly the drift/non-envelope events an operator most needs to see
  when debugging "why did this chain look incomplete" — the console's job
  is to surface drift, not hide it behind a tenant filter designed for
  compliant rows.
- **Evidence**: the scoping predicate `(tenant = $2 OR tenant IS NULL)` in
  `buildChainQuery`/`buildSpansQuery`
  (`services/tracking-ingester-service/src/lib/build-chain-query.ts`,
  `build-spans-query.ts`), consumed by `toChainResponse`
  (`to-chain-response.ts`) which derives `summary.orphan_count` from
  events whose `causation_id` has no matching `event_id` in the same
  fetched set — including the tenant-scope-excluded case. Grafana's
  "Causal node graph" panel removal
  (`infrastructure/base/observability/grafana/dashboards-message-tracking-configmap.yaml`)
  leaves "Trace waterfall (Tempo)", "Recent traces", "Orphan events", and
  "Trace events (detail)" as the ops-facing panels, with the admin
  console's causal graph view as the sole business-causality UI.
- **Engram topic**: `tracking/trace-console`.

## Change: connector causality fix, Recent calls on tracked_events & diagram deep links (connector-trace-linking)

Spec-driven change making connector executions first-class citizens of the
trace and the trace navigable: `connector.endpoint_call.completed.v1`
events now join the workflow run's correlation instead of being emitted as
causal orphans, the connector detail's "Recent calls" section reads from
the durable causal store (`tracking.tracked_events`, 7-day window) via a
new `GET /events` ingester endpoint instead of audit-service's 60-minute
window, and trace/run-view detail cards link out to entity screens
(connector/mcp/hosted-service/agent). Full task queue, gates, and human
decisions: `manual-loops/connector-trace-linking.md`. Operational contract
(causal fields, fallback semantics): `services/connector-runtime/README.md`
"Event Publishing". Read endpoint contract (query params, projection,
gateway mirror): `services/tracking-ingester-service/README.md` "Events-by-
type/resource read endpoint". Envelope inventory entry: `SCHEMAS.md` §13.

Decision cuádruple:
- **Rule**: `publishEndpointCallEvent` stays fire-and-forget — causal
  threading must never make an endpoint call fail; a `DepthExceededError`
  falls back to emitting WITHOUT causal fields (root event, warn log), an
  orphan event beats a lost event — `manual-loops/connector-trace-linking.md`
  §Constraints.
- **Why**: connector calls were causal orphans (`event-publisher.ts`'s
  `emit()` omitted `correlationId`/`causationId`, so `buildEventEnvelope`
  assigned a random UUID) while agent/mcp calls already joined the run's
  trace — this SPEC brings HTTP endpoint calls to parity and fixes the
  root cause of the empty "Recent calls" list (audit-service's 60-minute
  window, diagnosed in T02, not a missing-emission bug).
- **Evidence**: the gap was `IEndpointCallEvent`
  (`services/connector-runtime/src/activities/_shared/event-publisher.ts`,
  lines 45-60) having no causal fields; the fix mirrors
  `mcp-call.activity.ts:291` (connector-runtime) / workflow-service's
  `agent-call.activity.ts:289-293` existing `causal` threading pattern. Live verification (T06, 2026-07-13):
  post-fix endpoint_call rows land WITH siblings (`with_siblings` grew
  6→18 over the day's runs) while pre-fix rows stay at a flat orphan count.
- **Engram topic**: `tracking/connector-trace-linking`.

## Change: connector invoke API — sync + async invocation from code (connector-invoke-api)

Spec-driven change letting hosted-service code invoke connectors through the
same governed pipe workflows use (breaker, cache, audit event) without
touching Temporal, in two flavors. Full task queue, gates, and human
decisions: `manual-loops/connector-invoke-api.md`. Operational contract
(three-entrypoint deployable, sync/async contract, at-least-once window,
webhook SSRF guard + header denylist, Redis result parking, verify-only
stream-binding script): `services/connector-runtime/README.md` "Three
entrypoints, one deployable" onward. SDK usage:
`sdk/README.md` "`connectors.invoke()`". Cross-reference in
`DOCS/workflows/connector-vs-workflow.md` and `DOCS/messaging/service-bus.md`
"Connector-invoke transport pair".

Decision cuádruple:
- **Rule**: sync (`mode: "sync"`, default) runs the core inline and returns
  the result in the same HTTP response; async (`mode: "async"`) publishes an
  `invoke_requested` envelope and returns `202 { invocationId }` immediately
  — the call itself runs later in a separate consumer entrypoint. Async
  delivery is at-least-once (JetStream redelivery can repeat the outbound
  HTTP call between the call and the consumer's ack); callers must pass
  `idempotencyKey` for non-idempotent verbs — exactly-once was explicitly
  out of scope.
- **Why**: request/response semantics for code needed a transport that
  doesn't pull in Temporal's durability machinery (that stays a workflow
  feature); NATS JetStream already proved the streamed-subject + server-side
  `Nats-Msg-Id` dedup pattern via `serviceBusCall`, so async invoke reuses it
  instead of inventing a new mechanism.
- **Evidence**: `TAXONOMY.md` rule 21 (subjects
  `evt.<t>.connector-runtime.platform.endpoint.system.invoke_{requested,completed}.v1`,
  evaluated before rule 11 so these transport kinds are not mis-tagged
  `tech: connector`); the audit trail stays the SAME
  `connector.endpoint_call.completed.v1` event (resource
  `invocation/<invocationId>`) for both sync and async — no new audit event
  kind. Deployment shape (3 Deployments: worker / `connector-runtime-http` /
  `connector-runtime-invoke`) and the Redis TTL default (900s) were both
  explicit human calls (`manual-loops/connector-invoke-api.md` "Human
  boundaries for this change"). Known follow-ups (reviewer-flagged,
  non-blocking): `validateOutboundUrl` checks literal hostnames only, never
  resolves DNS, so `*.svc.cluster.local` webhook targets bypass the RFC1918
  guard; the e2e's async header comment says cache-status is informational
  but the assertion is currently strict.
- **Engram topic**: `platform/connector-invoke-api`.

## Change: declarative provisioning — manifest apply + secrets broker (declarative-provisioning)

Spec-driven change adding a NEW `provisioning-service` that reconciles a full
integration (channels, connectors, agents, knowledge bases, hosted-service refs,
workflows) described in ONE YAML manifest: `validate`/`plan`/`apply` lifecycle over
tenant-scoped manifest revisions, a create-or-update apply engine that resolves
symbolic refs (`channelRef`/`agentRef`/`serviceRef`/`secretRef`) against live platform
state via the existing internal APIs, a write-only per-resource secrets CRUD API
backed by ONE k8s Secret per resource plus an internal-only secrets broker enforcing
consumer-identity + scope-binding checks, and KB sources (`inline`/`file`/`url`) with
sha256 checksum-driven re-embedding. Full task queue, gates, and human decisions:
`manual-loops/declarative-provisioning.md`. Operational contract (manifest lifecycle,
plan verdicts, apply partial-failure/resume, secrets model, KB checksum semantics,
RBAC, follow-ups): `services/provisioning-service/README.md`. Gateway routes:
`services/api-gateway/src/modules/provisioning/`. SDK: `sdk/README.md`
"`manifests`"/"`secrets`". Audit event subjects and causal-chain shape:
`DOCS/messaging/service-bus.md` "Provisioning-service audit events". Classification:
`TAXONOMY.md` rules 22 (`platform`/`provisioning`) and 23 (`platform`/`secrets-audit`),
golden rows seq1322-1329.

Decision cuádruple:
- **Rule**: the secrets broker lives INSIDE `provisioning-service` (not
  `tenant-service`) as a single RBAC-privileged reader; consumers present service
  identity + the resource they act for; the broker enforces the scope binding,
  delivers the value ephemerally, and audits every resolve/deny — per-resource
  isolation is application-layer (k8s RBAC cannot filter by Secret name or label),
  and v1 apply is strictly create-or-update, with NO prune/delete semantics —
  `manual-loops/declarative-provisioning.md` §User decisions 4/5/8.
- **Why**: ONE k8s Secret per resource (never a per-tenant bag) keeps blast radius to
  a single resource's credential if a consumer is compromised, while a broker inside
  the reconciler (rather than a new tenant-service capability) means the same service
  that already resolves symbolic refs and materializes hosted-service Knative specs
  is the one that hands secrets to their k8s-native env vars — no second
  cross-service round trip for the common case (decision 7: hosted services get
  secrets k8s-natively). Prune/delete semantics were deferred because destructive
  reconciliation (detecting "this used to be in the manifest, now it's gone, so
  delete it") needs its own design round with explicit human sign-off, not a
  side-effect of shipping create/update.
- **Evidence**: `secret-consumer-policy.ts`'s static per-kind allow-set (the apply
  engine's fixed identity `provisioning-service-apply-engine` may act for every kind;
  runtime consumers like `channel-service`/`connector-runtime`/`agent-ai-service`/
  `workflow-service` are scoped to their own kind) plus the `(kind, owner)` binding
  match in `SecretsBrokerService` are the two enforcement layers; the granted
  `provisioning-service-secrets-manager` ClusterRole
  (`knative/services/rbac/cluster-role.yaml`) has no `delete` verb on `secrets`,
  matching the "no prune" stance end to end. Runtime numbers recorded in T09
  (2026-07-15, dev cluster): first plan 64ms; first apply 144ms wall / 59ms server
  for 4 resources; second plan 25ms; second apply 30ms wall / 1ms server (all-noop).
  Negative broker test: a mismatched-binding consumer is denied and a
  `secret_access_denied` event is audited in `tracking.tracked_events`.
- **Engram topic**: `platform/declarative-provisioning`.

Known follow-ups (reviewer-flagged, non-blocking, carried forward not silently
inherited): connector `authConfig`/LLM credential-mode unification onto `secretRef`;
`validateOutboundUrl`'s DNS-resolution SSRF gap, now more urgent because KB `url:`
sources are server-side fetch targets; true `multipart/form-data` for the apply bundle
transport (currently base64-encoded tar in the JSON body, human decision 2026-07-15)
once a multipart parser dependency is vendored.

## Change: samples reorg — three-tier examples taxonomy + declarative provisioning showcase (samples-reorg)

> **SUPERSEDED**: `manual-loops/provisioning-manifest-gaps-2.md`/`-3.md` later migrated all 12
> samples to `manifest.yaml`; none remain stand-by.

Manual-loop change (not SDD) reorganizing the old flat SDK samples tree (one true SDK example plus
twelve platform integration examples) into three tiers, each with one reason to
exist: `sdk/examples/` (SDK API-surface examples, seeded with `reference-pattern`),
`integrations/` (end-to-end platform-feature references grouped `channels/`, `ai/`,
`http/`, `mcp/`), and `demos/` (unchanged — commercial showcases). Migrated
integrations provision exclusively through a `manifest.yaml` (`IntegrationManifest`)
applied via the new SDK CLI (`yoizen manifests apply -f manifest.yaml
--secrets-from-env`) against `provisioning-service` — no imperative setup scripts.
Full task queue, gates, and human decisions: `manual-loops/samples-reorg.md`.
Companion gap SPEC (manifest v1 extensions needed to migrate the remaining
stand-by samples): `manual-loops/provisioning-manifest-gaps.md`.

Decision cuádruple:
- **Rule**: a migrated integration has ZERO imperative setup `.sh`/`.ts` files —
  `manifest.yaml` + README CLI instructions only; a sample whose provisioned
  end-state cannot be expressed in manifest v1 (verified against the apply-engine
  writer code, not just the schema) goes to STAND-BY (untouched scripts +
  `STANDBY.md`) instead of being approximated — `manual-loops/samples-reorg.md`
  §User decisions 6/8.
- **Why**: wrapping setup scripts around manifest calls would keep two competing
  provisioning mechanisms alive for the same resource; the loop's explicit goal is
  for `integrations/` to be the living "after" showcase of declarative provisioning,
  so a sample that cannot honestly express its end-state through the manifest must
  wait rather than fake it.
- **Evidence**: code-level inspection of the apply engine (not just the schema)
  during T06 found the T01 schema-only audit too optimistic — connector `authConfig`
  is unreachable (`connectors-writer.ts:41-73`, inline keys dropped, `secretRef`
  fails loud `secret_not_resolvable`), connector `endpoints` and manifest-time
  symbolic-ref-to-real-ID substitution have no apply-engine concept at all. Human
  ruling (2026-07-15): migrate `telegram-transform-reply` only; the other seven
  formerly-MIGRATABLE samples join the four original gap samples in stand-by (11
  total), restored by `manual-loops/provisioning-manifest-gaps.md`.
- **Engram topic**: `platform/samples-reorg`.

## Overall status

- **Full traceability shipped and committed** (`6292520` + earlier): root ingress fix, persistence in `audit` + `channel_events` + `gateway_audit_events`, endpoints `GET /audit/events/chain/:correlationId` and `GET /audit/channel-events/chain/:correlationId`.
- Validated on **OrbStack (macOS)** and **minikube (Linux)**. One-command startup: `scripts/orbstack/startup.sh` or `scripts/minikube/startup.sh`.
- Only pending item: optional minor `traceability-depth-and-traceid` (`>=`/`>` adjustment in depth-tracker + D9 traceid).
- Uncommitted: `.mcp.json`, `.cbmignore`, `.sdd/changes/` (SDD artifacts), `cowork/` (these docs).
