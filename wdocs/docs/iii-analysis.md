# iii.dev vs platform-cluster — comparison and applicability (Pass 1)

> **Status:** draft for review. Pass 1 (this doc) frames the comparison and lists candidate ideas; Pass 2 will turn the accepted ideas into a concrete adoption proposal. Not committed — sitting untracked on `features/refactor-agents-ui` for review.

## 1. Executive summary

[iii.dev](https://iii.dev/) is a polyglot distributed execution platform: a **worker** is the unit of work, the engine handles durable orchestration, and the model exposes a small set of primitives — KV state, named queues, WebSocket streams, HTTP/event/cron/websocket triggers, OTel tracing — over a single WebSocket protocol. "Three primitives. Zero integration cost." Agents are workers; nothing more, nothing less.

**Yoizen platform-cluster, productised**, is a multi-tenant agent and workflow platform on Kubernetes (Knative + Kourier), with NATS JetStream as the event spine, Temporal as the durable orchestrator, Redis as cache, and a dedicated PostgreSQL StatefulSet per tenant. YoizenClaw is the AI-agent layer (admin-service + per-tenant runtime + runtime-gateway), executed from `workflow-service` workflows via `agentCall`. Multi-tenant **isolation** is the product moat, not just execution.

**The 2–3 highest-leverage iii ideas worth borrowing:**

1. **Worker-as-tenant-extension** — let tenants register their own polyglot functions and call them from workflows without you deploying a Knative service per customer. This is the single most differentiating idea.
2. **Workers-and-agents unification** — `agentCall`, `serviceCall`, `endpointCall` and a future `workerCall` are all variants of "invoke a registered function". Collapse them in the workflow action model and the docs.
3. **Unified tenant developer console** — one tenant-scoped surface showing workers/triggers/queues/state/traces/logs (you already have most pieces; what's missing is the integration into one console).

**What NOT to borrow:** iii's always-on worker connections as the only execution model (kills your scale-to-zero economics); iii's KV/queue primitives (yours are better and tenancy-aware); iii itself as a runtime dependency (too early, no multi-tenant story).

Pass 2 will turn ideas 1–3 (and possibly 4–5 below) into a phased adoption proposal with file paths, service changes, and rollout risks — pending your validation of this framing.

## 2. Side-by-side primitives

| Primitive | iii.dev | platform-cluster |
|-----------|---------|------------------|
| Unit of execution | **Worker** — always-connected WebSocket client, any language, registers named functions | Knative Service (e.g. `connector-runtime`), Temporal activity (`endpointCall`, `serviceCall`, `jsFunction`, `serviceBusCall`), or per-tenant `yoizenclaw-runtime` invoked via `agentCall` |
| Durable orchestration | Built-in engine (specifics not on the marketing page) | Temporal cluster + `workflow-service` API + `http-adapter` task queue worker (KEDA-scaled) |
| HTTP trigger | First-class | `api-gateway` `POST /events` + dynamic routing to tenant Knative services |
| Event trigger | First-class | NATS JetStream `EVENTS`/`RESULTS`/`DLQ` streams + trigger consumers |
| Cron trigger | First-class | Not first-class — would need a new scheduler service |
| WebSocket trigger | First-class | Not first-class — `channel-service` handles inbound webhooks but not raw WS triggers |
| State / KV | Built-in KV | Redis 7 (cache, no persistence) + dedicated PostgreSQL StatefulSet per tenant |
| Queues | Named queues with backpressure + retries | NATS JetStream streams + consumers (`max_deliver`, DLQ, 7-day retention) |
| Streams | WebSocket | `api-gateway` SSE on `/events/stream` |
| Tracing | OpenTelemetry over gRPC, cross-language | `@yoizen/observability` package (OTel-based) |
| Multi-tenancy | Not surfaced on the marketing page | First-class: namespace per tenant, dedicated Postgres StatefulSet, JWT `tenant:<name>` scope, NATS subject prefix, Redis key prefix, per-tenant Knative runtime |
| Polyglot for *platform code* | TS, Rust, Python, Go SDKs out of the box | TS+Bun on every platform service; Python only on `yoizenclaw-runtime` |
| Polyglot for *customer code* | Yes — same SDK story | No first-class path today |
| Agent model | "Agents are just workers — same protocol, same trace, same engine" | Dedicated layer: `yoizenclaw-admin-service` for authoring, `yoizenclaw-runtime-gateway` as stateless bridge, per-tenant `yoizenclaw-runtime` Knative Service |
| Authoring UI | "Developer Console" (unified) | `admin-console` (Angular) + workflow editor (Foblex Flow) + agent CRUD + playground; separate `audit-service` query; `messaging-console` in flight |
| Deployment model | Always-connected WebSocket workers | Knative scale-to-zero services + per-tenant runtime auto-provisioned by `tenant-service` |
| Install | `curl -fsSL install.sh | sh` (self-host) | `bootstrap-orbstack.sh` / `bootstrap.sh` per environment + tenant provisioning API |
| License / pricing | Open-source GitHub, no pricing stated | Proprietary, productisation TBD |

## 3. Concept mapping (iii → platform-cluster)

- **iii worker** ↔ **`connector-runtime` + `agentCall` + `serviceCall` + `jsFunction`**. iii collapses these into one execution primitive; you have four (soon five with `branch`) explicit action types in `workflow-service`. The semantic union is the same: "invoke a named function with args and get a result back". iii is just simpler at the cost of being multi-tenancy-blind.
- **iii triggers (HTTP/event/cron/websocket)** ↔ **`api-gateway` + NATS JetStream consumers + `channel-service` inbound webhooks**. You match HTTP and event natively. Cron and raw websocket are gaps.
- **iii KV state** ↔ **Redis + per-tenant PostgreSQL**. Your durability and tenancy are stronger; iii's API surface is simpler. Different trade-offs, neither strictly better.
- **iii named queues** ↔ **NATS JetStream streams + consumers**. Yours are stronger (durable, replayable, DLQ-aware, per-tenant subjects). No reason to swap.
- **iii WebSocket streams** ↔ **api-gateway SSE on `/events/stream`**. Comparable functionality with different transport.
- **iii OTel tracing** ↔ **`@yoizen/observability`**. Same idea, same protocol.
- **iii unified console** ↔ **admin-console (Angular) + audit query + playground + workflow editor**. Functionally you have most of the surface; you don't have it integrated into one panel per tenant.

## 4. Multi-tenancy gap analysis

iii.dev's marketing page never mentions tenants. For your productised offering, **tenant isolation is the moat** — customers buy isolation, not just execution. This is where iii's model is weakest and where your platform is strongest.

What "tenant" means in your stack today (concrete checklist, traceable to `DOCS/01-ARCHITECTURE.md` and `DOCS/02-INFRASTRUCTURE.md`):

- Kubernetes namespace `<tenant>-<env>-ns` with discovery labels.
- Dedicated PostgreSQL StatefulSet (per-tenant schema, no shared rows).
- Per-tenant `yoizenclaw-runtime` Knative Service auto-provisioned by `tenant-service`.
- JWT scope `tenant:<name>` enforced by `AuthGuard` + `TenantGuard` on every request.
- NATS subjects prefixed per tenant (`events.<tenant>.*`, etc).
- Redis key prefix per tenant.
- Per-tenant rate limits in `api-gateway`.
- Audit events persisted to the tenant's own Postgres via `audit-service`.

For an iii-style "worker" overlay to live inside your platform, each of these has to hold:

| Concern | Where iii needs work | Verdict |
|---------|----------------------|---------|
| Per-tenant worker namespacing | Workers must be addressable as `<tenant>/<worker>/<function>`, not globally | iii could add this; not architectural |
| Per-tenant queue partitioning | Named queues must scope to a tenant | iii could add this |
| Per-tenant state isolation | KV must not leak across tenants | iii could add this with prefixes — but durability tier is weaker than your Postgres |
| Per-tenant trace filtering | OTel exporters or console views filtered by tenant | iii could add this |
| Per-tenant rate limits | Worker invocation budgeting per tenant | iii could add this |
| Per-tenant runtime isolation (process / network) | Today every tenant has its own `yoizenclaw-runtime` pod | iii's always-connected workers don't map cleanly — you'd need a bridge that does namespace-by-tenant on connection metadata |
| Audit + billing | Per-tenant audit trail and usage aggregation | Not in iii at all |

**Implication:** you should treat iii's model as inspiration, not a dependency. Borrow the worker abstraction; keep your tenancy boundaries.

## 5. Deployment model: always-on vs scale-to-zero

The deepest architectural tension between the two systems.

- **iii**: workers are always connected to the engine over a WebSocket. Cheap iteration, instant invocation (no cold start), but every worker consumes resources continuously.
- **platform-cluster**: every platform service and every per-tenant `yoizenclaw-runtime` runs on Knative, which scales to zero when idle. The Knative pod terminates after inactivity; the next request triggers a cold start (sub-second to a few seconds). Zero-traffic tenants cost effectively nothing.

The economics of multi-tenancy at scale depend on scale-to-zero. If you have 1000 tenants and 950 are idle on a given hour, Knative serves them at near-zero cost. A naive port of iii's always-on worker model would force every tenant's workers to be continuously connected, which inverts the cost curve.

**Resolution:** if you adopt the worker abstraction, the bridge service must be the always-on component (shared across all tenants), and individual tenant workers must remain scale-to-zero — connecting on-demand when a workflow needs them. This is the single most important architectural decision for Pass 2.

## 6. Polyglot story

- **Today:** the platform itself is TS+Bun-uniform. Adding a new platform service in another language means a new Knative service, a new Dockerfile, new observability wiring, new auth wiring. `yoizenclaw-runtime` is the exception (Python). For *customer* code, today there is no first-class story: customers can author `jsFunction` inline JS in workflows, or call out via `endpointCall` to their own external HTTP services. They can't run their own Python or Rust function inside your platform.
- **iii's pitch:** any language, one protocol. Workers in TS, Rust, Python, Go register functions; any caller invokes them transparently with OTel context propagated.
- **What it would take here:** a worker SDK in each supported language + a `worker-bridge` service that brokers invocations. The SDK speaks NATS to the bridge (no need to invent iii's WebSocket protocol — your event bus is already strong), the bridge enforces tenancy, and `workflow-service` gains a `workerCall` action that targets `<tenant>/<worker>/<function>`. This is the most directly portable iii idea, and the foundation for productisation as a developer platform.

## 7. Observability / unified console

You already have most of the pieces. What you don't have is integration.

| Piece | Where today |
|-------|-------------|
| Agent CRUD UI | `admin-console` (Angular) — agents page |
| Workflow editor | `admin-console` (Foblex Flow drag-and-drop) |
| Playground for test execution | `admin-console` |
| Per-agent runtime sync indicator | `admin-console` (added recently) |
| Audit / event log query | `audit-service` REST API (no integrated UI) |
| Traces | `@yoizen/observability` (OTel, no integrated viewer) |
| Logs | Per-pod via `kubectl logs` |
| Queue depth / consumer lag | NATS monitoring, no UI |
| State inspection (Redis / Postgres) | None |

A "unified tenant console" would surface all of the above on one tenant-scoped surface. Some of this is real engineering (audit query UI, trace viewer); some is just routing existing data to one page. Worth scoping in Pass 2.

## 8. Maturity and risk

iii is early-stage: open-source on GitHub (`iii-hq/iii`), install via curl, no pricing surfaced, no enterprise references on the page, no explicit multi-tenant story. This is fine for an internal experiment, dangerous for a production multi-tenant SaaS.

Two postures, with my recommendation:

| Posture | Description | Risk | Recommended for |
|---------|-------------|------|-----------------|
| **A. Port the ideas** | Borrow the worker abstraction, build it on your existing stack (NATS + Temporal + Knative + tenant model) | Low — you control the surface and tenancy | **Production multi-tenant productisation** |
| **B. Adopt iii as a dependency** | Run iii inside the cluster, hand workflows off to it | High — coupling production to an early-stage runtime with unproven multi-tenancy | Internal R&D only, off the critical path |

**Recommendation: posture A.** Pass 2's adoption proposal assumes A unless you push back.

## 9. Prioritised candidate ideas

Each gets one line of description, why it's leverage, what it would touch, and a rough size. **L** = months of work, **M** = weeks, **S** = days.

1. **Worker-as-tenant-extension (L).** Tenants register their own polyglot functions, callable from workflows, no per-customer Knative service. Why: differentiates against pure-workflow products (n8n, Make) and pure-runtime products (Temporal Cloud); the natural extension of your existing workflow + agent model. Touches: new `worker-bridge` service, `packages/sdk-ts` and `packages/sdk-python`, a `workerCall` action in `workflow-service`, registry tables in `connector-admin` (or a new `worker-admin`), tenant scope plumbing.
2. **Workers-and-agents unification (M).** `agentCall`, `serviceCall`, `endpointCall`, and the future `workerCall` are variants of "invoke a registered named function". Why: simpler mental model for the product, simpler docs, fewer concepts to teach. Touches: `workflow-service` action dispatch + types, `yoizenclaw-runtime` invocation contract, `DOCS/04-WORKFLOW-ENGINE.md` and `DOCS/05-AGENT-EXECUTION-FLOW.md`.
3. **First-class cron and websocket triggers (M).** Currently triggers are HTTP and NATS events; cron and raw WS are gaps. Why: completes the trigger matrix and unlocks scheduled-job and real-time integration use cases without bolt-ons. Touches: a new `scheduler-service` (or extension to `workflow-service`), `api-gateway` for WS upgrade, NATS trigger consumers.
4. **Unified tenant developer console (M–L).** One tenant-scoped surface in `admin-console` (or `messaging-console`) showing workers/triggers/queues/state/traces/logs. Why: closes the observability gap; the "wow" demo when selling the product. Touches: `admin-console` UI, `audit-service` query extensions, OTel surfacing, NATS monitoring proxy.
5. **Polyglot worker SDK (M–L).** TS + Python SDKs first; Rust + Go later. SDKs register functions over your existing NATS bus rather than inventing iii's WebSocket protocol — leverages tenancy you already have. Why: the lever that makes (1) real. Touches: `packages/sdk-ts`, `packages/sdk-python`, examples repo, documentation.

## 10. What NOT to borrow

- **Always-on worker connections as the only execution model.** Breaks Knative scale-to-zero economics and the per-tenant runtime model that lets idle tenants cost ~nothing. Use always-on only for the shared bridge service.
- **iii's KV state and named queues as replacements.** Yours are tenancy-aware, durable, and already in production. iii's primitives are simpler but weaker for your needs.
- **iii as a runtime dependency.** Too early, no multi-tenant story, no SLA. Inspiration only.
- **The "three primitives" marketing framing.** Your value prop is bigger: tenant isolation, agent runtime, workflow engine, channel ingress, audit, usage aggregation. Selling "three primitives" undersells the platform.
- **A separate developer protocol (WebSocket gRPC mix).** You already have NATS + HTTP + SSE. Adding a new transport for workers would multiply surface area without adding capability.

## 11. Open questions for Pass 2

Pass 2's shape depends on your answers to these:

1. **Customer-authored polyglot code** — is "tenants run their own Python/Rust functions" a real product requirement, or is "tenants compose pre-built functions you wrote" enough for the GTM you're targeting? This decides whether ideas 1 and 5 (SDK + worker-as-extension) are top priority or backlog.
2. **Audience** — platform engineers (who want to write code), business operators (who want a no-code workflow editor + ready-made agents), or both? This shapes how aggressive idea 4 (unified console) needs to be.
3. **GTM time horizon** — Pass 2 sized for a 3-month MVP, a 6–9 month V1, or an 18-month roadmap?
4. **Existing customers' lock-in** — anyone currently authoring agents or wiring Telegram channels who must not see breaking changes? This decides whether idea 2 (workers/agents unification) can rename the action types or must keep them as aliases.
5. **Open-source posture** — do the worker SDKs ship open-source (like iii does) to drive adoption, or stay proprietary? Affects packaging, examples, docs.

Once you answer these, Pass 2 becomes a concrete proposal: file paths, services to add/change, sequence, rollout risks, migration story for existing tenants.

---

**Next step:** read this and reply with one of:

- "Framing looks right — write Pass 2" → I draft the adoption proposal.
- "Framing is off on X" → I revise this doc.
- "Stop here, this is enough" → we keep this as reference and don't write Pass 2.
