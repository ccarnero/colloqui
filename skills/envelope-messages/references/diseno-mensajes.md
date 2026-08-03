## As-built sources of truth — Message design

This file is an index of the sources of truth for the implemented messaging system.
The code wins over any document when they diverge.

> Filename note: this file keeps its original Spanish name (`diseno-mensajes.md`)
> because it is referenced by path from `SKILL.md`; only the content was
> translated (envelope-drift post-loop item 4, 2026-07-31).

### Architecture documentation (as-built)

| Document | Contents |
|---|---|
| `DOCS/messaging/envelope.md` | Canonical envelope contract (CloudEvents-inspired), 8-token subject format, header allowlist, idempotency, causal chain (causation/correlation/depth), claim-check (summary), examples per producer type |
| `DOCS/messaging/ingress.md` | Two-stage ingress flow (webhook bridge api-gateway → channel-service), as-built AI agent lifecycle |
| `DOCS/messaging/claim-check.md` | Full claim-check protocol: producer (IngressService), consumer middleware (MultiTenantConsumerManager), Object Store (PAYLOAD-<tenant>), sha256 checksum invariant, error codes, metrics, sequence diagrams |
| `DOCS/messaging/service-bus.md` | Stream topology (INGRESS-<tenant>, DLQ-<tenant>, PAYLOAD-<tenant>, GATEWAY_AUDIT, PLATFORM_TENANTS), subject taxonomy (8 tokens), provisioning lifecycle, claim-check pattern (as-built) |

### Source of truth for types and helpers

```
packages/shared/src/interfaces.ts
  → EventEnvelope, EventTransport, EventData

packages/shared/src/envelope.utils.ts
  → computeIdempotencyKey, computePayloadChecksum, canonicalJson, canonicalByteLength
  → buildSubject, parseSubject
  → deriveEnvelope, buildEventEnvelope
  → isCompliantEnvelope
  → MAX_DEPTH_BY_CATEGORY, DepthExceededError
  → ProducerCategory

packages/shared/src/channel.constants.ts
  → CHANNEL_PRODUCER ("channel-service")
  → WEBHOOK_FORWARDED_HEADERS (7 entries) + WEBHOOK_FORWARDED_HEADERS_SET
  → WEBHOOK_SECRET_HEADERS (4-entry verification subset, stripped post-signature-check)
  → CLAIM_CHECK_THRESHOLD_BYTES (256 KB)
  → CLAIM_CHECK_BUCKET_TTL_NS, CLAIM_CHECK_BUCKET_MAX_BYTES
  → buildDlqStreamName, buildDlqSubjectPattern

packages/shared/src/channel.utils.ts
  → buildChannelSubject, buildWebhookIngressSubject
  → buildClaimCheckBucket, parseChannelSubject, parseWebhookIngressSubject, buildTenantWildcard

packages/shared/src/tenant-stream.constants.ts
  → getTenantStreamName (INGRESS-<TENANT>, upper-cased — the only ingress-name builder)

packages/shared/src/webhook.interfaces.ts
  → WebhookIngressEnvelope (api-gateway pre-ingress type — no accountid)
  → IWebhookIngressData (includes raw_body_b64 and headers)

services/channel-service/src/domain/envelope.factory.ts
  → createChannelEnvelope — canonical producer
    id: crypto.randomUUID()
    type: io.yoizen.messaging.${channel}.${provider}.${kind}.v1
    source: //channel-service/accounts/${accountId}
    idempotencykey: computeIdempotencyKey(rawPayload)

services/channel-service/src/modules/ingress/ingress.service.ts
  → claim-check logic (producer): threshold, putBlob, slim envelope, DLQ on failure

packages/database/src/claim-check.ts
  → looksLikeClaimCheck, parseClaimCheckRef, resolveClaimCheckEnvelope
  → ClaimCheckResolveError, ClaimCheckErrorCode, isClaimCheckEnvelope, withInflatedData
```
