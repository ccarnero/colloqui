# Architecture Decision Log

Class: register
Summary: Live register of cross-cutting closed decisions, open points, milestones and the messaging-bus migration record; rows are amended in place, unlike the frozen ADRs in DOCS/adr/.

> This file captures cross-cutting closed decisions, open points, milestones, and
> the historical migration record for the messaging bus.
> Granular, single-topic decision records live in [`../adr/`](../adr/).

**Status:** Operational reference
**Last updated:** 2026-07-30

---

## This log vs. `DOCS/adr/`

Two channels, one rule for choosing between them:

| | This log (`D<n>` / `O<n>` / `M<n>`) | `DOCS/adr/<topic>.md` |
|---|---|---|
| Granularity | One table ROW per decision — a single line, cross-referenced to the document that specifies it | One FILE per decision, with its own context, rationale, tradeoff and mitigation |
| Scope | Cross-cutting decisions that constrain several documents or services at once, mostly bus/messaging | A single topic, usually one service boundary or one subsystem |
| Identifier | `D<n>` is the stable handle; cite it in code comments and PRs | The filename is the handle; there is no number |
| Lifecycle | Rows are amended in place as status changes (`Implemented`, `Superseded`, …) | The decision body is immutable once recorded; later reality goes in a "Later observations" section |

**The two numbering schemes are independent.** A `D<n>` is not an ADR index and
an ADR file does not consume a `D` number. Most ADRs have no corresponding
`D<n>` at all; where one exists, both sides link to each other explicitly.

### Current ADR files

| ADR | Corresponding decision-log entry |
|---|---|
| [`../adr/connector-runtime-separation.md`](../adr/connector-runtime-separation.md) | none |
| [`../adr/tenant-postgres-model.md`](../adr/tenant-postgres-model.md) | none — closest context is the [Historical migration](#historical-single-tenant--multi-tenant-migration) data-isolation row |
| [`../adr/temporal-and-nats.md`](../adr/temporal-and-nats.md) | **D2** (adjacent, narrower — see below), topology governed by **D5** |
| [`../v_next/agent-architecture-improvements.md`](../v_next/agent-architecture-improvements.md) | none — moved out of `adr/` to `v_next/` by the docs-truth-audit T10 (ruling O5): `status: proposed`, nothing shipped, so it is a future design rather than a decision record |
| [`../adr/rag-system.md`](../adr/rag-system.md) | none |
| [`../adr/variable-system.md`](../adr/variable-system.md) | none |

The first three were extracted from `DOCS/guides/onboarding.md` on 2026-07-30
so that architecture decisions have exactly one home
(`manual-loops/architecture/docs-consistency.md` T05).

### Convention for new ADRs

Filename is a kebab-case topic slug with no numeric or date prefix, matching the
files already in `../adr/`. The body opens with YAML frontmatter
(`status`, `date`, `decision-makers`, `consulted`, `informed`) as in
`agent-architecture-improvements.md`, followed by an `# ADR: <Title>` heading as
in `rag-system.md` and `variable-system.md`. If the decision maps to a `D<n>`,
name it in the ADR header and add the row to the table above.

---

## Closed Decisions

These decisions are final and apply across all bus/messaging documents.

| # | Decision | Document | Status |
|---|---|---|---|
| D1 | Generic envelope + raw payload kept intact | messaging/envelope | Implemented |
| D2 | JetStream, not Core NATS | messaging/service-bus | Implemented — broader context in [`../adr/temporal-and-nats.md`](../adr/temporal-and-nats.md) |
| D3 | 1 event per raw POST received (no splitting) | messaging/envelope | Implemented |
| D4 | Routing by NATS subject, not by body fields | messaging/envelope | Implemented |
| D5 | One stream per tenant with explicit limits | messaging/service-bus | Implemented — topology consequence of [`../adr/temporal-and-nats.md`](../adr/temporal-and-nats.md) |
| D6 | Full raw + per-tenant ACL for PII | security | Implemented (ACLs pending) |
| D7 | Initial shadow publish — replaced by primary path | messaging/service-bus | Superseded: NATS is the primary path |
| D8 | Explicit allowlist of HTTP headers | messaging/envelope | Implemented (7 headers; see `WEBHOOK_FORWARDED_HEADERS`). Extended 2026-08-01: the verification-secret subset (`WEBHOOK_SECRET_HEADERS`) is stripped after the stage-1 signature check, so stage-2 `data.headers` never carries a secret |
| D9 | `traceid` in the envelope | messaging/envelope | Implemented (`activeOrRandomTraceId` via `@yoizen/observability`) |
| D10 | Rename field `subject` to `resource` in the envelope | messaging/envelope | Implemented |
| D11 | `causation_id` and `correlation_id` in the envelope | messaging/envelope | Implemented |
| D12 | Anti-loop mechanism with `depth` for agents | messaging/ingress | Partially implemented (see messaging/envelope §6.3) |
| D13 | Claim-Check pattern for large payloads | messaging/claim-check | Implemented |
| D14 | NATS Object Store as initial claim-check store | messaging/claim-check | Implemented |
| D15 | 256 KB threshold to activate claim-check | messaging/claim-check | Implemented (`CLAIM_CHECK_THRESHOLD_BYTES`) |
| D16 | Server `max_payload` stays at 1 MB (default) | messaging/claim-check | Implemented |
| D17 | Three agent categories: internal, third-party, platform | messaging/ingress | Partially implemented |

---

## Open Points

Points marked **Resolved** are closed in code. All others remain pending.

| # | Topic | Owner | Document | Status |
|---|---|---|---|---|
| O1 | Define NATS accounts structure (1 per tenant vs 1 per env with ACLs) | Infra | messaging/service-bus | Pending |
| O2 | Automate tenant provisioning | Infra + Dev | messaging/service-bus | **Resolved** (3 layers: tenant-service, lazy publishers, agent-ai-service self-healing) |
| O3 | Header allowlist by provider | Dev | messaging/envelope | **Resolved** (7 headers in `WEBHOOK_FORWARDED_HEADERS`, `packages/shared/src/channel.constants.ts`) |
| O4 | `correlation_id` scheme (format, generator, propagation) | Dev | messaging/envelope | **Resolved** (`correlation_id` defaults to the envelope's own `id`; propagated unchanged in `deriveEnvelope`) |
| O5 | Evaluate whether `provider` should be optional for single-provider channels | Dev | messaging/envelope | Pending |
| O6 | Define transport contract for polling-based providers | Dev | messaging/envelope | Pending |
| O7 | Define Agent Cards format for capability discovery | Dev | messaging/ingress | Pending |
| O8 | Evaluate MCP server as publish interface for internal agents | Dev | messaging/ingress | Pending |
| O9 | Design API gateway for third-party agents | Dev + Infra | messaging/ingress | Pending |
| O10 | Define onboarding process for third-party agents | Dev + Product | messaging/ingress | Pending |
| O11 | Define integrations with AI platform providers | Dev | messaging/ingress | Pending |
| O12 | Evaluate A2A as multi-agent coordination protocol | Dev | messaging/ingress | Pending |
| O13 | Define max bucket size per tier | Infra | messaging/claim-check | **Resolved** (512 MB default, `CLAIM_CHECK_BUCKET_MAX_BYTES`) |
| O14 | Evaluate payload compression before store | Dev | messaging/claim-check | Pending |
| O15 | Define retry policy for Object Store write failures | Dev | messaging/claim-check | Pending |
| O16 | Define JetStream encryption at rest configuration | Infra | security | Pending |
| O17 | Define API key rotation policy for third-party agents | Infra + Security | security | Pending |
| O18 | Evaluate immediate revocation mechanism for third-party agents | Infra | security | Pending |
| O19 | Define PII redaction strategy if compliance requirements change | Dev + Legal | security | Pending |
| O20 | Define monitoring dashboard for streams | Infra | observability | Pending |
| O21 | Define dead-letter strategy for failed validations | Dev | observability | Partially resolved (DLQ-<tenant> exists; see messaging/service-bus "DLQ Lifecycle" — that document has named headings, not numbered sections) |
| O22 | Support MCP as an outbound tool source (agents/workflows consume external MCP servers) | Dev | architecture/mcp-connections | **Resolved** (commit c4da71a) — distinct from O8/M2 below, which is the *inverse* direction (an internal MCP server as a publish interface for other agents); that idea remains pending |

---

## Milestone Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M1 | External ingress to the bus as the primary path (Telegram, generic HTTP) | **Completed** |
| M2 | Internal agents publish to the bus via MCP server | Pending |
| M3 | Platform agents via direct integrations | In progress |
| M4 | Third-party agents via API gateway + marketplace | Pending |
| M5 | Evaluate A2A for multi-agent coordination | Pending |

---

## Historical: Single-Tenant → Multi-Tenant Migration

> **Status: completed** — the platform is multi-tenant by current design.

This section summarizes the transition from the original single-tenant monorepo
("Coexistance") to the current multi-tenant platform (Yoizen Platform). The migration is
complete; this is historical context.

### What Changed

| Aspect | Previous System | Current System |
|---|---|---|
| Platform | Express monorepo + MongoDB | NestJS microservices + Kubernetes |
| Data isolation | `tenant` field in shared MongoDB collections | Per-tenant PostgreSQL: shared CNPG (tier `shared`) or dedicated StatefulSet (tier `dedicated`) — recorded in [`../adr/tenant-postgres-model.md`](../adr/tenant-postgres-model.md) |
| Event bus | NATS Core (at-most-once) | NATS JetStream with per-tenant streams |
| Tenant resolution | Subdomain `acme.coexistance.io` or header `x-tenant-id` | Hostname `acme.dev.local` (OrbStack) or header `x-yoizen-tenant` |
| Provisioning | Manual / seed script | Automatic via `tenant-service` + Kubernetes API |
| Auth | JWT with `tenant` field in payload | JWT with `scope: "tenant:<name>"` or `"platform"` |

### New Tenant Onboarding Flow (Current)

```
POST /tenants { "name": "acme" }
  → api-gateway proxy → tenant-service
  → creates K8s namespace: acme-dev-ns
  → provisions PostgreSQL (shared CNPG logical DB for shared tier;
                            StatefulSet for dedicated tier)
  → creates NATS streams: INGRESS-ACME, DLQ-ACME, PAYLOAD-ACME
  → returns { name: "acme", status: "active", postgresHost: "..." }
```

Convenience script: `setup-tenant.sh` (repo root, wraps the API call).

### Relevant Files

| File | Role |
|---|---|
| `services/tenant-service/src/modules/tenants/tenants.controller.ts` | `POST /tenants` — creates tenant |
| `services/tenant-service/src/modules/provisioning/tenant-provisioning-executor.service.ts` | K8s + PostgreSQL + NATS stream provisioning |
| `setup-tenant.sh` | CLI script for tenant creation via API |
