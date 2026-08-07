# BLOCKED

## PENDIENTES/09-hallazgos-group-c.spec.md · T01 — 2026-08-07

- **Attempts**: 1 (implementer STOPPED per the SPEC's own rule: "a repaired
  suite exposes a real product bug too large for one attempt → STOP").
- **Failing gate**: `cd services/agent-admin-service && bun test` → `0 fail`
  is unreachable within the task's scope. Best state achieved during the
  attempt: 778 pass / 17 skip / 10 fail (baseline 768/17/14); typecheck green.
- **Why it cannot be green as scoped** — the registered DI-token rot is real
  but is only layer 1 of 5 (all verified by the implementer):
  1. DI token: suites override `TenantConnectionManager` (@yoizen/database)
     while modules inject `YoizenclawTenantConnectionManager`
     (`src/providers/tenant-connection-manager.ts:8`).
  2. Eager NATS: `jetStreamManagerProvider` dials the broker at `app.init()`
     unless `LAZY_NATS` is overridden (`src/providers/nats.provider.ts:175-185`).
  3. Wrong HTTP platform: suites use `createNestApplication()` (Express); the
     service is Fastify (precedent for fix:
     `services/agent-memory-service/test/e2e/agent-tools.controller.e2e-spec.ts:172,180`).
  4. Testcontainers: default wait strategy hangs; bun rejects
     `beforeAll(fn, ms)` — repo pattern is `setDefaultTimeout` +
     `Wait.forLogMessage` (`services/connector-admin/test/integration/setup.ts:112-118`).
  5. Engine mismatch: `bun test` shares one process; `test/setup-env.ts` pins
     `STORAGE_ENGINE=mongo` and engines bind at import time
     (`providers.module.ts:24`), so mongo integration + postgres e2e cannot
     coexist in one run as written.
- **Hard blocker (product, not tests)**: `e2e/credentials-security` (13
  tests), parts of `e2e/multi-tenancy` (2) and `e2e/nats-events` (3) exercise
  `/admin/credentials` and `/admin/channels` — no such module/controller
  exists in `src`. Green requires either building the features or formally
  retiring the suites: a HUMAN product ruling, out of loop scope.
- **What was tried**: full repair of `e2e/health` (0 fail standalone,
  10 pass) proving the layer-1-4 fixes work; shared `test/e2e/setup.ts`
  hardening; partial integration repair reverted to keep the tree clean.
  ALL of it reverted per protocol — the knowledge lives here and in the
  spec's Progress.
- **Proposed re-scope** (needs human approval, then a spec update):
  - T01a — repair `e2e/health` + `e2e/agents` (engine pinned postgres,
    canonical `initAgentAdminTenantSchema`, Fastify adapter, ValidationPipe
    parity).
  - T01b — integration suites: in-memory persistence fake at the
    repository-token seam; repair the 57 tests.
  - T01c — product ruling on `credentials`/`channels`: implement the modules
    or retire the three suites (13+2+3 tests). Decision, not implementation.
- **Adjacent smells reported by the attempt** (for the register):
  `SystemVariablesService` issues raw SQL unconditionally — broken under
  `STORAGE_ENGINE=mongo` (`system-variables.service.ts:30-40`);
  `test/mongo-mock.ts:3` imports a nonexistent path (survives via type-only
  use); `e2e/nats-events` partially asserts on envelopes fabricated by its own
  mock (validates the double, not `NatsPublisher`);
  `providers.module.ts:34-37` dead ternary (same listener both branches).
