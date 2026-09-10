# BLOCKED

## PENDIENTES/09-hallazgos-group-c.spec.md · T01 — 2026-08-07 — **RESOLVED 2026-08-07**

> Re-scope approved by the user (T01a/T01b/T01c) and credentials/channels
> ruled Option B: retire the phantom tests (SPEC ruling 4). The entry below
> stays as the diagnostic record.

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


## manual-loops/examples/channel-subject-parsing.md · T02 — 2026-09-10

The required package-index export test cannot load because the new runtime lists
are absent from the index's selective exports. The implementer stopped without
editing outside the allowed paths.

Root cause: `packages/shared/src/index.ts:68-98` selectively re-exports constants,
ending with `WEBHOOK_SECRET_HEADERS_SET,` followed by `} from "./channel.constants";`.
It omits all three new lists. The task requires the index export test but excludes
`index.ts` from its allowed write paths.

Preferred candidate fix (requires human scope approval): add
`packages/shared/src/index.ts` to T02's allowed paths, then add the intended exports:

```diff
   WEBHOOK_SECRET_HEADERS_SET,
+  CHANNELS,
+  CHANNEL_PROVIDERS,
+  MESSAGE_KINDS,
 } from "./channel.constants";
```

Risk: low; adds three intended public exports. Alternative: use
`export * from "./channel.constants";` instead of the selective block; medium risk
because it also exposes other current and future constants. Neither fix was applied.

- SPEC: `manual-loops/examples/channel-subject-parsing.md`; task T02; date 2026-09-10.
- Attempts: 1/4; stopped for required scope expansion, not budget exhaustion.
- Attempt 1: added runtime lists, parser membership checks, rejection table and index
  export test within the three allowed paths. Separate implementer typecheck passed;
  implementer Accept failed: `Export named 'CHANNEL_PROVIDERS' not found`.
- Script-runner: G0 exit 0 (KISS guards passed); G1 exit 0 (no output); G2
  `cd packages/shared && bun test` exit 1: `384 pass`, `1 fail`, `1 error`,
  `748 expect() calls`, 385 tests across 22 files. Runner output was truncated.
- Runner Accept, dual review and commit dry run were not run after the failing gate.
- Estimated total usage below 100,000 / 5,000,000 tokens; exact accounting unavailable.
- Implementation preserved by scoped stash:
  `BLOCKED manual-loops/examples/channel-subject-parsing.md T02`.
  First stash failed with `error: could not write index`; escalated retry succeeded.
- Remaining: approve scope, commit the block/SPEC records, resume the preserved work,
  rerun applicable gates and both reviews, then perform the human commit dry run.

### T02 scope decision — 2026-09-10

The user approved the preferred proposal: allow `packages/shared/src/index.ts`
and add only the three runtime-list exports to its existing selective block.
The SPEC now records that scope and the retry instruction. Implementation remains
stashed; attempt 2 has not started because the block records and approved SPEC
change are uncommitted. This resolves the scope decision, not validation or T02.
