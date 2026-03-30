# Tasks: migrate-yoizen-admin-to-platform

**Total Effort**: ~35 horas | **Critical Path**: Phase 1 → Phase 2.1 → Phase 2.2 → Phase 3 → Phase 4 → Phase 5
**TDD**: disabled (testing convencional, no RED/GREEN/REFACTOR triplets)

---

## Phase 1: Foundation & Configuration

Configuración inicial del servicio, providers globales y estructura base.

- [x] 1.1 Crear estructura de carpetas del servicio `[XS]`
- [x] 1.2 Crear `package.json` con dependencias `[S]`
- [x] 1.3 Crear `tsconfig.json` `[XS]`
- [x] 1.4 Implementar `TenantConnectionManager` provider `[M]`
- [x] 1.5 Implementar `NatsProvider` y `NatsPublisher` `[M]`
- [x] 1.6 Crear `AGENTS.md` template `[XS]`

---

## Phase 2: Core Implementation - Agents Module

Implementación completa del módulo de agents (CRUD + publish/unpublish + eventos NATS).

- [x] 2.1 Escribir tests unitarios para AgentsRepository `[S]`
- [x] 2.2 Implementar `AgentsRepository` `[M]`
- [x] 2.3 Implementar DTOs `agents.dto.ts` `[S]`
- [x] 2.4 Escribir tests para AgentsService `[S]`
- [x] 2.5 Implementar `AgentsService` `[M]`
- [x] 2.6 Implementar `AgentsController` `[M]`
- [x] 2.7 Crear `AgentsModule` `[XS]`
- [x] 2.8 Tests de integración para Agents `[M]`

---

## Phase 3: Core Implementation - Credentials Module

CRUD de credentials con placeholder de cifrado.

- [x] 3.1 Implementar `CredentialsRepository` `[M]`
- [x] 3.2 Implementar DTOs `credentials.dto.ts` `[S]`
- [x] 3.3 Implementar `CredentialsService` `[M]`
- [x] 3.4 Implementar `CredentialsController` `[M]`
- [x] 3.5 Crear `CredentialsModule` `[XS]`
- [x] 3.6 Tests de integración para Credentials `[M]`

---

## Phase 4: Core Implementation - Channels Module

CRUD de channels + evento channel.config.changed.

- [x] 4.1 Implementar `ChannelsRepository` `[M]`
- [x] 4.2 Implementar DTOs `channels.dto.ts` `[S]`
- [x] 4.3 Implementar `ChannelsService` `[M]`
- [x] 4.4 Implementar `ChannelsController` `[S]`
- [x] 4.5 Crear `ChannelsModule` `[XS]`
- [x] 4.6 Tests de integración para Channels `[S]`

---

## Phase 5: Core Implementation - Jobs Module

CRUD de jobs + scheduling + trigger manual + ejecuciones.

- [x] 5.1 Implementar `JobsRepository` y `JobExecutionsRepository` `[M]`
- [x] 5.2 Implementar DTOs `jobs.dto.ts` `[S]`
- [x] 5.3 Implementar `JobsService` `[M]`
- [x] 5.4 Implementar `JobsController` `[M]`
- [x] 5.5 Crear `JobsModule` `[XS]`
- [x] 5.6 Tests de integración para Jobs `[M]`

---

## Phase 6: Core Implementation - Config Files Module

Gestión de archivos de configuración + deploy.

- [x] 6.1 Implementar `ConfigFilesRepository` `[M]`
- [x] 6.2 Implementar DTOs `config-files.dto.ts` `[S]`
- [x] 6.3 Implementar `ConfigFilesService` `[M]`
- [x] 6.4 Implementar `ConfigFilesController` `[S]`
- [x] 6.5 Crear `ConfigFilesModule` `[XS]`
- [x] 6.6 Tests de integración para Config Files `[S]`

---

## Phase 7: Integration Modules

Runtime status y Health checks.

- [x] 7.1 Implementar `RuntimeService` y `RuntimeController` `[S]`
- [x] 7.2 Crear `RuntimeModule` `[XS]`
- [x] 7.3 Implementar `HealthController` `[S]`
- [x] 7.4 Crear `HealthModule` `[XS]`

---

## Phase 8: Wiring & Bootstrap

Conectar todo en AppModule y bootstrap.

- [x] 8.1 Crear `AppModule` `[S]`
- [x] 8.2 Crear `main.ts` `[S]`
- [x] 8.3 Actualizar `AGENTS.md` con información final `[M]`

---

## Phase 9: End-to-End Testing

Tests E2E completos del servicio.

- [x] 9.1 Setup de tests E2E `[S]`
- [x] 9.2 E2E test: Flujo completo de Agents `[M]`
- [x] 9.3 E2E test: Multi-tenancy isolation `[M]`
- [x] 9.4 E2E test: Security - No credential exposure `[S]`
- [x] 9.5 E2E test: NATS event structure `[S]`
- [x] 9.6 E2E test: Health endpoint `[XS]`

---

## Phase 10: Deployment Configuration

Knative y Kubernetes manifests.

- [x] 10.1 Crear Knative Service YAML `[S]`
- [x] 10.2 Crear overlay para local `[XS]`
- [x] 10.3 Crear Dockerfile `[XS]`

---

## Phase 11: Final Verification & Cleanup

Validación final antes de merge.

- [x] 11.1 Ejecutar todos los tests `[M]`
- [x] 11.2 Ejecutar linter `[S]`
- [x] 11.3 Verificar TypeScript `[S]`
- [x] 11.4 Actualizar tasks.md `[XS]`

---

## Summary

| Phase | Tasks | Parallelizable | Effort | Focus |
|-------|-------|---------------|--------|-------|
| Phase 1 | 6 | 0 | ~4h | Foundation |
| Phase 2 | 8 | 0 | ~6h | Agents Module |
| Phase 3 | 6 | 5 | ~4h | Credentials |
| Phase 4 | 6 | 5 | ~3h | Channels |
| Phase 5 | 6 | 5 | ~4h | Jobs |
| Phase 6 | 6 | 5 | ~3h | Config Files |
| Phase 7 | 4 | 3 | ~2h | Integration |
| Phase 8 | 3 | 0 | ~2h | Wiring |
| Phase 9 | 6 | 0 | ~4h | E2E Testing |
| Phase 10 | 3 | 0 | ~1h | Deployment |
| Phase 11 | 4 | 0 | ~2h | Verification |
| **Total** | **59** | **23** | **~35h** | |

### Critical Path

La ruta crítica (no paralelizable) es:
1. Phase 1 (Foundation) → 
2. Phase 2.1-2.2 (Agents Repository tests + impl) → 
3. Phase 2.6-2.7 (Agents Controller + Module) → 
4. Phase 8 (Wiring) → 
5. Phase 9 (E2E) → 
6. Phase 11 (Verification)

### Implementation Order

**Batch 1** (Secuencial, 1 desarrollador, ~10h):
- Phase 1 completa
- Phase 2 completa (Agents como template)
- Phase 8 (Wiring)

**Batch 2** (Paralelo, 3-4 desarrolladores, ~15h):
- Phase 3 (Credentials)
- Phase 4 (Channels)
- Phase 5 (Jobs)
- Phase 6 (ConfigFiles)

**Batch 3** (Secuencial, 1 desarrollador, ~10h):
- Phase 7 (Integration modules)
- Phase 9 (E2E tests)
- Phase 10 (Deployment)
- Phase 11 (Verification)

---

## Implementation Complete ✅

**Status**: 59/59 tareas completadas (100%)

**Fecha de finalización**: 2026-03-30

**Servicio**: `yoizenclaw-admin-service` en `platform-cluster/services/`

---

*Tasks updated: 2026-03-30*
*Status: Implementation Complete*
