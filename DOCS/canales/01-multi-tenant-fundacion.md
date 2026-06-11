# 01 — Multi-Tenant: Fundación

> **Estado:** implementado
> **Prerequisitos:** ninguno

## Contexto

La plataforma es **multi-tenant desde el diseño**. El aislamiento de tenant se implementa a nivel de aplicación (prefijos de subject NATS, campo `tenant` en base de datos, header `x-yoizen-tenant`), no a nivel de infraestructura. NATS usa una sola cuenta sin ACLs por tenant.

La resolución del tenant en cada request HTTP la realiza `TenantGuard` en `api-gateway`, que extrae el tenant del hostname (`<env>.<tenant>.yplatform.com`) o del header `x-yoizen-tenant`.

## Modelo

```
                    ┌───────────────────────────────────────────┐
                    │            api-gateway                    │
                    │                                           │
  acme.dev.yplatform.com ──▶ │   TenantGuard extrae "acme"     │
  beta.dev.yplatform.com ──▶ │   x-yoizen-tenant: beta         │
                    │          ▼                                │
                    │   req.tenant = "acme" | "beta"            │
                    │          ▼                                │
                    │   subject NATS: evt.acme.*  evt.beta.*    │
                    │          ▼                                │
                    │   base de datos: Postgres per-tenant      │
                    │   (namespaces Kubernetes aislados)        │
                    └───────────────────────────────────────────┘
```

**Un deploy, múltiples tenants.** El aislamiento de datos se logra por:
1. Subjects NATS con prefijo `evt.<tenant>.`
2. Streams NATS per-tenant: `INGRESS-<TENANT>`, `DLQ-<TENANT>`, `PAYLOAD-<TENANT>`
3. Base de datos Postgres por tenant (StatefulSet dedicado en namespace K8s del tenant)
4. Header `x-yoizen-tenant` propagado en todas las llamadas entre servicios

## Principios

1. **Tenant obligatorio** — ningún evento viaja sin campo `tenant`. Ningún query de DB omite el filtro de tenant.
2. **Aislamiento en el bus** — streams NATS son per-tenant; un consumer del tenant "acme" no puede leer mensajes de "beta".
3. **Aislamiento en datos** — cada tenant tiene su propio Postgres (provisioning via `tenant-service`).
4. **Sin ACLs de NATS** — el aislamiento es de aplicación; no hay accounts ni user permissions por tenant en el servidor NATS.
5. **Provisioning automático** — al crear un tenant, `tenant-service` crea el namespace K8s, el StatefulSet de Postgres, y `ensureTenantIngressStream` crea los streams NATS necesarios.

## Componentes que implementan multi-tenancy

| Componente | Implementación |
|-----------|----------------|
| `api-gateway` | `TenantGuard` — hostname o header `x-yoizen-tenant` |
| NATS subjects | `evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v1` |
| NATS streams | `INGRESS-<TENANT>` (filter `evt.<tenant>.>`), `DLQ-<TENANT>`, `PAYLOAD-<TENANT>` |
| `tenant-service` | Provisiona namespace K8s + Postgres StatefulSet |
| `channel-service` | Propaga `tenant` en todos los envelopes canónicos |
| `packages/shared` | Constante `TENANT_HEADER = 'x-yoizen-tenant'` |

## Diagrama de aislamiento

```
Tenant "acme"                          Tenant "beta"
─────────────                          ─────────────
INGRESS-ACME stream                    INGRESS-BETA stream
DLQ-ACME stream                        DLQ-BETA stream
PAYLOAD-ACME object store              PAYLOAD-BETA object store
Namespace: acme-dev-ns (K8s)           Namespace: beta-dev-ns (K8s)
  └── Postgres StatefulSet               └── Postgres StatefulSet

NATS subjects:                         NATS subjects:
  evt.acme.channel-service.messaging.>   evt.beta.channel-service.messaging.>

JWT tokens:                            JWT tokens:
  scope: "tenant:acme"                   scope: "tenant:beta"
```

## Archivos relevantes

| Archivo | Rol |
|---------|-----|
| `services/api-gateway/src/guards/tenant.guard.ts` | Resolución de tenant por hostname / header |
| `services/tenant-service/src/modules/provisioning/tenant-provisioning-executor.service.ts` | Provisioning K8s + Postgres |
| `packages/shared/src/constants.ts` | `TENANT_HEADER = 'x-yoizen-tenant'` |
| `packages/shared/src/channel.constants.ts` | Funciones `buildIngressStreamName`, `buildDlqStreamName`, `buildClaimCheckBucket` |
| `packages/database/src/` | `ensureTenantIngressStream`, `ensureTenantDlqStream` |
| `scripts/migrate-tenants-to-shared-postgres.sh` | Migración de Postgres por tenant a Postgres compartido (script operacional) |

## Siguiente paso

→ [02-tenant-resolution.md](./02-tenant-resolution.md) — cómo se resuelve el tenant en cada request.
