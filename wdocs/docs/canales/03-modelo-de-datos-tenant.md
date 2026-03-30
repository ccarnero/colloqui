# 03 — Modelo de Datos: Tenant

> **Fase:** 1
> **Estado:** borrador v0
> **Prerequisitos:** [01-multi-tenant-fundacion.md](./01-multi-tenant-fundacion.md)

## Principio

**Todo documento tiene `tenant`. Todo query filtra por `tenant`.** Sin excepciones.

El campo `tenant` es un `string` (slug del tenant, ej: `"acme"`, `"beta"`). Es el primer campo en todos los indices compound para garantizar aislamiento eficiente.

## Cambios por coleccion

### users

**Antes:**
```javascript
{
  _id: ObjectId,
  email: string,        // unique
  password_hash: string,
  name: string,
  role: "admin" | "operator",
  account_ids: [ObjectId],
  created_at: Date
}
// Indice: { email: 1 } unique
```

**Despues:**
```javascript
{
  _id: ObjectId,
  tenant: string,       // NUEVO — required
  email: string,
  password_hash: string,
  name: string,
  role: "admin" | "operator",
  account_ids: [ObjectId],
  created_at: Date
}
// Indice: { tenant: 1, email: 1 } unique  (reemplaza { email: 1 })
```

**Implicacion:** el mismo email puede existir en multiples tenants como usuarios distintos. Login requiere `{ tenant, email }`.

### accounts

**Antes:**
```javascript
{
  _id: ObjectId,
  waba_id: string,
  phone_number_id: string,
  display_phone: string,
  access_token: string,
  token_expires_at: Date,
  business_name: string,
  meta_app_id: string,
  meta_app_secret: string,
  status: string,
  owner_user_id: ObjectId,
  created_at: Date,
  updated_at: Date
}
// Indices: { owner_user_id: 1 }, { waba_id: 1 }
```

**Despues:**
```javascript
{
  _id: ObjectId,
  tenant: string,           // NUEVO — required
  waba_id: string,
  phone_number_id: string,
  display_phone: string,
  access_token: string,
  token_expires_at: Date,
  business_name: string,
  meta_app_id: string,
  meta_app_secret: string,
  status: string,
  owner_user_id: ObjectId,
  created_at: Date,
  updated_at: Date
}
// Indices:
//   { tenant: 1, owner_user_id: 1 }
//   { tenant: 1, waba_id: 1 }
//   { tenant: 1, phone_number_id: 1 } unique  (para webhook lookup)
```

**Implicacion:** webhook lookup cambia de `{ phone_number_id }` a `{ tenant, phone_number_id }`. El tenant viene del path del webhook URL.

### contacts

**Antes:**
```javascript
{
  _id: ObjectId,
  account_id: ObjectId,
  wa_id: string,
  identifier_type: "phone" | "bsuid",
  phone: string,
  bsuid: string,
  display_name: string,
  last_message_at: Date,
  created_at: Date
}
// Indices:
//   { account_id: 1, wa_id: 1 } unique
//   { account_id: 1, bsuid: 1 } sparse
//   { account_id: 1, phone: 1 } sparse
```

**Despues:**
```javascript
{
  _id: ObjectId,
  tenant: string,           // NUEVO — required
  account_id: ObjectId,
  wa_id: string,
  identifier_type: "phone" | "bsuid",
  phone: string,
  bsuid: string,
  display_name: string,
  last_message_at: Date,
  created_at: Date
}
// Indices:
//   { tenant: 1, account_id: 1, wa_id: 1 } unique
//   { tenant: 1, account_id: 1, bsuid: 1 } sparse
//   { tenant: 1, account_id: 1, phone: 1 } sparse
```

### messages

**Antes:**
```javascript
{
  _id: ObjectId,
  account_id: ObjectId,
  contact_id: ObjectId,
  wa_message_id: string,
  wa_sender_id: string,
  direction: "inbound" | "outbound",
  source: "human" | "bot" | "template",
  type: string,
  content: Object,
  status: string,
  status_history: Array,
  timestamp: Date,
  created_at: Date
}
// Indices:
//   { account_id: 1, contact_id: 1, created_at: -1 }
//   { wa_message_id: 1 } sparse
```

**Despues:**
```javascript
{
  _id: ObjectId,
  tenant: string,           // NUEVO — required
  account_id: ObjectId,
  contact_id: ObjectId,
  wa_message_id: string,
  wa_sender_id: string,
  direction: "inbound" | "outbound",
  source: "human" | "bot" | "template",
  type: string,
  content: Object,
  status: string,
  status_history: Array,
  timestamp: Date,
  created_at: Date
}
// Indices:
//   { tenant: 1, account_id: 1, contact_id: 1, created_at: -1 }
//   { tenant: 1, wa_message_id: 1 } sparse
```

## Nueva coleccion: tenants (opcional)

Si se necesita almacenar configuracion per-tenant (webhook verify token, Meta App credentials de plataforma, limites, etc.):

```javascript
{
  _id: ObjectId,
  slug: string,                 // "acme" — unique, usado como tenant ID
  name: string,                 // "Acme Corp"
  status: "active" | "suspended",
  config: {
    meta_verify_token: string,  // token para verificar webhooks (si es per-tenant)
    meta_app_id: string,        // Meta App de plataforma (si el tenant no trae la suya)
    meta_app_secret: string,
    webhook_base_url: string,   // ej: "https://api.coexistance.io/api/webhooks"
  },
  created_at: Date,
  updated_at: Date
}
// Indice: { slug: 1 } unique
```

**Nota:** esta coleccion es opcional en v1. Si no existe, la configuracion del tenant puede venir de env vars o del account. Evaluar si se necesita antes de implementar.

## Resumen de indices

| Coleccion | Indice | Tipo |
|-----------|--------|------|
| users | `{ tenant, email }` | unique |
| accounts | `{ tenant, owner_user_id }` | regular |
| accounts | `{ tenant, waba_id }` | regular |
| accounts | `{ tenant, phone_number_id }` | unique |
| contacts | `{ tenant, account_id, wa_id }` | unique |
| contacts | `{ tenant, account_id, bsuid }` | sparse |
| contacts | `{ tenant, account_id, phone }` | sparse |
| messages | `{ tenant, account_id, contact_id, created_at: -1 }` | regular |
| messages | `{ tenant, wa_message_id }` | sparse |
| tenants | `{ slug }` | unique |

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `server/src/db/connect.js` | Crear nuevos indices compound (drop viejos) |
| `server/src/db/users/create-user.js` | Agregar `tenant` al documento |
| `server/src/db/users/find-user.js` | Filtrar por `{ tenant, email }` |
| `server/src/db/accounts/create-account.js` | Agregar `tenant` al documento |
| `server/src/db/accounts/find-account.js` | Filtrar por `{ tenant, ... }` |
| `server/src/db/contacts/upsert-contact.js` | Agregar `tenant` al filtro y al doc |
| `server/src/db/messages/save-message.js` | Agregar `tenant` al documento |
| `server/src/db/messages/find-messages.js` | Filtrar por `{ tenant, ... }` |
| `server/src/db/messages/update-status.js` | Filtrar por `{ tenant, ... }` |
| `server/src/scripts/seed.js` | Recibir `TENANT` env var, incluirlo en docs |

## Siguiente paso

→ [04-migracion-single-a-multi.md](./04-migracion-single-a-multi.md) — como migrar datos existentes.
