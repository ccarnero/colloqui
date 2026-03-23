# Flujos — Coexistance

Documentación de los casos de uso básicos de la plataforma, con diagramas de secuencia Mermaid y explicaciones del flujo de datos a través del bus NATS.

## Índice

| # | Flujo | Descripción | Estado |
|---|-------|-------------|--------|
| 01 | [Recibir mensaje](./01-recibir-mensaje.md) | Meta webhook → ingress → NATS → persistence + SSE → browser | Implementado |
| 02 | [Auto-reply pong](./02-pong-auto-reply.md) | Consumer detecta "ping" → sendText + save + NATS (direct calls) | Stage 12 |
| 03 | [Enviar mensaje](./03-enviar-mensaje.md) | Dashboard → egress → Meta API + MongoDB + NATS publish | Implementado |
| 04 | [Ciclo ping→pong](./04-ciclo-ping-pong.md) | End-to-end: ingress + 3 subscribers + auto-reply + egress | Stage 12 |

## Arquitectura general

```
                    ┌─────────────┐
                    │  Meta Cloud  │
                    │     API      │
                    └──────┬───┬──┘
                  webhook  │   ▲  send
                    POST   │   │  POST
                           ▼   │
┌──────────────────────────────────────────────────────┐
│                    Express Server                     │
│                                                      │
│  ┌──────────┐  publish   ┌──────┐   subscribe        │
│  │ Ingress  │──────────►│ NATS │◄──────────┐        │
│  │ (routes) │           │  Bus │           │        │
│  └──────────┘           └──┬───┘    ┌──────┴──────┐ │
│                            │        │ Persistence │ │
│  ┌──────────┐  publish     │        │ (consumer)  │ │
│  │ Egress   │──────────────┘        └──────┬──────┘ │
│  │ (routes) │                              │        │
│  └──────────┘  ┌───────────┐        ┌──────▼──────┐ │
│                │SSE Bridge │        │  MongoDB    │ │
│                │(consumer) │        └─────────────┘ │
│                └─────┬─────┘                        │
└──────────────────────┼──────────────────────────────┘
                       │ SSE
                       ▼
                 ┌───────────┐
                 │  Browser  │
                 │ Dashboard │
                 └───────────┘
```

## Convenciones

**Subjects NATS:** `evt.{tenant}.{producer}.{domain}.{channel}.{provider}.{kind}.v{version}`

**Envelopes:** formato CloudEvents 1.0 con campos extra (tenant, producer, domain, channel, provider, traceid, correlationId).

**Result types:** todas las funciones retornan `{ ok: true, data }` o `{ ok: false, error }` — nunca throw.

**Consumers:** reciben el envelope completo, parsean `envelope.data.payload` según el caso.
