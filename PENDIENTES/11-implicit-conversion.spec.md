# SPEC — ValidationPipe options extraction + implicit-conversion sweep

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `PENDIENTES/`.
> Depends on: none (09-hallazgos-group-c CLOSED shipped the agent-admin fix
> this generalizes).
> Origin: register `PENDIENTES/11-implicit-conversion.md` (platform finding of
> `09-hallazgos-group-c.spec.md` T01d; Fase 2 of the PENDIENTES plan).
> Engram topic: 'platform-cluster/pendientes-implicit-conversion'.

## Goal

The production ValidationPipe options (`whitelist`, `forbidNonWhitelisted`,
`transform`, `transformOptions.enableImplicitConversion: true`) exist in four
copies — two production (`packages/observability/src/bootstrap-fastify.ts:47-53`,
`services/api-gateway/src/main.ts:58`; plus `bootstrap-split-service.ts`'s
inline twin) and three test-parity copies in agent-admin. T01d of register 09
proved `enableImplicitConversion` silently mangles untyped object-array DTO
fields, fixed it in agent-admin, and left a generic auto-discovery test
(`services/agent-admin-service/test/unit/agents.dto.transform.spec.ts`).

After this queue: (1) ONE exported options constant in
`packages/observability`, imported by every production bootstrap and every
test harness that needs parity — desync-by-copy is structurally dead;
(2) every service that boots with `withValidationPipe: true` has either a
permanent pinning test proving its DTOs survive the production pipe, or a
FINDING in register 11 awaiting the user's ruling. Product fixes are NOT part
of this queue.

## User decisions (human boundary — do not reinterpret)

1. Fase 2 ordering (2026-08-07): extraction FIRST, sweep second — the sweep's
   tests must import the extracted constant, not copy options a fourth time.
2. Sweep findings are REGISTERED, not fixed: any discovered mangling is a
   potential product bug → record in `PENDIENTES/11-implicit-conversion.md`
   §"Hallazgos del barrido T02" and STOP for ruling (T09 precedent). The only
   sanctioned code changes in T02 are new test files.
3. Scope discipline: adjacent smells get REPORTED in the task summary, never
   patched.

## Prior art (validated 2026-08-08 — REUSE, do not duplicate)

- `packages/observability/src/bootstrap-fastify.ts:45-55` — the canonical
  production pipe construction inside `runNestFastifyServiceMain`
  (`withValidationPipe` flag at `:15`).
- `packages/observability/src/bootstrap-split-service.ts` — the split-service
  bootstrap with the same inline options.
- `services/api-gateway/src/main.ts:58` — api-gateway's OWN production pipe
  (it does not use the shared bootstrap's flag). Whether its options are
  byte-equivalent to the canonical ones is UNKNOWN — T01 must diff them and
  either import the shared constant (if equivalent) or keep its own object and
  REPORT the divergence verbatim (changing api-gateway behavior is out of
  scope).
- Test-parity copies to replace: `services/agent-admin-service/test/e2e/setup.ts:434`,
  `services/agent-admin-service/test/integration/harness.ts:163`,
  `services/agent-admin-service/test/unit/agents.dto.transform.spec.ts:30`.
- `services/agent-admin-service/test/unit/agents.dto.transform.spec.ts` — the
  generic auto-discovery pattern T02 generalizes: build the production pipe,
  feed each DTO class a payload exercising its object-array/untyped fields,
  assert survival byte-for-byte.
- `rg -l "withValidationPipe" services` — the sweep population (~17 services;
  enumerate live at T02 start, do not trust this count).
- `packages/observability` has NO `scripts.test` in package.json; its specs
  live in `test/unit/` and run with bare `bun test`.

## Constraints (apply to every task)

- Conventional commits scoped to the touched package/service. No Co-Authored-By.
- Never weaken, skip, or delete an existing test — automatic reviewer
  rejection. The three test-parity copies being REPLACED BY AN IMPORT keep
  their assertions intact.
- The extracted constant's VALUES must be byte-identical to today's canonical
  options — this queue changes where the options live, never what they are.
  A parity pin test in `packages/observability/test/unit` locks the shape.
- api-gateway's production behavior must not change in this queue.
- T02 adds test files ONLY (plus the register findings section). A red
  discovery is a FINDING, not a fix order: the permanent test is added only
  where it lands green; dirty services get their finding registered and NO
  failing test committed.
- Any helper script: bash 3.2 syntax (D2 ruling — no associative arrays, no
  `mapfile`).
- Code, comments, and docs in English (register file is Spanish — match it).

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards (ITERATION, every attempt, every task)
bash scripts/checks/doc-code-guards.sh
# G1 — observability package tests (ITERATION: T01, T02)
cd packages/observability && bun test
# G2 — agent-admin-service unit tests (ITERATION: T01; T02 if touched)
cd services/agent-admin-service && bun run test:unit
# G3 — api-gateway tests + build (ITERATION: T01; T02 if touched)
cd services/api-gateway && bun test && bun run build
# G4 — every service whose tests T02 adds: bun test:unit (or bun test where
#      no test:unit script exists) for EACH touched service (ITERATION: T02)
# G5 — COMMIT GATE (T01 only, once, after G0-G3 green): full agent-admin suite
cd services/agent-admin-service && bun test
```

Gate rules (self-contained — the engine runs THIS file verbatim):

- PRECONDITION (before task 1): `git status --porcelain` empty except the
  standing user-owned modifications (`.opencode/opencode.json`,
  `integrations/channels/http-fanout-telegram/manifest.yaml`) — never touch,
  stage, or revert those two.
- T01 runs G0-G3 + G5 commit gate. T02 runs G0, G1, G4 (the per-service list
  is derived from the diff), plus G2/G3 only if it touches those services.
- ALL existing tests of a touched service must pass — no skips added.
- No cluster deploy gate: T01 changes bootstrap code in a package consumed by
  every service — rebuilds are batched POST-QUEUE (see final section), not
  per-task.

---

## Task queue

### T01 — extract the production ValidationPipe options to `packages/observability`

1. Export one constant (name it following the package's existing export
   conventions — check `index.ts`) holding today's canonical options object
   from `bootstrap-fastify.ts:47-53`, values byte-identical, JSDoc explaining
   it is THE production contract and why test harnesses import it (T01d
   history, register 11).
2. Consume it in `bootstrap-fastify.ts` and `bootstrap-split-service.ts`
   (delete both inline copies). NestJS `ValidationPipe` mutates nothing, but
   guard anyway: construct a fresh `ValidationPipe(OPTIONS)` per boot, never a
   shared pipe instance.
3. Diff `services/api-gateway/src/main.ts:58` options against the constant:
   byte-equivalent → import the constant (spread extra gateway-only keys if
   any); divergent → leave api-gateway untouched and REPORT the exact diff in
   the task summary (user decides later).
4. Replace the three agent-admin test-parity copies with the import. Their
   surrounding assertions stay untouched.
5. Parity pin test in `packages/observability/test/unit`: asserts the exact
   option shape (whitelist/forbid/transform/implicit-conversion) so any future
   edit to the constant is a visible wire-adjacent change, and asserts
   `runNestFastifyServiceMain`'s pipe is built FROM the constant (structural,
   e.g. by exporting the builder or checking source — pick the least invasive
   proof and justify it).
6. Export from `packages/observability` index; update the package README if it
   documents exports.

**Accept** (after G0-G3 green, before G5):

```
# No inline copy of the options survives outside the constant's definition:
rg -n "enableImplicitConversion" packages/observability/src services/agent-admin-service/test services/api-gateway/src --glob '!node_modules'
# ^ expected: the constant's definition file; api-gateway/src/main.ts ONLY if T01 step 3 found divergence (then the report justifies it).
rg -n "forbidNonWhitelisted" services/agent-admin-service/test
# ^ expected: zero hits (copies replaced by the import).
```

### T02 — implicit-conversion sweep across every `withValidationPipe` service

1. Enumerate the population live: `rg -l "withValidationPipe: true" services`
   (plus api-gateway, which self-boots its pipe). Record the list in the task
   summary.
2. For each service: port the auto-discovery pattern from
   `agents.dto.transform.spec.ts` — one new unit spec per service that (a)
   auto-discovers DTO classes and their object-array / untyped fields, (b)
   runs representative payloads through a pipe built from the T01 constant,
   (c) asserts the payload survives unmangled. Follow each service's existing
   test layout/naming.
3. GREEN services: commit the spec as a permanent pin.
4. RED services: do NOT commit a failing test. Minimally reproduce, then
   record in `PENDIENTES/11-implicit-conversion.md` §"Hallazgos del barrido
   T02": service, DTO class + field, input → mangled output, product impact
   guess. The register edit ships in this task's commit.
5. Services with NO DTOs reaching the pipe (workers without HTTP surface):
   record "no DTO surface" in the task summary — no test file forced.
6. After the sweep: STOP the loop and report findings for ruling (User
   decision 2), even if everything is green.

**Accept** (after G0/G1/G4 green):

```
# Every swept service either has the new spec or is justified in the summary:
rg -ln "dto.transform|implicit-conversion" services/*/test 2>/dev/null | sort
# ^ reviewer compares against the T02 population list in the task summary.
# No test copies the options (all import the T01 constant):
rg -n "enableImplicitConversion" services/*/test --glob '!node_modules'
# ^ expected: zero hits.
```

---

## Progress

- [ ] T01 — options constant extracted, 4 copies replaced (or api-gateway divergence reported), parity pinned
- [ ] T02 — sweep rolled out: green services pinned, findings registered, loop STOPPED for ruling

## Post-queue (operator, outside the loop)

T01 changes `packages/observability` bootstrap code: every service rebuild
picks it up, but nothing behavioral changed (same options, new home) — batch
the rebuilds with the NEXT behavioral change instead of redeploying 17
services for a refactor. Findings from T02 wait for Christian's ruling before
any product fix is queued.
