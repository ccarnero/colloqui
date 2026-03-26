# Canales — Documentacion

> **Estado:** borrador v0 — para revision y discusion
> **Fecha:** 2026-03-24
> **Audiencia:** equipo tecnico Yoizen

## Vision

Coexistance evoluciona de plataforma WhatsApp single-tenant a una plataforma **multi-tenant, multi-canal** que Yoizen vende como servicio. Cada tenant (cliente) gestiona sus propias cuentas de canal con aislamiento total de datos.

## Fases

| Fase | Alcance | Docs |
|------|---------|------|
| **1 — Multi-Tenant** | Fundacion: aislamiento de datos por tenant, resolucion de tenant, migracion | 01 a 04 |
| **2 — Instagram** | Primer canal adicional sobre la base multi-tenant | 05 a 08 |

## Documentos

| # | Documento | Fase | Descripcion |
|---|-----------|------|-------------|
| 01 | [multi-tenant-fundacion](./01-multi-tenant-fundacion.md) | 1 | Modelo de tenancy, aislamiento, que existe vs que falta |
| 02 | [tenant-resolution](./02-tenant-resolution.md) | 1 | Cadena subdomain → header → JWT, webhooks por path |
| 03 | [modelo-de-datos-tenant](./03-modelo-de-datos-tenant.md) | 1 | Cambios al schema MongoDB: campo tenant en todas las colecciones |
| 04 | [migracion-single-a-multi](./04-migracion-single-a-multi.md) | 1 | Scripts y pasos para migrar datos existentes |
| 05 | [arquitectura-multi-canal](./05-arquitectura-multi-canal.md) | 2 | Como los canales se integran sobre la base multi-tenant |
| 06 | [overview-instagram-api](./06-overview-instagram-api.md) | 2 | Instagram Messaging API: conceptos, limites, auth |
| 07 | [instagram-implementacion](./07-instagram-implementacion.md) | 2 | Webhook, ingress, egress, modelo de datos, stages |
| 08 | [reutilizacion-patrones-whatsapp](./08-reutilizacion-patrones-whatsapp.md) | 2 | Guia de reuso del codigo WhatsApp existente |

## Decisiones cerradas

| # | Decision | Contexto |
|---|----------|----------|
| D1 | Un solo deployment sirve a multiples tenants | Datos aislados por campo `tenant` en MongoDB |
| D2 | Usuarios per-tenant con aislamiento total | Un operador de "acme" no ve datos de otro tenant |
| D3 | Tenant resolution: subdomain → header → JWT | Fallback chain con validacion de consistencia |
| D4 | Webhooks usan path para tenant | `/api/webhooks/{channel}/:tenantId` |
| D5 | Instagram es el primer canal adicional | Gratis, misma plataforma Meta, maximo reuso de codigo |
| D6 | Fase 1 antes de Fase 2 | Multi-tenant es fundacional, debe existir antes de agregar canales |

## Orden de ejecucion

```
Fase 1: Multi-Tenant
  01 → fundacion (modelo, principios)
  02 → tenant resolution (middleware, JWT)
  03 → modelo de datos (schemas, indices)
  04 → migracion (scripts, backward compat)

Fase 2: Instagram (requiere Fase 1 completa)
  05 → arquitectura multi-canal
  06 → overview Instagram API
  07 → implementacion Instagram
  08 → reutilizacion de patrones WhatsApp
```
