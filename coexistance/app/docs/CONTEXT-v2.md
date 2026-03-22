# Coexistance — Contexto para v2

Pegá esto al inicio de un chat nuevo para continuar el desarrollo.

## Qué es

Coexistance es una plataforma self-hosted para que negocios configuren líneas de atención al cliente por WhatsApp. Similar a Kapso.ai pero con control total. El usuario se loguea, conecta su cuenta de WhatsApp Business (sandbox o Embedded Signup), y recibe/envía mensajes desde un dashboard web en tiempo real.

## Stack

* Runtime: Bun.js
* Server: Express + MongoDB (native driver, no Mongoose)
* Client: React 19 + Vite 6 + Tailwind CSS 4 + React Router 7
* WebSocket: ws library, JWT auth, account-scoped broadcast
* Tests: Vitest (32 tests passing)
* Monorepo: `server/` + `client/` en raíz `coexistance/`

## Lineamientos de código

* Functional programming, no OOP — pure functions, no classes, no singletons
* One function per file, max 200 lines
* KISS — no over-engineering, no exotic FP libraries
* Result types (ok/err) for error handling instead of throwing
* Pipe and compose for data transformation
* Pattern matching with match() for branching logic
* Verbose logging — nothing should fail silently
* Idempotent scripts (seed, fix, migrations)
* BSUID support from day 1
* Spanish for UI text, English for code
* Accessibility: status indicators usan forma + icono + texto, nunca solo color (daltonismo)

## Estructura de archivos

```
coexistance/
├── .env                          # Secrets (no git)
├── .env.example
├── .gitignore
├── setup.sh                      # Instala todo + seed
├── docs/
│   ├── CONTEXT-V1.md
│   ├── CONTEXT-v1.1.md
│   ├── CONTEXT-v2.md             # ← Este archivo
│   ├── PRD-mvp.md
│   └── help/                     # 8 guías (00-indice a 07-troubleshooting)
├── server/
│   ├── package.json
│   ├── src/
│   │   ├── server.js             # Entry: Express + HTTP server + WS + static
│   │   ├── config/env.js         # readEnv() — validates required/optional vars
│   │   ├── db/
│   │   │   ├── connect.js        # connectDb(uri) → { db, client }
│   │   │   ├── accounts/         # create-account.js, find-account.js, update-account.js
│   │   │   ├── contacts/         # upsert-contact.js, find-contact-by-wa-id.js
│   │   │   ├── messages/         # save-message.js, update-status.js, find-messages.js
│   │   │   └── users/            # create-user.js, find-user.js
│   │   ├── auth/
│   │   │   ├── hash-password.js
│   │   │   ├── verify-password.js
│   │   │   ├── create-token.js   # JWT con { sub: userId } — IMPORTANTE: el claim es "sub"
│   │   │   └── verify-token.js   # Retorna ok({ sub, iat, exp })
│   │   ├── middleware/
│   │   │   ├── require-auth.js
│   │   │   └── require-account.js
│   │   ├── meta/
│   │   │   ├── exchange-token.js       # Embedded Signup code → access_token
│   │   │   ├── refresh-token.js        # fb_exchange_token → long-lived (~60d)
│   │   │   ├── fetch-waba-phone-numbers.js
│   │   │   ├── fetch-templates.js
│   │   │   ├── subscribe-webhooks.js
│   │   │   ├── verify-webhook.js       # GET challenge verification
│   │   │   ├── parse-webhook.js        # POST → { type, data }
│   │   │   ├── parse-sender-id.js      # phone/bsuid detection + AR normalization
│   │   │   ├── send-text.js
│   │   │   └── send-template.js
│   │   ├── lib/
│   │   │   ├── result.js          # ok(data), err(msg), tryCatch()
│   │   │   ├── pipe.js
│   │   │   ├── match.js
│   │   │   └── http.js            # fetchJson() with logging
│   │   ├── routes/
│   │   │   ├── auth-routes.js          # POST /api/auth/register, /login, GET /me
│   │   │   ├── account-routes.js       # GET/POST /api/accounts, /callback
│   │   │   ├── webhook-routes.js       # GET/POST /api/webhooks/whatsapp
│   │   │   ├── conversation-routes.js  # GET /api/accounts/:id/conversations
│   │   │   ├── message-routes.js       # POST /send, /send-template
│   │   │   ├── template-routes.js      # GET /api/accounts/:id/templates
│   │   │   └── token-routes.js         # GET token-status, POST token-refresh, token-update
│   │   ├── ws/create-ws-server.js      # WebSocket con JWT auth (usa result.data.sub) + broadcast
│   │   └── scripts/
│   │       ├── seed.js                 # Creates user + sandbox account
│   │       ├── fix-account.js          # Syncs MongoDB account with .env
│   │       └── backfill-meta-credentials.js  # ★ v2: migra cuentas existentes con meta_app_id/secret desde .env
│   └── tests/                     # 7 test files, 32 tests
├── client/
│   ├── package.json
│   ├── vite.config.js             # Proxy /api + /ws a localhost:6666
│   ├── index.html
│   └── src/
│       ├── main.jsx               # Entry: BrowserRouter + AuthProvider + App
│       ├── index.css              # @import "tailwindcss"
│       ├── App.jsx                # Routes: /login, /register, /*
│       ├── context/auth-context.jsx
│       ├── lib/
│       │   ├── api.js             # Fetch wrapper — incluye getTokenStatus, refreshAccountToken, updateAccountToken
│       │   └── use-websocket.js   # WS hook — usa mismo host (Vite proxy en dev)
│       ├── pages/
│       │   ├── LoginPage.jsx      # Con "Recordar sesión" checkbox
│       │   ├── RegisterPage.jsx
│       │   ├── DashboardPage.jsx  # ★ v2: AccountSelector + multi-account + localStorage persistence
│       │   └── AccountSettingsPage.jsx  # Token management + account info
│       └── components/
│           ├── AccountSelector.jsx # ★ v2: Dropdown para cambiar entre cuentas WABA
│           ├── Sidebar.jsx        # Conversation list + account name label + empty state
│           ├── ChatView.jsx       # Messages + text input + template toggle + refreshTick prop
│           ├── TemplatePicker.jsx
│           ├── ConnectAccount.jsx # Sandbox form + Embedded Signup
│           └── EmptyState.jsx     # Shows account details when connected
```

## Estado actual (v2)

### Lo que funciona end-to-end
* Login/register con JWT
* Conectar cuenta WABA (sandbox manual o Embedded Signup)
* Recibir mensajes via webhook → MongoDB → WebSocket → UI en tiempo real
* Enviar mensajes de texto y templates desde la UI → Meta API → WhatsApp
* Recordar sesión (localStorage)
* Token management: ver estado, renovar on-demand, pegar token manualmente
* Status indicator accesible en el Header (circle/triangle/octagon + texto)
* Account Settings page con info de cuenta read-only
* **★ Multi-account: selector en Header, persistencia en localStorage, reset de UI al cambiar**
* **★ WS filtering: solo procesa eventos de la cuenta activa (ignora otras)**
* **★ Sidebar muestra nombre de la cuenta activa**

### Qué se agregó en v2 (esta sesión)

**Multi-account UI:**
1. **AccountSelector component** — dropdown en el Header que aparece cuando hay 2+ cuentas. Con 1 sola cuenta muestra el nombre sin dropdown. Accesible (aria-haspopup, aria-expanded, role=listbox).
2. **Persist active account** — guarda `wa_active_account_id` en localStorage. Al recargar, restaura la última cuenta seleccionada.
3. **State reset on switch** — al cambiar de cuenta se limpian: activeContact, conversations, tokenStatus, refreshTick. Evita mostrar datos de otra cuenta durante la transición.
4. **WS account filtering** — el client ahora compara `event.data.account_id` con la cuenta activa via ref. Eventos de otras cuentas se ignoran (log verbose).
5. **Sidebar account label** — muestra `business_name` o `display_phone` de la cuenta activa debajo del título "Conversaciones".
6. **UI en español** — textos de bienvenida y sidebar migrados a español.

**Per-account Meta App credentials:**
7. **Account schema** — nuevos campos `meta_app_id` y `meta_app_secret` en el documento de account. Soporta cuentas conectadas a distintas apps de Meta.
8. **Token refresh usa credenciales por cuenta** — `token-routes.js` ahora usa `account.meta_app_id` / `account.meta_app_secret`, con fallback a `env.META_APP_ID` / `env.META_APP_SECRET`.
9. **ConnectAccount form** — sección colapsable "Credenciales de Meta App" para ingresar app_id/secret al conectar. Opcional (si no se proveen, usa las del servidor).
10. **AccountSettings** — nueva sección "Credenciales de Meta App" con formulario para actualizar app_id/secret. Muestra el app_id actual en la info de cuenta.
11. **Endpoint `POST /api/accounts/:id/meta-credentials`** — actualiza meta_app_id y meta_app_secret de una cuenta.
12. **Migration script** — `backfill-meta-credentials.js` rellena cuentas existentes con las credenciales del .env. Idempotente.

### Acumulado de v1 → v1.1 (ya resuelto)
1. Phone Number ID ≠ número de teléfono (1009049662293548, no +15551541722)
2. Access token vive en MongoDB, no solo en .env (fix-account.js sincroniza)
3. LOCAL_TESTING=false para conectar con Meta real
4. Ruta webhook: /api/webhooks/whatsapp (no /webhook del proyecto viejo)
5. Suscribirse a "messages" en Meta es obligatorio post-verificación
6. Números argentinos: Meta manda 549XX, API espera 54XX (parse-sender-id normaliza)
7. WebSocket ahora pasa por Vite proxy en dev (ya no conecta directo a :6666)
8. Tokens temporales de Meta duran 24h → solución: token-refresh endpoint + Account Settings UI
9. JWT claim es `sub`, no `userId` — consistente en create-token.js y create-ws-server.js
10. Mensajes enviados desde la consola de Meta no aparecen en Coexistance — es por diseño de Meta
11. Token refresh fallaba con "token does not belong to application" — el token pertenecía a otra app de Meta. Fix: credenciales por cuenta (`meta_app_id` + `meta_app_secret` en cada account doc)

## Entorno Meta actual
* APP_ID: 1690770278576601
* WABA_ID: 1360068825556562
* Phone Number ID: 1009049662293548
* Display phone: +1 555 154 1722 (test number)
* Test recipient: +54 9 11 3460 2008
* Webhook URL: https://api.devmachina.net/api/webhooks/whatsapp
* Tunnel: cloudflared con dominio devmachina.net

## API Endpoints (completo)

### Auth
* `POST /api/auth/register` — { email, password, name }
* `POST /api/auth/login` — { email, password }
* `GET /api/auth/me` — requiere Bearer token

### Accounts
* `GET /api/accounts` — lista cuentas del usuario
* `POST /api/accounts/connect` — conexión manual (sandbox)
* `POST /api/accounts/callback` — Embedded Signup callback
* `GET /api/accounts/:id/status` — estado de la cuenta

### Token Management
* `GET /api/accounts/:id/token-status` — estado del token (connected/expiring_soon/expired/no_token) + días restantes
* `POST /api/accounts/:id/token-refresh` — intercambia token actual por long-lived (~60d) via fb_exchange_token
* `POST /api/accounts/:id/token-update` — pega un token nuevo manualmente, auto-intenta extenderlo
* `POST /api/accounts/:id/meta-credentials` — ★ v2: actualiza meta_app_id y meta_app_secret de una cuenta

### Conversations & Messages
* `GET /api/accounts/:id/conversations` — lista conversaciones
* `GET /api/accounts/:id/conversations/:contactId` — mensajes de un contacto
* `POST /api/accounts/:id/messages/send` — enviar texto
* `POST /api/accounts/:id/messages/send-template` — enviar template

### Templates
* `GET /api/accounts/:id/templates` — lista templates de Meta

### Webhooks
* `GET /api/webhooks/whatsapp` — Meta verification challenge
* `POST /api/webhooks/whatsapp` — incoming messages + status updates

### WebSocket
* `ws://localhost:5173/ws` (dev, via Vite proxy) / `wss://domain/ws` (prod)
* Auth: enviar `{ type: 'auth', token: 'JWT' }` como primer mensaje
* Recibe: `{ type: 'new_message' | 'status_update', data: {...} }`
* **v2: client filtra eventos por account_id — solo procesa los de la cuenta activa**

## MongoDB Collections
* **users** — { _id, email, password_hash, name, account_ids[], created_at }
* **accounts** — { _id, waba_id, phone_number_id, display_phone, access_token, token_expires_at, token_refreshed_at, business_name, meta_app_id, meta_app_secret, status, owner_user_id, created_at, updated_at }
* **contacts** — { _id, account_id, wa_id, display_name, identifier_type, created_at }
* **messages** — { _id, account_id, contact_id, wa_message_id, wa_sender_id, direction, source, type, content, status, timestamp, created_at }

## Para v3 — features pendientes
* Tests más completos (DB/routes con testcontainers)
* Producción: deploy, systemd, SSL
* Métricas / dashboard analytics
* Chatbot/auto-reply rules
* Media messages (images, documents)
* Contact management
* Registrar número real de producción (Embedded Signup flow ya implementado)
* Limpiar debug logs de WS broadcast (dejar solo errores)
* Notificación badge en AccountSelector cuando llegan mensajes a cuentas no activas
