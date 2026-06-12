## Fuentes de verdad as-built — Diseño de mensajes

Este archivo es un índice de las fuentes de verdad del sistema de mensajería implementado.
El código prevalece sobre cualquier documento ante divergencias.

### Documentación de arquitectura (as-built)

| Documento | Contenido |
|---|---|
| `DOCS/messaging/envelope.md` | Contrato canónico de envelope (CloudEvents-inspired), formato de subjects de 8 tokens, allowlist de headers, idempotencia, cadena causal (causation/correlation/depth), claim-check (resumen), ejemplos por tipo de producer |
| `DOCS/messaging/ingress.md` | Flujo de ingress de dos etapas (webhook bridge api-gateway → channel-service), ciclo de vida de agentes AI as-built |
| `DOCS/messaging/claim-check.md` | Protocolo completo de claim-check: producer (IngressService), consumer middleware (MultiTenantConsumerManager), Object Store (PAYLOAD-<tenant>), invariante de checksum sha256, códigos de error, métricas, diagramas de secuencia |
| `DOCS/messaging/service-bus.md` | Topología de streams (INGRESS-<tenant>, DLQ-<tenant>, PAYLOAD-<tenant>, GATEWAY_AUDIT, PLATFORM_TENANTS), taxonomía de subjects (8 tokens), ciclo de vida de provisioning, claim-check pattern (as-built) |

### Fuente de verdad de tipos y helpers

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
  → WEBHOOK_FORWARDED_HEADERS (6 entradas)
  → CLAIM_CHECK_THRESHOLD_BYTES (256 KB)
  → CLAIM_CHECK_BUCKET_TTL_NS, CLAIM_CHECK_BUCKET_MAX_BYTES
  → buildDlqStreamName, buildDlqSubjectPattern

packages/shared/src/channel.utils.ts
  → buildChannelSubject, buildWebhookIngressSubject, buildIngressStreamName
  → buildClaimCheckBucket, parseChannelSubject, parseWebhookIngressSubject, buildTenantWildcard

packages/shared/src/webhook.interfaces.ts
  → WebhookIngressEnvelope (tipo pre-ingress de api-gateway — sin accountid)
  → IWebhookIngressData (incluye raw_body_b64 y headers)

services/channel-service/src/domain/envelope.factory.ts
  → createChannelEnvelope — producer canónico
    id: crypto.randomUUID()
    type: io.yoizen.messaging.${channel}.${provider}.${kind}.v1
    source: //channel-service/accounts/${accountId}
    idempotencykey: computeIdempotencyKey(rawPayload)

services/channel-service/src/modules/ingress/ingress.service.ts
  → lógica de claim-check (producer): umbral, putBlob, slim envelope, DLQ on failure

packages/database/src/claim-check.ts
  → looksLikeClaimCheck, parseClaimCheckRef, resolveClaimCheckEnvelope
  → ClaimCheckResolveError, ClaimCheckErrorCode, isClaimCheckEnvelope, withInflatedData
```
