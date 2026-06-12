# 04 — Migración: Single-Tenant a Multi-Tenant

> **Estado:** completada — la plataforma es multi-tenant desde el diseño actual
> **Prerequisitos:** [03-modelo-de-datos-tenant.md](./03-modelo-de-datos-tenant.md)

## Contexto

Este documento describe cómo se ejecutó la transición del sistema original (monorepo single-tenant "Coexistance") a la arquitectura de plataforma multi-tenant actual (Yoizen Platform). Es histórico: la migración ya está completa.

La arquitectura actual no tiene el concepto de "agregar campo `tenant`" a colecciones MongoDB compartidas. En cambio, cada tenant tiene su propio Postgres (provisioning via `tenant-service`) y sus propios streams NATS (`INGRESS-<TENANT>`, `DLQ-<TENANT>`, `PAYLOAD-<TENANT>`).

## Lo que cambió

| Aspecto | Sistema anterior | Sistema actual |
|---------|-----------------|----------------|
| Plataforma | Monorepo Express + MongoDB | Microservicios NestJS + Kubernetes |
| Aislamiento de datos | Campo `tenant` en colecciones MongoDB compartidas | Postgres dedicado por tenant (K8s StatefulSet) |
| Bus de eventos | NATS Core (at-most-once) | NATS JetStream con streams per-tenant |
| Tenant resolution | Subdomain `acme.coexistance.io` o header `x-tenant-id` | Hostname `acme.dev.yplatform.com` o header `x-yoizen-tenant` |
| Provisioning | Manual / script de seed | Automático via `tenant-service` + K8s API |
| Auth | JWT con campo `tenant` en payload | JWT con `scope: "tenant:<name>"` o `"platform"` |

## Alta de un tenant nuevo

El flujo actual es completamente automático:

```
POST /tenants { "name": "acme" }
  → api-gateway proxy → tenant-service
  → crea namespace K8s: acme-dev-ns
  → provisiona Postgres StatefulSet en el namespace
  → crea streams NATS: INGRESS-ACME, DLQ-ACME, PAYLOAD-ACME
  → retorna { name: "acme", status: "active", postgresHost: "..." }
```

Script de conveniencia: `scripts/provision-tenant.sh` (wraps el API call).

## Migración de Postgres (script operacional)

`scripts/migrate-tenants-to-shared-postgres.sh` es una herramienta para reorganizar datos de tenants entre instancias de Postgres. Solo es relevante en operaciones de mantenimiento de infraestructura; no es parte del flujo de alta de tenant.

## Archivos relevantes

| Archivo | Rol |
|---------|-----|
| `services/tenant-service/src/modules/tenants/tenants.controller.ts` | `POST /tenants` — crea tenant |
| `services/tenant-service/src/modules/provisioning/tenant-provisioning-executor.service.ts` | Provisioning K8s + Postgres + NATS streams |
| `scripts/provision-tenant.sh` | Script CLI para crear un tenant vía API |
| `scripts/migrate-tenants-to-shared-postgres.sh` | Migración operacional de Postgres |

## Siguiente paso

→ [05-arquitectura-multi-canal.md](./05-arquitectura-multi-canal.md)
