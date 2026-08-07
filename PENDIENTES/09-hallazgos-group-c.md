# 9 · Hallazgos emergentes de la corrida Group C (2026-08-06)

Class: register
Summary: Tres hallazgos que surgieron ejecutando `02-group-c.spec.md` (T01–T03, commits `1f4244af`/`b33fde25`/`deb140bb`). Estado: **los tres CERRADOS 2026-08-07** — H2 por eliminación directa de `python_code`; H1 y H3 por el loop de `09-hallazgos-group-c.spec.md` (5/5 tareas, incl. el bug de producto T01d que H1 escondía). Este archivo queda como registro histórico.

---

## H1 · agent-admin-service: 14 suites de integración/e2e rotas en el commit base — **CERRADO 2026-08-07**

> Resuelto por el loop de `09-hallazgos-group-c.spec.md` (T01c/T01d/T01a/T01b):
> suite completa en **868 pass / 0 fail**. El rot tenía 5 capas (no solo el
> token de DI) y escondía: 18 tests fantasma de features inexistentes
> (retirados por ruling, contrato rescatado a
> `DOCS/agents/credentials-security-contract.md`) y un bug de producto real
> — pérdida de datos por `enableImplicitConversion` en `agents.dto.ts`
> (T01d, `d137ebb9`). El detalle de abajo queda como registro histórico.

El gate G1 del loop lo expuso: `bun test` en `services/agent-admin-service` da
**743 pass / 14 fail en el commit base** — las mismas 14 fallas con y sin los
diffs de Group C. No es testcontainers ni Docker: es rot de DI de NestJS —
`YoizenclawTenantConnectionManager` no resuelve en los módulos de test de
`SystemVariablesModule`, `ConfigFilesModule` y compañía
(`Nest can't resolve dependencies of the SystemVariablesService`).

Suites afectadas: Agents/ConfigFiles/Jobs Integration, Health/NATS/Agents/
Credentials-Security/Multi-Tenancy E2E.

**Misma clase que E10 de Group B** (suites que nunca corren verdes y nadie lo
nota). Mientras siga así, el gate "all integration tests green" de cualquier
loop sobre este servicio corre con 14 de deuda descontada a mano.

**Fix:** cablear el provider (o su mock) en los `Test.createTestingModule` de
esas suites; misma corrida debería dejar el servicio en 0 fail y restaurar el
gate sin asteriscos.

## H2 · `python_code` es un no-op silencioso que reporta éxito — **CERRADO 2026-08-07**

> Resuelto por ruling del usuario: eliminación completa. Case del executor,
> stub de `function-action.service.ts`, fila del doc, enum del fixture y
> allowlist del lint — todo fuera. Regresión:
> `test/unit/function-action.service.spec.ts` fija que `python_code` lanza
> `Unknown function` (nunca más éxito silencioso). El detalle de abajo queda
> como registro histórico.

`job-executor.service.ts:101-105` rutea `action_type: "python_code"` a
`functionAction.execute("python_code", {})`, que **no lanza**: devuelve
`{supported: false}` (`function-action.service.ts:23-32`) y la ejecución
termina publicando `execution_completed`. Un job `python_code` "corre",
no hace nada, y queda registrado como exitoso.

Agravante detectado en el review de T02: el lint del fixture acepta
`python_code` (está en la lista del switch), así que un drift futuro del
fixture hacia ese valor pasaría el guard y no-opearía en runtime.

**Productores: ninguno** (verificado 2026-08-07). El form de schedules del
admin-console ofrece solo `llm_call | webhook | function | agent_task`
(`schedule-form-dialog.component.ts`), el DTO de jobs no valida el payload, y
las únicas referencias en el repo son el case del executor, el stub y la fila
"stub" de `DOCS/agents/jobs.md`. Es un vestigio del runtime Python original
(el mensaje del stub lo dice: "NOT supported in TypeScript runtime").

**Fix:** eliminar el case del executor, el stub en `function-action.service.ts`,
la fila del doc y el valor en el allowlist del lint (`jobs-fixture.spec.ts`).
Solo un payload artesanal puede alcanzarlo hoy — que falle validación, no que
"complete".

## H3 · Las alertas de consumer-lag cubren 4 de 13 durables reales — **CERRADO 2026-08-07**

> Resuelto por T02 del loop (`717cd660`): patrón invertido — sin allow-list,
> todo consumer alerta por defecto, lista de exclusión vacía documentada; el
> guard G15 de `doc-code-guards.sh` deriva el universo de durables del código
> (22 nombres, no 13 — el conteo de abajo subestimaba) y convierte nombres
> muertos en falla de CI. Verificado en vivo vía `/api/v1/rules`. El detalle
> de abajo queda como registro histórico.

Tras T03 (borrar los 2 filtros muertos), los exprs de `nats-consumer-lag`
(`alerts.yaml:383,401`) quedaron honestos pero cortos: cubren
`workflow-triggers|channel-webhook-ingress|auto-reply|channel-egress`.
Durables vivos SIN cobertura de lag: `execution-audit`, `audit-events`,
`channel-audit`, `workflow-projector`, `connector-runtime-invoke`,
`adapter-internal-sync`, `ingestion-worker`, `skb-ingestion-worker`,
`ai-agent-gateway-results`.

Causa raíz del drift original: la lista está copiada a mano en 3 lugares (los
2 exprs + la prosa de `DOCS/architecture/observability.md` §4.2) y
`doc-code-guards` vigila nombres de alertas, no filtros de labels.

**Fix (ticket de infra):** invertir el patrón — match amplio sobre
`consumer_name` con lista de exclusión, para que un durable nuevo nazca
monitoreado por defecto (el modo de falla exacto que E5 arregló). Bonus: un
guard que derive la lista de los `DURABLE_NAME` reales bajo `services/`.
