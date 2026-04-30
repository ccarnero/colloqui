# Specification: yoizenclaw-admin-service

## Purpose

Especificación del servicio **yoizenclaw-admin-service** para platform-cluster. Este servicio gestiona la configuración administrativa de agents, credentials, channels, jobs y config files en una arquitectura multi-tenant.

---

## Requirements

### REQ-ADMIN-001: Crear Agent

**Priority**: P0 (Critical)

El sistema **MUST** permitir crear nuevos agentes conversacionales con configuración completa.

#### Scenario: Crear agent exitosamente

- GIVEN un tenant válido en el header `x-tenant-id`
- AND datos válidos del agente (nombre, system_prompt, model_config)
- WHEN se envía POST `/admin/agents` con el body
- THEN el sistema crea el agente en PostgreSQL del tenant
- AND retorna el agente creado con `id`, `created_at`, `updated_at`
- AND retorna HTTP 201 Created

#### Scenario: Validar campos obligatorios

- GIVEN un tenant válido
- AND datos incompletos (falta `name` o `system_prompt`)
- WHEN se envía POST `/admin/agents`
- THEN el sistema retorna HTTP 400 Bad Request
- AND incluye mensaje de error indicando campos faltantes

#### Scenario: Tenant no existe

- GIVEN un tenant inválido o no provisionado
- WHEN se envía POST `/admin/agents`
- THEN el sistema retorna HTTP 404 Not Found
- AND incluye mensaje "Tenant not found or not provisioned"

---

### REQ-ADMIN-002: Listar Agents

**Priority**: P0 (Critical)

El sistema **MUST** permitir listar todos los agentes de un tenant con paginación y filtros.

#### Scenario: Listar agents exitosamente

- GIVEN un tenant válido con agentes existentes
- WHEN se envía GET `/admin/agents`
- THEN el sistema retorna lista de agentes con paginación
- AND incluye metadata: total, page, limit
- AND retorna HTTP 200 OK

#### Scenario: Filtrar por status

- GIVEN un tenant válido
- AND parámetro de query `?status=published`
- WHEN se envía GET `/admin/agents`
- THEN el sistema retorna solo agentes con `is_active=true AND status='published'`

#### Scenario: Paginación

- GIVEN un tenant con 50 agentes
- AND parámetros `?page=2&limit=10`
- WHEN se envía GET `/admin/agents`
- THEN retorna agentes 11-20
- AND incluye links para navegación (next, prev)

---

### REQ-ADMIN-003: Obtener Agent por ID

**Priority**: P0 (Critical)

El sistema **MUST** permitir obtener un agente específico por su ID.

#### Scenario: Obtener agent exitosamente

- GIVEN un tenant válido
- AND un agente existente con id `agent-123`
- WHEN se envía GET `/admin/agents/agent-123`
- THEN retorna el agente completo con todas sus propiedades
- AND retorna HTTP 200 OK

#### Scenario: Agent no existe

- GIVEN un tenant válido
- AND un id de agente inexistente
- WHEN se envía GET `/admin/agents/inexistente`
- THEN retorna HTTP 404 Not Found
- AND incluye mensaje "Agent not found"

---

### REQ-ADMIN-004: Actualizar Agent

**Priority**: P0 (Critical)

El sistema **MUST** permitir actualizar la configuración de un agente existente.

#### Scenario: Actualizar agent exitosamente

- GIVEN un tenant válido
- AND un agente existente
- AND nuevos datos válidos (name, system_prompt, model_config)
- WHEN se envía PUT `/admin/agents/{id}`
- THEN actualiza el agente en PostgreSQL
- AND retorna el agente actualizado con nuevo `updated_at`
- AND retorna HTTP 200 OK

#### Scenario: Validar datos de actualización

- GIVEN un tenant válido
- AND datos inválidos (ej: model_config malformado)
- WHEN se envía PUT `/admin/agents/{id}`
- THEN retorna HTTP 400 Bad Request
- AND no modifica el agente en base de datos

---

### REQ-ADMIN-005: Eliminar Agent

**Priority**: P1 (High)

El sistema **SHOULD** permitir eliminar un agente (soft delete recomendado).

#### Scenario: Eliminar agent exitosamente

- GIVEN un tenant válido
- AND un agente existente no publicado (status=draft)
- WHEN se envía DELETE `/admin/agents/{id}`
- THEN marca el agente como `is_active=false` (soft delete)
- OR elimina físicamente si no tiene dependencias
- AND retorna HTTP 204 No Content

#### Scenario: No eliminar agent publicado

- GIVEN un agente con status='published'
- WHEN se intenta eliminar
- THEN retorna HTTP 409 Conflict
- AND mensaje "Cannot delete published agent. Unpublish first."

---

### REQ-ADMIN-006: Publicar/Unpublicar Agent

**Priority**: P0 (Critical)

El sistema **MUST** permitir publicar y despublicar agents, emitiendo eventos NATS.

#### Scenario: Publicar agent

- GIVEN un agente existente en estado 'draft'
- WHEN se envía POST `/admin/agents/{id}/publish`
- THEN cambia status a 'published'
- AND actualiza `published_at` timestamp
- AND publica evento NATS `agent.published` con metadata del agente
- AND retorna HTTP 200 OK

#### Scenario: Despublicar agent

- GIVEN un agente publicado
- WHEN se envía POST `/admin/agents/{id}/unpublish`
- THEN cambia status a 'draft'
- AND publica evento NATS `agent.unpublished` con metadata
- AND retorna HTTP 200 OK

#### Scenario: Evento NATS estructura correcta

- GIVEN una publicación/despublicación exitosa
- WHEN se emite evento NATS
- THEN el evento **MUST** seguir formato EventEnvelope de @yoizen/shared
- AND incluir: type, payload, metadata (tenantId, timestamp, source)
- AND usar subject NATS_SUBJECT.AGENT_PUBLISHED o AGENT_UNPUBLISHED

---

### REQ-ADMIN-007: CRUD Credentials

**Priority**: P0 (Critical)

El sistema **MUST** gestionar credenciales (secrets) con cifrado seguro.

#### Scenario: Crear credential

- GIVEN datos válidos: name, type (api_key/oauth/basic/custom), value
- WHEN POST `/admin/credentials`
- THEN almacena el value cifrado (encriptación simétrica con clave de entorno)
- AND retorna credential con `id`, metadata, `created_at`
- AND **MUST NOT** retornar el valor desencriptado
- AND retorna HTTP 201 Created

#### Scenario: Rotar credential

- GIVEN credential existente
- AND nuevo valor proporcionado
- WHEN PUT `/admin/credentials/{id}` con nuevo value
- THEN actualiza valor cifrado
- AND emite evento NATS `credential.rotated` con provider y timestamp
- AND retorna HTTP 200 OK

#### Scenario: Obtener credential sin valor

- GIVEN credential existente
- WHEN GET `/admin/credentials/{id}`
- THEN retorna metadata, type, expires_at
- AND **MUST NOT** incluir el valor encriptado ni desencriptado

---

### REQ-ADMIN-008: CRUD Channels

**Priority**: P1 (High)

El sistema **SHOULD** gestionar configuración de canales de comunicación.

#### Scenario: Crear channel

- GIVEN tipo válido: webchat | whatsapp | telegram | slack | custom
- AND config específica del tipo
- WHEN POST `/admin/channels`
- THEN crea channel en PostgreSQL
- AND retorna channel con `id`, `webhook_url` (generado automáticamente)
- AND retorna HTTP 201 Created

#### Scenario: Actualizar config de channel

- GIVEN channel existente
- AND cambios en configuración
- WHEN PUT `/admin/channels/{id}`
- THEN actualiza config
- AND emite evento NATS `channel.config.changed` con `channelId`, `changes`
- AND retorna HTTP 200 OK

---

### REQ-ADMIN-009: CRUD Jobs

**Priority**: P1 (High)

El sistema **SHOULD** gestionar tareas programadas asociadas a agents.

#### Scenario: Crear job

- GIVEN agent_id válido, name, schedule (cron expression o 'interval:X' o 'once')
- AND payload opcional
- WHEN POST `/admin/jobs`
- THEN crea job en PostgreSQL
- AND calcula `next_run` basado en schedule
- AND retorna HTTP 201 Created

#### Scenario: Listar job executions

- GIVEN job existente
- WHEN GET `/admin/jobs/{id}/executions`
- THEN retorna historial de ejecuciones con status, logs, timestamps
- AND soporta paginación

#### Scenario: Trigger job manualmente

- GIVEN job existente
- WHEN POST `/admin/jobs/{id}/trigger` con event_payload opcional
- THEN emite evento NATS `job.trigger` con job_id, execution_id, payload
- AND retorna HTTP 202 Accepted

#### Scenario: Enable/Disable job

- GIVEN job existente
- WHEN POST `/admin/jobs/{id}/enable` o `/disable`
- THEN actualiza `is_active` flag
- AND retorna HTTP 200 OK

---

### REQ-ADMIN-010: Config Files

**Priority**: P1 (High)

El sistema **SHOULD** gestionar archivos de configuración YAML/JSON.

#### Scenario: Actualizar config file

- GIVEN path y content válidos
- AND formato: yaml | json
- WHEN PUT `/admin/config-files`
- THEN almacena content en PostgreSQL
- AND incrementa version number
- AND retorna HTTP 200 OK

#### Scenario: Deploy config files

- GIVEN array de files a deployar
- WHEN POST `/admin/config-files/deploy`
- THEN emite evento NATS `runtime.config.sync` con files y paths
- AND retorna HTTP 202 Accepted

---

### REQ-ADMIN-011: Runtime Status

**Priority**: P2 (Medium)

El sistema **MAY** proveer información de estado del runtime.

#### Scenario: Obtener status

- GIVEN tenant válido
- WHEN GET `/admin/runtime/status`
- THEN retorna: configured (boolean), connected_runtimes (array), last_sync_at

---

## Multi-Tenancy Requirements

### REQ-TENANT-001: Aislamiento de Datos

**Priority**: P0 (Critical)

El sistema **MUST** garantizar aislamiento completo de datos entre tenants.

#### Scenario: Datos aislados por tenant

- GIVEN tenant A con agents existentes
- AND tenant B sin agents o con agents diferentes
- WHEN tenant B lista agents
- THEN **MUST NOT** ver agents de tenant A
- AND solo ve sus propios datos

#### Scenario: Conexión dinámica por tenant

- GIVEN request con header `x-tenant-id: tenant-123`
- WHEN cualquier operación de base de datos
- THEN el sistema conecta a `postgres.tenant-123-{env}-ns.svc.cluster.local`
- AND usa credenciales del namespace específico

---

### REQ-TENANT-002: Tenant Provisioning Check

**Priority**: P0 (Critical)

El sistema **MUST** verificar que el tenant esté provisionado antes de operar.

#### Scenario: Tenant no provisionado

- GIVEN header `x-tenant-id` con valor válido
- AND tenant no tiene PostgreSQL provisionado (sin namespace)
- WHEN cualquier request
- THEN retorna HTTP 404
- AND mensaje "Tenant database not provisioned"

---

## NATS Integration Requirements

### REQ-NATS-001: Publicar Eventos

**Priority**: P0 (Critical)

El sistema **MUST** publicar eventos al stream EVENTS de NATS JetStream cuando ocurren cambios relevantes.

#### Eventos requeridos:

| Evento | Subject | Trigger |
|--------|---------|---------|
| agent.published | AGENT_PUBLISHED | POST /agents/{id}/publish |
| agent.unpublished | AGENT_UNPUBLISHED | POST /agents/{id}/unpublish |
| credential.rotated | CREDENTIAL_ROTATED | PUT /credentials/{id} con nuevo value |
| channel.config.changed | CHANNEL_CONFIG_CHANGED | PUT /channels/{id} |
| runtime.config.sync | RUNTIME_CONFIG_SYNC | POST /config-files/deploy |
| runtime.jobs.sync | RUNTIME_JOBS_SYNC | POST /jobs (bulk sync) |
| job.trigger | JOB_TRIGGER | POST /jobs/{id}/trigger |
| job.event.emit | JOB_EVENT_EMIT | POST /jobs/events/emit |

#### Scenario: Evento estructura correcta

- GIVEN publicación de cualquier evento
- THEN el payload **MUST** seguir formato EventEnvelope:
```json
{
  "kind": "event",
  "type": "agent.published",
  "data": { ...payload... },
  "metadata": {
    "tenantId": "tenant-123",
    "timestamp": "2026-03-30T12:00:00Z",
    "source": "admin-service"
  }
}
```

---

## Non-Functional Requirements

### NFR-001: Performance de Queries

**Category**: Performance
**Priority**: P1 (High)

El sistema **SHOULD** responder a queries de listado en menos de 200ms (p95).

- **Metric**: Tiempo de respuesta HTTP para GET endpoints de listado
- **Target**: < 200ms para listas de hasta 100 elementos
- **Measurement**: OpenTelemetry traces, Prometheus metrics

---

### NFR-002: Seguridad de Secrets

**Category**: Security
**Priority**: P0 (Critical)

El sistema **MUST** nunca exponer credenciales desencriptadas en APIs ni logs.

- **Metric**: Exposición de secrets en respuestas/logs
- **Target**: 0 exposiciones
- **Measurement**: Scan de código, testing de endpoints

---

### NFR-003: Disponibilidad

**Category**: Reliability
**Priority**: P1 (High)

El sistema **SHOULD** estar disponible 99.9% del tiempo.

- **Metric**: Uptime del servicio
- **Target**: 99.9% (max 43min downtime/month)
- **Measurement**: Health checks, Knative probes

---

### NFR-004: Tracing

**Category**: Observability
**Priority**: P1 (High)

El sistema **SHOULD** incluir distributed tracing en todas las operaciones.

- **Metric**: Cobertura de traces OpenTelemetry
- **Target**: 100% de requests HTTP y operaciones NATS
- **Measurement**: Jaeger traces

---

## Traceability Summary

| ID | Requirement | Priority | Test File |
|----|-------------|----------|-----------|
| REQ-ADMIN-001 | Crear Agent | P0 | agents.controller.spec.ts |
| REQ-ADMIN-002 | Listar Agents | P0 | agents.controller.spec.ts |
| REQ-ADMIN-003 | Obtener Agent | P0 | agents.controller.spec.ts |
| REQ-ADMIN-004 | Actualizar Agent | P0 | agents.controller.spec.ts |
| REQ-ADMIN-005 | Eliminar Agent | P1 | agents.controller.spec.ts |
| REQ-ADMIN-006 | Publicar/Unpublicar Agent | P0 | agents.service.spec.ts |
| REQ-ADMIN-007 | CRUD Credentials | P0 | credentials.controller.spec.ts |
| REQ-ADMIN-008 | CRUD Channels | P1 | channels.controller.spec.ts |
| REQ-ADMIN-009 | CRUD Jobs | P1 | jobs.controller.spec.ts |
| REQ-ADMIN-010 | Config Files | P1 | config-files.controller.spec.ts |
| REQ-ADMIN-011 | Runtime Status | P2 | runtime.controller.spec.ts |
| REQ-TENANT-001 | Aislamiento de Datos | P0 | integration/tenant-isolation.spec.ts |
| REQ-TENANT-002 | Tenant Provisioning Check | P0 | integration/tenant-provision.spec.ts |
| REQ-NATS-001 | Publicar Eventos | P0 | integration/nats-publisher.spec.ts |
| NFR-001 | Performance de Queries | P1 | e2e/performance.spec.ts |
| NFR-002 | Seguridad de Secrets | P0 | security/audit.spec.ts |
| NFR-003 | Disponibilidad | P1 | health/health.controller.spec.ts |
| NFR-004 | Tracing | P1 | observability/tracing.spec.ts |

---

*Specification created: 2026-03-30*
*Status: Approved for Design*
