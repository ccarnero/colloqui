# 01 — Multi-Tenant: Fundacion

> **Fase:** 1
> **Estado:** borrador v0
> **Prerequisitos:** ninguno

## Contexto

Coexistance hoy es efectivamente **single-tenant**. El slot `{tenant}` existe en los subjects NATS y en el envelope CloudEvents, pero la capa de aplicacion no lo usa de forma consistente:

| Componente | Estado actual | Que falta |
|-----------|---------------|-----------|
| NATS subject | `evt.{tenant}.coexistance...` — slot existe | El tenant viene de `account.tenant \|\| 'default'` (fallback) |
| CloudEvents envelope | Campos `tenant`, `resource` incluyen tenant | Funciona si se le pasa el tenant correcto |
| MongoDB accounts | No tiene campo `tenant` | Agregar campo obligatorio |
| MongoDB users | No tiene campo `tenant` | Agregar campo obligatorio |
| MongoDB contacts | No tiene campo `tenant` | Agregar campo obligatorio |
| MongoDB messages | No tiene campo `tenant` | Agregar campo obligatorio |
| Auth (JWT) | Token tiene `sub` (userId) | Agregar `tenant` al payload |
| Middleware | No existe tenant resolution | Crear `resolve-tenant.js` |
| Queries | No filtran por tenant | Todas deben incluir `{ tenant }` |
| Seed script | Crea datos sin tenant | Recibir tenant como parametro |

## Modelo

```
                    ┌─────────────────────────────────┐
                    │      Coexistance (1 deploy)      │
                    │                                   │
  acme.coex.io ──▶ │   resolve-tenant middleware        │
  beta.coex.io ──▶ │          ▼                         │
                    │   req.tenant = "acme" | "beta"    │
                    │          ▼                         │
                    │   todas las queries filtran        │
                    │   por { tenant: req.tenant }       │
                    │          ▼                         │
                    │   MongoDB (colecciones compartidas │
                    │   con campo tenant en cada doc)    │
                    └─────────────────────────────────┘
```

**Un solo deployment, multiples tenants.** Los datos se aislan por campo `tenant` en MongoDB, no por base de datos separada.

## Principios

1. **Tenant obligatorio** — ningun documento se crea sin `tenant`. Ningun query se ejecuta sin filtro `{ tenant }`.
2. **Usuarios per-tenant** — un user de "acme" no puede autenticarse ni ver datos de "beta". El email `user@example.com` puede existir en ambos tenants como usuarios distintos.
3. **Aislamiento en la capa de datos** — indices compound con `tenant` como primer campo garantizan que los queries no crucen tenants accidentalmente.
4. **Bus ya preparado** — NATS subjects y CloudEvents envelopes ya transportan `tenant`. Zero cambios al bus.
5. **Backward compatible** — la migracion agrega `tenant` a datos existentes sin romper funcionalidad.

## Que funciona sin cambios

Estos componentes ya son tenant-aware y no requieren modificacion:

- `server/src/bus/build-subject.js` — acepta `{ tenant }` en el contexto
- `server/src/bus/build-envelope.js` — incluye `tenant` en el envelope
- `server/src/bus/publish-event.js` — publica con el subject completo
- `server/src/bus/subscribe.js` — puede filtrar por `evt.{tenant}.*` o `evt.>` (wildcard)
- `server/src/bus/validate-envelope.js` — valida que `tenant` no este vacio

## Que necesita cambiar

### Capa de datos (MongoDB)

| Coleccion | Cambio |
|-----------|--------|
| `accounts` | Agregar `tenant: string` (required) |
| `users` | Agregar `tenant: string` (required) |
| `contacts` | Agregar `tenant: string` (required) |
| `messages` | Agregar `tenant: string` (required) |

Detalle completo en [03-modelo-de-datos-tenant.md](./03-modelo-de-datos-tenant.md).

### Capa de autenticacion

| Componente | Cambio |
|-----------|--------|
| `auth/create-token.js` | Incluir `tenant` en el JWT payload |
| `auth/verify-token.js` | Extraer y retornar `tenant` |
| `middleware/require-auth.js` | Validar que `token.tenant === req.tenant` |

### Capa de middleware

| Componente | Cambio |
|-----------|--------|
| Nuevo: `middleware/resolve-tenant.js` | Extrae tenant de subdomain/header/JWT |
| `server.js` | Registrar middleware antes de rutas |

Detalle completo en [02-tenant-resolution.md](./02-tenant-resolution.md).

### Capa de servicios

| Servicio | Cambio |
|----------|--------|
| `services/ingress/routes.js` | Webhook URL con `:tenantId` en path |
| `services/persistence/persist-message.js` | Incluir `tenant` al guardar |
| `services/egress/routes.js` | Filtrar accounts por tenant |
| `services/sse/sse-bridge.js` | Filtrar eventos por tenant del JWT |
| `services/auto-reply/index.js` | Filtrar por tenant al buscar account |

### Capa de rutas

Todas las rutas que acceden a la DB deben incluir `tenant` en las queries:
- `routes/auth-routes.js` — login/register filtran por tenant
- `routes/account-routes.js` — listar/crear accounts con tenant
- `routes/conversation-routes.js` — conversaciones del tenant
- `routes/template-routes.js` — templates del tenant
- `routes/token-routes.js` — tokens del tenant

## Diagrama de aislamiento

```
Tenant "acme"                         Tenant "beta"
─────────────                         ─────────────
accounts: [A1, A2]                    accounts: [B1]
users: [U1, U2]                       users: [U3]
contacts: [C1..C50]                   contacts: [C51..C60]
messages: [M1..M500]                  messages: [M501..M550]

NATS subjects:                        NATS subjects:
  evt.acme.coexistance...               evt.beta.coexistance...

JWT tokens:                           JWT tokens:
  { sub: U1, tenant: "acme" }          { sub: U3, tenant: "beta" }
```

Ningun query de "acme" puede retornar datos de "beta" porque todo filtro incluye `{ tenant: "acme" }`.

## Siguiente paso

→ [02-tenant-resolution.md](./02-tenant-resolution.md) — como se resuelve el tenant en cada request.
