# Arquitectura — Coexistance

## Estructura del monorepo

```
coexistance/
├── .env                          ← Configuración (no commitear)
├── .env.example                  ← Template de configuración
├── setup.sh                      ← Script de setup completo
├── package.json                  ← Monorepo root (workspaces)
│
├── server/                       ← Backend (Bun/Node + Express + MongoDB)
│   ├── package.json
│   ├── src/
│   │   ├── server.js             ← Entry point — compone todo
│   │   ├── config/
│   │   │   └── env.js            ← Lee y valida .env
│   │   ├── lib/
│   │   │   ├── result.js         ← ok()/err() — tipo Result para manejo de errores
│   │   │   ├── pipe.js           ← pipe() y pipeAsync() — composición funcional
│   │   │   ├── http.js           ← fetchJson() — wrapper de fetch con Result
│   │   │   └── match.js          ← Pattern matching para routing de mensajes
│   │   ├── auth/
│   │   │   ├── hash-password.js  ← bcryptjs hash
│   │   │   ├── verify-password.js
│   │   │   ├── create-token.js   ← JWT sign
│   │   │   └── verify-token.js   ← JWT verify → Result
│   │   ├── middleware/
│   │   │   ├── require-auth.js   ← JWT auth middleware
│   │   │   └── require-account.js← Verifica ownership de cuenta
│   │   ├── db/
│   │   │   ├── connect.js        ← Conexión MongoDB + indexes
│   │   │   ├── users/
│   │   │   │   ├── create-user.js
│   │   │   │   └── find-user.js
│   │   │   ├── accounts/
│   │   │   │   ├── create-account.js
│   │   │   │   ├── find-account.js
│   │   │   │   └── update-account.js
│   │   │   ├── contacts/
│   │   │   │   ├── upsert-contact.js    ← BSUID-aware
│   │   │   │   └── find-contact-by-wa-id.js
│   │   │   └── messages/
│   │   │       ├── save-message.js
│   │   │       ├── find-messages.js
│   │   │       └── update-status.js
│   │   ├── meta/                 ← Todo lo que habla con Meta Graph API
│   │   │   ├── verify-webhook.js
│   │   │   ├── parse-webhook.js  ← Normaliza payloads de Meta
│   │   │   ├── parse-sender-id.js← Detecta phone vs BSUID
│   │   │   ├── send-text.js
│   │   │   ├── send-template.js
│   │   │   ├── fetch-templates.js
│   │   │   ├── exchange-token.js ← Embedded Signup: code → token
│   │   │   ├── fetch-waba-phone-numbers.js
│   │   │   └── subscribe-webhooks.js
│   │   ├── routes/
│   │   │   ├── auth-routes.js
│   │   │   ├── account-routes.js ← Incluye callback de Embedded Signup
│   │   │   ├── webhook-routes.js ← El corazón: recibe mensajes de Meta
│   │   │   ├── conversation-routes.js
│   │   │   ├── message-routes.js
│   │   │   ├── template-routes.js
│   │   │   └── events-routes.js     ← SSE stream con auth JWT
│   │   ├── bus/
│   │   │   ├── connect-nats.js      ← 9 primitivos compartidos
│   │   │   ├── publish-event.js
│   │   │   ├── subscribe.js
│   │   │   ├── build-envelope.js
│   │   │   ├── build-subject.js
│   │   │   ├── validate-envelope.js
│   │   │   ├── idempotency-key.js
│   │   │   ├── check-payload-size.js
│   │   │   └── filter-headers.js
│   │   ├── services/
│   │   │   ├── ingress/             ← Recepción de webhooks + NATS publish
│   │   │   │   └── handle-webhook.js
│   │   │   ├── egress/              ← Envío de mensajes + NATS shadow publish
│   │   │   │   └── send-message.js
│   │   │   ├── persistence/         ← NATS consumer → MongoDB
│   │   │   │   └── save-events.js
│   │   │   ├── sse/                 ← NATS consumer → browser streaming
│   │   │   │   └── broadcast-sse.js
│   │   │   ├── health/              ← Métricas + health endpoints
│   │   │   │   └── health-check.js
│   │   │   └── auto-reply/          ← NATS consumer → respuestas automáticas
│   │   │       └── handle-auto-reply.js
│   │   └── scripts/
│   │       └── seed.js           ← Crea user + cuenta sandbox
│   └── tests/
│       ├── result.test.js
│       ├── pipe.test.js
│       ├── match.test.js
│       ├── parse-sender-id.test.js
│       ├── parse-webhook.test.js
│       ├── verify-webhook.test.js
│       └── exchange-token.test.js
│       └── (150+ tests en total)
│
├── client/                       ← Frontend (React + Vite + Tailwind)
│   ├── package.json
│   ├── vite.config.js            ← Proxy /api → :6666 en dev
│   ├── index.html
│   └── src/
│       ├── main.jsx              ← Entry point
│       ├── index.css             ← Tailwind + scrollbar styles
│       ├── App.jsx               ← Router (login/register/dashboard)
│       ├── context/
│       │   └── auth-context.jsx  ← Auth state + localStorage token
│       ├── lib/
│       │   ├── api.js            ← Fetch wrapper para todos los endpoints
│       │   ├── use-event-stream.js ← SSE hook con auth
│       │   └── use-websocket.js  ← DEPRECATED — replaced by use-event-stream.js
│       ├── pages/
│       │   ├── LoginPage.jsx
│       │   ├── RegisterPage.jsx
│       │   └── DashboardPage.jsx ← Layout principal + header
│       └── components/
│           ├── Sidebar.jsx       ← Lista de conversaciones
│           ├── ChatView.jsx      ← Mensajes + input
│           ├── TemplatePicker.jsx← Selector de templates
│           ├── ConnectAccount.jsx← Sandbox + Embedded Signup
│           └── EmptyState.jsx
│
└── docs/
    ├── PRD.md                ← Product Requirements Document
    └── help/
        ├── 01-primeros-pasos.md
        ├── 02-meta-dashboard.md
        ├── 03-usar-el-dashboard.md
        ├── 04-api-reference.md
        └── 05-arquitectura.md   ← Este archivo
```

## Principios de diseño

### Functional Programming nativo

- No hay clases ni OOP en ningún lado
- Cada archivo exporta una función (o pocas funciones relacionadas)
- Máximo 200 líneas por archivo
- Error handling con Result types (ok/err) en vez de try/catch
- Composición con pipe/pipeAsync
- Pattern matching con match()

### Sin Mongoose

MongoDB se usa con el driver nativo. Cada función de DB recibe `db` como primer argumento — no hay modelos ni schemas de Mongoose.

### BSUID desde día 1

WhatsApp está migrando a "Business-Scoped User IDs" (BSUIDs) a partir de junio 2026. El sistema detecta automáticamente si un sender ID es teléfono o BSUID via parseSenderId(), y los contactos se guardan con un campo `identifier_type`.

### LOCAL_TESTING mode

Con `LOCAL_TESTING=true` en .env, todas las llamadas a Meta se mockean. Podés desarrollar sin credenciales reales y sin webhook externo.

## Flujo de un mensaje entrante

```
WhatsApp del cliente
      ↓
Meta Cloud API
      ↓ (webhook POST)
Cloudflare Tunnel (HTTPS → localhost)
      ↓
webhook-routes.js → responde 200 inmediato
      ↓
publishEvent() → publica a NATS bus
      ↓
services/ingress → normaliza y enriquece
      ↓
NATS subscribers:
  - services/persistence → guarda en MongoDB
  - services/sse → difunde por SSE a dashboards conectados
  - services/auto-reply → respuestas automáticas
```

## Flujo de un mensaje saliente

```
Dashboard → input → submit
      ↓
api.sendMessage(accountId, to, text)
      ↓
POST /api/accounts/:id/messages/send
      ↓
message-routes.js → busca account → obtiene token
      ↓
publishEvent() → publica a NATS bus
      ↓
services/egress consume el evento:
  1. Llama sendText(token, phoneNumberId, to, text)
  2. fetch → graph.facebook.com/v22.0/{phone_id}/messages (en LIVE mode)
  3. Responde al cliente
      ↓
Shadow publish para auditoria/logging
      ↓
services/persistence → guarda en MongoDB
      ↓
services/sse → difunde a dashboards
```

## Tests

```bash
cd server
npx vitest run        # correr todos
npx vitest            # watch mode
npx vitest run match  # correr solo match tests
```

Actualmente hay más de 150+ tests.
Los tests cubren los módulos puros (result, pipe, match, parseSenderId, parseWebhook, verifyWebhook, exchangeToken) y también incluyen pruebas de integración con la base de datos y las rutas.
