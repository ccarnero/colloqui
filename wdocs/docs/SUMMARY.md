# Yoizen Platform — Documentation Summary

## What Is This

Yoizen is a **multi-tenant, multi-channel messaging platform** that connects businesses to messaging providers (WhatsApp, Instagram) via **Meta Cloud API**. The platform is powered by an event-driven architecture built on **NATS JetStream**, with a **NestJS/Fastify** service mesh, **PostgreSQL** for persistence, **Redis** for caching, and **Temporal** for workflow orchestration.

The documentation in `wdocs/docs/` originates from the **Coexistance** prototype — a self-hosted WhatsApp Business dashboard built with Bun, Express, MongoDB, and React/Vite. The Arch platform has since evolved into a production-grade microservices architecture, but the domain concepts, message formats, and integration patterns documented here remain the foundation for the **channel-service** that bridges external messaging APIs with the internal event bus.

---

## Documentation Map

### Root Files

| File | Purpose |
|------|---------|
| `README.md` | Index of the doc tree, stack overview, coding rules, stage completion table |
| `CONTEXT.md` | Session bootstrap snapshot: v2 features, file tree, API list, MongoDB collections, v3 backlog |
| `PRD.md` | MVP product requirements: user stories, P0 features (Embedded Signup, webhooks, send/reply, multi-tenancy, auth) |
| `QUICKSTART.md` | Local setup guide: install, seed, dev-start, ports, test login |

### `arquitectura/` — Event Bus Architecture

Formal design for the NATS JetStream ingress pipeline: stream topology, envelope format, agent types, claim-check, security, and observability.

| File | Topic |
|------|-------|
| `01-service-bus.md` | JetStream vs Core NATS, per-tenant streams, shadow publish, DLQ |
| `02-diseño-de-mensajes.md` | Subject taxonomy `evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v1`, CloudEvents envelope, idempotency, header allowlist |
| `03-ingress-agentes.md` | Agent classification (internal/thirdparty/platform), trust levels, depth anti-loop, MCP/A2A surface |
| `04-claim-check.md` | Payload size threshold (256 KB), NATS Object Store `PAYLOAD-{tenant}`, resolvePayload, failure sequences |
| `05-seguridad.md` | HMAC webhook verification, NATS ACLs, service tokens, PII policy, rate limits, revocation |
| `06-observabilidad.md` | Metric names, structured logging rules, alert thresholds, Grafana dashboards, OpenTelemetry tracing |

### `canales/` — Multi-Tenant and Multi-Channel

Evolution from single-tenant to multi-tenant SaaS, plus Instagram channel integration.

| File | Topic |
|------|-------|
| `01-multi-tenant-fundacion.md` | Tenant field consistency, JWT tenant claim, middleware, queries |
| `02-tenant-resolution.md` | Resolution chain: subdomain, `X-Tenant-Id` header, JWT claim; webhook path `/api/webhooks/{channel}/:tenantId` |
| `03-modelo-de-datos-tenant.md` | Tenant field on all entities, compound indexes, optional tenants collection |
| `04-migracion-single-a-multi.md` | Migration scripts, deployment order, rollback, backward compatibility |
| `05-arquitectura-multi-canal.md` | Provider abstraction (`meta/` split into WhatsApp + Instagram), channel-aware persistence/egress |
| `06-overview-instagram-api.md` | Instagram Messaging API differences: IGSID, graph.instagram.com, no templates, echo messages |
| `07-instagram-implementacion.md` | Implementation stages IG-01 through IG-09 |
| `08-reutilizacion-patrones-whatsapp.md` | Shared patterns (verify, OAuth, bus), adaptations (parse-webhook, send-text), new concerns (echo filter) |

### `flujos/` — Runtime Sequence Diagrams

End-to-end Mermaid flows for the NATS pipeline.

| File | Topic |
|------|-------|
| `01-recibir-mensaje.md` | Inbound: Meta webhook -> ingress -> NATS -> persistence + SSE -> browser |
| `02-pong-auto-reply.md` | Auto-reply consumer: ping -> pong via sendText + saveMessage + processEgress |
| `03-enviar-mensaje.md` | Outbound: dashboard -> egress -> Meta -> DB -> shadow processEgress |
| `04-ciclo-ping-pong.md` | Full ping/pong timeline, example documents, two subjects (received.v1, sent.v1) |

### `help/` — Operator Guides

| File | Topic |
|------|-------|
| `01-primeros-pasos.md` | What Coexistance is, setup/login, sandbox vs Embedded Signup |
| `02-meta-dashboard.md` | Where to find WABA ID, Phone Number ID, tokens, App ID/Secret |
| `03-usar-el-dashboard.md` | UI layout, 24h window, templates, SSE real-time |
| `04-api-reference.md` | REST + SSE endpoints, error codes |
| `05-arquitectura.md` | Monorepo tree, principles, message flows |
| `06-cloudflare-tunnel.md` | cloudflared setup, DNS, Meta webhook URL |
| `07-troubleshooting-v0.md` | Common issues: Phone Number ID, token, webhook path, Argentine numbers |

### `prompts/` — AI Agent Implementation Playbooks

Stage-by-stage prompts for building the NATS bus migration in the original codebase (stages 01-12).

---

## Core Concepts

### CloudEvents Envelope

All messages on the bus follow a CloudEvents-inspired envelope:

```
Subject: evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v1
Headers: Nats-Msg-Id (idempotency), traceid, correlation_id, causation_id
Body: { id, type, source, time, datacontenttype, data, resource, ... }
```

### NATS JetStream Streams

- `INGRESS-{tenant}` — per-tenant inbound message stream
- `EVENTS` — platform-wide event stream (existing)
- `RESULTS` — processed event completions (existing)
- `DLQ` — dead letter queue (existing)

### Subject Taxonomy

```
evt.<tenant>.messaging.<channel>.<provider>.<kind>.v1
```

- **channel**: `whatsapp`, `instagram`
- **provider**: `meta`
- **kind**: `received`, `sent`, `delivered`, `read`, `failed`

### Claim-Check Pattern

Payloads exceeding **256 KB** are stored in **NATS Object Store** (`PAYLOAD-{tenant}`) and replaced with a URI reference in the envelope. Consumers call `resolvePayload()` to retrieve the full content.

### Tenant Resolution

Resolution chain (first match wins):
1. Subdomain pattern: `<env>.<tenant>.yplatform.com`
2. `X-Tenant-Id` / `x-yoizen-tenant` header
3. JWT `tenant_id` claim
4. Webhook path parameter: `/webhooks/{channel}/:tenantId`

### Channel Abstraction

Each messaging provider implements `IChannelProvider`:
- `parseWebhook(rawBody)` — parse platform-specific webhook into normalized message
- `sendMessage(account, message)` — send outbound via provider API
- `verifySignature(rawBody, signature, secret)` — HMAC verification

---

## Gap Analysis: Documentation vs Current Platform

| Aspect | Documentation (Coexistance) | Current Platform (Arch) |
|--------|----------------------------|------------------------|
| Runtime | Bun + Express | Bun + NestJS + Fastify |
| Database | MongoDB (native driver) | PostgreSQL (postgres.js) |
| Frontend | React + Vite + Tailwind | Angular 21 + Material |
| Messaging | Core NATS + shadow publish | NATS JetStream (EVENTS/RESULTS/DLQ) |
| Orchestration | None | Temporal |
| Deployment | Manual / cloudflared | Kubernetes + Knative + Kustomize |
| Auth | JWT sub field, basic | JWT + RBAC + tenant roles |
| Observability | Basic metrics/health | OTel + Prometheus + Grafana + Loki + Tempo |

The **channel-service** bridges this gap by implementing the documented messaging patterns (CloudEvents envelopes, webhook ingestion, egress, auto-reply, multi-channel) on top of the current NestJS/Fastify/PostgreSQL/JetStream stack.

---

## Key Architectural Decisions (from docs)

| ID | Decision |
|----|----------|
| D1 | JetStream over Core NATS for durability and exactly-once semantics |
| D2 | Per-tenant streams for isolation and independent retention |
| D3 | CloudEvents-like envelope for interoperability |
| D4 | Nats-Msg-Id for built-in deduplication |
| D5 | HMAC verification on all external webhooks |
| D6 | Shadow publish (return 200 before publish) in M1 for reliability |
| D7 | Claim-check at 256 KB via NATS Object Store |
| D8 | Provider strategy pattern for multi-channel extensibility |
