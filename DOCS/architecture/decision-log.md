# Architecture Decision Log

> Granular ADRs live in `../adr/`.
> This file captures cross-cutting closed decisions, open points, milestones, and
> the historical migration record for the messaging bus.

**Status:** Operational reference
**Last updated:** 2026-06-11

---

## Closed Decisions

These decisions are final and apply across all bus/messaging documents.

| # | Decision | Document | Status |
|---|---|---|---|
| D1 | Generic envelope + raw payload kept intact | messaging/envelope | Implemented |
| D2 | JetStream, not Core NATS | messaging/service-bus | Implemented |
| D3 | 1 event per raw POST received (no splitting) | messaging/envelope | Implemented |
| D4 | Routing by NATS subject, not by body fields | messaging/envelope | Implemented |
| D5 | One stream per tenant with explicit limits | messaging/service-bus | Implemented |
| D6 | Full raw + per-tenant ACL for PII | security | Implemented (ACLs pending) |
| D7 | Initial shadow publish — replaced by primary path | messaging/service-bus | Superseded: NATS is the primary path |
| D8 | Explicit allowlist of HTTP headers | messaging/envelope | Implemented (7 headers; see `WEBHOOK_FORWARDED_HEADERS`) |
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
| O3 | Header allowlist by provider | Dev | messaging/envelope | **Resolved** (7 headers in `WEBHOOK_FORWARDED_HEADERS`, `channel.constants.ts:55`) |
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
| O21 | Define dead-letter strategy for failed validations | Dev | observability | Partially resolved (DLQ-<tenant> exists; see messaging/service-bus §5) |

---

## Milestone Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M1 | External ingress to the bus as the primary path (WhatsApp, Telegram, etc.) | **Completed** |
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
| Data isolation | `tenant` field in shared MongoDB collections | Per-tenant PostgreSQL: shared CNPG (tier `shared`) or dedicated StatefulSet (tier `dedicated`) |
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
