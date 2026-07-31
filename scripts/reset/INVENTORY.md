# scripts/reset/INVENTORY.md

Inventario de todo lugar donde persisten rastros de mensajes en el ambiente
de desarrollo de `platform-cluster`, para diseñar un reset limpio y
repetible. Generado por rastreo de código (codegraph) el 2026-07-09 sobre
`feature/versioning-and-sdk`. Solo lectura — nada fue modificado.

Convenciones:
- **DATA** = candidato a limpieza (mensajes, eventos, runs, cachés derivados).
- **CONFIG** = topología/config/credenciales — NUNCA se toca.
- **DUDOSO** = requiere decisión humana antes de incluir en el reset.

---

## 1. JetStream — Streams

| Stream | Alcance | Subjects | Creado por | Cita |
|---|---|---|---|---|
| `INGRESS-<TENANT_UPPER>` | Por tenant | `evt.<tenant>.>` | Se crea de forma idempotente (primer creador gana) desde 4 servicios distintos: `channel-service` (`ensureTenantIngressStream`), `registry-service`, `agent-memory-service`, `agent-admin-service` | `packages/database/src/nats-provider.ts:228-307`, `packages/shared/src/tenant-stream.constants.ts:44-62` |
| `DLQ-<tenantId>` | Por tenant | `dlq.<tenantId>.>` | `packages/database/src/nats-dlq.ts:30-58` (`ensureTenantDlqStream`), invocado automáticamente cuando cualquier consumer lanza `PermanentError` | `packages/database/src/multi-tenant-consumer-manager.ts:447`; `packages/shared/src/channel.constants.ts:70-91` |
| `DLQ` (global, legacy) | Global | `dlq.webhook` (antes `dlq.>`) | Sin `streams.add` vivo encontrado en código — solo mencionado en un comentario histórico | `packages/database/src/nats-provider.ts:96-107`; `packages/shared/src/constants.ts:1-11` — **DUDOSO, ver abajo** |
| `PLATFORM_TENANTS` | Global (control-plane) | `platform.tenant.>` | `tenant-service`, `RetentionPolicy.Workqueue` (se autolimpia al ackear) | `services/tenant-service/src/providers/nats.module.ts:23-35`; `packages/shared/src/tenant-events.ts:30-33` |
| `GATEWAY_AUDIT` | Global | `audit.gateway.>` | `audit-service` (consumer) / `api-gateway` (publisher) | `services/audit-service/src/providers/nats.provider.ts:34-51`; `packages/shared/src/constants.ts:81-85` |

**Object Store (claim-check), gestionado por JetStream pero no es un stream:**

| Bucket | Owner (crea con config) | También escrito por (sin config) | Cita |
|---|---|---|---|
| `PAYLOAD-<tenant>` | `channel-service` `IngressService.getClaimCheckBucket` — TTL 7d, max_bytes 512MB | `packages/database/src/multi-tenant-consumer-manager.ts:311-317` (open-only); `agent-ai-service` `ClaimCheckService.storePayload` — **crea el bucket sin TTL/max_bytes si corre primero** (config drift) | `services/channel-service/src/modules/ingress/ingress.service.ts:100-125`; `services/agent-ai-service/src/modules/claim-check/claim-check.service.ts:52-77,175-182` |

⚠️ No confiar en el TTL para el reset: si el bucket fue creado por el path de `agent-ai-service`, no tiene expiración. El script debe purgar objetos explícitamente.

---

## 2. JetStream — Consumers / Durables

Todos comparten el mismo nombre de durable en cada stream `INGRESS-<tenant>` al que se bindean (un consumer físico por tenant, mismo nombre lógico).

| Durable | Stream | Servicio | maxDeliver / ackWait | Cita |
|---|---|---|---|---|
| `audit-events` | `^INGRESS-` | audit-service | default | `services/audit-service/src/modules/audit/audit.service.ts:48-70` |
| `channel-audit` | `^INGRESS-` | audit-service | default | `services/audit-service/src/modules/channel-audit/channel-audit.service.ts:49-70` |
| `execution-audit` | `^INGRESS-` | audit-service | default | `services/audit-service/src/modules/execution-audit/execution-audit.service.ts:43-78` |
| `ingestion-worker` | `^INGRESS-` | agent-admin-service | 5 / 300000ms | `services/agent-admin-service/src/modules/knowledge-bases/ingestion-worker.service.ts:28-90` |
| `skb-ingestion-worker` | `^INGRESS-` | agent-admin-service | 5 / 300000ms | `services/agent-admin-service/src/modules/structured-kb/skb-ingestion-worker.service.ts:30-97` |
| `agent-ai-service-consumer` | `^INGRESS-` | agent-ai-service | config-driven | `services/agent-ai-service/src/modules/nats-consumer/multi-tenant-consumer.service.ts:18-60` |
| `ai-agent-gateway-results` | `^INGRESS-` | ai-agent-gateway | — | `services/ai-agent-gateway/src/modules/executions/executions.service.ts:61-93` |
| `auto-reply` | `^INGRESS-` | channel-service | — | `services/channel-service/src/modules/auto-reply/auto-reply.service.ts:50-104` |
| `channel-egress` | `^INGRESS-` | channel-service | `MAX_DELIVER` | `services/channel-service/src/modules/egress/send-command-consumer.service.ts:38-102` |
| `channel-webhook-ingress` | `^INGRESS-` | channel-service | — | `services/channel-service/src/modules/webhooks/webhook-ingress-consumer.service.ts:32-65` |
| `adapter-internal-sync` | `^INGRESS-` | connector-admin | `MAX_DELIVER`/`ACK_WAIT_MS` | `services/connector-admin/src/modules/internal-sync/internal-sync.service.ts:54-160` |
| `workflow-projector` | `^INGRESS-` | workflow-service | — | `services/workflow-service/src/modules/executions-projector/execution-projector.service.ts:33-124` |
| `workflow-triggers` | `^INGRESS-` | workflow-service | 3 / 60000ms | `services/workflow-service/src/modules/triggers/trigger-consumer.service.ts:49-102` |
| `<cfg.ingressDurableName>` | `^INGRESS-` | usage-aggregator-service | — | `services/usage-aggregator-service/src/modules/aggregator/aggregator.engine.ts:114-115` |
| `<cfg.dlqDurableName>` | `^DLQ-` | usage-aggregator-service | — bindeado directo a los streams DLQ para agregar métricas | `services/usage-aggregator-service/src/modules/aggregator/aggregator.engine.ts:129-130,387-390` |
| `gateway-audit-writer` | `GATEWAY_AUDIT` | audit-service | 5 | `services/audit-service/src/providers/nats.provider.ts:34-59` |
| `tenant-provisioner` | `PLATFORM_TENANTS` | tenant-service | 5 / 300000ms | `services/tenant-service/src/modules/provisioning/tenant-provision-consumer.service.ts:14-60` |

**Efímeros, no requieren purga:** `ui-inspect-<timestamp>-<rand>` (channel-service, se autoborra en `finally`); `job-execution-status` en agent-admin-service usa NATS core (`nc.subscribe`), sin estado de ack.

Nota de diseño: los durables (definición, `deliver_policy`, `ack_policy`, `filter_subject`) son **CONFIG/topología**, no se tocan. El estado de ack/redelivery es **DATA** y se resetea solo al purgar los mensajes del stream — no hace falta borrar/recrear el consumer.

---

## 3. DLQ

- Mecanismo: cualquier consumer bajo `MultiTenantConsumerManager` que lance `PermanentError` termina el mensaje (`msg.term()`) y lo republica en `dlq.<tenantId>.<subject-original>` dentro de `DLQ-<tenantId>`, con headers `X-Dlq-*`. Cita: `packages/database/src/multi-tenant-consumer-manager.ts:442-467`, `packages/database/src/nats-consumer-runner.ts:497-563`.
- Todos los durables de la tabla §2 pueden generar tráfico DLQ.
- `usage-aggregator-service` lee de vuelta desde los streams DLQ — purgarlos resetea también su estado de agregación.
- Stream global legacy `DLQ` / subject `dlq.webhook`: ver DUDOSO.

---

## 4. Postgres — Tablas

Sin TypeORM/Prisma: todo es DDL SQL crudo (`postgres.js`), aplicado por bootstrap o por `TenantConnectionManager.setSchema()`. Sin carpeta de migraciones (`packages/database/migrations` no existe).

### DATA

| Tabla | Servicio | Cita | Notas |
|---|---|---|---|
| `events` | audit-service | `services/audit-service/src/modules/audit/audit.postgres.repository.ts:26` | Audit log genérico por tenant |
| `channel_events` (audit) | audit-service | `services/audit-service/src/modules/channel-audit/channel-audit.postgres.repository.ts:29` | Trail de mensajes in/out, incluye `message_text`, `conversation_id` |
| `execution_events` | audit-service | `services/audit-service/src/modules/execution-audit/execution-audit.postgres.repository.ts:32` | Log de ejecución de agentes/LLM |
| `gateway_audit_events` | audit-service | `services/audit-service/src/modules/gateway-audit/gateway-audit.postgres.repository.ts:60` | Audit de requests al gateway |
| `mcp_call_events` | agent-admin-service | `services/agent-admin-service/src/providers/schema-initializer.ts:460` | Eventos de uso de MCP (feature reciente, commit `fix(mcp): record usage events`) |
| `connector_call_events` | usage-aggregator-service | `packages/shared/src/connector-call-usage-schema.ts:19` | Hypertable Timescale, DB compartida `yoizen_usage` |
| `channel_events` (usage) | usage-aggregator-service | `packages/shared/src/channel-usage-schema.ts:31,128` | ⚠️ Mismo nombre que la tabla de audit-service pero DB/schema distinto — resolver por conexión, no por nombre |
| `channel_events_hourly` / `channel_events_daily` | usage-aggregator-service | `packages/shared/src/channel-usage-schema.ts:54,66,154,167` | Vistas materializadas derivadas — se regeneran solas |
| `workflow_executions` | workflow-service | `packages/shared/src/workflow-schema.ts:33` | Runs de Temporal por tenant |
| `job_executions` | agent-admin-service | `services/agent-admin-service/src/providers/schema-initializer.ts:195` | Resultados de jobs programados |
| `skb_query_history` | agent-admin-service | `services/agent-admin-service/src/providers/schema-initializer.ts:115` | Log de queries a KB estructurada |
| `memories` | agent-memory-service | `services/agent-memory-service/src/schema/memory-schema.sql:1` | Memoria conversacional por sesión/usuario/tenant — probablemente el store de "conversación" más grande de la plataforma |

### CONFIG (no tocar)

`tenants`, `registered_services`, `service_routes`, `canary_deployments`, `platform_users`, `api_clients`, `public_routes`, `agents`, `credentials`, `jobs` (definiciones), `config_files`, `skills`, `mcp_servers`, `system_variables`, `knowledge_bases`, `documents`, `skb_containers`/`skb_files`/`skb_schemas`/`skb_rows`, `http_adapters`, `adapter_endpoints`, `channel_accounts`, `auto_reply_rules`, `tenant_roles`/`tenant_role_permissions`/`tenant_users`, `workflow_definitions`.

---

## 5. MongoDB — Colecciones

### DATA

| Colección | Servicio | Cita |
|---|---|---|
| `events` | audit-service | `services/audit-service/src/modules/audit/audit.mongo.repository.ts:66` |
| `gateway_audit_events` | audit-service | `services/audit-service/src/modules/gateway-audit/gateway-audit.mongo.repository.ts:70` |
| `channel_events` (audit) | audit-service | `services/audit-service/src/modules/channel-audit/channel-audit.mongo.repository.ts:38` |
| `execution_events` | audit-service | `services/audit-service/src/modules/execution-audit/execution-audit.mongo.repository.ts:41` |
| `channel_events` (usage) | channel-service / usage-aggregator-service | `services/channel-service/src/modules/usage/usage.mongo.repository.ts:66,110,152`; `services/usage-aggregator-service/src/modules/aggregator/batch-inserter.mongo.ts:51` |
| `job_executions` | agent-admin-service | `services/agent-admin-service/src/modules/jobs/job-executions.mongo.repository.ts:95,122,146` |
| `mcp_call_events` | agent-admin-service | `services/agent-admin-service/src/modules/mcp-servers/mcp-usage.mongo.repository.ts:72,93` |
| `workflow_executions` | workflow-service | `services/workflow-service/src/modules/executions-projector/executions.mongo.repository.ts:32,76` |

### CONFIG (no tocar)

`channel_accounts`, `auto_reply_rules`, `agents`, `agent_versions`, `credentials`, `jobs`, `config_files`, `mcp_servers`, `http_adapters`, `adapter_endpoints`, `registered_services`, `service_routes`, `canary_deployments`, `tenants`, `platform_users`, `api_clients`, `public_routes`, `tenant_roles`, `tenant_role_permissions`, `tenant_users`, `workflow_definitions`.

---

## 6. Redis — Keyspaces

| Patrón | Servicio | Notas | Cita |
|---|---|---|---|
| `pending:` / `<tenant>:pending:<executionId>` | api-gateway, ai-agent-gateway | Estado de ejecución pendiente, TTL 3600s | `packages/shared/src/execution-client.ts:50-52` |
| `result:` / `<tenant>:result:<executionId>` | api-gateway, ai-agent-gateway | Resultado de ejecución cacheado, TTL 3600s | `packages/shared/src/execution-client.ts:46-47` |
| `callback:` | api-gateway | Correlación de callback URLs, TTL 3600s | `packages/shared/src/constants.ts:15` |
| `public_routes:{env}[:{tenantId}]` | api-gateway (lee) / auth-service (escribe) | Espejo de la colección Mongo `public_routes` | `services/api-gateway/src/modules/auth/public-routes-cache.service.ts:31` |
| `dashboard:stats:<tenant>` | api-gateway | Cache de stats de dashboard | `services/api-gateway/src/modules/dashboard/dashboard-proxy.service.ts:48` |
| `ratelimit:<env>:<tenant>:...` | api-gateway | Contadores de rate limit (sliding/token-bucket/fixed) | `packages/shared/src/rate-limit.constants.ts:1` |
| `agent-ai:costs:<tenant>:<agentId>:<fecha>` | agent-ai-service | Contadores de costo/tokens LLM, TTL 90d | `services/agent-ai-service/src/modules/llm/cost-tracker.service.ts:7,74,104,159` |
| `platform:admin:runtime:last_sync:<tenant>` | agent-admin-service | Timestamp de último sync | `services/agent-admin-service/src/modules/runtime/runtime.service.ts:12,57` |
| `adapter:config:<tenant>:<adapterId>` | connector-runtime | Cache SWR de config de adapter (Mongo) | `packages/shared/src/adapter-client.ts:23,58,148` |
| `adapter:internal-by-service:<tenant>:<serviceId>` | connector-runtime | Cache de lookup interno | `packages/shared/src/adapter-client.ts:25,160,181` |
| `httpcache:v1:<sha256>` | connector-runtime | Cache de respuestas HTTP salientes | `services/connector-runtime/src/activities/_shared/http-cache/cache-policy.ts:91` |
| `cb:channel:egress` | channel-service | Estado de circuit-breaker | `services/channel-service/src/modules/egress/egress-breaker.provider.ts:91` |
| `cb:workflow:http` / `cb:workflow:agent` | connector-runtime | Estado de circuit-breaker | `services/connector-runtime/src/activities/_shared/breaker.ts:141,153` |
| `cache:*` (namespace libre) | cache-service | API HTTP CRUD genérica de cache L2, consumida por otros servicios con sus propias keys | `services/cache-service/src/modules/cache/cache.service.ts:26-119` |

Todo lo anterior es DATA (cachés derivados, contadores, breakers) salvo lo marcado abajo como DUDOSO.

---

## 7. Fuera de alcance de Mongo/Redis pero relevante

- `agent-memory-service` guarda la memoria conversacional en **Postgres** (tabla `memories`, §4) — no en Mongo/Redis. Es probablemente el store de "conversación" más grande del sistema.
- `usage-aggregator-service` también escribe a Postgres/Timescale (`batch-inserter.postgres.ts`, `batch-inserter.connector.ts`) además del path Mongo.
- La deduplicación `Nats-Msg-Id`/`idempotencykey` es interna del broker NATS (JetStream), no persiste en Redis/Mongo — ya cubierta implícitamente por el reset de streams (§1-3).

---

## DUDOSO — decidir antes de aprobar

1. **Stream global legacy `DLQ` / subject `dlq.webhook`** (`packages/shared/src/constants.ts:1-11`) — sin `streams.add` vivo en código, solo mencionado en un comentario histórico (`packages/database/src/nats-provider.ts:96-107`). Puede existir igual en el NATS de dev por un deploy viejo. **Verificar con `nats stream ls` en vivo antes de decidir si se purga/borra.**
2. **`agent_versions`** (Postgres y Mongo) — historial de versiones publicadas de agentes. ¿Es CONFIG (historial de config) o DATA regenerable? Recomiendo excluirlo del reset por defecto.
3. **`document_chunks` / `document_chunks_embedding`** (Postgres, agent-admin-service) — contenido de KB ingerido y sus embeddings. Es contenido editable por el usuario, no data conversacional/de eventos. Recomiendo tratarlo como CONFIG/contenido y excluirlo, salvo que se quiera un reset total de KB.
4. **`credentials` (Mongo, agent-admin-service)** — clasificado CONFIG por guardar credenciales de conectores, pero confirmar que no duplica función de cache de tokens.
5. **`canary_deployments`** — estado de rollout/deploy, más cercano a topología que a config estática. Recomiendo excluir del reset por defecto.
6. **`adapter:oauth:<adapterId>` (Redis)** — tokens OAuth2 cacheados de adapters. Es reconstruible (se re-autentica), pero toca material de credenciales — pedir confirmación explícita antes de incluirlo.
7. **`agent-scheduler-service` Redis client** — provider instanciado (`services/agent-scheduler-service/src/providers/redis.provider.ts:1-38`) pero sin sitios de escritura confirmados en este rastreo. Confirmar con el owner si se usa y qué guarda.
8. **Claim-check buckets `PAYLOAD-<tenant>`** — no hay purga/TTL confiable (ver §1). Clasificado DATA, pero el script debe purgar objetos explícitamente en vez de confiar en expiración.
9. **`CLAUDE.md` de audit-service está desactualizado**: documenta un stream global `EVENTS` y un durable `audit-writer` que ya no existen en el código (reemplazados por `audit-events`/`channel-audit`/`execution-audit` sobre `INGRESS-*`, según comentario en `services/audit-service/src/providers/nats.provider.ts:27-33`). No usar ese doc como fuente de verdad.
10. **Config drift en `INGRESS-<tenant>`**: 4 servicios distintos pueden crear el stream con límites distintos (fixed vs. tier-based) según quién corra primero. No es un problema del reset script, pero cuidado: no "arreglar" esto recreando streams — eso toca topología, fuera del alcance pedido.

---

## Resumen para Fase 2

- **Streams a purgar (mensajes, no el stream en sí):** `INGRESS-<tenant>` (todos), `DLQ-<tenant>` (todos), `GATEWAY_AUDIT`, `PLATFORM_TENANTS` (solo in-flight/unacked).
- **Buckets a purgar (objetos, no el bucket):** `PAYLOAD-<tenant>` (todos).
- **Tablas Postgres a truncar:** ver lista DATA en §4 (respetar FKs: `mcp_call_events`→`mcp_servers`, etc. — aunque solo se truncan las de DATA).
- **Colecciones Mongo a vaciar:** ver lista DATA en §5.
- **Keys Redis a borrar:** todos los patrones de §6 salvo `adapter:oauth:*` (dudoso).
- **No tocar:** todo lo listado como CONFIG en §4/§5, ni las definiciones de streams/consumers/buckets (solo su contenido).

---

## Manifest-from-zero: borrón y cuenta nueva (wipe de definiciones)

> Añadido 2026-07-15 tras un ejercicio real de "aplicar un manifest.yaml
> contra un tenant sin ningún recurso previo". `reset-dev.ts` (§ arriba)
> deliberadamente NO alcanza para esto: por diseño solo trunca las tablas
> **DATA** de §4/§5 (mensajes, eventos, runs) — nunca las **DEFINICIONES**
> de recursos (cuentas de canal, workflows, agentes, adaptadores, etc.),
> que son justamente lo que un manifest crea/reconcilia. Para probar un
> `apply` desde cero hace falta vaciar esas definiciones a mano.

### Qué NO toca `reset-dev.ts` (y por qué hace falta un paso aparte)

`reset-dev.ts` clasifica y trunca únicamente las tablas/colecciones DATA de
§4/§5 (`events`, `channel_events`, `execution_events`, `workflow_executions`,
`job_executions`, etc.) y respeta explícitamente todo lo listado como CONFIG.
Las **definiciones** de recursos (lo que un `manifest.yaml` provisiona) viven
en Postgres compartido, en la base por tenant `tenant_acme`, y quedan
intactas después de cualquier corrida de `reset-dev.ts`.

### Tablas de definiciones en `tenant_acme` (Postgres compartido)

Las tablas de definición relevantes para un wipe manifest-from-zero, todas
en la base por tenant (`tenant_acme` en dev):

`workflow_definitions`, `http_adapters`, `adapter_endpoints`, `agents`,
`agent_versions`, `channel_accounts`, `knowledge_bases`, `documents`,
`document_chunks`/`document_chunks_embedding`, `kb_document_checksums`,
`mcp_servers`, `manifest_revisions`, `system_variables`, `skills`, `jobs`,
`config_files`, `auto_reply_rules`.

### Comando usado (dev, verificado en vivo)

```bash
kubectl exec -n support-services-dev postgres-shared-1 -c postgres -- \
  psql -U postgres -d tenant_acme -c "
TRUNCATE workflow_definitions, http_adapters, adapter_endpoints, agents,
  agent_versions, channel_accounts, knowledge_bases, documents,
  document_chunks, document_chunks_embedding, kb_document_checksums,
  mcp_servers, manifest_revisions, system_variables, skills, jobs,
  config_files, auto_reply_rules
CASCADE;
"
```

### Qué se preserva (no incluir en el TRUNCATE)

`tenant_users`, `tenant_roles`, `tenant_role_permissions`, `credentials` —
identidad, RBAC y credenciales del tenant no son parte del estado que un
manifest reconstruye; wipearlas rompería el login/la sesión usada para
correr el `apply` que sigue.

### Consecuencias post-wipe (las dos que importan)

1. **El webhook de Telegram queda apuntando a una cuenta borrada** hasta
   que se re-aplique el manifest y (si `CHANNEL_SERVICE_PUBLIC_URL` sigue
   sin configurar en el deploy, ver
   `integrations/channels/telegram-transform-reply/README.md` §
   Troubleshooting) se re-registre el webhook a mano — la cuenta vieja ya
   no existe, así que cualquier `setWebhook` previo referencia un
   `externalId` que ya no resuelve a nada.
2. **El siguiente `plan` muestra todo en `create`**: al no quedar ninguna
   definición previa, `yoizen manifests plan` reporta cada recurso del
   manifest como `create` (nunca `noop`/`update`) — es el comportamiento
   esperado de un tenant "en blanco", no un bug del planner.
