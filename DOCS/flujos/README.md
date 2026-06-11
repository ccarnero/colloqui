# Flujos — Yoizen Platform

Documentación de los casos de uso básicos de la plataforma, con diagramas de secuencia y explicaciones del flujo de datos a través del bus NATS JetStream.

## Índice

| # | Flujo | Descripción |
|---|-------|-------------|
| 01 | [Recibir mensaje](./01-recibir-mensaje.md) | Webhook provider → api-gateway → channel-service → NATS → consumers downstream |
| 02 | [Auto-reply pong](./02-pong-auto-reply.md) | consumer detecta "ping" → egress → Meta API + DB |
| 03 | [Enviar mensaje](./03-enviar-mensaje.md) | Dashboard → channel-service egress → provider API |
| 04 | [Ciclo ping→pong](./04-ciclo-ping-pong.md) | End-to-end: ingress bifásico + consumers + auto-reply |

## Arquitectura general

```
  Provider externo (Meta/Telegram)
         │
         ▼
  [api-gateway]  POST /webhooks/:channel/:tenantId
         │  WebhookIngressEnvelope → INGRESS-<TENANT>
         ▼
  [channel-service]  webhook-ingress-consumer (durable)
         │  verifica HMAC, parsea mensajes, resuelve accountid
         │  ChannelEnvelope → INGRESS-<TENANT>
         ▼
  Consumers downstream
    ├── [agent-ai-service]     (AI pipelines)
    ├── [workflow-service]     (Temporal workflows)
    └── otros consumers...
```

## Convenciones

**Subjects NATS:**
```
evt.<tenant>.<producer>.messaging.<channel>.<provider>.<kind>.v1
```

Ejemplos:
```
evt.acme.api-gateway.messaging.whatsapp.webhook.webhook_received.v1   ← stage 1 (api-gateway)
evt.acme.channel-service.messaging.whatsapp.meta.received.v1          ← stage 2 (channel-service)
```

**Streams per-tenant:**
- `INGRESS-<TENANT>` — filter `evt.<tenant>.>`, retención 7 días / 256 MB
- `DLQ-<TENANT>` — mensajes terminados, retención 30 días
- `PAYLOAD-<TENANT>` — claim-check Object Store para payloads > 256 KB

**Envelopes:** formato CloudEvents-inspired definido en `packages/shared/src/interfaces.ts` (`EventEnvelope`) y `packages/shared/src/webhook.interfaces.ts` (`WebhookIngressEnvelope`).
