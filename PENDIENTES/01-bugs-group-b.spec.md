# SPEC — Group B: the 13 real bugs from the docs-truth audit

> Task queue for the `/manual-loop` command. One task at a time, gated by tests and
> dual review. Register (origin + evidence pointers): `PENDIENTES/01-bugs-group-b.md`.
> Full evidence: `DOCS/archive/audits/DOCS-TRUTH-LEDGER.md` and
> `manual-loops/architecture/docs-truth-audit.md` §(g).

## Goal

Close the code bugs the docs-vs-code audit surfaced (E10–E36; E13 postponed by
user ruling — see Out of scope). One bug (or one tightly-coupled pair) per task,
one commit per task. E11 is resolved by REMOVAL, not implementation. Every fix lands with a
regression guard: a test where a harness exists, an executable `rg`/`bash -n`
Accept check where none does (shell scripts, sample drivers).

## User decisions (human boundary — do not reinterpret)

1. **E11**: do NOT implement `oauth2-client` (user ruling 2026-08-06). Remove
   every reference to that functionality — services AND admin-console UI. It is
   a phantom feature: accepted by validation, never able to work.
2. **E13**: POSTPONED (user ruling 2026-08-06) — the agent-scheduler-service
   deployment fix moves to its own future feature. Not in this queue.
3. **E36**: RESOLVED (user ruling 2026-08-06, supersedes the delete option) —
   keep cache-service, VALIDATE it, and make the connectors consume it. History
   verified: no integration was ever removed; the connector cache was born on
   direct ioredis (`e9af887a`) and cache-service was never adopted by anything
   (only the gateway health probe and its own deleted self-test ever called it).
   T10 validates the service; T11 routes connector-runtime's HTTP-response
   cache through it. Accepted tradeoff: one in-cluster HTTP hop per cache op;
   mandated mitigation: cache-service failure degrades to cache-miss, NEVER a
   failed connector call.
4. Scope discipline: fix exactly the registered bug. Adjacent smells found while
   fixing get REPORTED in the task summary, never patched in the same commit.

## Constraints (apply to every task)

- Conventional commits scoped to the touched service/script. No Co-Authored-By.
- Every bug fix gets a regression test in the SAME task where a runner exists.
  Never weaken, skip, or delete an existing test to go green — automatic
  reviewer rejection.
- Shell scripts stay **bash 3.2 compatible** (macOS `/bin/bash`): no `mapfile`,
  no associative arrays, no `case` inside `$()`. Follow the patterns in
  `scripts/reset/purge-temporal.sh:554` (while-read) and `rebuild-changed.sh:100`.
  Keep each script's existing `set` flags.
- TypeScript: follow the file you are editing (NestJS modules, class-validator
  DTOs, repo naming). Shared contracts live in `packages/shared` and are
  imported, never duplicated.
- Code, comments, UI strings, and docs in English.
- The cluster must never drift from the branch: tasks marked **[cluster]** end
  with `./rebuild-redeploy.sh <service> dev` for each deployed service touched,
  BEFORE dual review/commit.
- If a task's fix exposes deeper breakage (e.g. E10's never-run suites reveal
  real product bugs too large for one attempt), STOP the task and report — do
  not absorb unrelated fixes.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
G1 ITERATION — for EVERY package/service touched by the attempt's diff, run its
   row from the Gate table below, verbatim. All rows exit 0.
G2 ITERATION — for EVERY shell script touched: bash -n <script>
G3 COMMIT GATE (once per task, after G1/G2 green) —
     bash scripts/checks/doc-code-guards.sh
G4 COMMIT GATE — tasks marked [cluster] only:
     ./rebuild-redeploy.sh <service> dev        # each deployed service touched
   wait for the rollout, then run the cluster checks in the task's Accept.
```

Gate table (per touched package — the runners differ, do not "normalize" them):

| Package | Verbatim command |
|---|---|
| `packages/shared` | `cd packages/shared && bun test` |
| `services/proxy-service` | `cd services/proxy-service && bun test && bunx tsc -p tsconfig.json --noEmit` |
| `services/tenant-service` | `cd services/tenant-service && bun test && bunx tsc -p tsconfig.json --noEmit` |
| `services/agent-ai-service` | `cd services/agent-ai-service && bun test && bunx tsc -p tsconfig.build.json --noEmit` |
| `services/connector-admin` | `cd services/connector-admin && pnpm test:unit && bunx tsc -p tsconfig.json --noEmit` |
| `services/admin-console` | `cd services/admin-console && pnpm test` |
| `services/cache-service` | `cd services/cache-service && bun test && bunx tsc -p tsconfig.json --noEmit` |
| `services/connector-runtime` | `cd services/connector-runtime && bun test && bunx tsc -p tsconfig.json --noEmit` |
| `services/api-gateway` | `cd services/api-gateway && bun test && bunx tsc -p tsconfig.json --noEmit` |
| `sdk` | `cd sdk && pnpm test` |
| `integrations/ai/ai-system-variables` | `cd integrations/ai/ai-system-variables && bunx tsc --noEmit` (skip if no tsconfig — then G2-style `rg` Accept checks are the guard) |

Gate rules:

- PRECONDITION (before task 1): `git status --porcelain` empty.
- Tasks touching only shell scripts skip G1; tasks touching only TS skip G2.
- G3 runs for every task (several fixes touch files the doc-guards watch).
- A G4 rebuild failure is a failed attempt like any other gate.

---

## Task queue

### T01 — E11: remove the phantom OAuth2 connector auth everywhere **[cluster]**

User ruling: do NOT implement it — `oauth2-client` is accepted by validation but
can never work (both shared injectors switch on `"oauth2"`, a value the DTO does
not even accept, so such connectors silently send no `Authorization`). Remove
every reference to the functionality, services and UI:

- `services/connector-admin/src/modules/adapters/adapters.dto.ts:39-45` — drop
  `"oauth2-client"` from `ADAPTER_AUTH_TYPES` (the `@IsIn` guards at `:177` and
  `:239` follow automatically). Chase the shared type union it mirrors
  (`packages/shared` adapter interfaces/schemas) and remove the member there too.
- `packages/shared/src/adapter-auth-headers.ts:38-42` — remove the dead
  `case "oauth2"`.
- `packages/shared/src/adapter-client.ts:390-399` — remove the `"oauth2"` branch
  of `injectAuthHeaders`, and `getOAuthToken` plus any oauth-only config fields
  IF nothing else uses them (follow the type graph before deleting).
- `services/agent-ai-service/src/modules/tools/adapter-executor.service.ts:170`
  — remove the `case "oauth2-client"` branch and its spec expectations
  (`test/unit/adapter-executor.service.spec.ts:513-514`). Deleting THESE tests is
  sanctioned by this task (the feature is being removed) — the "never delete
  tests" constraint does not apply to tests OF the removed feature.
- admin-console: remove the oauth2 option from the connector auth-type
  selectors/forms/labels (search the `data-integrations` feature).
- `services/connector-admin/README.md:127-132` — remove the known-gap note and
  any oauth2 rows in its auth-type docs.

Regression guard: a `packages/shared` test asserting an adapter with an
unrecognized `authType` gets NO auth header (nothing silent, log per repo style
if the injector already logs). Data note: any stored adapter with
`authType: "oauth2-client"` will now fail validation on update — acceptable
(dev-only platform); the reviewer should confirm reads don't crash on such rows.

**[cluster]** rebuild: `connector-runtime`, `connector-admin`,
`agent-ai-service`, `admin-console`.

**Accept**
```
rg -n "oauth2" packages/shared/src services/connector-admin/src services/agent-ai-service/src services/admin-console/src/app/features/data-integrations ; test $? -eq 1
rg -n "oauth2" services/connector-admin/README.md ; test $? -eq 1
cd packages/shared && bun test
cd services/connector-admin && pnpm test:unit
cd services/agent-ai-service && bun test
cd services/admin-console && pnpm test
```

### T02 — E10: proxy-service and tenant-service test scripts recurse forever

`services/proxy-service/package.json:9` → `"test": "bun run build && pnpm test"`;
`services/tenant-service/package.json:9` → `"test": "MONGO_PASSWORD=… pnpm test"`.
Both re-invoke themselves; `test:unit` in both (and tenant-service's
`test:integration`, line 11) recurse the same way. No test in either service has
ever run.

Fix the scripts to call the runner directly (`bun test`, `bun test test/unit`,
`bun test test/integration`), preserving the `MONGO_PASSWORD` default in
tenant-service. Then make the suites actually pass — they are unexecuted code.
Small test rot (stale imports, renamed symbols) is in scope; if a suite exposes a
real product bug, STOP and report per Constraints.

**Accept**
```
cd services/proxy-service && bun test
cd services/tenant-service && bun test
rg -n '"test"' services/proxy-service/package.json services/tenant-service/package.json
```

### T03 — E27: smoke-test must check all 11 worker Deployments

`scripts/smoke-test.sh:66-75` lists 8 Deployments, omitting
`connector-runtime-http`, `connector-runtime-invoke`, `tracking-ingester-worker`
(manifests in `knative/services/base/`). Both bring-up orchestrators poll it as
THE readiness gate (`scripts/orbstack/startup.sh:93`,
`scripts/minikube/startup.sh:107`), so bring-up can declare ready with three
workloads in crash-loop.

Add the three names to `ALL_PLAIN_DEPLOYMENTS` and update the apologetic comment
at lines 61-66.

**Accept**
```
bash -n scripts/smoke-test.sh
rg -n "connector-runtime-http|connector-runtime-invoke|tracking-ingester-worker" scripts/smoke-test.sh
bash scripts/smoke-test.sh
```
(The last command runs against the live dev cluster and must exit 0 — if one of
the three newly-watched workers is genuinely unhealthy, that is the bug this gate
exists to catch: fix the worker or report, do not trim the list.)

### T04 — E15: the SDK test glob must reach the CLI specs

`sdk/package.json:112` → `"test": "tsx --test 'test/**/*.test.ts'"` misses the
14 co-located specs under `src/cli/**/*.test.ts` (entire `yoizen` CLI, including
`--secrets-from-env`, untested by the documented command; 38 files matched, 14
missed). `test:watch` (:113) and `test:e2e` (:114) share the blind spot.

USER RULING (2026-08-06): 10 of the 14 CLI specs are Bun-only by design
(`read-manifest-file.ts` requires `Bun.YAML`; the CLI is documented as
`bunx yoizen`) and can never pass under tsx/Node — so the fix is to move the
SDK's test scripts to `bun test`, the runner every other package already uses
(471/471 green). Keep `test:e2e` on its current runner if moving it would
change its semantics. Rebaseline any documented test count (471 vs 343 —
update whatever doc states the old number).

**Accept**
```
cd sdk && pnpm test
cd sdk && pnpm test 2>&1 | rg "across 52 files"
rg -n '"test": "bun test' sdk/package.json
```
(52 files is unreachable without `src/cli` — the old glob ran 38. Note: bare
`bun test` would double-count specs compiled into `dist/`; the `src/ test/`
filters are load-bearing. The register's "471" was that artifact: real count
is 407.)

### T05 — E18: the ai-system-variables sample must look up slugs

`integrations/ai/ai-system-variables/manifest.yaml:60,67,74` declares
`company-name`, `escalation-priority`, `brand-voice` (the schema forbids
camelCase — see the comment at :51-59), but `src/index.ts:115-126` matches
`companyName` / `escalationPriority` / `brandVoice`. The sample's most visible
step always prints `(missing!)`, and `escalationVarId` stays undefined, breaking
the later PATCH demo (:214).

Fix the three lookups to the slug names (JS variable names stay camelCase).
Remove the workaround note in the sample README that says the driver is broken.

**Accept**
```
rg -n '"company-name"|"escalation-priority"|"brand-voice"' integrations/ai/ai-system-variables/src/index.ts
rg -rn "companyName\"|escalationPriority\"|brandVoice\"" integrations/ai/ai-system-variables/src/index.ts || true
```
(First check must hit all three; the sample has no test harness — the `rg` pair
plus reviewer scrutiny is the guard. If the package has a tsconfig, also run
`bunx tsc --noEmit` per the Gate table.)

### T06 — E29 + E33: dev-mode.sh and rebuild-redeploy.sh agree on connector-runtime **[cluster]**

Two halves of the same drift, fixed together:

- **E29** — `dev-mode.sh:211-214` maps `connector-runtime` to ONE Deployment;
  the manifests declare THREE (`connector-runtime`, `connector-runtime-http`,
  `connector-runtime-invoke`) and `rebuild-redeploy.sh:184` rolls all three.
  Emit three entries, mirroring the `workflow-service` block at `dev-mode.sh:206-210`
  (verify each Deployment's entrypoint source file from its manifest/Dockerfile
  before writing the rows).
- **E33a** — `rebuild-redeploy.sh:132-147`: `get_ksvc_names()` lacks an empty
  case for `connector-runtime`, so the default arm emits a phantom ksvc and every
  rebuild warns at `:297-299`. Add the empty case (same shape as
  `tracking-ingester-service` at `:143`).
- **E33b** — `usage()` (`:36,45`) says "a Knative rollout" but the deploy phase
  (`:428-431`) also rolls plain Deployments and ensures CronJobs — say so.
- **E33c** — `VALID_ENVIRONMENTS=(dev qa staging production)` (`:30`) advertises
  overlays that do not exist (`get_overlay_path_for_env`, `:207-213`, maps only
  `dev`; the filesystem has only `local/{dev,mongo-dev,postgres-dev}`). Reduce to
  `(dev)` and fix the `$0 tenant-service qa` example at `:56`.

**Accept**
```
bash -n dev-mode.sh
bash -n rebuild-redeploy.sh
rg -n "connector-runtime-http" dev-mode.sh
rg -n "VALID_ENVIRONMENTS=\(dev\)" rebuild-redeploy.sh
./rebuild-redeploy.sh connector-runtime dev 2>&1 | rg -v "not found in namespace"
```
(The last command is the G4 cluster gate for this task: a full rebuild must
complete with zero phantom-ksvc warnings and all three Deployments rolled.)

### T07 — E24 + E25: purge-circuit-breakers.sh can fail, and runs on bash 3.2

Same script (`scripts/reset/purge-circuit-breakers.sh`), two defects:

- **E24** — `any_error` declared at `:241`, exited with at `:271`, never
  assigned; and the `|| true` at `:250-251`/`:256-257` is attached to `tr` (last
  pipe element), so with `set -uo pipefail` (no `-e`) a failing `redis-cli` just
  yields an empty `n` normalized to 0. The script cannot report failure even if
  everything fails — its own header admits it at `:69`. Fix: detect each
  operation's real outcome, set `any_error=1` on failure, keep sweeping (partial
  sweep still visits every prefix), exit `any_error`. Update the header.
- **E25** — `mapfile -t MASTERS < <(list_masters)` at `:212` in the
  Redis-cluster branch is bash 4+; the repo rule is bash 3.2 (macOS `/bin/bash`)
  — the ONLY `mapfile` in the repo. Replace with the while-read pattern used by
  the sibling `scripts/reset/purge-temporal.sh:554`. Latent today only because
  dev Redis is standalone.

**Accept**
```
bash -n scripts/reset/purge-circuit-breakers.sh
rg -c "mapfile" scripts/reset/purge-circuit-breakers.sh; test $? -eq 1
rg -n "any_error=1" scripts/reset/purge-circuit-breakers.sh
/bin/bash -n scripts/reset/purge-circuit-breakers.sh
```
(`/bin/bash -n` runs the syntax check under the actual macOS 3.2 binary.)

### T08 — E28: the PostToolUse hook must run a runner that exists

`.claude/settings.json:5-15` wires `scripts/claude-hook-lint-test.sh` on every
Edit/Write; its line `:51` runs `vitest related "$FILE"`, but vitest exists in
exactly ONE manifest (`services/admin-console`) — every other package uses
`bun test`, `tsx --test`, or `node --import tsx` (the script's own header admits
this at `:12-17`). For nearly every edited file the vitest half is a no-op that
logs a misleading FAILURES line.

Fix (KISS): scope the test half — run `vitest related` ONLY when `$FILE` is
under `services/admin-console/`; for all other paths skip the test half
explicitly (log "no per-file runner for this package") and keep the biome half
(`:44`) as-is. Do NOT try to invent per-package `related` semantics for bun/tsx
— they have none; that would be a new feature, not this bug. Update the header
comment to describe the new behavior.

**Accept**
```
bash -n scripts/claude-hook-lint-test.sh
rg -n "admin-console" scripts/claude-hook-lint-test.sh
```

### T09 — E12: parseFrontmatter must not split YAML with `indexOf(":")`

`services/agent-ai-service/src/modules/skills/skill-file.service.ts:97-117`
parses skill frontmatter line-by-line on the first `:`. Block scalars break twice:
`description: >` stores the literal `">"`, and the indented continuation line
(no colon) is dropped. First-colon splitting also mis-handles values containing
colons. The mangled description reaches the model via `discoverSkills` (:50-53).

Fix: parse the frontmatter correctly for the shapes skills actually use — plain
scalars, quoted scalars, and block scalars (`>` and `|` with indented
continuation). Prefer an existing YAML dependency if one is already in the
service's dependency tree; otherwise a small correct hand parser for exactly
these shapes, with a guard that logs and skips a skill whose frontmatter it
cannot parse (nothing silent).

There is NO existing spec for `SkillFileService` — create
`test/unit/skill-file.service.spec.ts` with regression cases: block scalar `>`,
block scalar `|`, quoted value, value containing a colon, missing frontmatter.

**Accept**
```
cd services/agent-ai-service && bun test test/unit/skill-file.service.spec.ts
cd services/agent-ai-service && bun test && bunx tsc -p tsconfig.build.json --noEmit
```

### T10 — E36a: validate cache-service end to end **[cluster]**

User ruling: cache-service stays and gets adopted. First, prove the service
itself is sound — it has never had a real consumer, so treat it as unaudited:

- Its own suites green: `cd services/cache-service && bun test` (unit +
  integration; check what the integration suite needs to run — if it expects a
  live Redis, wire it to the dev cluster's Redis the way sibling services do).
- Typecheck: `bunx tsc -p tsconfig.json --noEmit` (add nothing to package.json).
- Live CRUD validation against the deployed pod (port-forward or in-cluster):
  PUT `{value, ttl}` → GET returns the value → TTL expiry honored (short TTL,
  poll until null) → DELETE → GET null. Batch endpoint too if it exists (read
  `cache.controller.ts` first). Script the check into
  `scripts/e2e/cache-service.sh` following the existing `scripts/e2e/` pattern
  and exit-code contract, so validation stays executable.
- Fix what validation exposes IN the service (rot from never being used).
  A defect too large for one attempt → STOP and report.
- `services/cache-service/README.md`: replace the "nobody calls this" admission
  with the real contract and the incoming consumer (T11).

**Accept**
```
cd services/cache-service && bun test
cd services/cache-service && bunx tsc -p tsconfig.json --noEmit
bash scripts/e2e/cache-service.sh
```

### T11 — E36b: connector-runtime's HTTP-response cache consumes cache-service **[cluster]**

Route the connector cache (the `cache` config the admin-console already
exposes per adapter/endpoint) through cache-service instead of raw ioredis:

- New `AdapterCache` implementation backed by cache-service's HTTP API
  (`get`/`setex` semantics mapped to its GET/PUT endpoints — read
  `cache.controller.ts` for the real contract; TTL rides the PUT body). Place it
  next to the consumer in `connector-runtime` unless an existing shared seam
  fits naturally — do NOT invent a new shared package for one consumer.
- `services/connector-runtime/src/activities/_shared/adapter-client.provider.ts:145`:
  `createHttpResponseCache(...)` receives the cache-service-backed store instead
  of `getSafeCache()` (raw Redis). ONLY the HTTP-response cache moves — every
  other Redis use in connector-runtime (adapter config cache, rate limits,
  whatever exists) stays untouched.
- **Resilience mandate**: any cache-service error (timeout, 5xx, connection
  refused) logs at warn and behaves as a cache miss on `get` / a no-op on
  `setex`. A connector call must NEVER fail because the cache is down. Bounded
  timeout on cache calls (follow existing HTTP-call timeout patterns in the
  service).
- Config: `CACHE_SERVICE_URL` in `services/connector-runtime/src/config.ts` +
  env entries in all THREE deployment manifests (`connector-runtime`,
  `connector-runtime-http`, `connector-runtime-invoke`) and the overlay
  env-patches, following how the existing `CACHE_SERVICE_URL` patches for
  api-gateway are shaped.
- Unit tests: the new store (mocked fetch — hit, miss, TTL passthrough, error →
  miss/no-op + warn); existing cache-policy/cached-fetch specs untouched.
- Cluster proof: with everything deployed, run an adapter endpoint with
  `cache.enabled` twice and show the second response is served from cache AND
  the key is visible through cache-service's API. Extend
  `scripts/e2e/cache-service.sh` (from T10) with this consumer scenario, or a
  sibling script if the existing e2e layout separates concerns that way.

**Accept**
```
cd services/connector-runtime && bun test && bunx tsc -p tsconfig.json --noEmit
rg -n "CACHE_SERVICE_URL" services/connector-runtime/src/config.ts
rg -n "CACHE_SERVICE_URL" knative/services/base/connector-runtime.yaml knative/services/base/connector-runtime-http.yaml knative/services/base/connector-runtime-invoke.yaml
./rebuild-redeploy.sh connector-runtime dev
./rebuild-redeploy.sh cache-service dev
bash scripts/e2e/cache-service.sh
```

---

## Progress

- [x] T01 E11 remove phantom oauth2 auth (services + UI)
- [x] T02 E10 recursive test scripts
- [x] T03 E27 smoke-test full worker list
- [x] T04 E15 sdk test glob
- [x] T05 E18 sample slug lookups
- [x] T06 E29+E33 dev-mode / rebuild-redeploy drift
- [x] T07 E24+E25 purge-circuit-breakers
- [x] T08 E28 hook runner
- [x] T09 E12 parseFrontmatter
- [x] T10 E36a validate cache-service (suite + live CRUD e2e script)
- [ ] T11 E36b connector http-response cache via cache-service

## Rebuild map (services to rebuild/redeploy per task)

| Task | Rebuild |
|---|---|
| T01 | `connector-runtime`, `connector-admin`, `agent-ai-service`, `admin-console` |
| T06 | `connector-runtime` (exercised by the Accept gate) |
| T09 | `agent-ai-service` (src change — added to the map post-hoc) |
| T10 | `cache-service` (if validation fixes touch src) |
| T11 | `connector-runtime` + `cache-service` |
| others | none (scripts, sdk, sample, hook, or test-only changes) |

## Out of scope (explicit)

- **E13 agent-scheduler-service deployment fix — POSTPONED** (user ruling
  2026-08-06): moves to its own future feature. The verified evidence (missing
  manifest env, no tenant seeding, health hardcodes "ok" —
  `knative/services/base/agent-scheduler-service.yaml:26-47`,
  `scheduler.service.ts:52-63`, `health.controller.ts:22-28`) stays in the
  register for that future SPEC.
- E36 "delete cache-service" variant — dead: the user ruled adopt-and-validate
  (2026-08-06). No api-gateway public route for the cache either: the consumer
  is in-cluster service-to-service (connector-runtime → cache-service); a public
  cache API is a non-goal.
- Documenting the bash 3.2 rule in AGENTS.md — real gap (the rule exists only as
  scattered script comments), but it is a constitution change: separate ticket.
- Inventing per-file "related tests" semantics for bun/tsx in the hook (T09).
- Any fix beyond the registered bugs; adjacent smells are reported, not patched.

## Human boundaries for this change

- Approving this SPEC before the first `/manual-loop` run.
- The E36 ruling (T11 precondition).
- Running the loop (`/manual-loop PENDIENTES/01-bugs-group-b.spec.md`).
