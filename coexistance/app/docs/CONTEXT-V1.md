# Coexistance — Contexto para v1

Pegá esto al inicio de un chat nuevo para continuar el desarrollo.

## Qué es

Coexistance es una plataforma self-hosted para que negocios configuren líneas de atención al cliente por WhatsApp. Similar a Kapso.ai pero con control total. El usuario se loguea, conecta su cuenta de WhatsApp Business (sandbox o Embedded Signup), y recibe/envía mensajes desde un dashboard web en tiempo real.

## Stack

- **Runtime:** Bun.js
- **Server:** Express + MongoDB (native driver, no Mongoose)
- **Client:** React 19 + Vite 6 + Tailwind CSS 4 + React Router 7
- **WebSocket:** ws library, JWT auth, account-scoped broadcast
- **Tests:** Vitest (32 tests passing)
- **Monorepo:** `server/` + `client/` en raíz `coexistance/`

## Lineamientos de código

- Functional programming, no OOP — pure functions, no classes, no singletons
- One function per file, max 200 lines
- KISS — no over-engineering, no exotic FP libraries
- Result types (ok/err) for error handling instead of throwing
- Pipe and compose for data transformation
- Pattern matching with match() for branching logic
- Verbose logging — nothing should fail silently
- Idempotent scripts (seed, fix, migrations)
- BSUID support from day 1
- Spanish for UI text, English for code

## Estructura de archivos

```
coexistance/
├── .env                          # Secrets (no git)
├── .env.example
├── .gitignore
├── setup.sh                      # Instala todo + seed
├── docs/help/                    # 8 guías (00-indice a 07-troubleshooting)
├── server/
│   ├── package.json
│   ├── src/
│   │   ├── server.js             # Entry: Express + HTTP server + WS + static
│   │   ├── config/env.js         # readEnv() — validates required/optional vars
│   │   ├── db/
│   │   │   ├── connect.js        # connectDb(uri) → { db, client }
│   │   │   ├── contacts/         # upsert-contact.js, find-contact-by-wa-id.js
│   │   │   └── messages/         # save-message.js, update-status.js
│   │   ├── auth/
│   │   │   ├── hash-password.js
│   │   │   ├── verify-password.js
│   │   │   └── create-token.js
│   │   ├── middleware/
│   │   │   ├── require-auth.js
│   │   │   └── require-account.js
│   │   ├── meta/
│   │   │   ├── exchange-token.js       # Embedded Signup code → access_token
│   │   │   ├── fetch-waba-phone-numbers.js
│   │   │   ├── subscribe-webhooks.js
│   │   │   ├── verify-webhook.js       # GET challenge verification
│   │   │   ├── parse-webhook.js        # POST → { type, data }
│   │   │   ├── parse-sender-id.js      # phone/bsuid detection + AR normalization
│   │   │   ├── send-text.js
│   │   │   └── send-template.js
│   │   ├── lib/
│   │   │   ├── result.js          # ok(data), err(msg)
│   │   │   ├── pipe.js
│   │   │   ├── match.js
│   │   │   └── http.js            # fetchJson() with logging
│   │   ├── routes/
│   │   │   ├── auth-routes.js          # POST /api/auth/register, /login, GET /me
│   │   │   ├── account-routes.js       # GET/POST /api/accounts, /callback
│   │   │   ├── webhook-routes.js       # GET/POST /api/webhooks/whatsapp
│   │   │   ├── conversation-routes.js  # GET /api/accounts/:id/conversations
│   │   │   ├── message-routes.js       # POST /send, /send-template
│   │   │   └── template-routes.js      # GET /api/accounts/:id/templates
│   │   ├── ws/create-ws-server.js      # WebSocket with JWT auth + broadcast
│   │   └── scripts/
│   │       ├── seed.js                 # Creates user + sandbox account
│   │       └── fix-account.js          # Syncs MongoDB account with .env
│   └── tests/                     # 7 test files, 32 tests
├── client/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx               # Entry: BrowserRouter + AuthProvider + App
│       ├── index.css              # @import "tailwindcss"
│       ├── App.jsx                # Routes: /login, /register, /*
│       ├── context/auth-context.jsx
│       ├── lib/
│       │   ├── api.js             # Fetch wrapper for all endpoints
│       │   └── use-websocket.js   # WS hook (dev: direct :6666, prod: same host)
│       ├── pages/
│       │   ├── LoginPage.jsx      # With "Recordar sesión" checkbox
│       │   ├── RegisterPage.jsx
│       │   └── DashboardPage.jsx  # Sidebar + ChatView/EmptyState
│       └── components/
│           ├── Sidebar.jsx        # Conversation list + empty state
│           ├── ChatView.jsx       # Messages + text input + template toggle
│           ├── TemplatePicker.jsx
│           ├── ConnectAccount.jsx # Sandbox form + Embedded Signup
│           └── EmptyState.jsx     # Shows account details when connected
```

## Estado actual (v0 completa)

Funciona end-to-end:
- Login/register con JWT
- Conectar cuenta WABA (sandbox manual o Embedded Signup)
- Recibir mensajes via webhook → MongoDB → WebSocket → UI en tiempo real
- Enviar mensajes de texto y templates desde la UI → Meta API → WhatsApp
- Recordar sesión (localStorage)

## Problemas conocidos resueltos en v0

1. Phone Number ID ≠ número de teléfono (1009049662293548, no +15551541722)
2. Access token vive en MongoDB, no solo en .env (fix-account.js sincroniza)
3. LOCAL_TESTING=false para conectar con Meta real
4. Ruta webhook: /api/webhooks/whatsapp (no /webhook del proyecto viejo)
5. Suscribirse a "messages" en Meta es obligatorio post-verificación
6. Números argentinos: Meta manda 549XX, API espera 54XX (parse-sender-id normaliza)
7. WebSocket no pasa por Vite proxy (conecta directo a :6666 en dev)
8. Tokens temporales de Meta duran 24h

## Entorno Meta actual

- APP_ID: 1690770278576601
- WABA_ID: 1360068825556562
- Phone Number ID: 1009049662293548
- Display phone: +1 555 154 1722 (test number)
- Test recipient: +54 9 11 3460 2008
- Webhook URL: https://api.devmachina.net/api/webhooks/whatsapp
- Tunnel: cloudflared con dominio devmachina.net

## Para v1 — posibles features del PRD pendientes

- Account selector en sidebar (multi-account)
- Tests más completos (DB/routes con testcontainers)
- Producción: deploy, systemd, SSL
- Métricas / dashboard analytics
- Chatbot/auto-reply rules
- Media messages (images, documents)
- Contact management
