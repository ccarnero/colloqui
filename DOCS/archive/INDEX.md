# Index — register of shipped changes

Class: register
Summary: Append-only register of every shipped change in this repo, one section per change, plus a present-tense header index of prerequisites and tooling.
Status: append-only

Map of everything produced and where each piece lives. Start here.

> **Class note (docs-truth-audit T08, 2026-08-03; re-homed T10, 2026-08-04).**
> This file is a hybrid: the per-change entries below are RECORDS and are never
> rewritten (they describe their date), but the Prerequisites / Tooling /
> Documents / Artifacts tables in this header are a present-tense index. Only
> that header is ever corrected, and only where it names an artifact that does
> not exist. The full per-document verdicts live in
> `DOCS/archive/audits/DOCS-TRUTH-LEDGER.md` — read that, not this table, for
> whether a given doc is still true.
>
> **T10 moved this file** from `cowork/INDEX.md` to `DOCS/archive/INDEX.md`
> (ruling D3) and dissolved `cowork/` entirely. It stays the append-only change
> register (`Class: register`, `Status: append-only`) — every SPEC's docs task
> still adds its entry here.

## Prerequisites

What you need to run the stack and work with these docs:

| Prerequisite | Why / notes |
|---|---|
| **Bun 1.3+** | Runtime for all TypeScript services and scripts. |
| **Docker + a local Kubernetes** | **OrbStack** (macOS) or **minikube** (Linux/CI). The whole cluster runs locally. |
| **kubectl** | Talk to the cluster. |
| **kustomize ≥ 5.7.0** (standalone) | The kubectl-bundled version is too old; install the standalone binary. |
| **codebase-memory-mcp** on `PATH` | Code knowledge-graph MCP used by Claude Code (see "Tooling: codebase-memory-mcp" below). Optional but recommended. |
| **Claude Code** (this repo's config) | Under `.claude/`: the manual-loop engine (`commands/manual-loop.md`), the `implementer`/`reviewer` agents, the lint/test hook wired in `settings.json`, and a `skills` symlink to `skills/`. The SDD subagents and `/sdd:*` commands this row used to name are **retired** (AGENTS.md, "Retired 2026-07-29") and gone from `.claude/`; only `.claude/sdd-profiles.json` and `scripts/sdd-profile.mjs` survive. |
| **sudo** (Linux) | The minikube orchestrator needs it up-front for the Kourier port-forward. |

One-command startup once the prereqs are in place: `scripts/orbstack/startup.sh` (macOS) or `scripts/minikube/startup.sh` (Linux). The full runbook is the root `README.md` plus `bootstrap-from-scratch.md` — the `CHECKPOINT.md` this line used to point at was a dead session-resume note, deleted by the docs-truth-audit T10 (ruling D14).

## Tooling: codebase-memory-mcp

A local code knowledge-graph MCP server (tree-sitter based) used by Claude Code to search, trace paths, and query the architecture of this repo.

| Where | What |
|---|---|
| `.mcp.json` | Registers `codebase-memory-mcp` for Claude Code at the repo level (binary resolved from `PATH`). |
| `scripts/cbm-reindex.sh` | Idempotent re-index script (respects `.cbmignore`). |
| `.cbmignore` | Excludes `dist/`, `build/`, `coverage/`, lockfiles and the local agent caches. (`node_modules/` and `.git/` are not listed — the tool skips those on its own, per the file's own header.) |
| `.git/hooks/post-merge`, `.git/hooks/post-checkout` | Non-blocking auto-reindex on pull/branch switch (always `exit 0`). |

Full setup, install, and verification steps: `DOCS/guides/codebase-memory-mcp-setup.md` (moved out of `cowork/` by T10).

## Documents that used to live in `cowork/` (forwarding table)

`cowork/` was dissolved by the docs-truth-audit T10 (ruling D3). Every survivor
moved; every deletion has a named replacement verified on disk. This is the
forwarding address for anything that used to cite a `cowork/` path.

| Doc | Where it is now | What it covers |
|---|---|---|
| `INDEX.md` | `DOCS/archive/INDEX.md` | This index. |
| `CHECKPOINT.md` | **deleted** (D14) | Session resume state whose session ended; replaced by `README.md` + `bootstrap-from-scratch.md`. |
| `ARCHITECTURE-ANALYSIS.md` | **deleted** (D21) | Self-declared stale 2026-07-07 snapshot; replaced by `DOCS/architecture/overview.md` + `runtime-streaming.md` + `mcp-connections.md`. Its §11-§12 `codebase-memory-mcp` fit assessment was carved into `DOCS/guides/codebase-memory-mcp-setup.md` first (SB5). |
| `DOC-VS-CODE-AUDIT.md` | `DOCS/archive/audits/DOC-VS-CODE-AUDIT.md` | The 2026-07-07 doc-vs-code audit of `DOCS/`: 7 High / 8 Medium / 7 Low drift rows, the 5 still-open SKB wiring defects, and the K1–K10 lock proposals that became `scripts/checks/doc-code-guards.sh`. T10 appended a K→G crosswalk to it. |
| `SDK-http-sdk.md` | **deleted** (D18) | Described the 2026-06-20 JS-only ingest-only SDK; the SDK is now TypeScript with 21 resource namespaces. Replaced by `sdk/README.md` + `sdk/examples/README.md`. |
| `CACHE-architecture.md` | `DOCS/archive/audits/CACHE-architecture.md` | The 3 cache layers (cache-service L1/L2, per-service Redis, in-memory) + deep dive on the AdapterClient SWR + the L1 gotcha. |
| `TRACEABILITY-audit.md` | `DOCS/archive/audits/TRACEABILITY-audit.md` | End-to-end, hop-by-hop traceability audit (OTel vs correlation) — **historical**: its P0 findings are already shipped/committed (see the banner at the top of that doc). |
| `CHANGES-for-dev.md` | **deleted** (D16) | Handoff to a developer who read it; the work shipped. Replaced by the four `.sdd/changes/traceability-*/archive.md` + `TRACEABILITY-audit.md`. |
| `codebase-memory-mcp-setup.md` | `DOCS/guides/codebase-memory-mcp-setup.md` | How the `codebase-memory-mcp` tool was wired up, plus the carved-in 2026-06 fit assessment. |
| `ASYNC-RESILIENCE-AUDIT.md` | `DOCS/archive/audits/ASYNC-RESILIENCE-AUDIT.md` | The async/long-running-execution resilience audit; origin of guard `G7`. |
| `METERING-FOUNDATION.md` | `DOCS/archive/audits/METERING-FOUNDATION.md` | The metering-foundation audit and plan. Its six dead source-comment pointers (`DOCS/cowork/…`, a path that never existed) were corrected in the same commit that moved it — SB2. |
| `LOOP-PLAYBOOK.md` | `DOCS/guides/LOOP-PLAYBOOK.md` | The loop-engineering playbook, translated to English by T10 (ruling D33). |
| `DESIGN-run-view.md` + `.html` | `DOCS/archive/DESIGN-run-view.md` / `.html` | The binding visual contract for the workflow run view (ARCHIVED, not deleted — D23; both files moved together per SB6). |
| `DESIGN-http-channel-instances.md` | **deleted** (D19) | Option B shipped; replaced by `.sdd/changes/http-channel-instances/adr.md` + `DOCS/messaging/ingress.md`. |
| `DEBUG-fanout-telegram.md` | **deleted** (D17) | Replaced by `integrations/channels/http-fanout-telegram/README.md`. |
| `SESSION-HANDOFF.md` | **deleted** (D15) | Replaced by the trace feature README + 2 sample READMEs + `.sdd/changes/processes-message-trace/`; its "Known caveats" were verified present in the trace README first (SB4). |
| `staging/manual-loop.command.md` | **deleted** (D20) | Unmaintained second copy of the loop engine; `.claude/commands/manual-loop.md` is the sole canonical one. |
| `DOCS-TRUTH-LEDGER.md` | `DOCS/archive/audits/DOCS-TRUTH-LEDGER.md` | This audit's own instrument: 306 rows, one verdict per documentation artifact. Closed and archived by T10. |

## Artifacts in the repo (outside this register)

| Location | What's there |
|---|---|
| `.sdd/changes/traceability-causal-chain-ingress/` | SDD record of change 1 (explore/design/adr/tasks/archive). |
| `.sdd/changes/traceability-audit-persist-ids/` | SDD record of change 2. |
| `.sdd/changes/traceability-channel-ingress-causal/`, `.sdd/changes/traceability-channel-chain-endpoint/` | SDD records of the ingress fix + the channel-events chain endpoint. |
| `services/audit-service/`, `services/api-gateway/`, `packages/shared/` | Code for the changes — **committed** on `main` (incl. `6292520`). |
| `DOCS/messaging/envelope.md` §8 · `services/audit-service/README.md` | Official docs updated by the changes. (The per-service `CLAUDE.md` this row used to name was absorbed into that README; guard `G6g` in `scripts/checks/doc-code-guards.sh` now fails if a per-component agent file reappears.) |
| `.claude/settings.json`, `.claude/sdd-profiles.json` | Claude Code config still present. The `.claude/agents/sdd-*.md` and `.claude/commands/sdd/*.md` this row used to name are gone — retired 2026-07-29, do not resurrect. |
| `scripts/orbstack/startup.sh` | Full startup orchestrator for OrbStack (macOS): sudo, precheck, rebuild, bootstrap, readiness gate, setup-tenant, e2e. |
| `scripts/minikube/startup.sh` | Equivalent orchestrator for minikube (Linux/CI): uses `BUILD_PARALLELISM=2`, Kourier port-forward to localhost:8080, `READY_WAIT=300`. |
| `scripts/sdd-profile.mjs`, `scripts/claude-hook-lint-test.sh` | SDD profile switch + lint/test hook. |
| `scripts/cbm-reindex.sh`, `.cbmignore`, `.git/hooks/post-merge\|post-checkout` | Maintenance of the `codebase-memory-mcp` graph. |
| `.mcp.json` | Connects `codebase-memory-mcp` to Claude Code. |
| `services/tracking-ingester-service/` | **Message-tracking delivery** — bus→Postgres tracking ingester (classify + persist every bus event to `tracking.tracked_events`). Operational doc: `services/tracking-ingester-service/README.md`; classification rules: `TAXONOMY.md`; build-loop playbook: `DOCS/guides/LOOP-PLAYBOOK.md`. |

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
>
> [Detail added 2026-07-31: the last one, `ai-skill-support-agent`, shipped in
> gaps-3 T04 (`00ec5487`, 2026-07-17) together with the `skills` fifth resource
> kind — schema section, writer, `skillRef` substitution and SDK surface. A
> follow-up SPEC (`manual-loops/provisioning-skills-section.md`) was authored on
> 2026-07-31 to build that kind and was found SUPERSEDED AT AUTHORING; it is kept
> as the record of the decision round and the adjudication. Note gaps-2 and
> gaps-3 have no `## Change:` entries of their own — a pre-existing bookkeeping
> gap flagged, not fixed here.]
>
> [2026-08-01: bookkeeping gap closed — both entries authored retroactively
> below, before the gaps-4 entry.]

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

## Change: crm-support-telegram demo — declarative manifest migration + docs (crm-support-telegram)

Manual-loop change (not SDD) retaking the `demos/crm-support-telegram` commercial showcase
(end-to-end Telegram customer support backed by a real HubSpot CRM, an AI agent, and the
`priority-scorer` hosted service demonstrating both sync and async `connectors.invoke()` modes)
and migrating its provisioning from five sequential setup scripts to a single declarative
`manifest.yaml` applied via `yoizen manifests apply --secrets-from-env` — the same end-state
`integrations/channels/telegram-transform-reply` reached first. Full task queue, gates, and human
decisions: `manual-loops/demos/crm-support-telegram.md`. Engram topic:
`demo/crm-telegram-showcase`.

> **Triggered a platform gap fix mid-loop**: `services[].env[]` could not express the
> `priority-scorer` service's 9 required env vars (2 credential `secretRef`s + 4 HubSpot
> connector/endpoint id refs) — the loop PAUSED before its own T04 while
> `manual-loops/provisioning-manifest-gaps-4.md` shipped the fix, then resumed. See that SPEC's
> own INDEX-worthy summary below.

Decision cuádruple:
- **Rule**: the manifest is the SOLE provisioning path for every platform resource this demo
  needs — the five `01-…05-*.sh`/`setup.sh` scripts and their `src/0N-*.ts` drivers are DELETED
  (T06), not kept as a fallback; only `run.sh` (e2e proof) and a NEW `bootstrap.sh` (the narrow
  set of genuinely out-of-band items: image build, HubSpot custom property, Telegram webhook
  registration) survive as scripts — `manual-loops/demos/crm-support-telegram.md` user decisions 2-4.
- **Why**: proves the declarative-provisioning story end-to-end on the platform's most
  full-shaped commercial showcase (channel + connector + LLM connector + KB + skill +
  systemVariables + agent + hosted service + workflow, all cross-referencing each other by
  symbolic ref in ONE apply) — a stronger proof than any single-resource sample, and lets the demo
  itself sell "one YAML, one apply, noop-idempotent, no plaintext secrets" as part of its own
  pitch (see the demo's README "Declarative provisioning" section).
- **Evidence**: live-verified full-manifest convergence — first apply creates every resource
  (channel, 2 connectors, skill, KB, agent, service, workflow), second apply is a full noop (0
  creates / 0 updates); the `priority-scorer` service's `secretKeyRef`-resolved env vars were
  independently confirmed structurally correct against the live Knative spec (no plaintext
  `value` field for either credential) and against the live `demo-hubspot` connector's real
  endpoint ids, matching byte-for-byte.
- **Engram topic**: `demo/crm-telegram-showcase`.

## Change: provisioning manifest gaps 2 — library manifests, connector ID refs, per-tool MCP fields, service env (provisioning-manifest-gaps-2)

[Entry authored retroactively 2026-08-01 — the loop ran and shipped 2026-07-16/17
but never got its `## Change:` entry, a bookkeeping gap the samples-reorg entry's
SUPERSEDED note records. Content reconstructed from the SPEC's own Progress log.]

Manual-loop change (not SDD) extending manifest v1 with the four gap kinds the parent
`provisioning-manifest-gaps.md` T08 escalated while migrating the 9 remaining stand-by
samples, plus a safety fix found en route. T01 library/channel-less manifests (the
structural validator no longer unconditionally demands ≥1 inbound channel + ≥1 process,
so connector-catalog and MCP-server-only manifests are expressible); T02 fail-loud on
ref-shaped objects at non-allowlisted keys (previously walked as plain objects and
persisted verbatim — a silent-corruption bug independent of the other gaps); T03 LLM/KB
connector ID references (`model_config.llm.connectorId`,
`ingestion_config.provider_connector_id`) join manifest-time substitution; T04 agent
per-tool MCP fields (`enabled_mcp_tools`, `tool_description_overrides`); T05 service
`env[]` vars (PLAIN-STRINGS-ONLY ruling — the secretRef half was deferred and later
shipped by `provisioning-manifest-gaps-4`, next entry); T06 low-priority cleanup
fold-in; T07 migrated 8/9 stand-by samples in three batches, ONE commit per sample
(`ai-skill-support-agent` escalated — it needs a genuine fifth resource kind, which
became `provisioning-manifest-gaps-3`; four more HTTP/Telegram-triggered manifests
shipped carrying the DOCUMENTED unpinned-trigger deviation the earlier migrations had
established, bringing the deviation-carrying total to seven); T08 restored the full G8
canary set. Full queue, decisions, and per-task Progress log:
`manual-loops/provisioning-manifest-gaps-2.md` (dated 2026-07-16/17).

- **Rule**: gaps found while migrating samples get their own human-approved SPEC instead
  of stretching the parent loop past its approved scope (2026-07-16 ruling, inherited
  from the parent's §Human boundaries).
- **Engram topic**: `platform/provisioning-manifest-gaps-2`.

## Change: provisioning manifest gaps 3 — `skills` catalog resource + array symbolic-ref substitution (provisioning-manifest-gaps-3)

[Entry authored retroactively 2026-08-01 — same bookkeeping gap as gaps-2 above.]

Manual-loop change (not SDD) closing the two workstreams gaps-2 ended on, both
HUMAN-APPROVED IN ADVANCE (2026-07-17 ruling recorded in the SPEC preamble): (a) the
`skills` catalog section — a genuine FIFTH resource kind (schema + planner comparable +
apply-engine writer mirroring mcp-servers-writer + `skillRef` scalar substitution),
migrating `ai-skill-support-agent` as the LAST stand-by sample so all 12/12 imperative
samples are declarative, with the first manifest-created catalog skill live and second
apply FULL NOOP; and (d) ARRAY symbolic-ref substitution
(`accountIds: [{ channelRef: … }]`), re-pinning the SEVEN already-migrated workflows'
triggers that carried the documented unpinned-trigger deviation (accumulated across
samples-reorg, the parent gaps loop's T08 batch 1, and gaps-2 T07 — four of the seven). LIVE FINDING + HUMAN RULING during
T05: the workflow comparable is existence-only, so trigger changes NEVER reconcile on
existing workflows — human ruled FORCE NOW + DOCUMENT (delete via API + re-apply, array
substitution resolved to real channel UUIDs, DB-verified). Left open for future rounds:
workflow definition diffing (existence-only comparable), k8s-native `secretKeyRef` env
values (closed later by `provisioning-manifest-gaps-4`, next entry), secret-typed
`systemVariables`. The later-authored skills-section SPEC was superseded at authoring —
this loop's T04 had already shipped it (recorded 2026-07-31, commits e2049ca9/fd407245).
Full queue, decisions and Progress log: `manual-loops/provisioning-manifest-gaps-3.md`
(dated 2026-07-17).

- **Rule**: a pre-approved workstream still runs under full loop discipline, and any
  GENUINELY NEW decision that surfaces mid-task stops and escalates (T05's FORCE NOW
  ruling is the precedent).
- **Engram topic**: `platform/provisioning-manifest-gaps-3`.

## Change: `services[].env[]` secretRef + ref substitution, k8s-native (provisioning-manifest-gaps-4)

Manual-loop change (not SDD) closing the exact gap `crm-support-telegram`'s T04 hit: hosted-service
`env[]` values could only ever be plain literal strings (`manual-loops/provisioning-manifest-gaps-2.md`
T05's own PLAIN-STRINGS-ONLY ruling). Extends `services[].env[].value` to a discriminated union —
literal string | `{ secretRef }` | `{ connectorRef }` | `{ connectorRef, endpointMethod,
endpointPath }` — resolved at apply time via the SAME `resolvedIds` mechanism every other symbolic
ref already uses for the two ref-shaped variants, and via a NEW k8s-native path
(`valueFrom.secretKeyRef` from the `psec-service-<owner>` Secret the platform's secrets broker
already materializes) for the secret-shaped variant. Full task queue, gates, and human decisions:
`manual-loops/provisioning-manifest-gaps-4.md`. Engram topic: `platform/provisioning-manifest-gaps-4`.

Decision cuádruple:
- **Rule**: a service-scoped `secretRef` NEVER resolves to plaintext inside `provisioning-service`
  — only an existence check runs there; `registry-service` receives a REFERENCE
  (`{name: psec-service-<owner>, key: <binding>}`) and its own `knative-builder.ts` emits the
  k8s-native `valueFrom.secretKeyRef` container-env shape. No plaintext secret value ever crosses
  into the manifest, the apply-engine's logs, Postgres, or the live Knative spec.
- **Why**: `provisioning-manifest-gaps-2.md` T05 already tried the "resolve to plaintext, mirror
  connector auth" shape once (2026-07-16) and a reviewer proved it baked the literal secret into
  the Knative spec (etcd-persisted, `kubectl`-visible) — a direct regression against
  `declarative-provisioning.md`'s FOUNDING decision 7 ("hosted services receive secrets
  k8s-natively"). This loop revisited that exact decision point with the k8s-native design that
  ruling deferred as a follow-up, rather than silently re-implementing the rejected shape.
- **Evidence**: `registry-service`'s Knative Services and `provisioning-service`'s `psec-*` k8s
  Secrets were confirmed to deploy into the IDENTICAL per-tenant namespace via the SAME
  `@yoizen/shared` `tenantKubernetesNamespaceName` helper before design started — same-namespace
  `secretKeyRef` needs no cross-namespace copying or extra RBAC. Live-proven end-to-end
  (`scripts/e2e/manifest-apply.sh` Stage 9): a service env block with 2 `secretRef`s + 4
  connector/endpoint refs applies, resolves (2 `valueFrom.secretKeyRef` pairs, 4 real resolved
  ids, structurally verified, no plaintext ever read), and noops on the second apply.
- **Engram topic**: `platform/provisioning-manifest-gaps-4`.

## Change: console redesign foundation (console-redesign-foundation)

Manual-loop change (not SDD) landing the visual foundation for the admin
console redesign: `--rd-*` design tokens in `services/admin-console/src/styles.scss`
(dark default on `:root`, light overrides under `[data-theme="light"],
.light-theme`, transcribed from `manual-loops/admin-console/design/Rediseño
Terminal.dc.html`), the existing `ThemeService` extended to set a
`data-theme` attribute on `<html>` alongside the legacy `light-theme` class
(both mechanisms kept live so old screens keep working during migration),
a restyled shell/sidebar/header/sub-nav, and a shared primitive catalog
(`kpi-card`, `sparkline`, `status-badge` with the new `dot` health-dot
variant, `inventory-table`, `needs-attention-panel`, `detail-dialog` over
`MatDialog`) that section loops (L1-L7) compose instead of rebuilding. Full
task queue, gates, and human decisions:
`manual-loops/admin-console/console-redesign-foundation.md`. Operational
contract (theming, token conventions, primitive catalog with usage
snippets): `services/admin-console/README.md` "Redesign foundation
(theming, tokens, primitives)". Engram topic:
`admin-console/redesign-foundation`.

## Change: console redesign dashboard (console-redesign-dashboard)

Manual-loop change (not SDD) rebuilding the Overview → Dashboard screen on
top of the `console-redesign-foundation` primitives: a four-card metric
strip from `IDashboardStats` (sparklines only on `requestsToday` and
`avgResponseMs`, the two metrics with a real `dailyBreakdown` series), an
API-usage sparkline panel next to an Activity feed (row dot color via an
`activityTone` mapping precedented on `RightPanelComponent.activityColor`),
and a recent-workflows `inventory-table`. Full task queue, gates, and human
decisions: `manual-loops/admin-console/console-redesign-dashboard.md`.
Operational contract (widget composition, column/metric rationale):
`services/admin-console/README.md` "Dashboard composition". Engram topic:
`admin-console/redesign-dashboard`.

Two human-signed amendments (both dated 2026-07-21, made after T01's
inventory findings) diverge from the SPEC's original wording:

- **No needs-attention panel on Dashboard.** The originally specified layout
  ("metric cards → needs-attention panel → recent-activity table") does not
  match the binding visual contract (`Rediseño Terminal.dc.html`), which has
  no attention panel on the Dashboard screen at all — that element belongs
  to the Channels ops view (L2). The SPEC was amended to drop it here rather
  than invent a deviation from the mock.
- **Recent-workflows table renders real columns only.** Of the design's five
  columns (Nombre / Trigger / Ejecuciones / p95 / Estado), only Nombre and
  Ejecuciones map to live data (`ProcessesMetricsService.topWorkflows`);
  Trigger, p95, and Estado have no data source today, and the closest
  candidate field (`successRate`) is hard-coded to `1` for every row. The
  SPEC was amended to render Name + Executions only rather than render a
  hard-coded value as if it were real.

## Change: console redesign channels (console-redesign-channels)

Manual-loop change (not SDD) rebuilding the Channels section on top of the
`console-redesign-foundation` primitives: a fleet view
(`features/channels/channels.component.ts`, `/channels/:channel`) with a
messages-24h/active/inactive metric-card row, an `app-inventory-table` of
accounts (health dot, sparkline, status) and an `app-needs-attention-panel`
of inactive accounts, plus the existing account detail route
(`features/channels/detail/channel-detail.component.ts`,
`/channels/:channel/accounts/:accountId`, unchanged) now carrying an
identity header with health dot and the Edit/Delete actions. Full task
queue, gates, and human decisions:
`manual-loops/admin-console/console-redesign-channels.md`. Operational
contract (fleet + detail composition, health mapping rationale, Edit/Delete
relocation): `services/admin-console/README.md` "Channels composition".
Engram topic: `admin-console/redesign-channels`.

Two human-signed decisions (both dated 2026-07-22, made after T01/T02's
inventory findings) diverge from ambiguous SPEC wording:

- **Health-dot Mapping A (isActive only).** The design defines three health
  states (`ok`/`warn`/`down`), but `IChannelAccount.isActive` is the only
  per-account status field the API returns today. Mapping A maps
  `isActive === true` → `ok`, `isActive === false` → `error`, and treats the
  design's `warn` state as unreachable until the backend exposes a
  degradation signal — rejected the alternative (an extra
  `getUsageTotals({direction: 'dlq'})` call per row to approximate `warn`)
  because it adds N per-row HTTP calls the fleet table does not make today.
- **Edit/Delete relocated to the account-detail header.** The design's
  fleet table has no action column, so the account list's inline Edit/Delete
  buttons moved to the detail view's header, reusing the existing
  `AccountDialogComponent` edit mode and `ChannelAdminService.deleteAccount`.

Backend follow-ups flagged by T01 (not fixed in this loop — front-only
SPEC):

- No per-account `health`/degradation or time-bucketed series (`spark`)
  field exists in `listAccounts()` — blocks the design's `warn` state and
  the fleet table's sparkline/msgs-24h/delivery/first-response columns.
- `ChannelsMetricsService.failedDeliveries24h` is declared and exposed via
  `resolve()` but never `.set()` anywhere — a dead signal, permanently
  `null`.
- `ChannelsMetricsService.connectedCount` is set to `accounts.length` (the
  same value as `totalCount`) and never filters by `isActive` — the
  landing page's "N need reauth" sub-label can never fire today.

## Change: console redesign connections (console-redesign-connections)

Manual-loop change (not SDD) rebuilding the Connections section on top of
the `console-redesign-foundation` primitives: a unified fleet landing
(`features/connections/connections-landing.component.ts`, `/connections`)
with a KPI-count row (HTTP/MCP/Hosted), an `app-inventory-table` merging
the three connector kinds into one rows array with per-type health dots,
and an `app-needs-attention-panel` of failing connections across all three
types, plus restyled `connector-detail` (HTTP,
`features/data-integrations/connectors/detail/connector-detail.component.ts`)
and `mcp-detail` (`features/connections/mcp-detail/mcp-detail.component.ts`)
routed views with health dots, identity chips, `app-kpi-card` config
summaries, and Edit buttons reusing the existing `http-adapter-dialog`/
`mcp-server-dialog` unchanged with fail-fast save + user-visible
`saveError` banners. Secrets are never rendered: the detail views
(`connector-detail`, `mcp-detail`) are sentinel-tested (unit tests assert a
sentinel secret placed in `authConfig`/`auth_config` never appears in
rendered DOM); the landing table's row-mapping functions only read
`authType`/`transport_type`/`image` (no secret field touched) but lack an
equivalent sentinel unit test — tracked as a follow-up below. Full
task queue, gates, and human decisions:
`manual-loops/admin-console/console-redesign-connections.md`. Operational
contract (fleet + detail composition, health-mapping rationale,
Edit-in-header pattern, secrets rule): `services/admin-console/README.md`
"Connections composition". Engram topic: `admin-console/redesign-connections`.

Health-mapping ruling (precedent-applied, orchestrator ruling
2026-07-22, applying the human precedent signed in the Channels loop —
real fields only, no invented thresholds): hosted services reuse the
existing `statusColor()` semantics unchanged (`active`→ok, `pending`→warn,
`error`→error, all real states); MCP servers map `enabled && is_active` →
ok else error; HTTP connectors map `status === "enabled"` → ok else error.
No `warn` state is derived from call error rates or other thresholds for
MCP/HTTP — same class of rejection as the DLQ-derived `warn` the human
turned down in the Channels loop's decision 3. Flagged as backend
follow-up, not fixed in this loop.

Landing-table sentinel-test follow-up (flagged by review, not fixed in this
loop): `connections-landing.component.spec.ts` has no sentinel test
covering the row-mapping functions, unlike `connector-detail` and
`mcp-detail`; the mapping functions only read `authType`/`transport_type`/
`image` today (behavior is safe), but a sentinel unit test should be added
to `connections-landing.component.spec.ts` to lock that in.

Glue-duplication follow-up (flagged by review, not fixed in this loop): the
adapter update-glue between `connectors.component.ts`'s list-refresh path
and `connector-detail.component.ts`'s save/reload path is duplicated
rather than extracted into a shared adapter-update helper; both call sites
independently re-fetch and re-map `IAdapterDto` after a save. Extracting a
shared "update adapter + refresh" function is recommended before a third
call site appears.

Backend follow-ups from T01 (not fixed in this loop — front-only SPEC):

- No call-aggregation or error-rate fields exist anywhere in the
  inventoried services (`IAdapterDto`, `IMcpServer`, `IRegisteredService`,
  `ConnectorCallService`, `AgentAdminService`) — the design's fleet
  health-strip (Calls·24h, Error rate, Avg p95, Secrets por rotar) and the
  inventory table's sparkline/p95/err/usedBy columns have no real data
  source today; would require new backend aggregation, not a client
  derivation.
- `ConnectionsMetricsService`'s `internalErrored`/`externalErrored` signals
  exist but `loadCounts()` never sets them — they stay `null` forever, so
  the `httpErrored` signal that depends on them never resolves to a real
  value. No `mcpErrored`/`hostedErrored` signal exists at all.

## Change: console redesign ai (console-redesign-ai)

Manual-loop change (not SDD) rebuilding the AI section on top of the
`console-redesign-foundation` primitives: the agents list
(`ai-agents-page.component.ts` → `ai.component.ts` list mode →
`existing-agents-panel.component.ts`) with an `app-kpi-card` row of real
agent counts, an `app-inventory-table` with a runtime-state health mapping
(`synced`→`ok`, `draft`→`idle`, `unsynced`→`warn`, `misconfigured`→`error`)
and an `app-needs-attention-panel`; a prompt editor, hosted by
`ai-agent-editor-page.component.ts`'s `AiAgentEditorPageComponent` (which
composes `<app-ai>` and `<app-agent-test-panel>` side by side for both
`/ai/agents/new` and `/ai/agents/:id/configure`), with Monaco mention
decorations (`@skill:`/`@tool:`, purple/green per the design) built from
`MENTION_PATTERN_SOURCE`/`createMentionRegex()` in `ai.helpers.ts` — the
single source of truth also consumed by `extractMentionsFromPrompt` —
display-layer only, the save path stays byte-identical; and a NEW
`agent-test-panel` component beside the editor reusing
`AgentRuntimeService`'s `createExecution` → poll `getExecution` contract
(the `playground.component.ts` pattern), tokens from `result.usage.*`,
latency computed client-side, visible error turns on failure. Full task
queue, gates, and human decisions:
`manual-loops/admin-console/console-redesign-ai.md`. Operational contract
(list composition, health mapping, editor architecture, test-panel invoke
reuse): `services/admin-console/README.md` "AI composition". Engram topic:
`admin-console/redesign-ai`.

Human-signed decision (T04 amendment, dated 2026-07-22, made after T01's
inventory findings): the SPEC's original wording called for restyling the
"existing" `chat-panel.component.ts` test panel with its invoke wiring
"reused verbatim." T01 found this factually wrong — `chat-panel.component.ts`
is an orphaned prompt-editing component (System Prompt/Rules/Soul chips),
never imported by any route or by `ai.component.ts`, and contains zero
`AgentRuntimeService`/invoke wiring to reuse. The test panel was instead
built as the new `agent-test-panel` component described above; the orphaned
file was left untouched rather than repurposed.

Follow-ups (flagged by T01, not fixed in this loop — front-only SPEC, no
new endpoints allowed):

- `chat-panel.component.ts` removal — it is dead code with no route or
  parent-component reference; deleting it is a separate follow-up, not
  bundled into this loop.
- No per-agent stats/usage endpoint exists (`AgentAdminService` has no
  `stats`/`usage`/`metrics`/`invocation`/`error_rate` method for agents) —
  blocks the design's per-agent `inv`/`p95`/`spark` inventory-table columns
  and the list's top-of-page `MetricCard` row (invocations·24h, avg p95,
  tokens·24h, handoff rate), all rendered as an explicit empty/dash state
  in this loop rather than invented numbers.

## Change: console redesign processes-builder (console-redesign-processes-builder)

Manual-loop change (not SDD) rebuilding the Processes section on top of the
`console-redesign-foundation` primitives: the workflow list
(`workflows.component.ts`) as an operational view — `app-inventory-table`
(health dot, run sparkline, status) sourced from a new `WorkflowApiService.
getSummary()` wrapper around the **existing** `GET /workflows/summary`
endpoint (7-day-windowed `topByExecutionCountLast7d`, previously unwired
into admin-console — no new backend endpoint added), health mapping
`active`→`ok`, `draft`→`idle`, `disabled`→`warn`, plus an
`app-needs-attention-panel`, with enable/disable moved to the workflow
detail view's Settings tab behind a confirm dialog and an error banner on
failure; and the workflow builder rebuilt as a full-bleed, Figma-style
canvas on top of the **existing** `@foblex/flow` engine and save path
(`flow-serializer.ts`/`flow-deserializer.ts` untouched) — a new
`subNavHidden` route flag extending the existing `subNavCollapsed`
mechanism hides only the sub-nav (app header/tabs stay visible), floating
chrome (back, name, save state, zoom via `FCanvas`/`fZoom`) overlays the
canvas, node/port colors map by `EWorkflowNodeType` (`KIND_STRIPE`-style:
channel→green, conditional→yellow, agent→purple, other kinds→neutral),
edge labels render from `IWorkflowConnection.label` via
`fConnectionContent`, and the floating inspector embeds the same
`WorkflowNodeConfigComponent` (canvas-click/Esc/× dismissal, with an
autocomplete `Esc`-propagation regression fix + test). A round-trip unit
test covers all 9 node types, asserting deep-equal (not string-equal)
save-payload identity. Full task queue, gates, and human decisions:
`manual-loops/admin-console/console-redesign-processes-builder.md`.
Operational contract (list composition, builder architecture, amended
decisions, round-trip guarantee): `services/admin-console/README.md`
"Processes & builder composition". Engram topic:
`admin-console/redesign-processes-builder`.

Human-signed amendments (2026-07-22, made after T01's inventory findings):

- **Node-type colors, not port-type colors** — decision 4 originally read
  "port colors map by port data type." T01 found no per-port data type
  exists anywhere in the domain model (`workflow-node.types.ts` has one
  input/output port per node, untyped). Confirmed rule: color by
  `EWorkflowNodeType`, mirroring the pre-redesign `.is-channel`/
  `.is-branch`/`.is-conditional` classes and the design mock's own
  `KIND_STRIPE` mapping.
- **Header/tabs stay visible in the builder** — decision 3 originally read
  "hides the console sidebar/topbar." T01 found this contradicts the
  binding visual contract (`11-builder.png`, the mock's
  `showRail: !isBuilder`), which shows the app header and top-section tabs
  still visible in the builder, with only the left sub-nav hidden.
  Confirmed rule: extend `subNavCollapsed` (as `subNavHidden`) to hide only
  the sub-nav; no new topbar-hiding logic was added.

Follow-ups (flagged during this loop, not fixed — out of scope or
NO-DATA):

- The nested `:id/builder` route still shows the detail-view wrapper
  chrome around the canvas — `features/processes`/`detail/` composition
  was out of scope for this loop; only the top-level builder route got the
  full-bleed treatment.
- A stale doc comment in `workflow-detail.component.ts` still describes
  the pre-move enable/disable location (the control now lives in the
  Settings tab) — not corrected in this loop.
- `IWorkflowConnection.label` is never populated by
  `flow-serializer.ts`/`flow-deserializer.ts` — the builder's edge-label
  rendering path is wired and ready, but labels will only appear once the
  backend/serializer starts setting the field.
- Per-node run-count/error-rate mini-stats have no backing aggregate
  anywhere in the platform (`ITopDefinitionRow` is per-definition, not
  per-node) — the stats badge ships hidden rather than showing invented
  numbers; building the aggregate would require a new endpoint/query.
- `ProcessesMetricsService` (`core/services/metrics/processes-metrics.service.ts`)
  still computes `topWorkflows()` from the older, unwindowed
  `getExecutionCounts()` and hard-codes `successRate: 1` for every row —
  it was not migrated to the new `WorkflowApiService.getSummary()` wrapper
  in this loop (only the workflow list view was); doing so is a follow-up.

## Change: console redesign trace (console-redesign-trace)

Manual-loop change (not SDD) rebuilding the trace screens
(`processes/trace/:correlationId`, `processes/runs/:workflowId/:runId`) on
top of the `console-redesign-foundation` primitives and a new
component-provided, signal-based `TraceSelectionService` that becomes the
SINGLE owner of selected-event state across the four trace tabs
(waterfall, causal graph, legacy, run — run carries a step-log sub-panel,
not a fifth tab). Waterfall gained click-to-select (it had none before);
the causal graph migrated off its local `selected` signal and inline
detail card onto the shared service, moving payload fetch-on-demand
(`tracking:payload:read`-gated) and error-branch handling into a shared
docked inspector; the run-view canvas dropped its two prior local
selection signals in favor of the same service (kept OPTIONAL there so
the standalone `/processes/runs/:workflowId/:runId` page's own popup stays
unaffected) and was restyled with `--rd-*` tokens plus real
`ActionStatus`-sourced ✓/✕/– status badges. The inspector renders only
fields with a real data source: `computeEventTimingPercent` (waterfall),
`computeCausalChain` (causal graph, pure derivation over
`causation_id`/`causation_depth`), step result (run), and the existing
on-demand payload fetch. Subscribers (`consumed_by` durable-name list) are
NOT yet rendered in the inspector — open item, see follow-ups below.
Temporal deep links use `resolveTemporalDeepLink` (extracted verbatim from
the legacy tab's URL pattern), gated on `workflow_id`+`run_id` both being
present; entity deep links (connector/agent/MCP/hosted-service) render in
all four modes via `resolveSelectedStepDeepLink`. Full task queue, gates,
and human decisions: `manual-loops/admin-console/console-redesign-trace.md`.
Operational contract (tab set, selection-service architecture,
inspector content per mode, deep-link rules): `services/admin-console/README.md`
"Trace composition". Engram topic: `admin-console/redesign-trace`.

**Orchestrator ruling (2026-07-22, precedent-applied — flagged for human
confirmation)**, applying the "design wins" + "real data only" precedents
signed in earlier loops in this series, resolving two SPEC-vs-visual-
contract discrepancies T01 found:

- **Tab set follows the design mock, not the SPEC's Goal-section wording.**
  The mock's `traceTabs` script names four tabs — waterfall / causal /
  legacy / run — with "step log" as a sub-panel INSIDE the run tab (not a
  fifth tab as the SPEC's Goal section implied), and keeps the legacy tab
  (unnamed in the SPEC's decisions) so pre-existing screens keep working.
- **Inspector renders only fields that exist.** Subscribers are NOT yet
  rendered on the new pipeline — `trace-detail.component.ts` never reads
  `event.consumed_by` (the field exists only on the `ITrackedEvent` type
  and in test fixtures); rendering it as a subscriber list remains an open
  item (the richer `{service, durable, role, health}` shape stays
  legacy-only regardless — no backend field carries it elsewhere); the
  builder deep link stays HIDDEN in every
  mode because no trace-event→builder-canvas node id bridge exists
  anywhere in the codebase — never synthesized, per the SPEC's own
  "hidden otherwise, never a broken link" rule.

Follow-ups (flagged during this loop, not fixed — backend/builder gaps or
polish):

- **Builder deep-link id bridge.** `ILayoutNode.id` is a synthetic
  `(branchPath, actionIndex)` key scoped to a run's own step tree, not a
  `@foblex/flow` canvas node id, and the workflow builder accepts no
  node-focus route/query param today. Opening the builder "focused on the
  corresponding node" needs either a new client-side id-mapping layer or a
  human decision to scope the link to "open the workflow, no node focus."
- **Inspector subscribers block (`consumed_by` list).** The docked
  inspector does not render subscribers at all today —
  `trace-detail.component.ts` never reads `event.consumed_by`; the field
  exists only on the `ITrackedEvent` type and in test fixtures. Wiring the
  bare `consumed_by` durable-name list into the inspector is still open.
- **Rich subscriber shape (`{service, durable, role, health}`) is
  legacy-tab-only.** `ITrackedEvent`/`IRunEvent` carry only
  `consumed_by: string[]` — the richer shape lives solely in the legacy
  pipeline's `ITraceNode`/`assemble-trace.ts`, not wired to
  `ITrackingChainResponse` at all. Shipping the richer shape on the other
  three tabs needs a backend addition, out of scope per "no new backend
  fields."
- **Step-log-inside-run-tab integration polish.** The step log was built
  as a sub-panel of the run tab per the ruling above; any further visual
  polish needed once T05's run-view restyle and the step log are reviewed
  together is tracked here rather than assumed complete.

## Change: console redesign users-analytics-settings (console-redesign-users-analytics-settings)

Manual-loop change (not SDD) restyling Users onto the inventory-table
primitive, rebuilding Analytics from real data sources, and restyling the
Settings hub, on top of the `console-redesign-foundation` primitives: Users
(`features/identity/users/users.component.ts`, `/users`) as an
`app-inventory-table` of `IUser` rows (Email/Name/Role/Created), the
existing "+ Add User" dialog unchanged, and a new
`UserDetailDialogComponent` opened on row click surfacing the same
"Deactivate user" action (`users:delete`-gated); Analytics
(`features/overview/analytics/analytics.component.ts`, `/analytics`)
rebuilt from `DashboardService.stats()`, `ChannelAdminService.getUsageTotals()`,
and `WorkflowApiService.getSummary()` (all already-wired elsewhere, no new
endpoints), with its "Requests · daily" chart reusing the existing
`UsageChartComponent` unmodified via a new pure adapter,
`mapDailyBreakdownToUsageRows` (`analytics-daily-breakdown-to-usage-rows.ts`);
Settings hub (`features/settings-hub/settings-hub.component.ts`, `/settings`)
re-tokened onto `--rd-*` with routes/behavior unchanged. Full task queue,
gates, and human decisions:
`manual-loops/admin-console/console-redesign-users-analytics-settings.md`.
Operational contract (composition, amendments, follow-ups):
`services/admin-console/README.md` "Users, Analytics & Settings
composition". Engram topic: `admin-console/redesign-users-analytics-settings`.

Two human-signed amendments (both dated 2026-07-23, made after T01's
inventory findings) diverge from the SPEC's original wording:

- **Analytics rebuilt from real data, not restyled mocks.** T01 found the
  previous Analytics screen was 100% hard-coded component fields
  (`apiVolumeData`/`topEndpoints`/`errorBreakdown`) with zero service calls.
  Rather than restyle the mocks under new primitives, T03 rebuilt the
  screen against `DashboardService`/`ChannelAdminService`/`WorkflowApiService`
  and removed the mocks entirely. The design's own metric set
  (conversaciones / resueltas sin humano % / tokens LLM · 30d / per-agent
  tables) has no backing data source anywhere in the app today — flagged
  NO-DATA rather than invented, tracked as a backend follow-up below.
- **Settings re-scoped from "grouped-form layout" to a hub restyle.** T01
  found `settings-hub.component.ts` has no form fields, validation, or save
  path — it is a nav hub of link cards — and the design mock has no
  dedicated Settings screen at all (the "Settings" tab renders the Users
  table underneath it). T04 re-scoped to restyling the existing card/chip
  grid with tokens/primitives; the SPEC's field-id snapshot test was
  replaced with chip route/label and rendering assertions.

Also corrected by T01 (not a new amendment, a factual fix to prior-art
wording): there is no user "edit" action or edit dialog anywhere in
`features/identity/users/`, in the design mock, or in `TenantUsersService`
(create + deactivate only) — the SPEC's "invite/edit/deactivate" wording
was corrected to invite + deactivate, and none was added.

Follow-ups (flagged by T01/T03, not fixed in this loop — front-only SPEC,
no new endpoints allowed):

- Analytics' design metric set (conversaciones / resueltas sin humano % /
  tokens LLM · 30d / per-agent and per-workflow tables) has no backing
  field or endpoint anywhere in the platform — a backend follow-up.
- The shared `app-detail-dialog` primitive has no action-projection slot,
  so `UserDetailDialogComponent` had to be built as its own component
  (styled after `app-detail-dialog`) instead of reusing it directly;
  extending the primitive with an optional action slot would let future
  detail dialogs reuse it directly.
- `IUser` has no `status` or `last_active`/`last-active` field — a future
  design iteration adding those columns needs a backend field first (moot
  for this loop since neither the current code nor the design mock shows
  them).

## Change: console redesign polish (console-redesign-polish)

Manual-loop change (not SDD) closing the visual-parity gap left by the
L0–L7 redesign series: every shipped screen used the new `--rd-*` tokens
but several fell short of the binding mocks at the LAYOUT level (chrome,
panel composition, affordance placement), the worst offender being the
workflow builder rendering inside the legacy detail wrapper with the old
palette/node-card layout. Full task queue, gates, findings, and human
decisions: `manual-loops/admin-console/console-redesign-polish.md`.
Engram topic: `admin-console/redesign-polish`.

**Audit pointers** — before/after screenshots + DOM-marker JSON for every
mocked screen, captured with the promoted Playwright harness
(`services/admin-console/scripts/visual-audit.mjs`, added T01):

- Before: `manual-loops/admin-console/audit/before/` (T01, captured against
  the wrong (`platform`-scope) credential — see the credential-artifact
  correction below).
- After: `manual-loops/admin-console/audit/after/` (T09, same 14 routes,
  captured against the correct tenant-scoped credential; no route had to be
  skipped — the workflow id (`HQZTIXPG9ySqHJDZi5aZN`), Telegram account id
  (`bd0d5548-b4ef-422a-b105-dc29ee2a1a8c`), HTTP connector id
  (`f27086e2-e480-4dc9-a522-cbd5b84487fd`), and trace correlation id
  (`d74a3f4f-4bfe-439b-8d40-6f4ed9908158`) from the before-audit all still
  resolved live).

**Audit-credential rule (T08 finding, binding for future visual audits):**
tenant-scoped screens must use `TENANT_ADMIN_EMAIL`/`TENANT_ADMIN_PASSWORD`
from the `auth-secret` k8s secret, passed to the harness as its
`ADMIN_EMAIL`/`ADMIN_PASSWORD`. The platform-scope `ADMIN_EMAIL` credential
(JWT `scope: "platform"`, no `tenant_id` claim, no tenant permissions)
produces false findings: T01's audit used it and recorded two "bugs" —
topbar tenant chip rendering `Unknown`, and a missing `+ Add User` button
on `/users` — that T08 proved were correct behavior for a platform-scope
session, not code defects. Under the real tenant credential the chip
renders `acme` and the Add User button is visible. No code change was made
for either; both findings are corrected, not fixed.

**Findings resolved** (by task, see the SPEC's T01 findings list for the
full per-screen detail):

- **T02** — builder double chrome: the detail-view wrapper (breadcrumb,
  title/Active badge, Run now/Pause/Edit, sub-tabs row) is suppressed on
  the `builder` child route; its navigation moved into the builder's own
  floating chrome as the mock's segmented control.
- **T03** — builder palette replaced with the mock's floating bottom-center
  icon dock (same node types, same create wiring); node cards gained a
  type badge and a derived one-line mono config summary; `valid · N nodes`
  pill from existing validation state.
- **T04** — dashboard/analytics FIX-class deltas (panel proportions, header
  rows, table density, subtitle wording); DATA-GAP items (analytics'
  design metric set, dashboard service-health rollup) stayed excluded.
- **T05** — channels/connections: sidebar "All" aggregate row,
  Endpoint/Auth columns on the Connections table, `/connections/mcp`
  unified into the fleet landing (pre-filtered table + mock's filter-chips,
  legacy MCP page retired, same URL/data sources per decision 5(b)).
- **T06** — AI: sidebar count badges; AI agent editor rebuilt to the mock's
  single scrolling column per decision 5(c) (replacing the fixed 3-pane
  workstation), test panel remains reachable, save/mention/invoke wiring
  frozen.
- **T07** — trace: `Trace` added to the Processes sub-nav; new shared
  `TraceSummaryStripComponent` (VERDICT/TOTAL/EVENTOS/CANAL/BOTTLENECK,
  composed from existing pure derivations plus new `computeChainVerdict`)
  rendered above all four tabs; new time-axis ruler
  (`computeTimeAxisTicks`) on the Waterfall tab. The "uniform blue"
  service-color finding was a data-coincidence non-finding — per-`business_fn`
  coloring already existed. Legacy tab restyle stayed excluded per the task
  text (old pipeline kept alive by design).
- **T08** — topbar restructured into the mock's two-row chrome (breadcrumb
  row + section-tabs row); `/users` Role column now renders as a
  `status-badge` chip.

**Findings deferred (DATA-GAP, no backend field/endpoint exists today —
not built, not re-litigated by this loop):**

- Dashboard's "todos los servicios operativos" health-rollup aggregate.
- Analytics' full design metric set (Conversaciones / Resueltas sin humano
  % / 1ª respuesta / Tokens LLM · 30d, per-channel/agent/workflow
  breakdowns) — already an INDEX-signed amendment from
  `console-redesign-users-analytics-settings`.
- Channels/Connections fleet KPI rows, sparkline/msgs-24h/calls-24h/degraded
  columns, and per-account delivery/failed/first-response metrics — already
  INDEX-signed amendments from `console-redesign-channels`/
  `console-redesign-connections`.
- AI agents list invocation-based KPI row and per-agent stats
  (invocations/p95/tokens/handoff) — already INDEX-signed from
  `console-redesign-ai`.
- Builder per-node run-count/error-rate stats line — already INDEX-signed
  from `console-redesign-processes-builder`.
- Trace `CANAL` field is the honest existing proxy (ingress event `tech`,
  TAXONOMY.md §4 rule 2), not the mock's richer channel-type/account
  identity — no such field exists on `ITrackedEvent`.
- **New (T07): trace `VERDICT`'s `failed` delivery state.** The reduced
  3-state `computeChainVerdict` (received / published-unconfirmed /
  replied) has no equivalent of the legacy `assemble-trace.ts`
  `deriveVerdict`'s `failed` branch — that reads a legacy audit-row
  `delivery` field with no equivalent on `ITrackedEvent`. A failed send
  today renders as `published-unconfirmed` in the strip. Needs a
  delivery/outcome signal added to chain events — backend follow-up.
- `/connections/http/:id` and `/connections/mcp/:id` have no dedicated
  detail mock anywhere in `01`–`19` — a documentation gap in the visual
  contract itself, not a code bug; T05 used `03-channel-account-detail.png`'s
  rhythm as the closest analog.
- `/workflows` list KPI row (4-card strip not in the mock) and per-row `>`
  chevron affordance — flagged in T01 as queue gaps with no task owner;
  left as-is, human call pending on whether to keep or drop the extra
  chrome.
- Causal graph tab's own header chips duplicate 4 of the 5 new
  shared-strip cells — low-risk, non-blocking, flagged for a future loop
  to simplify once the shared strip is confirmed to fully replace it.
- Run view tab's Temporal-SDK-specific fields (`temporal id`/`task queue`/
  `attempt count`) — not confirmed present on `RunViewComponent`'s data
  source; not pursued without verification.
- Legacy tab full token migration (`--rd-*` restyle) — excluded per the
  task text; audited only as far as a `diagnostics:read`-gated session in
  this loop allowed (deny state confirmed correctly gated, no row-level
  content audit possible).

**NEW-CAPABILITY backlog awaiting human sign-off** (consolidated from T01
finding 14, decision 5(a) — none of these are built without explicit
approval):

- Topbar `Search… ⌘K` box.
- Dashboard service-health rollup ("todos los servicios operativos").
- Analytics `7d/30d/90d` time-range selector + `Export CSV` (verify
  whether `DashboardService`/`ChannelAdminService`/`WorkflowApiService`
  already accept a day-count param before building).
- `/connections/mcp`'s transport/status filter-chip row, superseded by
  T05's decision to unify MCP into the fleet landing instead (decision
  5(b)) — kept here as a backlog item only if a future loop reverses that
  direction.
- AI agents list `Sync from seed` button.
- AI editor version-management UI: version banner (`v14 · draft sobre v13
  published`), `unsaved` badge, `Diff vs v13`, `Reset`, `Versions` nav
  entry, `autosave on` indicator.
- Workflow builder `Publish` action.
- **T07 delivery signal**: a `failed`-verdict source field on
  `ITrackedEvent`/chain events (distinct from the reduced 3-state
  `computeChainVerdict`) — needed before the trace summary strip's
  `VERDICT` cell can distinguish a failed send from
  `published-unconfirmed`.

## Change: console redesign builder v2 (console-redesign-builder-v2)

Manual-loop change (not SDD) re-skinning the workflow builder
(`/workflows/:id/builder`) onto `design/builder-v2-reference/` while
PRESERVE-locking vertical flow orientation (item 1) and the left palette
rail (item 2) against the mock's own left→right/bottom-dock layout — per
the binding contract, PRESERVE wins on orientation/placement, the mock wins
on everything else. Full task queue, gates, findings, and human decisions:
`manual-loops/admin-console/console-redesign-builder-v2.md`. Engram topic:
`admin-console/redesign-builder-v2`.

**Audit pointers** — before/after screenshots + DOM-marker JSON, captured
with the promoted Playwright harness (`services/admin-console/scripts/visual-audit.mjs`):

- Before: `manual-loops/admin-console/audit/builder-v2/before/` (T01), the
  reference workflow `crm-support-telegram` (id `7DXJQ18-pcbk56XCMtdRt`, 11
  nodes incl. a branch/conditional — chosen and recorded in T01 so every
  task in the loop screenshots the same graph).
- After: `manual-loops/admin-console/audit/builder-v2/after/` (T09), four
  routes: `/workflows`, the same reference workflow's builder, a zero-run
  workflow's builder (`mcp-connections-demo`, id
  `_rTwN3aKCLFPVS6eSWZdO` — evidences the hidden-stats degraded state), and
  `/ai/agents/b3ea57af-5d62-4797-a7ba-9216d42f0ab8/configure` (PRESERVE
  items 3/4 evidence). Both workflow and agent ids were picked from live
  `tenant_acme` data (queried directly against `postgres-shared-1` in
  `support-services-dev`), not fabricated.

**Findings resolved** (T01 findings list, full per-item detail in the
SPEC's T01/T09 sections):

- **T01 items 2–7** — icon-chip fill/tint, type ramp/weight, card
  padding/proportions, canvas dot-grid, edge waypoint-marker density, and
  palette rail visual language (kept left per PRESERVE item 2) — all
  landed across T02–T05 and re-confirmed MATCH in the T09 audit.
- **T01 item 8 (floating chrome)** — PARTIAL, not fully resolved. T08
  replaced the before-capture's solid full-width toolbar with translucent
  floating pills for every element (back/breadcrumb/name, `saved · Ns`,
  node-count/validity pill, action buttons, segmented control, zoom
  control) — a real improvement. But the T09 audit found the mock's chrome
  is composed as **two separate floating rows** with the canvas/dot-grid
  visible through the gap between them, while the after-capture renders
  every element in **one single continuous row**. Two-row
  composition/density remains an open layout delta for a future task.
- **T01 item 1 / T06 / T07 (stats DATA-GAP)** — RESOLVED at the code level.
  T06 re-investigated L5 T01 finding 6 and found a real source one layer
  past the frontend trace assembly: `tracking.tracked_events` already
  carries `actionName`/`actionIndex`/`branch`/`status` per action per run,
  indexed by `correlation_id`, joinable to the builder's stable
  `action.name`. T07 (human-signed, RECOMMENDATION (b)) wired two new
  read-only endpoints — workflow-service resolves
  `definitionId -> correlation_id[]`; tracking-ingester-service exposes
  `GET /tracking/node-stats` grouping by `(action_name, branch)` — proxied
  through api-gateway, fetched once per builder load by admin-console, and
  rendered with a loading skeleton / hidden-on-error footer row (never
  fabricated numbers).

**Findings deferred:**

- **`Publish` action (NEW-CAPABILITY, T01 finding 9).** No publish API
  exists; per this loop's Human boundaries section and the standing
  polish-loop precedent (decision 3), stays a finding only, not built.
- **`Runs` segmented-control badge (DATA-GAP, T08 follow-up on T01 finding
  8).** The mock's `Runs 1,842` segment has no backing "total runs for this
  definition, all-time" aggregate anywhere the builder can read —
  `getWorkflowsSummary`'s `topByExecutionCountLast7d` only covers the top 5
  workflows over a 7-day window, and T07's node-stats join is per-node, not
  per-definition. The segment renders `Runs` with no number; same standing
  precedent as the per-node stats gap before T07.
- **"Variables Reference" affordance bar (T01 finding 10, out-of-scope
  note).** No equivalent in the `11-builder.png` crop and not itself
  styled in mock terms; not an action item for this loop, flagged only so
  a future header-region task doesn't silently drop it.

**T07 backend deploy requirement (open, blocks real numbers from
appearing):** the per-node stats pipeline is implemented and committed
(`b0eb2e2e`) but the dev cluster still runs pre-T07 revisions of all three
backend services it depends on — confirmed via `kubectl get pods -n
platform-services-dev` during the T09 audit: `api-gateway-00040` (10 days
old) and `workflow-service-api-00079` (~29h old) both predate the T07
commit, and there is no Knative-exposed `tracking-ingester-service` HTTP
surface at all (only the pre-existing `tracking-ingester-worker` NATS
consumer). Until `tracking-ingester-service`, `workflow-service`,
`api-gateway`, and `admin-console` are redeployed with the T07 changes,
`GET /tracking/node-stats` 404s and every node card's stats footer row
renders hidden (the correct degraded state, not a bug) — captured live in
the T09 after-audit screenshots.

## Change: connection call inspector — per-call request/response on every connection (connection-call-inspector)

Spec-driven change closing the last per-call capture gaps and giving every
connection type a docked call inspector: `serviceCall`, the raw no-adapter
HTTP branch, and `mcpCall`'s tool arguments/result now durably capture
per-call request/response (joining `endpointCall` and agent executions,
already captured), standalone LLM calls made outside chat executions emit
their own audit event, MCP "Recent calls" migrates off `mcp_call_events`
onto the tracked-events read API, hosted services get a full detail page,
and a shared docked `CallInspectorComponent` (pattern: the trace event
inspector) opens on every connection screen's call rows — HTTP connector,
MCP server, agent, hosted service — fetching payloads on demand instead of
requiring a trip to the trace. Full task queue, gates, and human decisions:
`manual-loops/connectors/connection-call-inspector.md`. Per-call capture
contract (serviceCall/raw/MCP kinds, resources, redaction/truncation,
fire-and-forget semantics): `services/connector-runtime/README.md` "Per-call
capture: serviceCall, raw HTTP, and MCP". Standalone LLM event contract:
`services/agent-ai-service/README.md` "Event Publishing — standalone LLM
calls". Ingester classification + type-aware `/events` projections:
`services/tracking-ingester-service/README.md` "Type-aware scalar
projections" / "New event kinds classified". Envelope inventory entries:
`SCHEMAS.md` §14/§15.

Decision cuádruple:
- **Rule**: connection screens now render per-call payloads in a docked
  side inspector, fetched on demand through the guarded payload endpoint —
  this SUPERSEDES `manual-loops/connector-trace-linking.md` §User decisions
  2 (dated 2026-07-13: "Payloads are viewed in the trace only — entity
  screens never render payloads"). The 2026-07-13 decision is not deleted,
  it stands as history; this SPEC dates and supersedes it
  (`manual-loops/connectors/connection-call-inspector.md` §User decisions
  1, dated 2026-07-28). Event-kind mapping (decision 7, human-approved with
  the SPEC): `serviceCall`/raw HTTP reuse
  `connector.endpoint_call.completed.v1` with resource prefixes
  `service/<name>`/`raw/<host>`; MCP calls get
  `connector.mcp_call.completed.v1` (`mcp/<mcpServerId>`); standalone LLM
  calls get `ai.llm_call.completed.v1` (`execution/<executionId>`) — no
  other new kinds.
- **Why**: four connector invocation types were causal-orphaned or entirely
  uncaptured at the per-call level (`serviceCall` and the raw branch emitted
  no audit event at all; MCP tool calls only reported scalar usage, never
  the actual args/result), forcing operators into the trace console for any
  payload inspection even on entity screens designed to show "Recent
  calls" — the docked inspector plus emission parity closes both gaps in
  one loop instead of two.
- **Evidence**: the two documented code-level gaps —
  `service-call.activity.ts:53-61` ("serviceCall emits no
  endpoint_call_completed event") and `execute-raw.ts:25-27` — are now
  publish call sites reusing the SAME `_shared/event-publisher.ts` sink
  `endpoint-call.activity.ts` already used (T01/T02); `mcp-call.activity.ts`'s
  `emitMcpCallEvent` is ADDITIVE to `reportMcpUsageEvent`, which keeps
  feeding `mcp_call_events`' aggregate summary unchanged (decision 3, T03);
  `LlmActionService.execute` is the sole publish call site for
  `ai.llm_call.completed.v1`, verified NOT to overlap `execution_completed`
  since chat executions route through `execution.handler.ts`, which never
  depends on `LlmCallEventPublisherService` (T04). Ingester classification
  rules 24/25 (`TAXONOMY.md` §4) plus the `resource=agent/<agentId>` query
  alias in `build-events-query.ts` (T05) make every new resource family
  filterable without a schema change. Cluster e2e (T12) verified the
  `serviceCall` round-trip live: the `endpoint_call_completed` row with
  resource `service/...` lands in `tracked_events` sharing the run's
  `correlation_id`, is returned via `GET /tracking/events`, and its payload
  fetch returns 200 with the run's nonce. MCP and standalone-LLM paths are
  covered by service-level tests only — no MCP server or LLM job fixture
  exists in the dev e2e today (T12 recorded limitation, fixtures out of
  scope for this loop).
- **Engram topic**: `connectors/call-inspector`.

## Change: system validation run — manual-loop machinery proven via adapter retry-chain caps (system-validation)

Manual-loop change (not SDD) whose primary product is EVIDENCE: one full pass of
the manual-loop machinery (engine, context contract, G0 repo guards, per-service
gates, dual review, auto-checked Progress, conventional commits) on a real
change, with each mechanism's firing recorded in the SPEC's own Progress as a
validation report. The vehicle shipping real value: upper caps on the connector
retry-chain fields — `ADAPTER_TIMEOUT_MS_MAX = 60_000`,
`ADAPTER_MAX_RETRIES_MAX = 3`, `ADAPTER_RETRY_BACKOFF_MS_MAX = 10_000`, exported
from `packages/shared/src/adapter-schema.ts` and enforced via `@Max` on the
Create and Update DTOs in
`services/connector-admin/src/modules/adapters/adapters.dto.ts`. Full task
queue, gates, human decisions, and the validation report:
`manual-loops/architecture/system-validation.md` (dated 2026-07-29). Operational
contract (the three caps, their rationale, the invariant guard, the
validation-layer-only scope): `services/connector-admin/README.md` "Retry-chain
caps".

Decision cuádruple:
- **Rule**: the caps live as exported constants in `packages/shared` and are
  IMPORTED, never duplicated as magic numbers per service; enforcement is
  validation-layer only — NO DB `CHECK` constraint and NO migration, so
  pre-existing rows above a cap keep working until their next edit —
  `manual-loops/architecture/system-validation.md` §User decisions 2/3.
- **Why**: an uncapped adapter `timeoutMs` × retries could exceed the async
  invoke consumer's 300s JetStream ack wait, after which NATS redelivers the
  in-flight message and the outbound HTTP call is DUPLICATED. With the caps the
  worst chain is 3 × (60s + 10s) + 10s webhook delivery = 220s < 300s.
- **Evidence**: the invariant is a permanent test, not a comment —
  `services/connector-runtime/test/unit/invoke-ack-wait-invariant.spec.ts`
  asserts the worst chain against the real exported
  `INVOKE_CONSUMER_ACK_WAIT_MS` (`services/connector-runtime/src/config.ts`),
  so raising any cap or lowering the ack wait without rebalancing breaks the
  build. Machinery evidence lives in the SPEC's "T03 findings" block: G0 green
  on every attempt, four independent reviewer verdicts (both T02 reviewers
  independently flagged the same non-blocking defect), one human-arbitrated
  retry round that exposed a PRE-EXISTING red `bun test` baseline in
  connector-admin, and two mechanisms explicitly recorded as NOT observed
  (BLOCKED.md flow, same-error-twice fast-block) rather than assumed working.
- **Engram topic**: `architecture/system-validation`.

## Change: dev-mode validator stage-4→5 readiness barrier (dev-mode-validator-fix)

Manual-loop change (not SDD) repairing `scripts/validate-dev-mode.sh`, whose internal
stage-5 race had — since 2026-07-16 — forced every backend manual-loop to skip its
per-iteration dev-mode gates via the PRECONDITION escape hatch and run commit-gates-only.
Stage 4's canary appends to `services/workflow-service/src/main.ts` and reverts it, and that
file is the entry point of the worker Deployments AND of the `workflow-service-api` ksvc, so
BOTH writes restart the API's `bun --watch` while stage 4 only ever watched the worker
Deployment. New stage 4b polls an authenticated `GET /api/workflows` through the gateway
until it is HTTP 200 AND a JSON array, 3 consecutive good samples after the revert's observed
outage (20s grace + WARN if the restart was too fast to sample), bounded at 120s, every
attempt logged. Full task queue, gates, human decisions, and the T01 evidence:
`manual-loops/architecture/dev-mode-validator-fix.md` (dated 2026-07-30). Operational
contract (stage list, barrier design, `BARRIER_*` knobs, the historical race):
`DOCS/guides/dev-mode.md` "Validating dev mode".

Decision cuádruple:
- **Rule**: the barrier WAITS for observable readiness — never a fixed sleep — and it checks
  the response SHAPE, not liveness: only HTTP 200 with a JSON *array* body counts, and the
  streak is accepted only after at least one bad sample proved the revert's reload happened
  (a single 200 can land in the gap between the append's reload and the revert's). Fix the
  VALIDATOR, not the loops, and touch no `dev-mode.sh` or service source —
  `manual-loops/architecture/dev-mode-validator-fix.md` §User decisions 1/2 and Constraints.
- **Why**: during the ~2–2.5s restart window the gateway answers a well-formed HTTP 502 JSON
  *object* (`{"statusCode":502,"message":"dial tcp ... connection refused"}`), which any
  200-or-liveness probe would have accepted as healthy; that body is precisely what broke the
  two downstream consumers, so the shape is the only honest readiness signal.
- **Evidence**: T01 reproduced the window with a 0.5s probe running alongside two full red
  runs plus two controlled replays of stage 4 outside the validator — the 502 body makes the
  e2e's `jq '.[] | select(.name ...)'` iterate the object's VALUES and index the number `502`
  (`Cannot index number with string "name"`, the 2026-07-16 symptom), and makes
  `provisioning-service`'s workflow `findByName` warn-and-continue into a PARTIAL manifest
  apply (`missing an expected resource externalId`, the 2026-07-24 symptom) — one window, two
  consumers, no second mechanism. Acceptance was determinism, not a single green:
  `./scripts/validate-dev-mode.sh --with-e2e` passing twice consecutively. Recorded but NOT
  fixed here (service source is out of scope for this loop): `build-manifest-plan.ts:128-138`
  downgrades a failed downstream lookup to a warning and applies partially, and
  `scripts/e2e/http-workflow.sh` never inspects `.preconditions` — worth its own SPEC.
- **Engram topic**: `architecture/dev-mode-validator`.

## Change: long-running agent executions (long-running-agent-executions)

Manual-loop change proving that an agent execution which takes LONGER than any default
HTTP timeout completes correctly through the async path — immediate handle, no live HTTP
connection during the wait, correct result delivery, ZERO NATS redeliveries, flat
resources — and that the same holds for the workflow `agentCall` path. Slowness is
injected deterministically by an env-gated, dev-only delay hook inside the REAL execution
pipeline (`AGENT_TEST_DELAY_ENABLED` + per-execution `__test_delay_ms`, hard cap 600 s,
`services/agent-ai-service/src/nats-handlers/test-delay.ts`), never by a real slow model or
an executor mock. Target duration **120 s** (decision 3), which T01 confirmed fits every
budget with 7.5× margin against the tightest one it crosses. Full task queue, gates, human
decisions, and the numbered T01 budget inventory:
`manual-loops/agents/long-running-agent-executions.md` (dated 2026-07-30). Operational
contract (13-budget table with `file:line`, the serial-consumer caveat, the delay hook):
`services/agent-ai-service/README.md`. Feature-author guide:
`DOCS/agents/long-running-executions.md`. Executable proof:
`scripts/e2e/long-agent-execution.sh`.

Decision cuádruple:
- **Rule**: the evidence bar is the async contract AND resources — immediate handle, no held
  connection, correct delivery, zero redeliveries, before/during/after `kubectl top` — with
  ONE normal workflow running during the wait as the contention probe; load testing (N
  concurrent long executions) is explicitly OUT (decision 2). Hard gate assertions only on
  DETERMINISTIC facts (status codes, completion, redelivery counts, ack-pending drain,
  duration ≥ delay); resource numbers are REQUIRED report evidence behind a deliberately
  generous ceiling (during-wait agent-ai CPU vs 500 m, measured 10-23 m). **Amendment
  2026-07-30 (decision 5, human-approved mid-loop):** T03 discovered the delay key was
  UNREACHABLE from the async submit path — neither `variables` nor `metadata` was declared on
  `CreateExecutionDto` in api-gateway or ai-agent-gateway, and the shared bootstrap installs
  a `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`, so both 400'd
  (`{"message":["property variables should not exist"]}`, verified live against the cluster).
  The agent instead of a workaround: STOP + report, then a human approved widening BOTH DTOs
  with one optional pass-through `metadata` object, nothing else.
- **Why**: a long agent execution is a normal case (slow tool chains, reasoning models, bad
  MCP days), and the platform's protection for it was undocumented and unproven — believed
  correct by design, never demonstrated. The 120 s target is longer than common client
  defaults and far under the Knative 960 s floor and the Temporal budgets, so it exercises
  the real risk without inventing an extreme.
- **Evidence**: T01 read every budget first-hand and pinned the invariant *delay < ackWait*
  (consumer ackWait 900 s refreshed by `msg.working()` every 30 s; buffered-execution abort
  900 s; Temporal `startToClose` 15 min / `heartbeatTimeout` 30 s with a heartbeat every 15 s;
  `AGENT_CALL_TIMEOUT_MS` 900 s; Knative revision 3600 s, floor 960 s; api-gateway proxy fetch
  30 s guarding only sub-second hops; Redis result TTL 3600 s; JetStream duplicate window
  120 s) — no amendment to the 120 s target was needed and ai-agent-gateway/workflow-service
  stayed read-only apart from the human-approved DTO field. T03/T04 runs on the dev cluster:
  handle in **0.05 s** (budget 5 s) with the follow-up GET reading `started`, contention probe
  green in **6-7 s** during the wait, direct execution completed after **123-125 s** with the
  hook's own log line `[test-delay] End after 120001ms` and **exactly one** handler delivery,
  `num_redelivered` 0→0 with `num_ack_pending` drained to 0, during-wait CPU **11-23 m** vs a
  500 m ceiling, and the workflow `agentCall` run COMPLETED after **122-125 s** with no
  Temporal failure and **exactly one** agent `execution_completed` on its tracking chain
  (plus exactly one `execution_requested`, zero `execution_failed`). Two real bugs the loop
  caught rather than assumed away: (a) a draining OLD Knative revision still bound to the
  durable consumer swallowed an in-flight execution — the message stayed un-acked for the full
  900 s ackWait and poisoned the next run's baseline — now a fail-fast preflight that waits
  for pods to settle on the latest ready revision AND requires `num_ack_pending == 0`;
  (b) `num_redelivered` is a GAUGE, not a cumulative counter (verified live: 0→1 at
  redelivery, back to 0 after ack), so the before/after comparison is backed by a mid-flight
  sample and by an "exactly one `[test-delay] Start` per executionId" log assertion.
  Also recorded: the webhook body structurally cannot carry the delay key on the workflow
  path (`trigger-consumer.service.ts:185-193` builds a FIXED request shape), and starting the
  run via `POST /workflows/:id/execute` DOES deliver the canonical
  `variables.request.__test_delay_ms` but produces NO causal context, so the agent's
  `execution_completed` lands on a different chain — hence the e2e uses the production
  webhook trigger with the delay in the action args.
- **Engram topic**: `agents/long-running-executions`.

## Change: docs/code consistency sweep + doc guards (docs-consistency)

Manual-loop change that made the documentation corpus verifiable instead of merely
written: every load-bearing claim in `DOCS/messaging/*`, `DOCS/architecture/*`,
`SCHEMAS.md`, `TAXONOMY.md` and the guides was checked against code, the per-component
`AGENTS.md` split-brain was collapsed into READMEs, and each drift CLASS that was found
got a static guard so it cannot come back. 14 `AGENTS.md` files absorbed-then-deleted
(3 in T02, 10 in T03, `packages/shared` in T04); 5 service READMEs and 4 package READMEs
written from scratch, 13 more service READMEs rewritten or absorbed into (3 in T01,
10 in T03) and `packages/shared/README.md` verified in place; 3 inline ADRs moved out of
the onboarding guide into `DOCS/adr/`.
`scripts/checks/doc-code-guards.sh` now runs **13 guards** (`K6a`–`K6g`, `K7`, `K8`, `K9`,
`K9b`, `K10`, `K11`) and is green at every commit. Full task queue, gates, human decisions
and the numbered T07 findings: `manual-loops/architecture/docs-consistency.md`
(dated 2026-07-30). Commits: `15b827b0`, `f85e7b64`, `21c31a99`, `a0ba2de1`, `fa80ad45`,
`46f2eed4`, `bf4043e1`.

Decision cuádruple:
- **Rule**: audit and guard in ONE loop — a finding that does not end in a guard is a
  finding that recurs. Every fix is paired with the check that pins it: numeric claims
  (`K9b`), dead links (`K10`), undocumented dual-backend support (`K11`), resurrection of
  per-component agent files (`K6g`). Absorb-then-delete, never delete-then-rewrite: the
  README had to carry the verified content BEFORE the `AGENTS.md` went away. And the
  guard must be GREEN in the commit that lands it — which is why `K6g` covered
  `services/*` in T03 and only grew to `packages/*` in T04, once the last packages
  `AGENTS.md` was gone.
- **Why**: the corpus had two failure modes with different remedies. Descriptive docs
  (READMEs, inventories, as-built contracts) had drifted from code and were simply wrong
  → the CODE decides, fix the doc. Prescriptive docs (envelope spec, security MUSTs,
  `TAXONOMY.md` rules) record a design the code must obey → the CODE is the bug, record a
  numbered finding and do NOT rewrite the doc. Collapsing that distinction is how a spec
  quietly becomes a description of whatever shipped. Recorded decisions moved verbatim
  (the 3 ADRs) with only date/status/header structure added.
- **Evidence**: the READMEs were not edited, they were re-derived — every surviving claim
  carries a `file:line` citation or a runnable command, and unverified claims were dropped
  rather than softened. The headline adjudications: **audit-service** documented a single
  `audit-writer` durable on an `EVENTS` stream writing one `events` table — neither the
  stream nor the durable exists anywhere in `src/`; reality is four trails
  (`audit-events`, `channel-audit`, `execution-audit` on per-tenant `INGRESS-*`, plus
  `gateway-audit-writer` on its own `GATEWAY_AUDIT` stream) writing four tables.
  **api-gateway** documented an events module that does not exist (`POST /api/events`,
  `GET /api/results/:id`, an SSE stream, `src/modules/events/`) while nine real modules
  went undocumented. **agent-admin-service**'s 551-line `AGENTS.md` described a
  Credentials module, a Channels module and an automatic `SeedService` — none of which
  exist in code. Guard calibration is likewise evidence-first: `K10` was verified to fire
  on a synthetic dead link and to correctly IGNORE links inside fenced blocks and inline
  code spans before it was accepted.
- **Engram topic**: `architecture/docs-consistency`.

Follow-ups for the future envelope-drift loop — the 9 T07 findings, all recorded with
`file:line` evidence in `manual-loops/architecture/docs-consistency.md` Progress, none
fixed here (the loop was docs + `scripts/checks/` only):

1. Stage-2 `transport.headers` is an undeclared field — `envelope.factory.ts:102-107`
   writes it, `EventTransport` (`interfaces.ts:13-18`) does not declare it; only compiles
   because a conditional spread bypasses excess-property checking. Stage 1 correctly uses
   `data.headers`. Extends `DRIFT.md` item 2 (doc side fixed in T07).
2. Stage-1 `type` token violates the prescriptive format —
   `webhook-ingress-publisher.service.ts:117` hardcodes
   `io.yoizen.messaging.webhook.received.v1` for every channel.
3. Depth enforcement `>=` vs `>` — `depth-tracker.service.ts:36` rejects one level early
   against a local `DEFAULT_MAX_DEPTH = 5`, ignoring `MAX_DEPTH_BY_CATEGORY`
   (`envelope.utils.ts:172,298`).
4. `skills/envelope-messages/assets/envelope-schema.json` needs a rewrite — 4 defects
   (`channel` enum omits `http`; wrong `correlation_id` description; no
   `WebhookIngressEnvelope`; `required` unconditionally includes `accountid`).
5. `transport-topology.ts:15,20,26` names a durable that does not exist
   (`channel-events-audit`; real name `channel-audit`, `channel-audit.service.ts:49`).
6. `agent-memory-service` subject constants are service-local
   (`nats.provider.ts:62-68`) and its envelope `domain` disagrees with its subject token.
   [Both fixed 2026-07-31 by envelope-drift T08 — the constants now live in
   `packages/shared/src/constants.ts:145-153` and the `domain` matches; the
   finding text and its original line anchor are left as recorded.]
7. `ensureDurableConsumer` JSDoc contradicts its own constants
   (`nats-durable-consumer.ts:74,76` vs `:30,:43-48`) — high risk given the file's
   duplicate-delivery history.
8. Tenant-tier limits defined but only partially wired — `ensureTenantIngressStream`
   ignores tier and applies flat channel constants.
9. Two INGRESS stream-name builders disagree on casing — `getTenantStreamName`
   upper-cases, `buildIngressStreamName` does not; both exported from `@yoizen/shared`.


## Change: repo skills tell the truth (skills-cleanup)

Manual-loop change that applied the docs-consistency bar to the skill corpus: the
skills that SURVIVED the 2026-07-29 deletions (`dotnet`, `devops`, `pydantic-ai`,
`tailwind-4`) were still legislating for other codebases, so every surviving claim was
re-derived against source or deleted. Three tasks: **T01** `multi-tenant` aligned with
reality, **T02** `yz-ui` ghost half removed, **T03** the gitignored-skill decision plus
the registry protocol. Full task queue, gates and human decisions:
`manual-loops/architecture/skills-cleanup.md` (dated 2026-07-29). Commits: `1df4d653`
(T01), `e080ee92` (T02).

Decision triple:
- **Rule**: a skill is advisory, but a WRONG skill is worse than no skill — it teaches an
  agent to write code for a platform that does not exist. So the same bar as the
  docs-consistency loop applies: every surviving claim carries a `file:line` citation or a
  runnable check, and unverifiable claims are DELETED, not softened. Where a skill and
  `AGENTS.md` disagreed, `AGENTS.md` won and the skill was fixed.
- **Assets are claims too**: flagging a lying asset is not enough, because an agent can
  open `assets/` directly. Both reviewers rejected T01's first attempt for exactly this,
  and the precedent then carried into T02. Deleted: `skills/multi-tenant/assets/` (6
  Express/`jsonwebtoken`/Mongo templates) + `references/docs.md`; `skills/yz-ui/`'s
  `component-template.tsx`, `css-snippets.css`, `tailwind-theme-schema.json` and
  `references/docs.md` (whose admin-console half cited 5 paths that no longer exist).
- **Evidence**: `multi-tenant` prescribed an `X-Tenant-Id` header (real:
  `x-yoizen-tenant`, `packages/shared/src/constants.ts:25`), Express middleware and
  `jsonwebtoken` (real: NestJS `TenantGuard` + `@TenantId()`,
  `packages/database/src/tenant-guard.ts:24-63`, and `jose`), a 403 tenant-mismatch rule
  that exists nowhere, and a Mongo shared-collection `{ tenant }` model (real: one
  database per tenant, `packages/shared/src/tenant-auth-schema.ts:6-8`). `yz-ui` was
  worse than stale — it taught wrong VALUES for the app that does exist: 180px/48px rails
  (real 210px/56px, `sub-nav.component.ts:85-101`), `var(--primary)` active states (real
  `var(--rd-accent)`), and it never mentioned the `--rd-*` redesign token layer
  (`styles.scss:153-268`) that 43 files already use.

Human decisions (T03, 2026-07-31):
- **`skills/playwright/` DELETED**, not tracked. It was real on disk but gitignored: 59
  files / 26,363 lines of third-party generic content (`author: currents.dev`, MIT) with
  zero references to this repo. The repo does use Playwright (`package.json:5`,
  `playwright.config.ts`, `e2e/sales-agent-setup.spec.ts`), which is why this was a real
  question and not an obvious delete — but tracking it would have imported 26k unaudited
  lines legislating for Electron, WebGL, Vue, React, GitLab and 5 CI providers, i.e. the
  exact failure mode that got `dotnet`/`devops` deleted. The three now-dead `.gitignore`
  lines went with it, and `AGENTS.md:101-104` was corrected — it had promised a
  `playwright` skill that no clone ever received, while omitting `judgment-day`,
  `skill-registry` and `_shared`, which do ship.
- **Registry protocol: PATHS, not summaries.** Two mutually exclusive protocols were
  live: `.atl/skill-registry.md:24-26` ("an index, not a summary… pass paths so subagents
  load the full runtime contract") versus `skill-registry`/`_shared` ("inject the COMPACT
  RULES text… the sub-agent should NOT read any SKILL.md files"). Paths won: a summary
  drifts from the file it summarizes, a path always resolves to current text. All three
  consumers were rewritten to the paths protocol, and the resolver's filesystem fallback
  now names the artifact that actually exists — it previously pointed at
  `skill-registry.md` "from the skills folder", a file that has never existed, so hop 3
  of the chain could never resolve. `.ywai/` (retired, `AGENTS.md:110-112`) was replaced
  by `.atl/` throughout, and the dead `skills/skill-sync/assets/sync.sh` reference dropped.

- **Engram topic**: `architecture/skills-cleanup`.

Follow-up, not done here: write a small FIRST-PARTY `playwright` skill documenting THIS
repo's e2e setup — the `workers: 1` sequential constraint (`playwright.config.ts:16`),
the `fillMatInput`/`mat-form-field` locator problem
(`e2e/sales-agent-setup.spec.ts:28-40`), the `E2E_BASE_URL`/`E2E_EMAIL`/`E2E_PASSWORD`/
`E2E_TENANT` env vars (`:16-19`), and the re-runnable idempotency requirement (`:12-13`).
Per the SPEC, writing NEW skills is a separate decision.

[Done 2026-07-31 — human-approved as envelope-drift post-loop item 5:
`skills/playwright/SKILL.md` (first-party, every claim cited),
registered in `.atl/skill-registry.md` (a LOCAL, gitignored index — shipped
discoverability is `skills/` itself plus the `AGENTS.md:103` list).]

## Change: envelope contract drift closed in code (envelope-drift)

Manual-loop change that took the nine numbered T07 findings the docs-consistency loop
RECORDED (it fixed docs only) and closed them in CODE, one commit per task, each with a
regression test that fails on the old behaviour. Eight of the nine are now fixed; finding
8 (tier wiring) stands deferred by decision 4 as a design change rather than drift.
[Updated 2026-07-31 — finding 8 ADJUDICATED in post-loop item 6 (human-decided):
not drift, the docs were accurate. The tier direction is formalized as
`DOCS/v_next/tenant-messaging-tiers.md` under a new FUTURE doc class
(`DOCS/v_next/README.md`) with 5 numbered prerequisites. The investigation did
surface a real latent bug, now fixed: `INGRESS-<TENANT>` had TWO creators with
different configs (flat 256 MiB vs free-tier 1 GiB + 1 MiB msg cap), decided by
whichever service touched a new tenant first; agent-admin and agent-memory now
delegate to `ensureTenantIngressStream`, the single creator. This is the only
post-loop item that changed production code.] Full
queue, gates, decisions and the per-finding code-fix log:
`manual-loops/messaging/envelope-drift.md` and the appended log in
`manual-loops/architecture/docs-consistency.md` (dated 2026-07-31).

What changed, by task: T01 consumer JSDoc now matches its constants (`60_000` /
`[60s, 120s, 300s, 600s]`) with a constant pin; T02 `DepthTrackerService` enforces strict
`>` against the shared `MAX_DEPTH_BY_CATEGORY` instead of a local `>= 5`; T03 the console's
hand-maintained durable registry names the real `channel-audit`; T04
`envelope-schema.json` rewritten from the real interfaces (adds `http`, models
`WebhookIngressEnvelope`, stops requiring `accountid` on stage 1) and pinned against typed
fixtures by a hand-rolled validator, since the repo has no JSON-schema validator; T05
stage-1 `type` obeys the prescriptive per-channel format; T06 the webhook allowlist moved
from an untyped `transport` spread to a typed `data.headers`; T07 `buildIngressStreamName`
deleted so one builder names INGRESS streams; T08 agent-memory subject constants moved to
`packages/shared` and its envelope `domain` aligned with its subject; T09 this docs sweep.

Findings that only surfaced during implementation:
- **`transport.headers` never reached the wire.** The T07 finding described a live
  untyped field, but the `webhookHeaders` option had NO caller — `ingress.service.ts`
  never passed it, and channel-service consumes the stage-1 allowlist only for signature
  verification. The fix closed a type hole (a probe key on `transport` now fails `tsc`
  with TS2353) with zero wire impact. The stage-2 example in `envelope.md` §10.2 is
  therefore aspirational until a caller forwards the allowlist.

  [Updated 2026-07-31 — a caller now does. Post-loop item 3 threads the stage-1
  allowlist through `WebhookIngressService.scheduleIngress` and
  `IngressService.processInbound` into `createChannelEnvelope`, so
  webhook-derived stage-2 envelopes carry `data.headers` and the §10.2 example
  is as-built. Still one filtering point (api-gateway); channel-service
  forwards verbatim.]

  [Updated 2026-08-01 — no longer verbatim: the ledger's five open decisions
  all RESOLVED in their own human-approved rounds. Channel-service now strips
  the verification-secret subset (`WEBHOOK_SECRET_HEADERS`) after the
  signature check, so stage-2 `data.headers` carries only non-secret entries
  (two filtering points — 1ef4866c). Same day: `PLATFORM_DOMAIN` →
  `AUTOMATION_DOMAIN` (9c5d77d4), dead `AGENT_ADMIN_ONLINE` deleted +
  scheduler heartbeat envelope de-hardcoded (d7d1d86e), and
  `AGENT_ADMIN_SKILL_CHANGED` relocated to shared (4b2a10c2). Per-decision
  detail: the RESOLVED blocks in `manual-loops/messaging/envelope-drift.md`.]
- **The tracking-ingester classifies by SUBJECT only.** T05's brief assumed
  `classify.ts` matched the stage-1 `type` literal and asked for extended rules plus new
  golden rows and three K9b pin updates. It does not: `classify(subject, options)` takes a
  subject and every call site passes `msg.subject`. No rule, golden row or pin needed
  changing; the invariant is now pinned instead by
  `services/tracking-ingester-service/test/stage1-type-migration.spec.ts`, which proves
  old- and new-type envelopes on one subject produce identical rows.
- **NEW, still open: agent-memory `producer` mismatch.** The same envelope T08 fixed sets
  `producer: PLATFORM_PRODUCER` (`agent-admin-service`) while its subject's producer token
  is `agent-memory-service` — the identical defect one field over. Left for its own
  consumer sweep rather than folded in silently.

  [Fixed 2026-07-31 — human-authorised post-loop follow-up after an
  investigation-only pass; see `manual-loops/messaging/envelope-drift.md`
  Progress and `manual-loops/architecture/docs-consistency.md` finding 6, now
  FIXED. Root cause for this AND the T08 domain half: the publisher was renamed
  out of the admin service at 61% similarity (`R061` in `e9e3a94b`), which
  rewrote the subject and `transport.agent_id` but not the envelope identity
  fields. The consumer sweep was clean. Two findings from that investigation
  remain OPEN: the agent-memory `type` grammar plus the inherited
  `accountid: "platform-admin"`, and the `PLATFORM_*` naming trap.]

  [Updated 2026-07-31 — the first of those two is DONE (envelope-drift SPEC
  post-loop item 1): the `type` now obeys `envelope.md:77` as
  `io.yoizen.agent-memory.platform.internal.<kind>.v1`, projected from the
  subject constant so the two cannot drift; and `accountid: "platform-admin"`
  was ruled KEEP — it is the shared sentinel every internal `platform`/
  `internal` producer uses (agent-admin, agent-scheduler, agent-memory), not an
  inheritance artifact. Only the `PLATFORM_*` naming trap remains OPEN.]

Two cross-cutting mechanics worth reusing: accept-gate greps like
`rg "webhook.received.v1"` treat `.` as a wildcard and match the CORRECT token too, so
regression tests that must assert a removed literal's absence assemble it
(`["build","Ingress","Stream","Name"].join("")`) rather than spelling it; and the Biome
format-on-edit hook rewrites whole files, so edits to formatter-dirty files were applied
by script to keep diffs surgical and doc-cited line anchors stable.

Commits: `971ad0c3` (T01), `e0c2e42f` (T02), `5db90ac5` (T03), `910f55fc` (T04),
`519594b8` (T05), `ab36a970` (T06), `9b6dd4e3` (T07), `1f6fc4cd` (T08).

- **Engram topic**: `messaging/envelope-drift`.

## Overall status

- **Full traceability shipped and committed** (`6292520` + earlier): root ingress fix, persistence in `audit` + `channel_events` + `gateway_audit_events`, endpoints `GET /audit/events/chain/:correlationId` and `GET /audit/channel-events/chain/:correlationId`.
- Validated on **OrbStack (macOS)** and **minikube (Linux)**. One-command startup: `scripts/orbstack/startup.sh` or `scripts/minikube/startup.sh`.
- Only pending item: optional minor `traceability-depth-and-traceid` (`>=`/`>` adjustment in depth-tracker + D9 traceid).
- Uncommitted: `.mcp.json`, `.cbmignore`, `.sdd/changes/` (SDD artifacts), `cowork/` (these docs).

## 2026-09-05: Engineering workflow documentation alignment

Local documentation maintenance; not a deployment or a fresh runtime audit.
Canonical workflow entry points now link AGENTS.md, manual-loop, templates,
the historical loop inventory and the separate PENDIENTES working register.
The legacy build-console command forwards to manual-loop with an explicit SPEC.
Guard documentation describes KISS as default and records CI coverage limits.
Verification and review status: [operating-docs-alignment](../../manual-loops/architecture/operating-docs-alignment.md).

## 2026-09-05: Dev-mode canary preservation

The validator's local canary cleanup uses ownership-aware snapshots rather than
Git restoration. Isolated regressions cover failed preflight and restoration
failure behavior. The development guide and templates describe the recovery
limits and the separate live OrbStack acceptance cycle.
Evidence and live-checkpoint status: [dev-mode-canary-preservation](../../manual-loops/architecture/dev-mode-canary-preservation.md).

## 2026-09-05: Workflow-service offline conformance baseline

Diagnostic audit only; no service fixes or deployment. Existing unit tests,
typecheck and KISS passed. The report records six source-backed findings and
separates them from unverified live integration behavior.
Report: [workflow-service conformance](../architecture/workflow-service-conformance.md).
Evidence and review status: [audit SPEC](../../manual-loops/architecture/workflow-service-conformance-audit.md).

## Change: FP delivery integration (2026-09-05)

The repository now documents the current manual-loop integration for a single
principal, optional FP architecture advice, economical development/QA, developer
regression tests, post-implementation QA, all gates before review, and two
independent capable reviewers. The current contract is
[manual-loop-fp-delivery.md](../guides/manual-loop-fp-delivery.md). The original
future proposal remains at
[v_next/manual-loop-fp-delivery.md](../v_next/manual-loop-fp-delivery.md) with
its superseded status. Configuration validation is provided by
[`scripts/checks/check-fp-delivery.py`](../../scripts/checks/check-fp-delivery.py);
live provider execution is recorded separately from configured model selection.


## 2026-09-06 — Tool configuration and documentation standardization

The [standardization SPEC](../../manual-loops/architecture/tool-docs-standardization.md)
records scope, validation, independent reviews, and any remaining execution evidence.
The shared [manual-loop procedure](../guides/manual-loop.md) and
[delivery role contracts](../guides/agent-roles.md) replace duplicated tool-specific
rules. Local configuration inherits active global choices by default and contains
only intentional project tuning. The [documentation index](../README.md) now
provides concise navigation to canonical sources.

The [former index snapshot](documentation-index-2026-09-06.md) and
[FP delivery proposal snapshot](fp-delivery-proposal-2026-09-05.md) preserve the
complete pre-consolidation sources. These snapshots are historical evidence,
not current execution instructions or proof of a live provider run.

## 2026-09-07 — Codex manual-loop configuration repair (pending)

The approved repair adds standalone project-local Codex role definitions, exact
pin validation, a SHA-256 drift lock, and G19 guard integration. The configuration
is installed, and fresh native sessions loaded all five roles with matching
observed model provenance. Final QA, the six repair gates, and two independent
reviews remain pending; this row does not mark the repair complete. Procedure and
current evidence boundaries are documented in the
[Codex manual-loop guide](../guides/codex-manual-loop.md) and
[repair SPEC](../../manual-loops/architecture/codex-manual-loop-repair.md).

## 2026-09-08 — Blocker handoff diagnosis

Future BLOCKED records lead with a short `For humans` section, the implementer's
cause and candidate fixes, and then full evidence; non-causal execution exceptions
are labeled separately. The handoff remains analysis only and creates no retry,
attempt, budget, or continuation SPEC. The `fp-dev` role update used dedicated
human-approved configuration scope, changed one SHA-256 lock entry, and takes
effect only in a fresh Codex session. At publication, T01-T04 were validated and
T05 gates and reviews were pending; the SPEC records current status. Decision and
current evidence:
[blocker-handoff diagnosis SPEC](../../manual-loops/architecture/blocker-handoff-diagnosis.md).

- **Engram topic**: `manual-loop/blocker-handoff` (durable repository record;
  no memory tool was available).
