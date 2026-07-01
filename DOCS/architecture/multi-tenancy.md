# Multi-Tenancy — Deep Reference

> **Summary in [overview.md](overview.md).** This document is the full reference for
> isolation model, tenant resolution, and data model.

**Status:** Implemented
**Sources:** `DOCS/architecture/multi-tenancy.md` (this file), `DOCS/architecture/decision-log.md`,
`DOCS/architecture/multi-tenancy.md`

---

## 1. Foundation

The platform is **multi-tenant by design**. Tenant isolation is enforced at the application
layer (NATS subject prefixes, `tenant` field in the database, `x-yoizen-tenant` header) — NOT
at the infrastructure layer. NATS runs as a **single account with no ACLs per tenant**.

**One cluster, many tenants.** The isolation contract:

1. **NATS subjects** carry a `evt.<tenant>.` prefix on every message.
2. **NATS streams** are per-tenant: `INGRESS-<TENANT>`, `DLQ-<TENANT>`, `PAYLOAD-<TENANT>`.
3. **PostgreSQL** is per-tenant: a logical database on the shared CNPG cluster (`shared` tier)
   or a dedicated StatefulSet (`dedicated` tier). Both cases use the same DNS alias
   `postgres.<tenant>-<env>-ns` so application code is identical across tiers.
4. **HTTP** — every cross-service call propagates the `x-yoizen-tenant` header.
5. **JWT scopes** — `tenant:<name>` for tenant operators, `platform` for platform-level access.

```
                ┌───────────────────────────────────────────┐
                │            api-gateway                    │
                │                                           │
dev.acme.yplatform.com ─▶ │ TenantGuard extracts "acme"    │
x-yoizen-tenant: beta ───▶ │ or falls back to header/query  │
                │          ▼                                │
                │   req.tenant = "acme" | "beta"            │
                │          ▼                                │
                │   NATS: evt.acme.*  /  evt.beta.*         │
                │          ▼                                │
                │   Postgres per tenant (CNPG shared /      │
                │    StatefulSet dedicated)                 │
                └───────────────────────────────────────────┘
```

---

## 2. Isolation Diagram

```
Tenant "acme"                          Tenant "beta"
─────────────                          ─────────────
INGRESS-ACME stream                    INGRESS-BETA stream
DLQ-ACME stream                        DLQ-BETA stream
PAYLOAD-ACME object store              PAYLOAD-BETA object store
Namespace: acme-dev-ns (K8s)           Namespace: beta-dev-ns (K8s)
  └── postgres (ExternalName →            └── postgres (ExternalName →
       postgres-shared.support-services-dev)   postgres-shared.support-services-dev)
       [shared tier — default]                 [shared tier — default]
       [dedicated tier → own StatefulSet]      [dedicated tier → own StatefulSet]

NATS subjects:                         NATS subjects:
  evt.acme.channel-service.messaging.>   evt.beta.channel-service.messaging.>

JWT tokens:                            JWT tokens:
  scope: "tenant:acme"                   scope: "tenant:beta"
```

---

## 3. Five Isolation Principles

1. **Tenant mandatory** — no event travels without a `tenant` field; no DB query omits the
   tenant filter.
2. **Bus isolation** — NATS streams are per-tenant; a consumer of tenant "acme" cannot read
   messages from "beta".
3. **Data isolation** — each tenant has its own PostgreSQL database provisioned by
   `tenant-service`: `shared` tier = logical DB on the shared CNPG cluster accessed via an
   `ExternalName` Service; `dedicated` tier = per-tenant StatefulSet.
4. **No NATS ACLs** — isolation is purely application-layer; there are no per-tenant NATS
   accounts, users, or permissions.
5. **Automatic provisioning** — on tenant creation, `tenant-service` creates the K8s namespace,
   provisions the PostgreSQL database per tier, and `ensureTenantIngressStream` creates the
   required NATS streams.

---

## 4. Components That Implement Multi-Tenancy

| Component | Implementation |
|---|---|
| `api-gateway` | `TenantGuard` — extracts tenant from hostname or `x-yoizen-tenant` header |
| NATS subjects | `evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v1` |
| NATS streams | `INGRESS-<TENANT>` (filter `evt.<tenant>.>`), `DLQ-<TENANT>`, `PAYLOAD-<TENANT>` |
| `tenant-service` | Provisions K8s namespace + PostgreSQL (shared CNPG logical DB or dedicated StatefulSet) + NATS streams |
| `channel-service` | Propagates `tenant` in all canonical envelopes |
| `packages/shared` | `TENANT_HEADER = 'x-yoizen-tenant'` (constant used across all services) |

---

## 5. Tenant Resolution

### 5.1 Resolution Chain (normal requests)

`TenantGuard` in `api-gateway` resolves the tenant before any route handler runs. It uses three
sources in priority order:

```
Incoming request (with JWT)
     │
     ▼
  1. Hostname?   dev.acme.yplatform.com → tenant = "acme"
     │ (not found — e.g. localhost)
     ▼
  2. Header?     x-yoizen-tenant: acme → tenant = "acme"
     │ (not found)
     ▼
  3. Query?      ?tenant=acme → tenant = "acme"
     │ (not found)
     ▼
  ❌ 400 Bad Request — tenant not resolved
```

Source file: `services/api-gateway/src/guards/tenant.guard.ts`

### 5.2 Source 1: Hostname

**Format:** `<env>.<tenant>.yplatform.com`

```
Host: dev.acme.yplatform.com
  → HOST_PATTERN captures the second label
  → tenant = "acme"
```

Local developer hostnames such as `api-gateway.platform-services-dev.dev.local`
route to the gateway but do not encode a tenant in the pattern the guard
recognizes. For local curl/scripts, pass `x-yoizen-tenant` or `?tenant=`.

### 5.3 Source 2: Header

```
x-yoizen-tenant: acme
```

Constant: `TENANT_HEADER` in `packages/shared/src/constants.ts`.

Used in:
- Internal service-to-service communication
- CLI tool calls or `kubectl port-forward`
- Local development when no tenant-aware `yplatform.com` hostname is configured

### 5.4 Source 3: Query parameter

```
?tenant=acme
```

This is a fallback for local scripts and debugging. Prefer the header for
tenant-scoped API calls because it matches downstream propagation.

### 5.5 Special Case: Webhooks

Webhook endpoints are public (`@Public()`, `@SkipTenant()`): they bypass `TenantGuard`. The
tenant is extracted directly from the path parameter:

```
POST /api/webhooks/:channel/:tenantId
GET  /api/webhooks/:channel/:tenantId   ← hub.challenge verification
```

Example:
```
POST /api/webhooks/whatsapp/acme
  → channel  = "whatsapp"
  → tenantId = "acme"
```

Meta (WhatsApp/Instagram) cannot include arbitrary headers or subdomains, so the tenant is
placed in the path.

Source file: `services/api-gateway/src/modules/channels/webhooks.controller.ts`

### 5.6 JWT Scope Table

The `AuthGuard` (also in `api-gateway`) validates the JWT scope:

| Scope | Description |
|---|---|
| `platform` | Access to all tenants (internal service tokens) |
| `tenant:<name>` | Access only to the named tenant |

If the resolved tenant does not match the `tenant:<name>` scope in the JWT → 403 Forbidden.

### 5.7 Downstream Propagation

Once resolved in `api-gateway`, the tenant propagates to downstream services via the
`x-yoizen-tenant` header in every HTTP proxy call.

### 5.8 Development / Curl Examples

Without a hostname configured, pass the header directly:

```bash
# Direct API call with port-forward
curl -H "x-yoizen-tenant: acme" \
     -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/api/workflows

# With kubectl port-forward
kubectl port-forward svc/api-gateway 3000:3000 -n platform-services-dev
curl -H "x-yoizen-tenant: acme" http://localhost:3000/api/workflows
```

---

## 6. Data Model

### 6.1 Principle

Each tenant has its own PostgreSQL database. The isolation can be logical or physical,
depending on the tier:

- **`shared` tier (default):** logical database on the shared CloudNativePG cluster
  (`postgres-shared` in `support-services-dev`), accessed via an ExternalName Service named
  `postgres` in the tenant namespace (`<tenant>-<env>-ns`). Application code connects to
  `postgres.<tenant>-<env>-ns.svc.cluster.local` regardless of tier.
- **`dedicated` tier:** per-tenant PostgreSQL StatefulSet in the tenant namespace. Schema is
  created via `init.sql` in the `postgres-config` ConfigMap at provisioning time.

Isolation is not via a `tenant` column in shared tables — each tenant's database is a
completely separate boundary.

Provisioning is executed by `tenant-service` when a tenant is created.
Source: `services/tenant-service/src/providers/postgres.provider.ts`

### 6.2 Storage Layers

#### Tenant PostgreSQL (primary channel data)

Stores: `ChannelAccount` records, messages, contacts, auto-reply rules, SKB tables (if enabled).

The initial schema is applied via migrations at provisioning time (shared tier) or via
`init.sql` in the `postgres-config` ConfigMap (dedicated tier).

#### Platform PostgreSQL (operational data)

Shared platform data (tenants table, users, connector configuration, schedules) lives in the
platform PostgreSQL instance in the `platform-services-dev` namespace.

#### NATS Object Store per-tenant (claim-check)

Large payloads (> 256 KB) are not carried inside the NATS envelope. They are stored in the
`PAYLOAD-<TENANT>` Object Store and the envelope carries a reference `nats://objstore/<bucket>/<key>`.

TTL: 7 days (aligned with the `INGRESS-<TENANT>` stream retention).

See [../../messaging/claim-check.md](../messaging/claim-check.md) for the full contract.

#### Redis (application cache)

Redis is **not** per-tenant. It is shared and used for: connector config SWR cache (keyed by
`adapter:<tenant>:*`), execution status store (keyed by `result:<id>`, `pending:<id>`), and
auth/gateway public-route sync. The cache keys include the tenant ID where isolation is needed.

### 6.3 Per-Tenant NATS Streams

| Stream | Subjects | Retention | Purpose |
|---|---|---|---|
| `INGRESS-<TENANT>` | `evt.<tenant>.>` | 7 days / 256 MB | All events for the tenant |
| `DLQ-<TENANT>` | `dlq.<tenant>.>` | 30 days / 512 MB | Permanently-failed messages |
| `PAYLOAD-<TENANT>` | — (Object Store) | 7 days / 512 MB | Claim-check payload blobs |

Name construction functions in `packages/shared/src/channel.constants.ts`:

| Function | Returns |
|---|---|
| `buildIngressStreamName(tenant)` | `INGRESS-<tenant>` |
| `buildDlqStreamName(tenant)` | `DLQ-<tenant>` |
| `buildClaimCheckBucket(tenant)` | `PAYLOAD-<tenant>` |

### 6.4 ChannelAccount Interface

Defined in `packages/shared/src/channel.interfaces.ts`:

```typescript
interface ChannelAccount {
  id: string;
  tenantId: string;
  channel: Channel;           // "whatsapp" | "instagram" | "telegram"
  provider: ChannelProvider;  // "meta" | "telegram"
  name: string;
  externalId: string;
  phoneNumberId?: string;     // WhatsApp: phone_number_id from Meta
  wabaId?: string;            // WhatsApp: WABA ID
  igUserId?: string;          // Instagram: IG professional account ID
  telegramBotToken?: string;  // Telegram: bot token
  accessToken: string;
  appId?: string;
  appSecret?: string;
  verifyToken?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

## 7. Relevant Files

| File | Role |
|---|---|
| `services/api-gateway/src/guards/tenant.guard.ts` | Tenant resolution by hostname / header |
| `services/api-gateway/src/modules/channels/webhooks.controller.ts` | Webhook endpoints (`@SkipTenant()`) |
| `services/tenant-service/src/modules/provisioning/tenant-provisioning-executor.service.ts` | K8s + PostgreSQL provisioning |
| `packages/shared/src/constants.ts` | `TENANT_HEADER = 'x-yoizen-tenant'` |
| `packages/shared/src/channel.interfaces.ts` | `ChannelAccount`, `InboundMessage`, `OutboundMessage` |
| `packages/shared/src/channel.constants.ts` | `buildIngressStreamName`, `buildDlqStreamName`, `buildClaimCheckBucket` |
| `packages/database/src/` | `ensureTenantIngressStream`, `ensureTenantDlqStream` |
