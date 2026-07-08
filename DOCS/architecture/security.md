# Security

**Status:** Operational reference — system implemented
**Audience:** Infra + Security
**Last updated:** 2026-06-11

> Operational reference as-built: `DOCS/messaging/service-bus.md`

---

## 1. Summary

This document describes the security layers implemented in the messaging system. For each
area it explicitly distinguishes the **current state** (what is in production) from the
**target design** (planned but not yet implemented).

---

## 2. Trust Model

The bus has four producer types, each with a different trust level:

```
┌──────────────────────────────────────────────────────────────────┐
│                       Trust Levels                               │
│                                                                  │
│  ┌─────────────────┐  We verify the provider's signature.       │
│  │ External provider│  We don't control what they send but we   │
│  │ (trust: high)    │  validate authenticity and integrity.      │
│  └─────────────────┘                                             │
│                                                                  │
│  ┌─────────────────┐  Our code, our infrastructure.             │
│  │ Internal agent   │  Full control over behavior.              │
│  │ (trust: high)    │                                            │
│  └─────────────────┘                                             │
│                                                                  │
│  ┌─────────────────┐  Known SaaS with SLAs and documented       │
│  │ Platform agent   │  formats. We don't operate it but we      │
│  │ (trust: medium)  │  know the provider.                       │
│  └─────────────────┘                                             │
│                                                                  │
│  ┌─────────────────┐  Third-party code, third-party infra.      │
│  │ Third-party agent│  Maximum restrictions. Treated as         │
│  │ (trust: low)     │  potentially hostile.                     │
│  └─────────────────┘                                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Tenant Isolation

### 3.1 Current State — Single-Account NATS Server

The NATS server is configured in **single-account mode with no accounts, users, or
authorization blocks**. The full configuration is in `infrastructure/base/nats/configmap.yaml`:

```
listen: 0.0.0.0:4222
jetstream { store_dir: /data/jetstream; max_mem: 256MB; max_file: 50GB }
max_payload: 1MB
```

There are no NATS accounts, ACLs, or users defined. Isolation between tenants is
**exclusively by subject-prefix convention at the application layer**: all messages for a
tenant are published under `evt.<tenantId>.>` and each service filters by tenant via its
corresponding `INGRESS-<tenantId>` stream.

### 3.2 Target Design — Per-Tenant NATS Accounts (Pending)

> **Status: pending — not implemented**

The original design contemplates cryptographic isolation via NATS accounts and ACLs per tenant:

```
┌──────────────────────────────────────────┐
│          NATS Account: acme              │
│                                          │
│  Publish:    ingress-service ✓           │
│              agente-cs-v2    ✓ (scoped)  │
│              partner-xyz     ✓ (scoped)  │
│              other-tenant    ✗           │
│                                          │
│  Subscribe:  processor-acme  ✓           │
│              analytics-acme  ✓           │
│              partner-xyz     ✓ (limited) │
│              globex-service  ✗           │
│                                          │
│  Stream:     INGRESS-ACME    (isolated)  │
│  Bucket:     PAYLOAD-acme    (isolated)  │
└──────────────────────────────────────────┘
```

- **Publish:** only the ingress service can publish to `evt.{tenant}.>`
- **Subscribe:** only services authorized for that tenant can subscribe
- **Cross-tenant:** no account can see traffic from another tenant

This design requires dynamic NATS account configuration (NKEYs/JWT) and is pending
implementation.

---

## 4. Verification by Producer Type

### 4.1 External Providers — Webhook Signature (Implemented)

Signature verification happens in **channel-service** when it consumes the `webhook_received`
envelope published by `api-gateway`. The flow has two stages:

**Stage 1 — api-gateway:** receives the incoming webhook HTTP request and publishes a
`webhook_received` envelope to JetStream **before signature verification**. The envelope
carries the raw body in `raw_body_b64` plus the signature headers in `forwarded_headers`.

**Stage 2 — channel-service:** upon consuming the envelope, verifies the signature before
any canonical processing. If verification fails → message discarded. The payload never
reaches the main bus without a verified signature.

> **Note on the trust boundary:** the raw webhook sits in JetStream during the interval
> between publication and verification. The `INGRESS-<tenant>` stream is internal; the risk
> is low in the current single-account configuration, but this should be revisited when
> per-tenant account isolation is implemented (§3.2).

**Forwarded signature headers** (`packages/shared/src/channel.constants.ts:55-63`):

```
WEBHOOK_FORWARDED_HEADERS = [
  "content-type",
  "x-hub-signature-256",
  "x-hub-signature",
  "x-telegram-bot-api-secret-token",
  "x-http-channel-token",
  "x-request-id",
  "user-agent"
]
```

**Implemented mechanisms by provider:**

| Provider | Mechanism | Header | Implementation |
|---|---|---|---|
| Meta (WhatsApp, Instagram) | HMAC-SHA256 with `timingSafeEqual` | `x-hub-signature-256` | `services/channel-service/src/providers/meta/meta-base.ts` |
| Telegram | `timingSafeEqual` against secret token | `x-telegram-bot-api-secret-token` | `services/channel-service/src/providers/telegram/telegram.provider.ts:62-65` |
| Generic HTTP channel | `timingSafeEqual` against a shared token | `x-http-channel-token` | `services/channel-service/src/providers/http/http.provider.ts` |

For Telegram, an absent or empty header is rejected directly as `signature_mismatch` (no
fallback to the first active account) because the token is the sole mechanism for identifying
the sending bot.

**Providers not yet implemented:**

> **Status: pending — not implemented**
> TikTok and X/Twitter do not have providers in the system. The corresponding rows from
> the original design (HMAC-SHA256 `x-tiktok-signature` and HMAC-SHA1
> `x-twitter-webhooks-signature`) do not apply until those providers are implemented.

### 4.2 Internal Agents — Service Token

> **Status: pending — not implemented**

The design contemplates authentication of internal agents via service tokens scoped to
the tenant:

```
authenticateServiceToken(token, tenant) -> Result<AgentIdentity, err>
```

Not implemented. Internal services access NATS without explicit identity authentication
(consequence of single-account mode).

### 4.3 Third-Party Agents — API Key + Tenant Authorization

> **Status: pending — not implemented**

Target design:

1. **API key:** authenticates the third-party agent
2. **Tenant authorization:** verifies permission to publish to the requested subject

```
authenticateApiKey(apiKey, tenant) -> Result<AgentIdentity, err>
validateTenantAuthorization(agentId, tenant, subject) -> Result<ok, err>
```

Planned constraints (pending): mandatory rotation every 90 days, 1 MB max payload with
claim-check at 256 KB, dedicated consumer, revocation in < 1 min.

### 4.4 Platform Agents — OAuth2 / Callback Signature

> **Status: pending — not implemented**

```
verifyPlatformSignature(request, platformProvider) -> Result<ok, err>
```

---

## 5. Payload Validation and Integrity

### 5.1 Current State

Validation in `webhook-ingress.service.ts` is a lightweight structural check:

- Verifies that the parsed body is a non-null, non-array JSON object
- If not → returns `{ status: "invalid_payload" }` without publishing anything

**No DLQ message is published on invalid payload.** The rejection is silent (warning log
only). The metric available to detect this is `channel.webhook.requests` (total requests
received) vs `channel.ingress.messages_published` (successfully published).

### 5.2 Target Design — DLQ on Invalid Payload (Pending)

> **Status: pending — not implemented**

The original design contemplated publishing to `dlq.{tenant}.ingress.invalid.v1` on invalid
payload. This is not implemented; currently only a log entry and early return are produced.

### 5.3 Implemented DLQ — Permanent Consumer Failure

The DLQ that exists is the **per-tenant DLQ stream** `DLQ-<tenantId>` with subject pattern
`dlq.<tenantId>.>`. It is used in two paths:

1. **Permanent consumer failure**
   (`packages/database/src/multi-tenant-consumer-manager.ts`): when a handler throws
   `PermanentError`, the manager calls `term()` and republishes the original envelope to
   `dlq.<tenantId>.<original-subject>` with headers:
   - `X-Dlq-Reason`
   - `X-Dlq-Stage`
   - `X-Dlq-Original-Subject`

2. **Claim-check store failure**
   (`services/channel-service/src/modules/ingress/ingress.service.ts`): when writing to the
   Object Store payload fails, the original envelope (with inline payload) is published to the
   DLQ with:
   - `X-Dlq-Reason: claim_check_store_failed`
   - `X-Dlq-Stage: ingress_claim_check`
   - `X-Dlq-Original-Subject`

### 5.4 Claim-Check Integrity

Every payload that exceeds the 256 KB threshold goes through the claim-check pattern
(`packages/database/src/claim-check.ts`):

- **Producer** (channel-service ingress): computes `sha256` over exactly the bytes of
  `canonicalJson(payload)` and stores them in the Object Store. The slim envelope carries
  `payload_checksum = "sha256:<hex>"`.
- **Consumer**: when resolving the claim-check, computes `sha256` over the raw bytes
  retrieved from the Object Store and compares against `payload_checksum`. Mismatch →
  throws `ClaimCheckResolveError` with code `"checksum_mismatch"` → nak/backoff → DLQ
  after `MAX_DELIVER`.

`ClaimCheckErrorCode` values: `ref_missing`, `ref_malformed`, `blob_not_found`,
`checksum_mismatch`.

---

## 6. PII Policy

### 6.1 Implemented Rule

`data.payload` **is never logged.** The `envelopeLogFields` function in
`packages/observability/src/envelope-logging.ts` extracts only envelope metadata fields
(`event_id`, `trace_id`, `causation_id`, `correlation_id`, `tenant`, `channel`, `provider`,
`producer`, `domain`, `idempotency_key`, `depth`). The `data.payload` field is deliberately
absent from `IStructuredLogFields`.

### 6.2 Encryption

| Layer | Mechanism | Status |
|---|---|---|
| In transit | TLS 1.3 between nodes and clients | Required in prod |
| At rest (streams) | JetStream file encryption | Pending configuration |
| At rest (object store) | Inherits from stream | Pending configuration |

### 6.3 Redaction Options for Future Compliance Requirements

The architecture supports adding a redaction step between ingress and publish without
changing the envelope contract:

1. **Selective redaction:** strip specific fields from the raw body before publishing
2. **Dual publish:** full version to the main stream (strict ACL) + redacted version to
   the tenant's public stream
3. **Layer-2 redaction:** full raw in Layer 1, Layer-2 consumer produces canonical events
   with PII already redacted

---

## 7. Rate Limiting

### 7.1 Current State

There is no dedicated per-tenant or per-agent rate-limiting mechanism implemented in the
ingress. Requests rejected with 429 are visible in the metric
`http.server.request.total{status_code=429}` (emitted by `packages/observability/src/http-metrics.ts`).

### 7.2 Target Design — Per-Type Rate Limiting (Pending)

> **Status: pending — not implemented**

The original design contemplates enforcement at the ingress service level before publish:

| Type | Limit (msgs/s) | Burst | Configurable |
|---|---|---|---|
| External provider (default) | 100 | 500 | Per tenant |
| External provider (enterprise) | 1000 | 5000 | Per tenant |
| Internal agent | 200 | 1000 | Per agent |
| Third-party agent | 50 | 200 | Per contract |
| Platform agent | 100 | 500 | Per integration |

The metric `ingress.rate_limited` from the original design is not implemented; 429s are
tracked today via `http.server.request.total{status_code="429"}`.

---

## 8. Agent Security Matrix

### 8.1 Control Summary — Current vs. Target

| Control | Internal | Third-Party | Platform |
|---|---|---|---|
| Authentication | **Pending** (service token) | **Pending** (API key + secret) | **Pending** (OAuth2 / signature) |
| Authorization | **Pending** (scoped by subject) | **Pending** (tenant must authorize) | **Pending** (per integration) |
| Output validation | Standard (implemented) | **Pending** (strict 1 MB) | **Pending** |
| Rate limit | **Pending** | **Pending** | **Pending** |
| Credential rotation | **Pending** | **Pending** (90 days) | **Pending** (OAuth2) |
| Revocation | **Pending** | **Pending** (< 1 min) | **Pending** |
| Anti-loop (MAX_DEPTH) | Defined (5) | **Pending** | **Pending** |

### 8.2 Third-Party Agents — Data Sandbox (Target Design)

> **Status: pending — not implemented**

A third-party agent MUST NEVER be able to:

- Read the tenant's full stream
- Publish to unauthorized subjects
- See events from other third-party agents (unless explicitly authorized)
- Know of the existence of other tenants

A third-party agent MUST ONLY be able to:

- Receive events via a dedicated consumer created by the tenant
- Publish to subjects explicitly authorized by the tenant
- See its own published events

### 8.3 Audit Trail — Current State

The log fields implemented in `packages/observability/src/envelope-logging.ts`
(`IStructuredLogFields`) are: `event_id`, `trace_id`, `causation_id`, `correlation_id`,
`tenant`, `channel`, `provider`, `producer`, `domain`, `idempotency_key`, `depth`, `step`.

The extended audit fields for agents (`agent_model`, `confidence`, `tool_chain`,
`agent_vendor`, `api_key_id`, `origin_ip`, `platform_*`) **are not implemented**.

> **Status: pending — not implemented**
> The extended audit trail for internal, third-party, and platform agents (fields `agent_id`,
> `agent_category`, `confidence`, `tool_chain`, `agent_vendor`, `api_key_id`, `origin_ip`,
> etc.) is planned but not present in the current structured logging.

---

## 9. Access Revocation

> **Status: pending — not implemented**

The revocation design by agent type (webhook secret rotation, service tokens, API keys,
OAuth2) is not implemented as a centralized mechanism. Webhook secret revocation is done
manually in the external provider dashboard (Meta, Telegram) and requires updating the
configured secret in the system.

| Type | Planned Mechanism | Planned Effective Time |
|---|---|---|
| External provider | Rotate webhook secret at the provider | Immediate (new webhooks fail verification) |
| Internal agent | Rotate service token | Per token cache (< 5 min) |
| Third-party agent | Revoke API key via admin | < 1 minute |
| Platform agent | Revoke OAuth2 credentials | Per token expiry (configurable) |

---

## 10. MCP Outbound Connections (Implemented)

Agents and workflows can call tools on external MCP servers configured per
tenant (`mcp_servers`, `services/agent-admin-service/src/modules/mcp-servers/`).
This is a **new, distinct trust boundary** from the producer types in
section 2: instead of *receiving* data from an external actor, the platform
*initiates* outbound calls, on the tenant's behalf, to a server the tenant
configured. See [mcp-connections.md](mcp-connections.md) for the full
design.

- **Auth types**: `none` / `api-key` / `bearer` / `basic` (`auth_type` +
  `auth_config` on the `mcp_servers` row). Credentials are injected into the
  outbound request at call time (agent tool bridge, or the `mcpCall`
  workflow activity on `connector-runtime`).
- **Known risk — plaintext credentials at rest.** `auth_config` (and the
  legacy raw `headers` field) is stored as JSON without field-level
  encryption. Any principal with database read access to `mcp_servers` can
  read configured MCP credentials in the clear. No compensating control
  exists today (no envelope encryption, no secrets-manager indirection).
  Treat this the same as the section 6.2 PII/encryption gap until closed.
- **SSRF guard**: the `mcpCall` activity and the test-connection endpoint
  validate the target URL (reject localhost, link-local, cloud metadata,
  and RFC1918 addresses) before connecting — the same class of guard
  `adapter-executor.service.ts` uses for adapter calls.
- **Tenant scoping**: `mcp_servers` rows are tenant-scoped like connectors;
  no cross-tenant reuse.

## 11. Admin API-Key Guard (Implemented)

`agent-scheduler-service` exposes read-only `/admin/*` job-execution
endpoints (see [jobs.md](../agents/jobs.md)) protected by
`AdminApiKeyGuard`. Requests must send `x-internal-api-key` matching the
configured `ADMIN_API_KEY`. This guard **fails closed**: if `ADMIN_API_KEY`
is not configured, the guard throws `ForbiddenException` on every request
rather than allowing unauthenticated access — there is no bypass mode.
`services/agent-scheduler-service/src/modules/admin/admin-api-key.guard.ts`
is the reference implementation.
