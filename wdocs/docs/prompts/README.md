# Contexto global — copiar como contexto inicial en opencode

**Uso:** pegar este bloque al inicio de cada sesión de opencode antes de ejecutar el prompt de la etapa.

---

```
Este proyecto es coexistance — un dashboard de WhatsApp Business con Bun.js + Express + MongoDB nativo.

ARQUITECTURA v0 — NATS Pub/Sub desacoplado:

El sistema usa NATS Core como bus de eventos para desacoplar ingress de consumers.
- El webhook recibe de Meta, responde 200 inmediato, construye un envelope, y hace nats.publish(). Nada más.
- Los consumers se suscriben a subjects de NATS de forma independiente:
  1. Consumer de persistencia: subscribe → findAccount → upsertContact → saveMessage (MongoDB)
  2. SSE Bridge: subscribe → stream al browser vía Server-Sent Events
- NO hay WebSocket. El frontend recibe eventos por SSE.
- Mañana se pueden agregar N consumers (AI agents, loggers, analytics) sin tocar el ingress.

REGLAS ESTRICTAS del codebase:

1. JavaScript plano (ES modules, .js). NO TypeScript. NO .ts.
2. NO classes, NO singletons, NO OOP. Solo funciones puras.
3. Una función exportada por archivo, max 200 líneas.
4. Result types para error handling: ok(data) y err(error). NUNCA throw para control flow.
   El Result type ya existe en src/lib/result.js: { ok: true, data } o { ok: false, error }
5. pipe() y pipeAsync() ya existen en src/lib/pipe.js para composición.
6. Bun.js como runtime. Usar APIs nativas de Bun cuando existan.
7. Express para HTTP. MongoDB native driver (no Mongoose).
8. Vitest para tests.
9. Comentarios en inglés.
10. Verbose logging con console.log — nada falla silenciosamente. Prefijo [TAG] en logs.
11. Dependencias se pasan como argumentos, no como globals ni imports de estado.
12. fetchJson() en src/lib/http.js es el wrapper HTTP del proyecto — retorna Result.
13. NATS_URL ya existe en env.js como var opcional con default nats://localhost:4222.

Estructura actual:
server/src/
├── auth/           (hash, verify, create tokens)
├── config/env.js   (readEnv — Object.freeze)
├── db/             (MongoDB — connect.js + subdirs por collection)
├── lib/            (result.js, pipe.js, match.js, http.js)
├── meta/           (WhatsApp Cloud API — parse-webhook.js, verify-webhook.js, etc.)
├── middleware/     (require-auth.js, require-account.js)
├── routes/         (7 archivos de rutas, cada uno export registerXxxRoutes(app, db, env, ...))
├── scripts/        (seed.js, fix-account.js — idempotentes)
├── ws/             (DEPRECATED — create-ws-server.js, no longer imported)
└── server.js       (entry point — compone todo, arranca el server)

El webhook actual está en routes/webhook-routes.js:
  POST /api/webhooks/whatsapp → res.status(200) inmediato → parseWebhook → findAccount → upsertContact → saveMessage → broadcast WS

Esto se va a desacoplar:
  INGRESS:   webhook → parseWebhook → buildEnvelope → nats.publish()
  CONSUMER:  nats.subscribe() → findAccount → upsertContact → saveMessage
  SSE:       nats.subscribe() → EventSource stream al browser

Seguir exactamente este estilo. Mirar los archivos existentes como referencia.
```

---

## Orden de ejecución

| Etapa | Folder | Entregable | Depende de |
|-------|--------|------------|------------|
| 1 | `01-bus-core/` | Validación, subject, utilidades | — |
| 2 | `02-envelope-publish/` | Build envelope, connect NATS, publish | 1 |
| 3 | `03-ingress-pipeline/` | Pipeline compuesto + webhook modificado | 1, 2 |
| 4 | `04-consumer-persistence/` | Subscriber NATS → MongoDB | 2, 3 |
| 5 | `05-sse-bridge/` | SSE reemplaza WebSocket | 4 |
| 6 | `06-tests-smoke/` | Tests + smoke test E2E | 1–5 |
| 7 | `07-metrics-health/` | Métricas básicas + health | 1–6 |

Cada etapa es verificable de forma independiente antes de pasar a la siguiente.
