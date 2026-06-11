# Canales — Documentación

> **Estado:** implementado
> **Audiencia:** equipo técnico Yoizen

## Visión

La plataforma es **multi-tenant, multi-canal** desde el diseño. Cada tenant gestiona sus propias cuentas de canal con aislamiento total de datos (Postgres dedicado, streams NATS per-tenant). Los canales implementados son WhatsApp, Instagram y Telegram.

## Documentos

| # | Documento | Descripción |
|---|-----------|-------------|
| 01 | [multi-tenant-fundacion](./01-multi-tenant-fundacion.md) | Modelo de tenancy, componentes, aislamiento implementado |
| 02 | [tenant-resolution](./02-tenant-resolution.md) | Cómo `TenantGuard` resuelve el tenant por hostname / header |
| 03 | [modelo-de-datos-tenant](./03-modelo-de-datos-tenant.md) | Almacenamiento per-tenant: Postgres, NATS streams, claim-check |
| 04 | [migracion-single-a-multi](./04-migracion-single-a-multi.md) | Historial de la migración del sistema single-tenant original |
| 05 | [arquitectura-multi-canal](./05-arquitectura-multi-canal.md) | Providers implementados, subject format, flujo de ingress/egress |
| 06 | [overview-instagram-api](./06-overview-instagram-api.md) | Instagram Messaging API: estructura de webhook, send API, diferencias con WhatsApp |
| 07 | [instagram-implementacion](./07-instagram-implementacion.md) | Detalle de implementación en el codebase |
| 08 | [reutilizacion-patrones-whatsapp](./08-reutilizacion-patrones-whatsapp.md) | Qué código es compartido entre WhatsApp e Instagram |

## Decisiones implementadas

| # | Decisión |
|---|----------|
| D1 | Un deploy sirve a múltiples tenants — aislamiento por Postgres dedicado + streams NATS per-tenant |
| D2 | Usuarios per-tenant con aislamiento total — JWT scope `tenant:<name>` |
| D3 | Tenant resolution: hostname `<env>.<tenant>.yplatform.com` → header `x-yoizen-tenant` |
| D4 | Webhooks usan path param para tenant — `POST /webhooks/:channel/:tenantId` |
| D5 | Tres canales implementados: WhatsApp, Instagram (Meta), Telegram |
| D6 | Bus y envelopes son channel-agnostic — `channel` es un token del subject NATS |
