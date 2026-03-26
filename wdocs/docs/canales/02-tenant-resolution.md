# 02 — Tenant Resolution

> **Fase:** 1
> **Estado:** borrador v0
> **Prerequisitos:** [01-multi-tenant-fundacion.md](./01-multi-tenant-fundacion.md)

## Resumen

Cada request HTTP debe resolver a que tenant pertenece antes de ejecutar cualquier logica de negocio. Se usa una **cadena de resolucion con 3 fuentes** (en orden de prioridad) y una **regla de consistencia** que previene conflictos.

## Cadena de resolucion

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

### Fuente 1: Subdomain

**Cuando se usa:** acceso via browser (dashboard), cualquier request con dominio personalizado.

```
Host: acme.coexistance.io
  → split por "."
  → primer segmento = "acme"
  → tenant = "acme"
```

**Configuracion necesaria:**
- DNS wildcard: `*.coexistance.io → IP del deployment`
- O configuracion explicita por tenant en el reverse proxy

**Excepciones:**
- `localhost` en desarrollo → no hay subdomain, usar header o JWT
- `api.coexistance.io` → reservado, no es un tenant

### Fuente 2: Header

**Cuando se usa:** llamadas API directas, inter-servicio, CLI, testing.

```
X-Tenant-Id: acme
```

Util para:
- Desarrollo local donde no hay subdomain configurado
- Comunicacion entre microservicios internos
- Scripts y herramientas CLI
- Tests automatizados

### Fuente 3: JWT claim

**Cuando se usa:** requests autenticados donde las fuentes 1 y 2 no estan presentes.

```json
{
  "sub": "user-id-123",
  "tenant": "acme",
  "iat": 1711000000,
  "exp": 1711604800
}
```

El tenant se incluye en el JWT al momento del login. El login mismo necesita resolver el tenant por subdomain o header (ya que aun no hay JWT).

## Regla de consistencia

Si hay **mas de una fuente presente**, todas deben coincidir. Si no coinciden → **403 Forbidden**.

```
subdomain = "acme", header = "acme", JWT.tenant = "acme"  → OK
subdomain = "acme", header = (none), JWT.tenant = "acme"  → OK
subdomain = "acme", header = "beta", JWT.tenant = (any)   → 403 FORBIDDEN
subdomain = (none), header = "acme", JWT.tenant = "beta"  → 403 FORBIDDEN
```

**Razon:** prevenir ataques donde un token de un tenant se usa en el contexto de otro.

## Caso especial: Webhooks

Meta (WhatsApp/Instagram) **no puede** enviar custom headers ni usar subdominios. El tenant se resuelve por **path parameter**:

```
POST /api/webhooks/whatsapp/:tenantId
POST /api/webhooks/instagram/:tenantId
GET  /api/webhooks/whatsapp/:tenantId   (verificacion)
GET  /api/webhooks/instagram/:tenantId  (verificacion)
```

**Flujo del webhook:**
1. Meta envia POST a `https://api.coexistance.io/api/webhooks/whatsapp/acme`
2. El middleware extrae `tenantId = "acme"` del path
3. Se busca la account: `{ tenant: "acme", phone_number_id: <del payload> }`
4. Si no hay match → log warning, no procesar

**Configuracion por tenant:**
- Cada tenant configura su webhook URL en Meta Developer (o la plataforma lo hace via API)
- El `META_VERIFY_TOKEN` puede ser global (plataforma) o per-tenant (almacenado en config del tenant)

## Middleware: resolve-tenant.js

```
Ubicacion: server/src/middleware/resolve-tenant.js
```

**Pseudocodigo:**

```javascript
const resolveTenant = (req, res, next) => {
  const fromSubdomain = extractSubdomain(req.headers.host)
  const fromHeader = req.headers['x-tenant-id']
  const fromJwt = req.auth?.tenant  // si require-auth ya corrio

  // Recolectar fuentes presentes
  const sources = [fromSubdomain, fromHeader, fromJwt].filter(Boolean)

  if (sources.length === 0) {
    return res.status(400).json({ error: 'tenant not resolved' })
  }

  // Validar consistencia
  const unique = [...new Set(sources)]
  if (unique.length > 1) {
    return res.status(403).json({ error: 'tenant mismatch' })
  }

  req.tenant = unique[0]
  next()
}
```

**Orden en el middleware chain:**

```
request → resolve-tenant → require-auth → route handler
```

- `resolve-tenant` puede resolver por subdomain/header sin auth
- `require-auth` verifica JWT y agrega `req.auth`
- Si JWT tiene `tenant`, `resolve-tenant` ya lo valido (o lo usara como fallback en una segunda pasada)

**Nota de implementacion:** en la practica, puede ser necesario ejecutar `resolve-tenant` en 2 fases:
1. Pre-auth: resolver por subdomain/header
2. Post-auth: validar consistencia con JWT.tenant

## Login flow

```
1. Usuario navega a acme.coexistance.io/login
2. resolve-tenant extrae "acme" del subdomain → req.tenant = "acme"
3. POST /api/auth/login { email, password }
4. find-user busca: { tenant: "acme", email }
5. Si match → create-token con { sub: userId, tenant: "acme" }
6. JWT retornado incluye tenant
7. Requests subsiguientes: subdomain + JWT.tenant validan consistencia
```

## Desarrollo local

En desarrollo local (`localhost:5173`), no hay subdomain. Opciones:

1. **Header:** el frontend en dev envia `X-Tenant-Id` automaticamente (configurable via env var `VITE_TENANT_ID`)
2. **Env var fallback:** en dev, si no hay subdomain ni header, usar `DEFAULT_TENANT` env var
3. **Archivo .env:** `DEFAULT_TENANT=acme` para desarrollo local

## Siguiente paso

→ [03-modelo-de-datos-tenant.md](./03-modelo-de-datos-tenant.md) — cambios al schema MongoDB.
