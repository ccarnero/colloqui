# Proposal: Integración de YoizenClaw con la Plataforma Yoizen

## Intent

Integrar el runtime de agentes conversacionales YoizenClaw (Python/FastAPI) con la plataforma Yoizen existente, cumpliendo la arquitectura definida en `wdocs/docs/arquitectura/`, para permitir que los tenants desplieguen y gestionen agentes de IA desde el Admin Console.

**Problema actual**:
- YoizenClaw es un runtime independiente sin integración multi-tenant
- Los tenants no pueden gestionar sus agentes desde el Admin Console
- No existe mecanismo de despliegue automatizado por tenant
- El runtime no usa la convención de envelopes ni subjects del bus NATS

**Solución**: Integración completa que incluye:
1. Provisionamiento de runtime YoizenClaw por tenant
2. Gestión de agentes, credenciales, jobs y config files desde Admin Console
3. Comunicación vía NATS JetStream con subjects `evt.{tenant}.>` y envelopes CloudEvents
4. YoizenClaw como **agente interno** (trust: alto) per `wdocs/03-ingress-agentes.md`
5. Claim Check para payloads grandes per `wdocs/04-claim-check.md`
6. Aislamiento por NATS Account/ACLs per `wdocs/05-seguridad.md`
7. Observabilidad completa per `wdocs/06-observabilidad.md`

## Compliance con wdocs/arquitectura/

| wdocs Doc | Requisito | Estado Plan |
|-----------|-----------|-------------|
| `01-service-bus.md` | Streams por tenant `INGRESS-{tenant}`, subjects `evt.{tenant}.>` | Covered |
| `02-diseño-de-mensajes.md` | CloudEvents envelope con `transport`, `depth`, `causation_id` | Covered |
| `03-ingress-agentes.md` | YoizenClaw = agente interno, MAX_DEPTH=5, `agent_outbound` | Covered |
| `04-claim-check.md` | NATS Object Store `PAYLOAD-{tenant}`, umbral 256KB | Covered |
| `05-seguridad.md` | NATS Accounts, ACLs por tenant, rate limiting por categoría | Covered |
| `06-observabilidad.md` | Métricas `ingress.*`, logging con `tenant`/`traceid`, alertas | Covered |

## Scope

### In Scope
- Agregar `tenant_id` al esquema PostgreSQL de YoizenClaw
- Modificar NATS bridge para usar subjects `evt.{tenant}.yoizenclaw.>` por convención wdocs
- Implementar envelopes CloudEvents con `transport.method: "agent"`, `depth`, `causation_id`
- YoizenClaw como agente interno (transport.protocol: "internal", MAX_DEPTH=5)
- Claim Check con NATS Object Store para payloads > 256KB
- NATS Accounts y ACLs por tenant para aislamiento
- Crear Helm chart para despliegue en Knative
- Integrar Admin Service con Tenant Service
- UI en Admin Console para gestión de agentes
- Health checks, métricas y observabilidad per wdocs/06
- Sincronización de jobs y config files por tenant
- Anti-loop con campo `depth` (MAX_DEPTH=5 para agentes internos)

### Out of Scope
- Migración de datos desde sistemas legacy
- Agentes de terceros (wdocs category: thirdparty) - futuro marketplace
- Agentes de plataforma (wdocs category: platform) - OpenAI/Anthropic direct
- Feature flags avanzados (A/B testing de agentes)
- Analytics y métricas avanzadas de uso de agentes
- MCP/A2A protocol integration (wdocs milestone M2+)

## Approach

### Arquitectura de Integración (alineada a wdocs)

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│  Admin Console  │────▶│ YoizenClaw Admin    │────▶│  Tenant Service │
│   (Angular)     │     │ Service (NestJS)      │     │  (K8s API)      │
└─────────────────┘     └─────────────────────┘     └─────────────────┘
                                │                              │
                                │ NATS JetStream               │ Provisiona
                                │ (evt.{tenant}.>)             │
                                ▼                              ▼
                       ┌─────────────────┐          ┌─────────────────────┐
                       │  NATS Cluster   │          │ Tenant Namespace    │
                       │  Account:       │          │ + PostgreSQL        │
                       │  {tenant}       │          │ + Object Store      │
                       │  Stream:        │          └─────────────────────┘
                       │  INGRESS-{t}    │                   │
                       │  Bucket:        │                   ▼
                       │  PAYLOAD-{t}    │          ┌─────────────────────┐
                       └─────────────────┘          │ YoizenClaw Runtime  │
                                │                  │ (Agente Interno)    │
                                │                  │ Knative Service     │
                                ▼                  │ depth ≤ 5           │
                       ┌─────────────────┐          └─────────────────────┘
                       │  NATS Account   │
                       │  ACLs:          │
                       │  pub: evt.{t}.> │
                       │  sub: evt.{t}.> │
                       └─────────────────┘
```

### YoizenClaw como Agente Interno (wdocs/03)

Per la clasificación de `wdocs/03-ingress-agentes.md`, YoizenClaw es un **agente interno**:

| Atributo | Valor |
|----------|-------|
| `transport.method` | `"agent"` |
| `transport.protocol` | `"internal"` |
| `transport.agent_id` | `"yoizenclaw-runtime"` |
| Trust | Alto (nuestra infra, nuestro código) |
| MAX_DEPTH | 5 |
| Rate limit | 200 msgs/seg |
| Acceso al stream | Lectura completa del tenant |
| Max payload | 1 MB (claim check a 256 KB) |

### NATS Subject Convention (wdocs/01)

Subjects alineados a `evt.{tenant}.{domain}.{channel}.{provider}.{action}.v1`:

| Subject | Propósito |
|---------|-----------|
| `evt.{tenant}.yoizenclaw.runtime.config_sync.v1` | Sincronización de configuración |
| `evt.{tenant}.yoizenclaw.runtime.jobs_sync.v1` | Sincronización de jobs |
| `evt.{tenant}.yoizenclaw.runtime.job_trigger.v1` | Disparo manual de jobs |
| `evt.{tenant}.yoizenclaw.runtime.chat_respond.v1` | Respuesta conversacional |
| `evt.{tenant}.yoizenclaw.runtime.online.v1` | Heartbeat |
| `evt.{tenant}.yoizenclaw.runtime.event.v1` | Eventos genéricos |
| `evt.{tenant}.yoizenclaw.agent.outbound.v1` | Output del agente (reply/action) |
| `evt.{tenant}.yoizenclaw.job.execution_status.v1` | Status de ejecución |

### CloudEvents Envelope (wdocs/02)

```json
{
  "specversion": "1.0",
  "id": "01JQXXXX",
  "source": "/services/yoizenclaw/agents/{agent_id}",
  "type": "io.yoizen.yoizenclaw.agent.outbound.v1",
  "time": "2026-03-30T12:00:00Z",
  "traceid": "4bf92f3577b34da6a3ce929d0e0e4736",
  "causation_id": null,
  "correlation_id": "conv_{tenant}_{channel}_{contact}",
  "tenant": "{tenant}",
  "producer": "yoizenclaw",
  "domain": "messaging",
  "channel": "webchat",
  "provider": "internal",
  "transport": {
    "method": "agent",
    "protocol": "internal",
    "agent_id": "yoizenclaw-runtime",
    "agent_capabilities": ["reply", "classify"],
    "confidence": 0.92,
    "depth": 1
  },
  "data": {
    "payload_inline": true,
    "payload_ref": null,
    "payload_bytes": 1200,
    "payload_checksum": "sha256:...",
    "payload": { ... }
  }
}
```

### Claim Check (wdocs/04)

| Umbral | Store | Bucket | TTL |
|--------|-------|--------|-----|
| > 256 KB | NATS Object Store | `PAYLOAD-{tenant}` | Alineado a stream max_age |

### Flujo de Provisionamiento

1. **Tenant crea agente** en Admin Console
2. **Admin Service** publica `evt.{tenant}.yoizenclaw.agent.created.v1` con envelope
3. Si es primer agente del tenant:
   - Tenant Service crea namespace `<tenant>-<env>-ns`
   - Provisiona PostgreSQL StatefulSet
   - Crea NATS Account con ACLs para `evt.{tenant}.>`
   - Crea stream `INGRESS-{tenant}` y bucket `PAYLOAD-{tenant}`
   - Knative crea YoizenClaw Service
4. **YoizenClaw Runtime** recibe config vía `evt.{tenant}.yoizenclaw.runtime.config_sync.v1`
5. Runtime se conecta al PostgreSQL del tenant y publica `evt.{tenant}.yoizenclaw.runtime.online.v1`

## Effort Estimation

- **Size**: **XL** (15+ archivos, cross-module, múltiples servicios, compliance wdocs)
- **Estimated files**:
  - 21 nuevos (Helm charts, envelopes, DTOs, UI components, metrics)
  - 15 modificados (services, controllers, bridges, schemas)
  - 0 eliminados
- **Complexity drivers**:
  - Multi-tenancy en esquema PostgreSQL existente
  - CloudEvents envelope compliance con wdocs/02
  - Claim Check con NATS Object Store
  - NATS Account/ACL provisioning por tenant
  - Coordinación entre 5+ servicios
  - Anti-loop depth tracking
- **Suggested SDD depth**: Full pipeline (proposal → specs → design → tasks → apply)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `applications/yoizenclaw-application/src/infrastructure/database/` | Modified | Agregar `tenant_id` a tablas, índices compuestos |
| `applications/yoizenclaw-application/src/interfaces/nats_bridge.py` | Modified | Subjects wdocs `evt.{tenant}.yoizenclaw.>`, envelope, depth |
| `applications/yoizenclaw-application/src/application/agents/` | Modified | Caché por tenant, depth tracking, agent_outbound |
| `applications/yoizenclaw-application/src/shared/` | Extended | Envelope builder, claim check, tenant utils, metrics |
| `applications/yoizenclaw-application/src/interfaces/http/` | Modified | Tenant header extraction, structured logging |
| `services/yoizenclaw-admin-service/` | Modified | Envelope publishing, NATS Account provisioning |
| `services/tenant-service/` | Extended | NATS Account/Stream/Bucket/ACL provisioning |
| `services/admin-console/src/` | Extended | UI gestión de agentes, runtime status |
| `infrastructure/base/` | New | Helm chart YoizenClaw runtime |
| `packages/shared/` | Extended | Constantes subjects YoizenClaw, envelope types |
| `shared/types/python/` | New | Envelope builder, tenant utils |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking changes en schema PostgreSQL | Medium | Alembic migrations con rollback |
| Latencia en sincronización NATS | Medium | Health checks, timeouts, retry con backoff |
| Resource exhaustion por tenant | Medium | Knative limits/requests, stream max_bytes por tier |
| Race conditions en caché de agentes | Low | Locks en AgentManager, invalidación por tenant |
| Agent loops por depth excesivo | Low | MAX_DEPTH=5, depth tracking en envelope, DLQ |
| NATS Object Store unavailable | Low | Claim check write before publish, DLQ fallback |
| NATS Account provisioning falla | Low | Retry con backoff, rollback de namespace completo |

## Rollback Plan

1. **Schema**: `alembic downgrade` revierte columnas tenant_id
2. **Knative**: `kubectl delete ksvc yoizenclaw-{tenant}` elimina runtime
3. **NATS Account**: Eliminar stream `INGRESS-{tenant}` + bucket `PAYLOAD-{tenant}` + ACLs
4. **Feature flag**: `YOIZENCLAW_MULTITENANT_ENABLED=false` desactiva nuevos endpoints
5. **Subjects legacy**: Subjects sin tenant funcionan durante período de migración

## Dependencies

- **Tenant Service**: Provisionamiento de namespaces y PostgreSQL
- **NATS JetStream**: Stream `INGRESS-{tenant}`, bucket `PAYLOAD-{tenant}`, Accounts
- **Knative**: Serving instalado en cluster
- **PostgreSQL**: pgvector disponible en imágenes
- **wdocs compliance**: Envelopes, subjects, ACLs per docs de arquitectura

## Success Criteria

- [ ] Tenant crea agente desde Admin Console
- [ ] Runtime YoizenClaw se despliega automáticamente en namespace del tenant
- [ ] NATS Account creada con ACLs que aíslan tráfico por tenant
- [ ] Stream `INGRESS-{tenant}` creado con limits por tier
- [ ] Bucket `PAYLOAD-{tenant}` creado con TTL alineado
- [ ] Envelopes cumplen CloudEvents spec con `transport.method: "agent"`
- [ ] Agentes de diferentes tenants aislados (no ven datos de otros)
- [ ] Sync de config via NATS con latencia < 500ms
- [ ] Jobs programados ejecutan correctamente por tenant
- [ ] Campo `depth` en envelope previene loops (MAX_DEPTH=5)
- [ ] Claim Check funciona para payloads > 256KB
- [ ] Métricas `yoizenclaw.*` publicadas con tags tenant/agent/channel
- [ ] Logs estructurados con `tenant`, `traceid`, `causation_id`
- [ ] Runtime escala a 0 en Knative sin tráfico
- [ ] Health endpoint refleja estado real del runtime

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- Agregar `tenant_id` a esquema PostgreSQL (Alembic)
- Implementar envelope builder y subject helpers
- Modificar NATS bridge para subjects `evt.{tenant}.yoizenclaw.>`
- Claim Check con NATS Object Store

### Phase 2: Core Runtime (Week 3)
- Agent Manager con caché por tenant y depth tracking
- `agent_outbound` events con envelope CloudEvents
- Anti-loop con MAX_DEPTH=5
- Observabilidad: métricas y logging estructurado

### Phase 3: Admin Service & Tenant Service (Week 4)
- Integrar Admin Service con Tenant Service
- NATS Account/Stream/Bucket/ACL provisioning
- Endpoints de provisionamiento y health checks

### Phase 4: Deployment (Week 5)
- Helm chart para YoizenClaw en Knative
- Knative Service templates con variables de tenant
- Testing end-to-end

### Phase 5: UI (Week 6)
- Sección de Agentes en Admin Console
- Forms de creación/edición de agentes
- Runtime status dashboard

## Alternatives Considered

| Approach | Summary | Why Rejected |
|----------|---------|-------------|
| Runtime compartido | Un pod atiende múltiples tenants | Aislamiento de datos, riesgo seguridad, no escala individualmente |
| Sidecar pattern | Runtime como sidecar del admin service | Acopla servicios, viola separation of concerns |
| Webhooks en lugar de NATS | Config sync via HTTP webhooks | Menos reliable, no tiene Claim Check nativo |
| Flat subjects sin tenant | `events.runtime.config.sync` global | No cumple wdocs/01, sin aislamiento NATS Account |
| Sin envelope CloudEvents | Mensajes JSON planos | No cumple wdocs/02, sin depth tracking ni anti-loop |

## Notes

- **NATS subjects**: Cambio de `events.{tenant}.runtime.*` a `evt.{tenant}.yoizenclaw.>.*.v1` per wdocs/01
- **Envelope**: Todos los mensajes NATS usan CloudEvents envelope con `transport` y `depth`
- **Agent type**: YoizenClaw = `internal` per wdocs/03, MAX_DEPTH=5
- **Claim Check**: NATS Object Store `PAYLOAD-{tenant}`, umbral 256KB per wdocs/04
- **Security**: NATS Accounts con ACLs por tenant per wdocs/05
- **Observability**: Métricas `yoizenclaw.*`, logs con `tenant`/`traceid` per wdocs/06
- **Migration**: Migración Alembic para `tenant_id` en tablas existentes
- **PII policy**: NUNCA loguear `data.payload` per wdocs/06 sección 3.4
