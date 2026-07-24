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

## Change: crm-support-telegram demo — declarative manifest migration + docs (crm-support-telegram)

Manual-loop change (not SDD) retaking the `demos/crm-support-telegram` commercial showcase
(end-to-end Telegram customer support backed by a real HubSpot CRM, an AI agent, and the
`priority-scorer` hosted service demonstrating both sync and async `connectors.invoke()` modes)
and migrating its provisioning from five sequential setup scripts to a single declarative
`manifest.yaml` applied via `yoizen manifests apply --secrets-from-env` — the same end-state
`integrations/channels/telegram-transform-reply` reached first. Full task queue, gates, and human
decisions: `manual-loops/crm-support-telegram.md`. Engram topic:
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
  registration) survive as scripts — `manual-loops/crm-support-telegram.md` user decisions 2-4.
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

## Overall status

- **Full traceability shipped and committed** (`6292520` + earlier): root ingress fix, persistence in `audit` + `channel_events` + `gateway_audit_events`, endpoints `GET /audit/events/chain/:correlationId` and `GET /audit/channel-events/chain/:correlationId`.
- Validated on **OrbStack (macOS)** and **minikube (Linux)**. One-command startup: `scripts/orbstack/startup.sh` or `scripts/minikube/startup.sh`.
- Only pending item: optional minor `traceability-depth-and-traceid` (`>=`/`>` adjustment in depth-tracker + D9 traceid).
- Uncommitted: `.mcp.json`, `.cbmignore`, `.sdd/changes/` (SDD artifacts), `cowork/` (these docs).
