# 05 — Arquitectura Multi-Canal

> **Estado:** implementado
> **Prerequisitos:** [01-multi-tenant-fundacion.md](./01-multi-tenant-fundacion.md)

## Resumen

El soporte multi-canal está construido desde el diseño. Un `ChannelAccount` tiene un campo `channel` (`"whatsapp" | "instagram" | "telegram"`) y un campo `provider` (`"meta" | "telegram"`). El bus NATS, el envelope y los servicios downstream son channel-agnostic: el `channel` es un token más en el subject.

## Canales implementados

| Canal | Provider | Estado |
|-------|----------|--------|
| WhatsApp | meta | Implementado |
| Instagram | meta | Implementado |
| Telegram | telegram | Implementado |

Código de providers: `services/channel-service/src/providers/`

## Estructura de providers

```
services/channel-service/src/providers/
├── channel-router.ts                  ← IChannelProvider registry
├── meta/
│   ├── meta-base.ts                   ← verifyWebhookSignature (HMAC-SHA256 compartida)
│   ├── meta-channel-provider.base.ts  ← base: signatureHeader, verifySignature, buildSendPayload
│   ├── meta-token.ts                  ← exchange / refresh token OAuth Meta
│   ├── provider-registry.ts
│   ├── whatsapp/
│   │   └── whatsapp.provider.ts       ← parseWebhook, sendMessage
│   └── instagram/
│       └── instagram.provider.ts      ← parseWebhook, sendMessage
└── telegram/
    └── telegram.provider.ts           ← signatureHeader, verifySignature, parseWebhook, sendMessage
```

## Flujo multi-canal (ingress)

```
                          ┌────────────────────────────────────────────┐
  WhatsApp User → Meta →  │ POST /webhooks/whatsapp/acme               │
                          │  channel-service verifica x-hub-signature-256│
                          │  parseWebhook → InboundMessage[]           │──▶ INGRESS-ACME
                          └────────────────────────────────────────────┘     (evt.acme.channel-service.
                                                                              messaging.whatsapp.meta.
                          ┌────────────────────────────────────────────┐      received.v1)
  IG User → Meta ──────▶  │ POST /webhooks/instagram/acme              │
                          │  channel-service verifica x-hub-signature-256│──▶ INGRESS-ACME
                          │  parseWebhook + echo filter                │     (evt.acme.channel-service.
                          └────────────────────────────────────────────┘      messaging.instagram.meta.
                                                                               received.v1)
                          ┌────────────────────────────────────────────┐
  TG User → Telegram ──▶  │ POST /webhooks/telegram/acme               │
                          │  channel-service verifica x-telegram-bot-api│──▶ INGRESS-ACME
                          │  -secret-token                             │     (evt.acme.channel-service.
                          └────────────────────────────────────────────┘      messaging.telegram.telegram.
                                                                               received.v1)
```

## Subject NATS (formato canónico)

```
evt.<tenant>.channel-service.messaging.<channel>.<provider>.<kind>.v1
```

Ejemplos:
```
evt.acme.channel-service.messaging.whatsapp.meta.received.v1
evt.acme.channel-service.messaging.instagram.meta.received.v1
evt.acme.channel-service.messaging.telegram.telegram.received.v1
```

Función generadora: `buildChannelSubject(tenant, channel, provider, kind)` en `packages/shared/src/channel.utils.ts`.

## Lookup de cuenta en webhook

`channel-service` busca la cuenta del tenant según el channel:

- **WhatsApp**: `phone_number_id` extraído de `entry[].changes[].value.metadata.phone_number_id`
- **Instagram**: `ig_user_id` extraído de `entry[].messaging[].recipient.id`
- **Telegram**: comparación del secret token contra todas las cuentas activas del tenant

La verificación de firma HMAC/token usa `timingSafeEqual` en todos los casos.

## Egress multi-canal

`channel-service` expone un consumer de comandos de envío que escucha subjects del patrón:
```
evt.*.channel-service.messaging.*.*.send.v1
```

El `channel` en el subject determina qué provider se usa para enviar. Los providers implementan la misma interfaz `IChannelProvider.sendMessage(account, message)`.

## Agregar un canal nuevo

1. Crear `services/channel-service/src/providers/<provider>/<channel>/<channel>.provider.ts` implementando `IChannelProvider`
2. Registrar en `channel-router.ts`
3. Definir el header de firma en `signatureHeader` y la lógica de `verifySignature`
4. Los subjects, streams y consumers se generan automáticamente — no hay cambios en el bus

## Siguiente paso

→ [06-overview-instagram-api.md](./06-overview-instagram-api.md) — la API de Instagram Messaging en detalle.
