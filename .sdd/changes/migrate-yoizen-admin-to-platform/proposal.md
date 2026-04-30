# Proposal: migrate-yoizen-admin-to-platform

## Intent

Migrar el servicio **yoizen-admin** desde el monorepo **yoizenclaw** a **platform-cluster**, transformándolo de una aplicación Express.js monolítica a un microservicio NestJS multi-tenant integrado en la arquitectura Kubernetes/Knative de platform-cluster.

### Motivación
- Unificar la gestión administrativa de agents, credentials y configuración dentro del ecosistema platform-cluster
- Aprovechar las capacidades multi-tenant, observabilidad y escalado automático de Knative
- Mantener consistencia tecnológica con el resto de servicios (NestJS + Fastify + Bun)
- Habilitar aislamiento de datos por tenant usando PostgreSQL dedicado por namespace

---

## Scope

### In Scope
1. **Creación del nuevo servicio** `yoizenclaw-admin-service` en `platform-cluster/services/`
2. **Migración del modelo de datos**: Agent, Credential, Channel, Job, ConfigFile
3. **Transformación de Express.js → NestJS 11 + Fastify**
4. **Migración de Zod → class-validator + class-transformer**
5. **Adaptación a multi-tenancy**: integración con tenant-service para PostgreSQL por tenant
6. **Integración con `@yoizen/shared`** (tipos, constantes, TENANT_HEADER)
7. **Integración con `@yoizen/observability`** (Pino, OpenTelemetry)
8. **Migración de NATS**: de nats 2.28 a integración con NATS JetStream del cluster
9. **Creación de AGENTS.md** específico del servicio
10. **Scripts de build/start/test** compatibles con Bun
11. **Configuración Knative** (service YAML)

### Out of Scope
- **yoizen-ui**: La UI React se migrará en un cambio separado
- **yoizen-ai-assist**: El helper Python/FastAPI se evaluará para migración posterior
- **yoizen-channels**: Servicio de canales/conversaciones es independiente
- **yoizen-tools**: Catálogo de herramientas es independiente
- **YoizenClaw**: Runtime principal Python es un cambio mayor que requiere diseño aparte
- **Datos existentes**: Migración de datos de yoizenclaw a platform-cluster (solo estructura nueva)
- **Cambios a tenant-service**: Solo consumir el servicio, no modificarlo
- **Feature flags**: No se agregarán nuevas funcionalidades, solo migración 1:1

---

## Approach

### Arquitectura Objetivo

Seguir el patrón exacto de `auth-service` y `audit-service` de platform-cluster, **con capa de repositories** (conservando Clean Architecture de yoizen-admin):

```
services/yoizenclaw-admin-service/
├── src/
│   ├── main.ts                    # Bootstrap: Fastify adapter, ValidationPipe, port binding
│   ├── app.module.ts              # @Global() root module con NATS + TenantConnectionManager
│   ├── providers/
│   │   ├── nats.provider.ts       # NATS_CONNECTION, JETSTREAM_MANAGER (para publicar eventos)
│   │   └── tenant-connection-manager.ts  # Per-tenant PostgreSQL pools (Map-based)
│   ├── modules/
│   │   ├── agents/
│   │   │   ├── agents.module.ts
│   │   │   ├── agents.controller.ts    # CRUD + publish/unpublish endpoints
│   │   │   ├── agents.service.ts       # Lógica de negocio
│   │   │   ├── agents.repository.ts    # Queries SQL postgres.js (mantener capa repository)
│   │   │   └── agents.dto.ts           # CreateAgentDto, UpdateAgentDto (class-validator)
│   │   ├── credentials/
│   │   │   ├── credentials.module.ts
│   │   │   ├── credentials.controller.ts
│   │   │   ├── credentials.service.ts
│   │   │   ├── credentials.repository.ts
│   │   │   └── credentials.dto.ts
│   │   ├── channels/
│   │   │   ├── channels.module.ts
│   │   │   ├── channels.controller.ts
│   │   │   ├── channels.service.ts
│   │   │   ├── channels.repository.ts
│   │   │   └── channels.dto.ts
│   │   ├── jobs/
│   │   │   ├── jobs.module.ts
│   │   │   ├── jobs.controller.ts      # + endpoints enable/disable/run/trigger
│   │   │   ├── jobs.service.ts
│   │   │   ├── jobs.repository.ts
│   │   │   └── jobs.dto.ts
│   │   ├── config-files/
│   │   │   ├── config-files.module.ts
│   │   │   ├── config-files.controller.ts
│   │   │   ├── config-files.service.ts
│   │   │   ├── config-files.repository.ts
│   │   │   └── config-files.dto.ts
│   │   ├── runtime/
│   │   │   ├── runtime.module.ts
│   │   │   ├── runtime.controller.ts   # GET /runtime/status
│   │   │   └── runtime.service.ts
│   │   └── health/
│   │       ├── health.module.ts
│   │       └── health.controller.ts    # GET /health
├── test/
│   ├── unit/
│   └── integration/
├── package.json
├── tsconfig.json
└── AGENTS.md
```

**Convenciones de platform-cluster a seguir:**
- **No subcarpetas `dto/`**: Los DTOs van en el mismo folder del feature (ej. `agents.dto.ts`)
- **Mantener capa `repositories/`**: Queries SQL postgres.js encapsuladas (patrón Clean Architecture de yoizen-admin)
- **AppModule @Global()**: Exporta todos los providers para inyección en cualquier módulo
- **TenantConnectionManager**: Patrón de audit-service para conexiones dinámicas por tenant
- **SQL crudo con postgres.js**: No ORM, queries preparadas

### Estrategia de Migración por Módulo

| Módulo yoizen-admin | Equivalencia platform-cluster | Adaptaciones Necesarias |
|---------------------|------------------------------|------------------------|
| `domain/` (entities) | DTOs + Interfaces | Agregar decoradores class-validator en archivos `.dto.ts` |
| `validation/` (Zod) | `*.dto.ts` (class-validator) | Transformar schemas Zod a clases DTO con decoradores |
| `controllers/` (Express) | `*.controller.ts` (NestJS) | Decoradores @Controller, @Get, @Post, @Body, @Param |
| `services/` (Express) | `*.service.ts` (NestJS) | @Injectable, orquestar lógica y llamar repositories |
| `repositories/` (pg) | `*.repository.ts` (NestJS) | @Injectable, inyectar TenantConnectionManager, queries SQL |
| `events/nats-publisher.ts` | `nats.provider.ts` | Adaptar a JetStream para publicar eventos |
| `utils/logger.ts` | `@yoizen/observability` | Reemplazar por LoggerService inyectado de NestJS |
| `db/` (pg raw) | `tenant-connection-manager.ts` | Reusar patrón de audit-service para conexiones dinámicas |

**Nota sobre Clean Architecture:**
- **Services**: Contienen lógica de negocio, orquestación, publicación de eventos NATS
- **Repositories**: Encapsulan queries SQL postgres.js, manejo de conexiones por tenant
- **Controllers**: HTTP layer, delegan a services inmediatamente

### Decisiones Técnicas

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Framework** | NestJS 11 + Fastify | Estándar platform-cluster, consistency |
| **Validación** | class-validator + class-transformer | Estándar platform, ValidationPipe global |
| **Database** | postgres.js (raw SQL) | Consistencia con auth-service/audit-service, sin ORM |
| **Multi-tenancy** | TenantConnectionManager | Patrón probado en audit-service, lazy pools por tenant |
| **Runtime** | Bun 1.3 | Estándar de platform-cluster |
| **NATS** | JetStream (solo publisher) | yoizen-admin solo publica eventos (no consume) |
| **Testing** | bun:test | Estándar platform-cluster (no Jest) |
| **Estructura DTOs** | En mismo folder del feature | Convención auth-service/audit-service (no subcarpeta dto/) |
| **Logging** | @yoizen/observability | Pino estructurado, OpenTelemetry tracing |
| **Health checks** | Módulo health/ separado | Convención de todos los servicios platform |

### Alternativas Consideradas

| Approach | Summary | Why Rejected |
|----------|---------|--------------|
| **Mantener Express.js** | Migrar solo infraestructura, no código | Rompe consistencia de platform, pierde beneficios NestJS (DI, decorators, ecosistema) |
| **Usar TypeORM** | ORM completo para PostgreSQL | Complejidad innecesaria, equipo familiarizado con queries raw, consistencia con tenant-service |
| **Multi-tenancy via schema** | Un PG compartido, schemas separados | No ofrece aislamiento completo de recursos, más complejo de escalar |
| **Migración gradual** | Servicio híbrido Express+NestJS | Duplicidad de código, complejidad de deployment, mayor riesgo |

---

### Multi-Tenancy Architecture

Usar el patrón exacto de **audit-service** con capa de **repositories**:

1. **TenantConnectionManager**: Provider global que mantiene `Map<string, Sql>` con conexiones por tenant
2. **Repositories**: Inyectan TenantConnectionManager, encapsulan queries SQL postgres.js
3. **Lazy initialization**: Conexión se crea en primer uso, schema se inicializa automáticamente
4. **Connection string**: `postgres://{user}:{pass}@postgres.{tenantId}-{env}-ns.svc.cluster.local:{port}/{db}`
5. **Tenant header**: Extraer de `TENANT_HEADER` (de @yoizen/shared) en cada request

**Flujo de datos:**
```
Controller -> Service -> Repository -> TenantConnectionManager -> PostgreSQL
                |
                v
          NATS Publisher (eventos)
```

**Ejemplo:**
```typescript
// agents.repository.ts
@Injectable()
export class AgentsRepository {
  constructor(private readonly tenantManager: TenantConnectionManager) {}

  async findById(tenantId: string, id: string): Promise<Agent | null> {
    const sql = await this.tenantManager.getConnection(tenantId);
    const result = await sql`SELECT * FROM agents WHERE id = ${id}`;
    return result[0] || null;
  }
}

// agents.service.ts
@Injectable()
export class AgentsService {
  constructor(
    private readonly repository: AgentsRepository,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  async publishAgent(tenantId: string, agentId: string) {
    const agent = await this.repository.findById(tenantId, agentId);
    await this.repository.updateStatus(tenantId, agentId, 'published');
    await this.natsPublisher.publishAgentPublished(agentId, agent.name, new Date().toISOString());
  }
}
```

---

## Effort Estimation

- **Size**: **L** (Large)
- **Estimated files**: 
  - **New**: ~40-50 archivos (controllers, services, repositories, DTOs, providers, tests)
  - **Modified**: 0 (servicio nuevo)
  - **Deleted**: 0 (no borramos yoizen-admin original todavía)
- **Complexity drivers**:
  - Cambio de framework (Express → NestJS)
  - Adaptación a multi-tenancy (conexiones dinámicas por tenant)
  - Migración de lógica de negocio completa (5 entidades principales)
  - Integración con ecosistema existente (NATS, observabilidad)
- **Suggested SDD depth**: **Full pipeline** (proposal → spec → design → tasks → apply → verify → archive)

---

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `services/yoizenclaw-admin-service/` | **New** | Servicio completo nuevo (40-50 archivos) |
| `services/tenant-service/` | **None** | Solo consumir API, no modificar |
| `packages/shared/` | **None** | Usar tipos existentes, no modificar |
| `packages/observability/` | **None** | Usar logger existente, no modificar |
| `infrastructure/` | **New** | Configuración Knative para nuevo servicio |
| `knative/services/` | **New** | Service YAML para yoizenclaw-admin-service |

---

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **Incompatibilidad de datos** entre yoizen-admin y tenant-service | Medium | Documentar mapeo de entidades, validar campos obligatorios, crear seeds de prueba |
| **Complejidad de multi-tenancy** (conexiones dinámicas) | Medium | Reusar patrón de tenant-service, crear provider reutilizable, tests de integración |
| **Diferencias de comportamiento** Express vs Fastify | Low | Testing E2E exhaustivo, verificar manejo de streams/WebSocket si aplica |
| **Performance con Bun** (runtime nuevo para equipo) | Low | Validar en ambiente local primero, comparar tiempos de respuesta |
| **NATS JetStream** vs NATS core de yoizenclaw | Medium | Documentar diferencias, adaptar publishers/consumers, testing de mensajería |
| **Scope creep** agregar features nuevas | Medium | Estricto en scope 1:1, cualquier mejora va a otro cambio SDD |

---

## Rollback Plan

1. **Antes del deployment a producción**:
   - Mantener yoizen-admin original en yoizenclaw operativo
   - Feature flag en api-gateway para routing condicional
   - Validación E2E completa antes de switch

2. **Si hay problemas en producción**:
   - Revertir Knative service YAML a versión anterior (si había uno)
   - Cambiar routing en api-gateway a yoizen-admin original
   - Yoizenclaw-admin-service queda inaccesible pero no afecta datos

3. **Recuperación**:
   - Datos no se migran automáticamente (scope out), no hay riesgo de corrupción
   - Servicio puede destruirse y recrearse sin impacto en otros servicios

---

## Dependencies

### Bloqueantes (deben estar listos antes de empezar)
- [ ] **tenant-service** operativo en platform-cluster (para crear tenants de prueba)
- [ ] **PostgreSQL provisioning** funcionando (StatefulSet por tenant)

### En paralelo (no bloquean pero se asumen)
- [ ] **@yoizen/shared** disponible en workspace
- [ ] **@yoizen/observability** disponible en workspace
- [ ] **NATS JetStream** configurado en infraestructura base

### Después (se integran luego)
- [ ] **api-gateway** routing al nuevo servicio
- [ ] **knative/services/** YAML del servicio

---

## Success Criteria

- [ ] **Servicio compila** sin errores TypeScript (`bun run build`)
- [ ] **Tests unitarios** pasan (>80% coverage en services/)
- [ ] **Tests E2E** pasan (POST/GET/PUT/DELETE de todos los endpoints)
- [ ] **Health endpoint** responde `200 OK` (`GET /health`)
- [ ] **CRUD Agents** funciona con validación (POST/GET/PUT/DELETE /agents, /agents/:id/publish, /agents/:id/unpublish)
- [ ] **CRUD Credentials** funciona con cifrado de secrets
- [ ] **CRUD Channels** funciona con validación de config
- [ ] **CRUD Jobs** funciona con scheduling config (incluye enable/disable/run/trigger)
- [ ] **ConfigFiles** funciona (GET/PUT /config-files, POST /config-files/deploy)
- [ ] **Runtime status** disponible (GET /runtime/status)
- [ ] **Multi-tenancy** aislada (datos de tenant A no visibles para tenant B)
- [ ] **NATS publisher** emite eventos correctamente (agent.published, channel.config.changed, etc)
- [ ] **Observability** logs estructurados con trace IDs
- [ ] **AGENTS.md** documenta arquitectura siguiendo formato de auth-service/audit-service
- [ ] **Knative service** configurado y desplegable

---

## Notes

### Entidades principales a migrar (de yoizenclaw):

```typescript
// Agent: Configuración de agentes conversacionales
interface Agent {
  id: string;
  name: string;
  description?: string;
  system_prompt: string;
  model_config: object;  // { provider, model, temperature, etc }
  tools: string[];       // referencias a tools
  channels: string[];    // referencias a channels
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Credential: Secrets cifrados (API keys, tokens)
interface Credential {
  id: string;
  name: string;
  type: 'api_key' | 'oauth' | 'basic' | 'custom';
  encrypted_value: string;
  metadata?: object;
  expires_at?: Date;
  created_at: Date;
  updated_at: Date;
}

// Channel: Configuración de canales de comunicación
interface Channel {
  id: string;
  name: string;
  type: 'webchat' | 'whatsapp' | 'telegram' | 'slack' | 'custom';
  config: object;        // config específica por tipo
  webhook_url?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Job: Tareas programadas asociadas a agents
interface Job {
  id: string;
  name: string;
  agent_id: string;
  schedule: string;      // cron expression o 'interval:X' o 'once'
  payload?: object;      // datos a enviar al agent
  is_active: boolean;
  last_run?: Date;
  next_run?: Date;
  created_at: Date;
  updated_at: Date;
}

// ConfigFile: Archivos de configuración YAML/JSON
interface ConfigFile {
  id: string;
  name: string;
  path: string;
  content: string;
  format: 'yaml' | 'json';
  version: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}
```

### Mapeo de Schemas Zod → class-validator

| Zod | class-validator |
|-----|-----------------|
| `z.string()` | `@IsString()` |
| `z.number()` | `@IsNumber()` |
| `z.boolean()` | `@IsBoolean()` |
| `z.optional()` | `@IsOptional()` |
| `z.array()` | `@IsArray()` + `@ValidateNested()` |
| `z.object()` | Clase DTO anidada |
| `z.enum()` | `@IsEnum()` |
| `z.uuid()` | `@IsUUID()` |
| `.min(n)` | `@MinLength(n)` |
| `.max(n)` | `@MaxLength(n)` |
| `.email()` | `@IsEmail()` |
| `.url()` | `@IsUrl()` |

---

*Propuesta creada: 2026-03-30*  
*Status: Draft - Pendiente de aprobación*
