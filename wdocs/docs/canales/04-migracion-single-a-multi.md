# 04 — Migracion: Single-Tenant a Multi-Tenant

> **Fase:** 1
> **Estado:** borrador v0
> **Prerequisitos:** [03-modelo-de-datos-tenant.md](./03-modelo-de-datos-tenant.md)

## Objetivo

Migrar datos existentes de Coexistance (actualmente sin campo `tenant`) a un modelo multi-tenant, sin romper funcionalidad existente ni perder datos.

## Estrategia

1. **Agregar `tenant` a todos los documentos existentes** con valor `"acme"` (o el slug del tenant actual)
2. **Crear indices compound** con `tenant` como primer campo
3. **Eliminar indices viejos** que no incluyen tenant
4. **Actualizar aplicacion** para usar `tenant` en todas las queries
5. **Validar** que todo funciona antes y despues

## Pasos de ejecucion

### Paso 1: Backup

```bash
# Backup de la DB antes de migrar
mongodump --uri="$MONGODB_URI" --out=./backup-pre-tenant-$(date +%Y%m%d)
```

### Paso 2: Script de migracion de datos

```
Ubicacion: server/src/scripts/migrate-add-tenant.js
Parametro: TENANT (env var, default: "acme")
```

**Pseudocodigo:**

```javascript
const TENANT = process.env.TENANT || 'acme'

// 1. Agregar tenant a todos los docs que no lo tienen
for (const collection of ['users', 'accounts', 'contacts', 'messages']) {
  const result = await db.collection(collection).updateMany(
    { tenant: { $exists: false } },
    { $set: { tenant: TENANT } }
  )
  console.log(`${collection}: ${result.modifiedCount} docs updated`)
}

// 2. Verificar que no quedan docs sin tenant
for (const collection of ['users', 'accounts', 'contacts', 'messages']) {
  const count = await db.collection(collection).countDocuments({ tenant: { $exists: false } })
  if (count > 0) {
    console.error(`ERROR: ${collection} still has ${count} docs without tenant`)
    process.exit(1)
  }
}
```

### Paso 3: Script de migracion de indices

```
Ubicacion: server/src/scripts/migrate-tenant-indexes.js
```

**Pseudocodigo:**

```javascript
// --- users ---
// Drop viejo indice unique en email
await db.collection('users').dropIndex('email_1').catch(() => {})
// Crear nuevo indice compound
await db.collection('users').createIndex(
  { tenant: 1, email: 1 },
  { unique: true, name: 'tenant_email_unique' }
)

// --- accounts ---
await db.collection('accounts').dropIndex('owner_user_id_1').catch(() => {})
await db.collection('accounts').dropIndex('waba_id_1').catch(() => {})
await db.collection('accounts').createIndex(
  { tenant: 1, owner_user_id: 1 },
  { name: 'tenant_owner' }
)
await db.collection('accounts').createIndex(
  { tenant: 1, waba_id: 1 },
  { name: 'tenant_waba' }
)
await db.collection('accounts').createIndex(
  { tenant: 1, phone_number_id: 1 },
  { unique: true, name: 'tenant_phone_unique' }
)

// --- contacts ---
await db.collection('contacts').dropIndex('account_id_1_wa_id_1').catch(() => {})
await db.collection('contacts').createIndex(
  { tenant: 1, account_id: 1, wa_id: 1 },
  { unique: true, name: 'tenant_account_waid_unique' }
)
// ... sparse indices similar

// --- messages ---
await db.collection('messages').dropIndex('account_id_1_contact_id_1_created_at_-1').catch(() => {})
await db.collection('messages').createIndex(
  { tenant: 1, account_id: 1, contact_id: 1, created_at: -1 },
  { name: 'tenant_account_contact_date' }
)
```

### Paso 4: Actualizar seed.js

El seed script debe recibir `TENANT` como env var:

```bash
TENANT=acme bun server/src/scripts/seed.js
```

Si `TENANT` no esta definido, usar `"acme"` como default (backward compat para desarrollo).

### Paso 5: Actualizar connect.js

El `ensureIndexes()` en `connect.js` debe crear los nuevos indices compound en lugar de los viejos. Esto asegura que nuevas instalaciones arrancan con los indices correctos.

### Paso 6: Actualizar aplicacion

Esto se hace en paralelo con los cambios de middleware ([02-tenant-resolution.md](./02-tenant-resolution.md)):

1. Agregar middleware `resolve-tenant` en `server.js`
2. Actualizar JWT (create-token, verify-token) para incluir `tenant`
3. Actualizar todas las funciones de DB para recibir y filtrar por `tenant`
4. Actualizar routes para pasar `req.tenant` a las funciones de DB

## Orden de deployment

```
1. Deploy migracion de datos (script)     -- agrega tenant a docs existentes
2. Deploy migracion de indices (script)    -- crea compound indices, drop viejos
3. Deploy aplicacion actualizada           -- usa tenant en todo
```

**Importante:** los pasos 1 y 2 son idempotentes. Pueden correrse multiples veces sin efecto adverso.

## Rollback plan

Si algo sale mal despues de la migracion:

1. **Datos:** `tenant` es un campo nuevo — no afecta queries viejas que no lo usan
2. **Indices compound:** son un superset de los viejos — queries viejas siguen funcionando (MongoDB usa prefix matching)
3. **Backup:** restaurar desde mongodump si es necesario

```bash
mongorestore --uri="$MONGODB_URI" --drop ./backup-pre-tenant-YYYYMMDD
```

## Backward compat durante transicion

Si se necesita un periodo de transicion donde la app vieja y la nueva coexisten:

1. El middleware `resolve-tenant` acepta un `DEFAULT_TENANT` env var como fallback
2. Las funciones de DB aceptan `tenant` opcional: `const filter = tenant ? { tenant, ...rest } : rest`
3. Una vez que toda la app esta migrada, hacer el `tenant` field **required** y eliminar fallbacks

## Validacion post-migracion

```javascript
// Verificar que todos los docs tienen tenant
for (const coll of ['users', 'accounts', 'contacts', 'messages']) {
  const without = await db.collection(coll).countDocuments({ tenant: { $exists: false } })
  const total = await db.collection(coll).countDocuments()
  console.log(`${coll}: ${total} total, ${without} without tenant`)
  assert(without === 0, `${coll} has docs without tenant!`)
}

// Verificar indices
for (const coll of ['users', 'accounts', 'contacts', 'messages']) {
  const indexes = await db.collection(coll).indexes()
  const hasTenantIndex = indexes.some(i => i.key?.tenant === 1)
  console.log(`${coll}: tenant index = ${hasTenantIndex}`)
  assert(hasTenantIndex, `${coll} missing tenant index!`)
}
```

## Siguiente paso

→ [05-arquitectura-multi-canal.md](./05-arquitectura-multi-canal.md) — como agregar canales sobre la base multi-tenant.
