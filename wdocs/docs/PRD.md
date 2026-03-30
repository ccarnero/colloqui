# PRD: WhatsApp Business Platform MVP

**Nombre interno:** Coexistance
**Autor:** Chris + Claude (PM)
**Fecha:** 2026-03-14
**Status:** Draft v2 — constraints actualizados

---

## 1. Problem Statement

Configurar una línea de atención al cliente por WhatsApp Business API es un proceso técnicamente complejo que requiere navegar múltiples pantallas de Meta for Developers, gestionar tokens, configurar webhooks, verificar números y entender el sistema de templates. Este proceso es una barrera de entrada tanto para PyMEs que no tienen equipo técnico, como para developers que quieren integrar WhatsApp en sus productos sin dedicar semanas a entender la plataforma de Meta.

Soluciones existentes como Kapso.ai simplifican el onboarding, pero el mercado aún no tiene una opción open-source o white-label que permita a un developer levantar su propia plataforma de atención al cliente por WhatsApp con control total.

**Quién experimenta este problema:** Negocios pequeños y medianos que quieren atención por WhatsApp, y developers/agencies que quieren ofrecer esto como servicio.

**Costo de no resolverlo:** Los negocios terminan usando la app de WhatsApp Business manualmente (no escala), o pagando plataformas caras ($50-200/mes) por funcionalidad básica.

---

## 2. Goals

| # | Goal | Tipo | Cómo medimos éxito |
|---|------|------|---------------------|
| G1 | Un usuario puede conectar su número de WhatsApp a la plataforma en menos de 5 minutos | User | Tiempo desde "start" hasta primer mensaje recibido |
| G2 | Validar la integración técnica completa con la Cloud API de Meta (envío, recepción, templates) | Business | Todos los endpoints core funcionando end-to-end |
| G3 | Arquitectura multi-tenant desde el día 1 | Business | Puede soportar N cuentas aisladas sin refactoreo |
| G4 | Chris entiende el flujo completo de WhatsApp Cloud API al terminar el MVP | User/Dev | Puede explicar cada paso del pipeline sin consultar docs |

---

## 3. Non-Goals (v1)

| Non-Goal | Por qué está fuera de scope |
|----------|---------------------------|
| Chatbot con IA / respuestas automáticas inteligentes | Es una feature enorme que merece su propio PRD; el MVP es el "plumbing" |
| Business Verification con Meta | Proceso manual que depende de Meta; el MVP funciona con sandbox/test numbers |
| Facturación y planes de pago | Premature — primero validar que la plataforma técnica funciona |
| App móvil | El dashboard web es suficiente para el MVP |
| Modo Coexistence (app + API en el mismo número) | Requiere número real verificado; el sandbox no lo soporta |
| Soporte multi-idioma en la UI | La UI será en español/inglés básico; internacionalización es v2 |

---

## 4. User Stories

### Persona 1: Chris (Developer / Platform Owner)
- **US-01:** Como developer, quiero configurar el backend con un solo comando (`bun install && bun run dev`) para que pueda iterar rápido sin setup complejo.
- **US-02:** Como developer, quiero recibir webhooks de WhatsApp en mi servidor local para poder debuggear mensajes entrantes en tiempo real.
- **US-03:** Como developer, quiero ver logs claros de cada interacción con la API de Meta para entender qué está pasando cuando algo falla.

### Persona 2: Business User (futuro cliente de la plataforma)
- **US-04:** Como dueño de negocio, quiero conectar mi número de WhatsApp a la plataforma sin salir de la app para no tener que entender Meta for Developers.
- **US-05:** Como dueño de negocio, quiero ver todas mis conversaciones en un dashboard para no tener que revisar mensajes uno por uno en mi teléfono.
- **US-06:** Como dueño de negocio, quiero responder a mis clientes desde el dashboard para centralizar mi atención al cliente.
- **US-07:** Como dueño de negocio, quiero enviar un mensaje proactivo usando un template aprobado para notificar a mis clientes sobre ofertas o actualizaciones.

### Edge Cases
- **US-08:** Como usuario, quiero ver un error claro si mi token de acceso expira para saber que necesito reconectar.
- **US-09:** Como usuario, quiero que la plataforma valide mi webhook URL antes de guardarla para evitar configuraciones rotas.
- **US-10:** Como usuario, quiero ver un estado "desconectado" si Meta restringe temporalmente mi cuenta para no confundirme pensando que la plataforma falló.

---

## 5. Requirements

### Must-Have (P0) — el MVP no sale sin esto

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| **R-01** | **Onboarding via Embedded Signup** | Given un usuario nuevo, When hace click en "Conectar WhatsApp", Then se abre el flujo de Meta Embedded Signup; When completa el flujo, Then la app recibe el WABA ID y token y los persiste en MongoDB |
| **R-02** | **Webhook receiver** | Given un webhook configurado en Meta, When un cliente envía un mensaje por WhatsApp, Then el servidor lo recibe, parsea, y almacena en la colección `messages` con timestamp, sender, content, y account_id |
| **R-03** | **Envío de mensajes (reply)** | Given una conversación abierta (dentro de la ventana de 24h), When el operador escribe una respuesta, Then la app envía el mensaje via Cloud API y actualiza el estado (sent/delivered/read) |
| **R-04** | **Envío de templates** | Given un template aprobado en Meta, When el operador selecciona un template y un destinatario, Then la app envía el template message via Cloud API |
| **R-05** | **Multi-tenancy** | Given múltiples cuentas, When cada una recibe mensajes, Then los datos están aislados por `account_id` y un usuario solo ve sus propias conversaciones |
| **R-06** | **Dashboard: lista de conversaciones** | Given un usuario autenticado, When accede al dashboard, Then ve una lista de conversaciones ordenadas por último mensaje, con preview del último mensaje y nombre/número del contacto |
| **R-07** | **Dashboard: vista de conversación** | Given una conversación seleccionada, When el usuario la abre, Then ve el historial de mensajes en formato chat (burbujas) con timestamps, y un input para responder |
| **R-08** | **Auth básica** | Given un usuario, When intenta acceder al dashboard, Then debe autenticarse (email/password con JWT es suficiente para el MVP) |

| **R-08b** | **Soporte BSUID (WhatsApp Usernames)** | Given un webhook donde el campo `from` es un BSUID (alfanumérico, no E.164), When el sistema procesa el mensaje, Then identifica correctamente al contacto usando `parseSenderId()`, crea/actualiza el contacto con `identifier_type: "bsuid"`, y el mensaje se asocia correctamente. El sistema NUNCA asume que `from`/`to` es un phone number. |

### Nice-to-Have (P1) — mejoran mucho la experiencia pero no bloquean launch

| ID | Requirement |
|----|-------------|
| **R-09** | Status de conexión en tiempo real (WebSocket) — indicador visual de si el webhook está activo |
| **R-10** | Gestión de templates desde la UI (listar, crear draft, ver status de aprobación) |
| **R-11** | Indicadores de delivery status (sent ✓, delivered ✓✓, read ✓✓ azul) |
| **R-12** | Soporte para media messages (imágenes, documentos, audio) — tanto enviar como recibir |
| **R-13** | Búsqueda de conversaciones por nombre o número |

### Future Considerations (P2) — no lo construimos pero lo diseñamos para que sea posible

| ID | Requirement | Implicación arquitectónica |
|----|-------------|---------------------------|
| **R-14** | Chatbot / auto-responses | El modelo de mensajes debe soportar `source: "bot" | "human"` desde el inicio |
| **R-15** | Múltiples operadores por cuenta | El schema de usuario necesita roles (admin, operator) desde ahora |
| **R-16** | Analytics (mensajes/día, tiempo de respuesta, satisfaction) | Los mensajes deben tener timestamps precisos y status transitions guardados |
| **R-17** | Billing / usage metering | Cada mensaje debe trackear `account_id` para poder agregar costos por cuenta |

---

## 6. Code Philosophy & Constraints

### Principios Fundamentales

- **Functional Programming nativo** — sin clases, sin `this`, sin herencia. Funciones puras, composición, y datos inmutables.
- **Sin librerías FP exóticas** — no fp-ts, no ramda, no sanctuary. Usamos los patterns (Result types, pipe, Either-like) pero implementados con JS vanilla.
- **KISS** — si algo se puede resolver con un `if` y un `return`, no necesita una abstracción.
- **Una función exportada por archivo, máximo 200 líneas** — helpers internos del archivo están permitidos, pero el export default es uno solo.
- **Sin OOP bajo ningún concepto** — ni Mongoose models con métodos, ni class-based anything. MongoDB se accede con el driver nativo y funciones.

### Patterns Permitidos

```javascript
// Result type casero (Either-like sin librería)
const ok = (data) => ({ ok: true, data })
const err = (error) => ({ ok: false, error })

// Uso
const result = await sendMessage(accountId, to, text)
if (!result.ok) return res.status(400).json({ error: result.error })

// Pipe simple (sin librería)
const pipe = (...fns) => (x) => fns.reduce((acc, fn) => fn(acc), x)

// Composición de validaciones
const validateMessage = pipe(
  requireField('to'),
  requireField('text'),
  validatePhoneFormat
)
```

### Patterns Prohibidos

```javascript
// ❌ Clases
class MessageService { ... }

// ❌ this
function send() { this.client.post(...) }

// ❌ Mongoose models con métodos
const MessageSchema = new Schema({...})
MessageSchema.methods.markAsRead = function() { ... }

// ❌ Herencia / extends
class WhatsAppService extends BaseService { ... }

// ❌ Librerías FP exóticas
import { pipe, flow, Either } from 'fp-ts'
```

### Estructura de archivos (una función = un archivo)

```
src/
├── config/
│   └── env.js                    ← readEnv() — lee y valida env vars
├── db/
│   ├── connect.js                ← connectDb() — conexión MongoDB
│   ├── accounts/
│   │   ├── create-account.js     ← createAccount(db, data)
│   │   ├── find-account.js       ← findAccount(db, query)
│   │   └── update-account.js     ← updateAccount(db, id, data)
│   ├── messages/
│   │   ├── save-message.js       ← saveMessage(db, message)
│   │   ├── find-messages.js      ← findMessages(db, query)
│   │   └── update-status.js      ← updateMessageStatus(db, waMessageId, status)
│   ├── contacts/
│   │   ├── upsert-contact.js     ← upsertContact(db, accountId, contactData)
│   └── find-contact-by-wa-id.js ← findContactByWaId(db, accountId, waId) — busca por BSUID o phone
│   └── users/
│       ├── create-user.js        ← createUser(db, userData)
│       └── find-user.js          ← findUser(db, query)
├── meta/
│   ├── send-text.js              ← sendText(token, phoneNumberId, to, text)
│   ├── send-template.js          ← sendTemplate(token, phoneNumberId, to, templateName, lang)
│   ├── fetch-templates.js        ← fetchTemplates(token, wabaId)
│   ├── verify-webhook.js         ← verifyWebhook(query, verifyToken)
│   ├── parse-webhook.js          ← parseWebhook(body) — extrae mensajes/status del payload
│   └── parse-sender-id.js        ← parseSenderId(rawId) → { value, type: "phone"|"bsuid" }
├── auth/
│   ├── hash-password.js          ← hashPassword(plain)
│   ├── verify-password.js        ← verifyPassword(plain, hash)
│   ├── create-token.js           ← createToken(userId)
│   └── verify-token.js           ← verifyToken(token)
├── routes/
│   ├── auth-routes.js            ← registerAuthRoutes(app, db)
│   ├── account-routes.js         ← registerAccountRoutes(app, db)
│   ├── conversation-routes.js    ← registerConversationRoutes(app, db)
│   ├── message-routes.js         ← registerMessageRoutes(app, db)
│   └── webhook-routes.js         ← registerWebhookRoutes(app, db)
├── middleware/
│   ├── require-auth.js           ← requireAuth(db) — middleware JWT
│   └── require-account.js        ← requireAccount(db) — verifica ownership
├── lib/
│   ├── result.js                 ← ok(), err() — Result type
│   ├── pipe.js                   ← pipe() — composición
│   └── http.js                   ← fetchJson() — wrapper de fetch con Result type
└── server.js                     ← startServer() — entry point, compone todo
```

---

## 7. Technical Architecture (High-Level)

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)           │
│  ┌─────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Auth    │  │ Conversations│  │   Templates   │  │
│  │  Pages   │  │   Dashboard  │  │   Manager     │  │
│  └─────────┘  └──────────────┘  └───────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │ REST API + WebSocket
┌──────────────────────┴──────────────────────────────┐
│                 Backend (Bun + Express)              │
│                                                      │
│  Funciones puras — sin clases, sin OOP              │
│  MongoDB driver nativo — sin Mongoose               │
│  Result types (ok/err) para error handling           │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ auth/*   │  │ meta/*   │  │ routes/webhook   │  │
│  │ (JWT)    │  │ (Cloud   │  │ (verify + parse) │  │
│  │          │  │  API)    │  │                   │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────┴────────┐
              │    MongoDB      │
              │  (driver nativo)│
              │  ┌────────────┐ │
              │  │ accounts   │ │
              │  │ messages   │ │
              │  │ contacts   │ │
              │  │ users      │ │
              │  └────────────┘ │
              └─────────────────┘
```

### Stack Definido

| Capa | Tecnología | Justificación |
|------|-----------|---------------|
| Runtime | Bun.js | Rápido, compatible con npm, built-in test runner |
| Framework HTTP | Express | Chris lo conoce, máxima documentación |
| Base de datos | MongoDB (**driver nativo**, sin Mongoose) | Sin OOP — funciones puras que reciben `db` como argumento |
| Frontend | React + Vite + Tailwind + shadcn/ui | Componentes pre-armados, zero-config, ideal para backend devs |
| Auth | JWT (jsonwebtoken) | Simple, stateless, suficiente para MVP |
| Real-time | WebSocket (ws) | Para updates de mensajes en tiempo real al dashboard |
| Webhooks (dev) | Cloudflare Tunnel | Chris ya tiene configuración de otro proyecto |

### Colecciones MongoDB (documentos planos, sin Mongoose)

```javascript
// accounts — una por cada WhatsApp Business Account conectada
// Acceso: db.collection('accounts').insertOne(accountDoc)
{
  _id,
  waba_id,           // WhatsApp Business Account ID de Meta
  phone_number_id,   // Phone Number ID para enviar mensajes
  display_phone,     // Número visible (+52 55 1234 5678)
  access_token,      // Token encriptado
  token_expires_at,
  business_name,
  status,            // "active" | "restricted" | "disconnected"
  owner_user_id,     // ref a users
  created_at, updated_at
}

// messages
{
  _id,
  account_id,        // ref a accounts (multi-tenancy key)
  contact_id,        // ref a contacts
  wa_message_id,     // ID de WhatsApp para dedup y status updates
  wa_sender_id,      // El from/to raw de Meta (BSUID o phone) — para trazabilidad
  direction,         // "inbound" | "outbound"
  source,            // "human" | "bot" | "template" (P2-ready)
  type,              // "text" | "template" | "image" | "document" | ...
  content: {
    text,            // para mensajes de texto
    template_name,   // para templates
    media_url,       // para media (P1)
  },
  status,            // "sent" | "delivered" | "read" | "failed"
  status_history,    // [{ status, timestamp }] (P2: analytics-ready)
  timestamp,
  created_at
}

// contacts — BSUID-ready desde día 1
// Un contacto se identifica por BSUID *o* phone, nunca asumimos cuál viene.
// Ref: WhatsApp Usernames rollout junio 2026 — el campo from/to en webhooks
// puede traer un BSUID (alfanumérico, hasta 128 chars) en vez de phone E.164.
{
  _id,
  account_id,
  bsuid,             // Business-Scoped User ID (único por business+user) — puede ser null si el user no activó usernames
  phone,             // Número E.164 — puede ser null si el user ocultó su número via username
  wa_id,             // El identificador que Meta envía en from/to (es bsuid O phone, lo que venga)
  identifier_type,   // "phone" | "bsuid" — indica qué tipo es wa_id
  display_name,
  last_message_at,
  created_at
}

// users
{
  _id,
  email,
  password_hash,
  name,
  role,              // "admin" | "operator" (P2-ready)
  account_ids,       // array de accounts a las que tiene acceso
  created_at
}
```

### API Endpoints

```
Auth
  POST   /api/auth/register
  POST   /api/auth/login
  GET    /api/auth/me

Accounts (WhatsApp connections)
  POST   /api/accounts/connect        ← inicia Embedded Signup
  POST   /api/accounts/callback       ← callback de Meta post-signup
  GET    /api/accounts                 ← lista cuentas del usuario
  GET    /api/accounts/:id/status      ← estado de la conexión

Conversations
  GET    /api/accounts/:id/conversations          ← lista con último mensaje
  GET    /api/accounts/:id/conversations/:contactId ← historial de mensajes

Messages
  POST   /api/accounts/:id/messages/send           ← enviar reply
  POST   /api/accounts/:id/messages/send-template  ← enviar template

Templates
  GET    /api/accounts/:id/templates               ← listar templates de Meta

Webhooks (Meta → nuestro server)
  GET    /api/webhooks/whatsapp        ← verification challenge
  POST   /api/webhooks/whatsapp        ← incoming messages + status updates
```

---

## 8. Success Metrics

| Metric | Target (MVP) | Cómo medimos | Cuándo evaluamos |
|--------|-------------|-------------|-----------------|
| Tiempo de setup (developer) | < 10 min desde `git clone` hasta recibir primer webhook | Manual timing | Semana 1 |
| Tiempo de onboarding (business user) | < 5 min desde login hasta número conectado | Timestamps en DB | Semana 2 |
| Mensajes enviados/recibidos sin error | > 95% success rate | Logs + status tracking | Ongoing |
| Latencia webhook → mensaje en dashboard | < 2 segundos | Timestamp diff | Semana 2 |
| Número de cuentas simultáneas sin degradación | ≥ 10 | Load test básico | Pre-launch |

---

## 9. Open Questions

| # | Pregunta | Quién responde | Bloquea? |
|---|---------|---------------|----------|
| Q1 | ¿Chris tiene o creará una Meta Business Account para development? | Chris | Sí — necesaria para Embedded Signup |
| Q2 | ¿Se usará el test number de Meta para todo el desarrollo o un número real? | Chris | No — test number es suficiente para empezar |
| Q3 | ¿Dónde se desplegará? (localhost, VPS, serverless) — los webhooks de Meta necesitan HTTPS público | Chris + Claude | Sí — afecta cómo exponemos el webhook |
| Q4 | ¿Se necesita encriptar los access tokens en MongoDB o es suficiente seguridad a nivel de DB? | Engineering | No — empezamos con .env + DB segura, encriptación de tokens es P1 |
| Q5 | ¿El frontend se servirá desde el mismo server Express o como app separada? | Engineering | No — Vite dev server separado en dev, build estático servido por Express en prod |

---

## 10. Implementation Phases

### Fase 1: Backend Core (el esqueleto)
- Setup del proyecto (Bun + Express + MongoDB + estructura de carpetas)
- Auth (register, login, JWT middleware)
- Webhook handler (verify + receive messages + status updates)
- Meta Cloud API client (send text, send template)
- Colecciones de MongoDB con driver nativo (funciones puras, sin Mongoose)

### Fase 2: Embedded Signup
- Integración del flujo de Meta Embedded Signup
- Callback handler para capturar WABA ID + token
- Persistencia de la cuenta conectada

### Fase 3: Frontend MVP
- Setup React + Vite + Tailwind + shadcn/ui
- Login / Register
- Dashboard de conversaciones (lista + chat view)
- Envío de mensajes (reply en ventana 24h)
- Envío de templates (seleccionar + enviar)

### Fase 4: Polish + Testing
- WebSocket para real-time updates
- Error handling robusto
- Status de conexión visual
- Test suite básico
- Documentación de setup

---

*Documento generado como parte del proceso de product definition para Coexistance MVP.*
