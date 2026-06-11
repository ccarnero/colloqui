# 03 — Modelo de Datos: Tenant

> **Estado:** implementado
> **Prerequisitos:** [01-multi-tenant-fundacion.md](./01-multi-tenant-fundacion.md)

## Principio

**Cada tenant tiene su propia base de datos Postgres.** El aislamiento es físico (StatefulSet dedicado en el namespace K8s del tenant), no por campo `tenant` en colecciones compartidas.

El provisioning de la base de datos lo ejecuta `tenant-service` al crear el tenant.

## Almacenamiento por capa

### Postgres per-tenant (datos primarios de canal)

Cada tenant tiene un StatefulSet de Postgres en su namespace K8s (`<tenant>-<env>-ns`). El schema inicial se crea vía `init.sql` en el ConfigMap `postgres-config`.

Los datos que viven aquí incluyen cuentas de canal (`ChannelAccount`), mensajes, contactos, y reglas de auto-reply.

Archivo de schema: `services/tenant-service/src/providers/postgres.provider.ts` — el `init.sql` está embebido en el ConfigMap que se crea durante el provisioning.

### Postgres plataforma (datos operacionales)

Datos compartidos de plataforma (tenants, usuarios, configuración de registry, schedules) viven en el Postgres de plataforma (`platform-services` namespace).

### NATS Object Store per-tenant (claim-check)

Payloads grandes (> 256 KB) no viajan dentro del envelope NATS. Se almacenan en el Object Store `PAYLOAD-<TENANT>` y el envelope lleva una referencia `nats://objstore/<bucket>/<key>`.

Ver [DOCS/arquitectura/04-claim-check.md](../arquitectura/04-claim-check.md) para el contrato completo.

TTL del Object Store: 7 días (alineado con el stream `INGRESS-<TENANT>`).

### Redis (cache de aplicación)

Redis no es per-tenant en la actualidad. Se usa para caché de public routes, pending/result keys de eventos, y circuit breakers.

## Streams NATS per-tenant

| Stream | Subjects | Retención | Propósito |
|--------|----------|-----------|-----------|
| `INGRESS-<TENANT>` | `evt.<tenant>.>` | 7 días / 256 MB | Todos los eventos del tenant |
| `DLQ-<TENANT>` | `dlq.<tenant>.>` | 30 días / 512 MB | Mensajes terminados sin procesar |
| `PAYLOAD-<TENANT>` | — (Object Store) | 7 días / 512 MB | Claim-check: payloads grandes |

Las funciones de construcción de nombres están en `packages/shared/src/channel.constants.ts`:
- `buildIngressStreamName(tenant)` → `INGRESS-<tenant>`
- `buildDlqStreamName(tenant)` → `DLQ-<tenant>`
- `buildClaimCheckBucket(tenant)` → `PAYLOAD-<tenant>`

## Identidad de cuenta de canal

El modelo `ChannelAccount` (definido en `packages/shared/src/channel.interfaces.ts`) describe una cuenta conectada:

```typescript
interface ChannelAccount {
  id: string;
  tenantId: string;
  channel: Channel;           // "whatsapp" | "instagram" | "telegram"
  provider: ChannelProvider;  // "meta" | "telegram"
  name: string;
  externalId: string;
  phoneNumberId?: string;     // WhatsApp: phone_number_id de Meta
  wabaId?: string;            // WhatsApp: WABA ID
  igUserId?: string;          // Instagram: IG professional account ID
  telegramBotToken?: string;  // Telegram: bot token
  accessToken: string;
  appId?: string;
  appSecret?: string;
  verifyToken?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

## Migración operacional

El script `scripts/migrate-tenants-to-shared-postgres.sh` es una herramienta operacional para migrar datos entre configuraciones de Postgres. No es parte del flujo normal de alta de tenant.

## Archivos relevantes

| Archivo | Rol |
|---------|-----|
| `services/tenant-service/src/providers/postgres.provider.ts` | Provisioning del StatefulSet Postgres + schema inicial |
| `services/tenant-service/src/modules/provisioning/tenant-provisioning-executor.service.ts` | Orquestación completa del provisioning |
| `packages/shared/src/channel.interfaces.ts` | `ChannelAccount`, `InboundMessage`, `OutboundMessage` |
| `packages/shared/src/channel.constants.ts` | `buildIngressStreamName`, `buildDlqStreamName`, `buildClaimCheckBucket` |
| `packages/database/src/` | `ensureTenantIngressStream`, `ensureTenantDlqStream` |

## Siguiente paso

→ [04-migracion-single-a-multi.md](./04-migracion-single-a-multi.md)
