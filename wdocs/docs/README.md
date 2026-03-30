# Coexistance — Documentación

Dashboard de WhatsApp Business con arquitectura event-driven sobre NATS pub/sub.

## Para agentes de IA: empieza aquí

Si sos un agente de IA (opencode, Claude, Cursor, Copilot, etc.) que va a trabajar en este proyecto, leé estos documentos en este orden:

1. **[CONTEXT.md](./CONTEXT.md)** — Estado actual del codebase, stack, estructura de archivos, API endpoints, credenciales de test. **Este es tu documento principal.**
2. **[PRD.md](./PRD.md)** — Requerimientos del producto, goals y non-goals del MVP.
3. **[QUICKSTART.md](./QUICKSTART.md)** — Cómo levantar el entorno local (Bun + NATS + cloudflared).

## Estructura de docs/

```
docs/
├── README.md            ← Estás aquí
├── CONTEXT.md           ← Estado actual del codebase (fuente de verdad)
├── PRD.md               ← Product Requirements Document
├── QUICKSTART.md        ← Setup local rápido
│
├── arquitectura/        ← Diseño del bus NATS, seguridad, observabilidad
│   ├── README.md        ← Índice + roadmap (M1-M5)
│   ├── 01-service-bus.md
│   ├── 02-diseño-de-mensajes.md
│   ├── 03-ingress-agentes.md
│   ├── 04-claim-check.md
│   ├── 05-seguridad.md
│   └── 06-observabilidad.md
│
├── prompts/             ← Prompts de implementación para agentes IA
│   ├── README.md        ← Contexto global + reglas de código
│   ├── 01-bus-core/     ← hasta 12-auto-reply-service/
│   ├── autorun-full.md  ← Mega-prompt stages 01-07
│   └── autorun-09-10.md ← Mega-prompt stages 09-10
│
├── flujos/              ← Diagramas de secuencia Mermaid
│   ├── README.md        ← Índice + diagrama de arquitectura
│   ├── 01-recibir-mensaje.md
│   ├── 02-pong-auto-reply.md
│   ├── 03-enviar-mensaje.md
│   ├── 04-ciclo-ping-pong.md
│   └── dev-start.sh     ← Script para levantar todo el entorno
│
└── help/                ← Guías de usuario y operador
    ├── README.md        ← Índice de guías
    ├── 01-primeros-pasos.md
    ├── 02-meta-dashboard.md
    ├── 03-usar-el-dashboard.md
    ├── 04-api-reference.md
    ├── 05-arquitectura.md
    ├── 06-cloudflare-tunnel.md
    └── 07-troubleshooting-v0.md
```

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Bun.js |
| HTTP | Express |
| Base de datos | MongoDB (driver nativo, sin Mongoose) |
| Event bus | NATS Core pub/sub |
| Frontend | React + Vite + Tailwind |
| Real-time | Server-Sent Events (SSE) |
| Testing | Vitest (150+ tests) |
| Tunnel | Cloudflared (webhooks de Meta) |

## Arquitectura de servicios

```
server/src/
├── bus/          ← 9 primitivos compartidos (connect, publish, subscribe, envelope, subject, etc.)
└── services/
    ├── ingress/      ← Meta webhook → NATS publish
    ├── egress/       ← Dashboard send → Meta API + NATS shadow publish
    ├── persistence/  ← NATS consumer → MongoDB (messages, contacts, status)
    ├── sse/          ← NATS consumer → browser (Server-Sent Events)
    ├── health/       ← Métricas del bus + health endpoints
    └── auto-reply/   ← NATS consumer → reglas automáticas (ping→pong)
```

## Reglas de código

- Functional programming, no OOP — pure functions, no classes
- Un export por archivo, max 200 líneas
- Result types: `{ ok: true, data }` / `{ ok: false, error }` — nunca throw
- Español para UI, inglés para código
- Verbose logging — nada falla en silencio

## Stages ejecutados

| Stage | Descripción | Estado |
|-------|-------------|--------|
| 01 | Bus core — validación, subject, idempotency | Done |
| 02 | Envelope + publish | Done |
| 03 | Ingress pipeline | Done |
| 04 | Consumer persistence | Done |
| 05 | SSE bridge | Done |
| 06 | Tests + smoke | Done |
| 07 | Metrics + health | Done |
| 08 | Refactor → services/ | Done |
| 09 | Frontend SSE | Done |
| 10 | Egress bus | Done |
| 11 | Restructure monorepo | Done |
| 12 | Auto-reply (ping→pong) | Done |
