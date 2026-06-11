## Fuentes de verdad as-built — Diseño de mensajes

Este archivo es un índice de las fuentes de verdad del sistema de mensajería implementado.
Las tres secciones de documentación de arquitectura y el documento operativo de NATS/JetStream
son la referencia canónica. El código prevalece sobre los documentos ante cualquier divergencia.

### Documentación de arquitectura (as-built)

| Documento | Contenido |
|---|---|
| `DOCS/arquitectura/02-diseño-de-mensajes.md` | Contrato canónico de envelope (CloudEvents-inspired), formato de subjects de 8 tokens, allowlist de headers, idempotencia, cadena causal (causation/correlation/depth), claim-check (resumen) |
| `DOCS/arquitectura/03-ingress-agentes.md` | Flujo de ingress de dos etapas (webhook bridge api-gateway → channel-service), ciclo de vida de agentes AI as-built, backpressure y timeout del publisher |
| `DOCS/arquitectura/04-claim-check.md` | Protocolo completo de claim-check: producer (channel-service), consumer middleware (MultiTenantConsumerManager), Object Store (PAYLOAD-<tenant>), invariante de checksum, métricas, diagramas de secuencia |
| `DOCS/03-NATS-JETSTREAM.md` | Topología de streams (INGRESS-<tenant>, DLQ-<tenant>, PAYLOAD-<tenant>), taxonomía de subjects, ciclo de vida de provisioning de streams y consumers |

### Fuente de verdad de tipos

```
packages/shared/src/interfaces.ts   → EventEnvelope, EventTransport, EventData
packages/shared/src/channel.constants.ts → CHANNEL_PRODUCER, WEBHOOK_FORWARDED_HEADERS, CLAIM_CHECK_THRESHOLD_BYTES
packages/shared/src/envelope.utils.ts → computeIdempotencyKey, canonicalJson, buildSubject, deriveEnvelope, MAX_DEPTH_BY_CATEGORY
services/channel-service/src/domain/envelope.factory.ts → createChannelEnvelope (id: crypto.randomUUID(), type: io.yoizen.messaging.<channel>.<provider>.<kind>.v1)
services/channel-service/src/modules/ingress/ingress.service.ts → lógica de claim-check (producer)
packages/database/src/claim-check.ts → resolveClaimCheckEnvelope (consumer)
packages/shared/src/webhook.interfaces.ts → WebhookIngressEnvelope
```
