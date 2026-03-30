---
name: multi-tenant
description: >
  Patrones de arquitectura multi-tenant para Coexistance: resolución de tenant, aislamiento de datos, índices compound, y migración.
  Trigger: Cuando se trabaja con múltiples tenants, resolución de tenant, aislamiento de datos, o migraciones de DB.
license: Apache-2.0
metadata:
  author: Yoizen
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "tenant"
    - "multi-tenant"
    - "tenant resolution"
    - "tenant isolation"
    - "migration"
---

## When to Use

- Implementar o modificar sistema multi-tenant
- Resolver tenant desde requests (subdomain, header, JWT)
- Diseñar modelo de datos con aislamiento por tenant
- Crear índices compound con tenant
- Migrar de single-tenant a multi-tenant
- Implementar middleware de resolución de tenant
- Validar consistencia de tenant entre fuentes

---

## Critical Patterns

### 1. Principios Fundamentales

```
┌─────────────────────────────────────────┐
│  Coexistance (1 deployment)            │
│                                         │
│  acme.coex.io ──▶ resolve-tenant        │
│  beta.coex.io ──▶    middleware         │
│                       ▼                 │
│              req.tenant = "acme"         │
│                       ▼                 │
│         todas las queries filtran       │
│            por { tenant }               │
│                       ▼                 │
│     MongoDB (colecciones compartidas    │
│       con campo tenant en cada doc)     │
└─────────────────────────────────────────┘
```

**5 Principios:**
1. **Tenant obligatorio** — ningún documento sin `tenant`. Ningún query sin filtro `{ tenant }`
2. **Usuarios per-tenant** — mismo email puede existir en múltiples tenants
3. **Aislamiento en capa de datos** — índices compound con `tenant` primero
4. **Bus ya preparado** — NATS subjects y CloudEvents ya transportan `tenant`
5. **Backward compatible** — migración agrega `tenant` sin romper funcionalidad

### 2. Cadena de Resolución de Tenant

3 fuentes en orden de prioridad:

```
Request entrante
     │
     ▼
  1. Subdomain?  acme.coexistance.io → tenant = "acme"
     │ (no encontrado)
     ▼
  2. Header?     X-Tenant-Id: acme → tenant = "acme"
     │ (no encontrado)
     ▼
  3. JWT claim?  { tenant: "acme" } → tenant = "acme"
     │ (no encontrado)
     ▼
  ❌ 400 Bad Request — "tenant not resolved"
```

**Fuentes:**

| Fuente | Cuándo usar | Ejemplo |
|--------|-------------|---------|
| **Subdomain** | Acceso browser, dominios personalizados | `acme.coexistance.io` → `acme` |
| **Header** | API directa, inter-servicio, CLI, testing | `X-Tenant-Id: acme` |
| **JWT claim** | Requests autenticados | `{ tenant: "acme" }` en payload |

### 3. Regla de Consistencia

**Si hay múltiples fuentes presentes, todas deben coincidir.**

```
subdomain = "acme", header = "acme", JWT.tenant = "acme"  → ✅ OK
subdomain = "acme", header = (none), JWT.tenant = "acme"   → ✅ OK  
subdomain = "acme", header = "beta", JWT.tenant = (any)    → ❌ 403 FORBIDDEN
```

### 4. Middleware: resolve-tenant.js

```javascript
// middleware/resolve-tenant.js
const resolveTenant = (req, res, next) => {
  const fromSubdomain = extractSubdomain(req.headers.host);
  const fromHeader = req.headers["x-tenant-id"];
  const fromJwt = req.auth?.tenant; // si require-auth ya corrió

  // Recolectar fuentes presentes
  const sources = [fromSubdomain, fromHeader, fromJwt].filter(Boolean);

  if (sources.length === 0) {
    return res.status(400).json({ error: "tenant not resolved" });
  }

  // Validar consistencia
  const unique = [...new Set(sources)];
  if (unique.length > 1) {
    return res.status(403).json({ error: "tenant mismatch" });
  }

  req.tenant = unique[0];
  next();
};
```

**Orden en middleware chain:**
```
request → resolve-tenant → require-auth → route handler
```

### 5. Modelo de Datos MongoDB

**Campo `tenant: string` (slug) en TODOS los documentos:**

| Colección | Campo tenant | Índice compound |
|-----------|---------------|-----------------|
| `users` | `tenant: string` | `{ tenant: 1, email: 1 }` unique |
| `accounts` | `tenant: string` | `{ tenant: 1, phone_number_id: 1 }` unique |
| `contacts` | `tenant: string` | `{ tenant: 1, account_id: 1, wa_id: 1 }` unique |
| `messages` | `tenant: string` | `{ tenant: 1, account_id: 1, contact_id: 1, created_at: -1 }` |

**Reglas de índices:**
- `tenant` siempre PRIMER campo en índices compound
- Reemplazar índices únicos viejos (`{ email: 1 }`) con compound (`{ tenant: 1, email: 1 }`)
- Índices existentes siguen funcionando (prefix matching) durante transición

### 6. Caso Especial: Webhooks

Meta (WhatsApp/Instagram) no puede enviar headers custom ni usar subdominios. **Tenant por path parameter:**

```
POST /api/webhooks/whatsapp/:tenantId
GET  /api/webhooks/whatsapp/:tenantId  (verificación)
```

**Flujo:**
1. Meta envía POST a `https://api.coexistance.io/api/webhooks/whatsapp/acme`
2. Middleware extrae `tenantId = "acme"` del path
3. Buscar account: `{ tenant: "acme", phone_number_id: <del payload> }`

### 7. Login Flow Multi-Tenant

```
1. Usuario navega a acme.coexistance.io/login
2. resolve-tenant extrae "acme" del subdomain → req.tenant = "acme"
3. POST /api/auth/login { email, password }
4. find-user busca: { tenant: "acme", email }
5. Si match → create-token con { sub: userId, tenant: "acme" }
6. JWT retornado incluye tenant
7. Requests subsiguientes: subdomain + JWT.tenant validan consistencia
```

### 8. Desarrollo Local

En `localhost:5173`, no hay subdomain. Opciones:
1. **Header:** frontend en dev envía `X-Tenant-Id` automáticamente
2. **Env var fallback:** `DEFAULT_TENANT=acme` si no hay subdomain ni header
3. **Configuración:** `VITE_TENANT_ID` en `.env` del cliente

### 9. Migración: Single a Multi-Tenant

**Orden de deployment:**
```
1. Deploy migración de datos (script)      → agrega tenant a docs existentes
2. Deploy migración de índices (script)     → crea compound, elimina viejos
3. Deploy aplicación actualizada            → usa tenant en todo
```

**Scripts idempotentes:**
- `migrate-add-tenant.js` — agrega `tenant` a docs sin el campo
- `migrate-tenant-indexes.js` — crea compound indices, drop viejos

**Backward compat:**
- Campo `tenant` nuevo — no afecta queries viejas
- Índices compound son superset de viejos — prefix matching
- `DEFAULT_TENANT` env var como fallback

---

## Code Examples

### Extract Subdomain

```typescript
// lib/extract-subdomain.ts
export function extractSubdomain(host: string): string | null {
  // Ignorar localhost y IPs
  if (!host || host.includes("localhost") || /^[\d.]+$/.test(host)) {
    return null;
  }
  
  // Ignorar dominios reservados
  const reserved = ["api", "www", "admin", "app"];
  const parts = host.split(".");
  const subdomain = parts[0];
  
  if (reserved.includes(subdomain)) {
    return null;
  }
  
  return subdomain;
}

// Tests:
// "acme.coexistance.io" → "acme"
// "api.coexistance.io" → null (reservado)
// "localhost:5173" → null
```

### Middleware Completo

```typescript
// middleware/resolve-tenant.ts
import { extractSubdomain } from "../lib/extract-subdomain.js";

const DEFAULT_TENANT = process.env.DEFAULT_TENANT;

export function resolveTenant(req: Request, res: Response, next: NextFunction) {
  // 1. Extraer de todas las fuentes
  const fromSubdomain = extractSubdomain(req.headers.host);
  const fromHeader = req.headers["x-tenant-id"] as string | undefined;
  const fromPath = req.params?.tenantId; // para webhooks
  const fromJwt = (req as any).auth?.tenant;
  
  // 2. Recolectar fuentes presentes
  const sources = [fromSubdomain, fromHeader, fromPath, fromJwt].filter(Boolean);
  
  // 3. Fallback para desarrollo
  if (sources.length === 0 && DEFAULT_TENANT) {
    sources.push(DEFAULT_TENANT);
  }
  
  // 4. Validar que hay al menos una fuente
  if (sources.length === 0) {
    return res.status(400).json({ 
      error: "tenant not resolved",
      message: "Provide tenant via subdomain, X-Tenant-Id header, or JWT" 
    });
  }
  
  // 5. Validar consistencia
  const unique = [...new Set(sources)];
  if (unique.length > 1) {
    return res.status(403).json({
      error: "tenant mismatch",
      sources: { fromSubdomain, fromHeader, fromPath, fromJwt }
    });
  }
  
  // 6. Asignar y continuar
  (req as any).tenant = unique[0];
  next();
}
```

### Funciones de DB con Tenant

```typescript
// db/users/find-user.ts
import { ok, err } from "../../lib/result.js";

export async function findUser(
  db: Db,
  tenant: string,
  email: string
): Promise<Result<User | null, string>> {
  // SIEMPRE filtrar por tenant PRIMERO
  const user = await db
    .collection("users")
    .findOne({ tenant, email });
  
  return ok(user);
}

// Uso:
// const user = await findUser(db, req.tenant, email);
```

### Crear Documento con Tenant

```typescript
// db/accounts/create-account.ts
export async function createAccount(
  db: Db,
  tenant: string,
  data: CreateAccountData
): Promise<Result<Account, string>> {
  const account = {
    tenant, // ← campo obligatorio
    ...data,
    created_at: new Date(),
    updated_at: new Date(),
  };
  
  const result = await db.collection("accounts").insertOne(account);
  return ok({ ...account, _id: result.insertedId });
}
```

### Índices Compound

```typescript
// db/connect.ts — ensureIndexes
export async function ensureIndexes(db: Db): Promise<void> {
  // users: tenant + email (unique)
  await db.collection("users").createIndex(
    { tenant: 1, email: 1 },
    { unique: true, name: "tenant_email_unique" }
  );
  
  // accounts: tenant + phone_number_id (unique, para webhooks)
  await db.collection("accounts").createIndex(
    { tenant: 1, phone_number_id: 1 },
    { unique: true, name: "tenant_phone_unique" }
  );
  
  // accounts: tenant + owner
  await db.collection("accounts").createIndex(
    { tenant: 1, owner_user_id: 1 },
    { name: "tenant_owner" }
  );
  
  // contacts: tenant + account + wa_id
  await db.collection("contacts").createIndex(
    { tenant: 1, account_id: 1, wa_id: 1 },
    { unique: true, name: "tenant_account_waid_unique" }
  );
  
  // messages: tenant + account + contact + fecha
  await db.collection("messages").createIndex(
    { tenant: 1, account_id: 1, contact_id: 1, created_at: -1 },
    { name: "tenant_account_contact_date" }
  );
}
```

### JWT con Tenant

```typescript
// auth/create-token.ts
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = "7d";

export function createToken(userId: string, tenant: string): string {
  return jwt.sign(
    { 
      sub: userId,
      tenant, // ← incluir tenant en JWT
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// auth/verify-token.ts
export function verifyToken(token: string): Result<{ sub: string; tenant: string }, string> {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; tenant: string };
    return ok({ sub: decoded.sub, tenant: decoded.tenant });
  } catch (error) {
    return err("invalid_token");
  }
}
```

### Script de Migración

```typescript
// scripts/migrate-add-tenant.ts
const DEFAULT_TENANT = process.env.TENANT || "acme";

async function migrate() {
  const collections = ["users", "accounts", "contacts", "messages"];
  
  // 1. Agregar tenant a docs que no lo tienen
  for (const collection of collections) {
    const result = await db.collection(collection).updateMany(
      { tenant: { $exists: false } },
      { $set: { tenant: DEFAULT_TENANT } }
    );
    console.log(`${collection}: ${result.modifiedCount} docs updated`);
  }
  
  // 2. Verificar que no quedan docs sin tenant
  for (const collection of collections) {
    const count = await db.collection(collection).countDocuments({
      tenant: { $exists: false }
    });
    if (count > 0) {
      throw new Error(`${collection} still has ${count} docs without tenant`);
    }
  }
  
  console.log("Migration completed successfully");
}
```

---

## Commands

```bash
# Migrar datos existentes
TENANT=acme bun server/src/scripts/migrate-add-tenant.js

# Crear índices compound
bun server/src/scripts/migrate-tenant-indexes.js

# Seed con tenant específico
TENANT=acme bun server/src/scripts/seed.js

# Validar migración
bun server/src/scripts/validate-tenant-migration.js
```

---

## Resources

- **Templates**: See [assets/](assets/) para templates de middleware, funciones de DB, y scripts de migración
- **Documentation**: See [references/](references/) para documentos completos de:
  - Fundación multi-tenant
  - Resolución de tenant
  - Modelo de datos
  - Migración single→multi
