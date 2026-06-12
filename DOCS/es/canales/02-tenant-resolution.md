# 02 — Tenant Resolution

> **Estado:** implementado
> **Prerequisitos:** [01-multi-tenant-fundacion.md](./01-multi-tenant-fundacion.md)

## Resumen

`TenantGuard` en `api-gateway` resuelve el tenant antes de que cualquier handler de ruta lo procese. Usa dos fuentes en orden de prioridad. Los endpoints de webhook son la excepción: resuelven tenant desde el path param (`:tenantId`).

Archivo: `services/api-gateway/src/guards/tenant.guard.ts`

## Cadena de resolución (requests normales)

```
Request entrante (con JWT)
     │
     ▼
  1. Hostname?  acme.dev.yplatform.com → tenant = "acme"
     │ (no encontrado — ej: localhost)
     ▼
  2. Header?   x-yoizen-tenant: acme → tenant = "acme"
     │ (no encontrado)
     ▼
  ❌ 400 Bad Request — tenant no resuelto
```

### Fuente 1: Hostname

**Formato:** `<env>.<tenant>.yplatform.com`

```
Host: acme.dev.yplatform.com
  → partes: ["acme", "dev", "yplatform", "com"]
  → tenant = "acme"
  → env    = "dev"
```

**Configuración:** hostnames viven como Knative Services + Ingress en el cluster. En dev local con OrbStack/minikube se usa el dominio `dev.local` configurado en el ConfigMap `config-domain` de Knative.

### Fuente 2: Header

```
x-yoizen-tenant: acme
```

Constante: `TENANT_HEADER` en `packages/shared/src/constants.ts`.

Se usa en:
- Comunicación entre servicios internos
- Llamadas desde herramientas CLI / `kubectl port-forward`
- Entornos de desarrollo local donde no hay dominio configurado

## Caso especial: Webhooks

Los endpoints de webhook son públicos (`@Public()`, `@SkipTenant()`): no pasan por `TenantGuard`. El tenant se extrae directamente del path:

```
POST /webhooks/:channel/:tenantId
GET  /webhooks/:channel/:tenantId   ← verificación de hub.challenge
```

Ejemplo:
```
POST /webhooks/whatsapp/acme
  → channel  = "whatsapp"
  → tenantId = "acme"
```

Meta (WhatsApp/Instagram) no puede incluir headers arbitrarios ni subdominios; por eso el tenant va en el path.

Archivo: `services/api-gateway/src/modules/channels/webhooks.controller.ts`

## Scopes de JWT

El `AuthGuard` (también en `api-gateway`) valida el scope del token JWT:

| Scope | Descripción |
|-------|-------------|
| `platform` | Acceso a todos los tenants (tokens de servicio interno) |
| `tenant:<name>` | Acceso solo al tenant indicado |

Si el tenant resuelto no coincide con `tenant:<name>` del JWT → 403 Forbidden.

## Propagación downstream

Una vez resuelto en `api-gateway`, el tenant se propaga a servicios downstream vía el header `x-yoizen-tenant` en cada llamada HTTP de proxy.

## Desarrollo local

Sin dominio configurado, usar el header en cualquier cliente HTTP:

```bash
curl -H "x-yoizen-tenant: acme" \
     -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/...
```

O con `kubectl port-forward`:

```bash
kubectl port-forward svc/api-gateway 3000:3000 -n platform-services
curl -H "x-yoizen-tenant: acme" http://localhost:3000/health
```

## Siguiente paso

→ [03-modelo-de-datos-tenant.md](./03-modelo-de-datos-tenant.md) — esquema de datos por tenant.
