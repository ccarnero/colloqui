// Documentos de referencia para multi-tenant

## Documentación completa en DOCS/architecture/ y DOCS/channels/

### 01-multi-tenant-fundacion.md
- Fundamentos de arquitectura multi-tenant
- Modelo: un deployment, múltiples tenants
- 5 principios fundamentales
- Qué funciona sin cambios (bus NATS ya preparado)
- Qué necesita cambiar (capa de datos, auth, middleware)

### 02-tenant-resolution.md
- Cadena de resolución de tenant (3 fuentes)
  1. Subdomain
  2. Header X-Tenant-Id
  3. JWT claim
- Regla de consistencia (fuentes deben coincidir)
- Caso especial: webhooks con path parameter
- Login flow multi-tenant
- Desarrollo local sin subdomain

### 03-modelo-de-datos-tenant.md
- Campo `tenant: string` en todas las colecciones
- Índices compound con tenant como primer campo
- Cambios por colección:
  - users: { tenant, email } unique
  - accounts: { tenant, phone_number_id } unique
  - contacts: { tenant, account_id, wa_id } unique
  - messages: { tenant, account_id, contact_id, created_at }
- Nueva colección opcional: tenants

### 04-migracion-single-a-multi.md
- Estrategia de migración
- Script de migración de datos (idempotente)
- Script de migración de índices
- Orden de deployment
- Rollback plan
- Backward compatibility durante transición
- Validación post-migración

## Referencias adicionales

- DOCS/messaging/envelope.md — Envelopes con campo tenant
- DOCS/messaging/service-bus.md — Streams por tenant en NATS
