# scripts/e2e/README.md — end-to-end checks against the live dev cluster

Five scripts exercise the deployed platform (OrbStack dev cluster) end to
end — `manifest-apply.sh`, `http-workflow.sh`, `connector-invoke.sh`,
`teardown-regression.sh`, `long-agent-execution.sh` — plus `run-all.sh`,
which orchestrates the first three (and, with `--only`, the fourth).
`long-agent-execution.sh` is NOT reachable from `run-all.sh` at all.

Each check is dry-run-free by design: it creates real e2e-prefixed resources,
asserts against them, and tears itself down (idempotent, via an `EXIT`
trap) — there is no `--dry-run` mode here, unlike `scripts/reset/`.

## 1. Declarative provisioning — `manifest-apply.sh`

Full coverage of the T04 declarative-provisioning apply engine
(`manual-loops/declarative-provisioning.md`): plan -> apply -> re-plan
(all-noop) -> re-apply (no-op) -> teardown, talking directly to
provisioning-service's Knative ingress. api-gateway proxy routes for
provisioning DO exist now (`ProvisioningController`: manifests
validate/PUT/GET/plan/apply + secrets) and `http-workflow.sh` uses them;
this script keeps hitting the service's own ingress, so it covers
provisioning-service with the gateway out of the path. Knative ksvc are
activator/ingress-routed, so `kubectl port-forward` does not work on them.

Also covers, in the same run:
- T06 knowledge-base documents (inline + `file:` tar bundle, re-embed-only-
  the-changed-document assertion).
- T09 + T1 coverage pass: the **full showcase manifest** — channel,
  connector (`auth` secretRef, `endpoints`, tags), mcpServer, skill,
  systemVariable, agent (KB refs, MCP tool refs, symbolic-ref
  substitution), knowledge base, and workflow — applied through the **real
  SDK**, not raw curl. Delegated to `manifest-showcase-driver.ts` (see
  below).
- A `LibraryManifest` round trip (one connector).
- Three fail-loud negative-plan cases (`unallowlisted_symbolic_ref`,
  `mismatched_symbolic_ref`, `invalid_array_substitution_shape`).
- A negative secret-binding test: a consumer presenting a mismatched
  secret binding is denied and audited (`secret_access_denied`).

Rough runtime: ~30-60s (dominated by the showcase driver's SDK round trip).

```bash
./scripts/e2e/manifest-apply.sh
```

### `manifest-showcase-driver.ts`

Invoked by `manifest-apply.sh` via `bun run` (never run standalone in CI).
Imports `sdk/src/index.ts` directly by relative path. Owns the actual SDK
calls for the T09 showcase manifest; `manifest-apply.sh` owns cluster
reachability, teardown, and the tracking-ingester Postgres assertions the
driver has no access to.

## 2. Runtime chain — `http-workflow.sh`

Runtime chain: inbound webhook -> channel-service trigger match ->
workflow-service -> Temporal execution -> tracking-ingester, provisioned
via a single `IntegrationManifest` (channel account + echo agent + two
workflow definitions). Also exercises the `endpointCall` activity against a
pre-existing connector-admin adapter (see the stale-default caveat below),
a disabled-workflow negative case, and direct Postgres assertions against
`tracking.tracked_events`.

Rough runtime: ~60-120s (dominated by Temporal execution polling).

```bash
./scripts/e2e/http-workflow.sh
```

### `E2E_ENDPOINT_ADAPTER_ID` stale-default caveat

This script's `endpointCall` stage needs a **real, currently-registered**
connector-admin adapter id (e.g. the `pokeapi` sample connector from
`integrations/http/http-connectors/connectors/pokeapi.json`). It is NOT
manifest-created — provisioning has no `connectors[]` support for plain
adapters outside a workflow's substituted refs. Any dev-data wipe
(`scripts/reset/reset-tenant.sh` truncates connector-admin's tables too)
deletes it, so the id in `.env`/the script's hardcoded fallback **will go
stale** after a reset. Re-seed it and update `.env`:

```bash
curl -X POST http://connector-admin-api.platform-services-dev.dev.local/connectors \
  -H "x-yoizen-tenant: acme" -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d @integrations/http/http-connectors/connectors/pokeapi.json
```

...or discover it by name instead of hardcoding an id:
`GET /connectors?name=pokeapi` (same tenant header) — no need to track an
id at all if you resolve it at run time.

## 3. Connector invoke — `connector-invoke.sh`

Sync/async connector invoke coverage: creates its own throwaway
adapter/connector (unlike `http-workflow.sh`, it does not depend on any
pre-existing resource), exercises the sync and async invoke paths, cache
hit/miss, a webhook receiver pod/svc for the async callback, and tracking
assertions per invocation.

Rough runtime: ~30-60s.

```bash
./scripts/e2e/connector-invoke.sh
```

## `.env` convention

- `.env.example` (committed) — documents every var these scripts and
  `manifest-showcase-driver.ts` read, with placeholder/safe-default values.
- `.env` (gitignored, NOT committed) — real dev-cluster values. Copy
  `.env.example` to `.env` and fill in real values; every script in this
  folder auto-loads `scripts/e2e/.env` if present (`set -a` / `source`,
  same convention as `scripts/reset/`) BEFORE its own `${VAR:-default}`
  fallbacks are evaluated — so a value set in `.env` wins over a script's
  hardcoded default. `manifest-showcase-driver.ts` does not load `.env`
  itself; it inherits the parent `manifest-apply.sh` process's environment
  (which already sourced `.env`) when invoked via `bun run`.

  **Gotcha (found while centralizing these scripts): do NOT set the
  `*_URL` / `*_HOST` vars in `.env` unless you need a non-default target.**
  Each bash script reads e.g. `E2E_PROVISIONING_URL` into a *differently
  named* local shell variable (`PROVISIONING_URL="${E2E_PROVISIONING_URL:-
  default}"`), so exporting it has no effect on the bash script itself. But
  `manifest-showcase-driver.ts` reads the SAME env var name directly via
  `process.env.E2E_PROVISIONING_URL ?? (E2E_RESOLVE_IP ? ... : ...)` — if
  it's exported at all (even to a value matching the hardcoded default), it
  wins over the `E2E_RESOLVE_IP`-based localhost rewrite, so the driver
  tries to connect to the literal `*.dev.local` hostname instead of
  `127.0.0.1`, which fails outside a `--resolve`/hosts-file tunnel. Keep
  these commented out in `.env` (see `.env.example`).

## 4. `run-all.sh` — orchestrator

Runs the three default stages in order (`manifest-apply.sh` ->
`http-workflow.sh` -> `connector-invoke.sh`), aborting on the first failing
stage and printing a pass/fail summary at the end.

```bash
./scripts/e2e/run-all.sh                          # run everything (default 3 stages)
./scripts/e2e/run-all.sh --only connector-invoke   # run just one stage
./scripts/e2e/run-all.sh --skip http-workflow      # run the other two
```

## 5. Teardown regression — `teardown-regression.sh` (optional, not in the default sequence)

Regression test for a confirmed live incident: `manifest-apply.sh`'s
EXIT-trap `cleanup()` used to resolve every T09/T1 showcase resource
(channel, connector, mcpServer, skill, systemVariable, agent, knowledge
base, workflow, plus their bound `psec-*` k8s Secrets) **exclusively** from
`manifest-showcase-driver.ts`'s final stdout JSON summary line. When the
driver died anywhere before printing that line — crash, connection failure,
ctrl-c — `cleanup()` had no name/id to resolve from and silently skipped
every showcase resource. One afternoon of crashed debug iterations leaked
~16 workflows, ~20 each of channels/connectors/agents/knowledge
bases/mcpServers/skills/systemVariables, and 69 `psec-*` Secrets in the
tenant namespace.

The fix: `cleanup()` now also runs an independent name-prefix sweep across
every admin API it already talks to, matching by **this run's nonce
suffix** (every e2e-created resource in this script is named
`e2e-<kind>-${NONCE}`) — this sweep does not depend on the driver's JSON at
all, so it survives a crash at any point. `E2E_SWEEP_STALE=1` widens the
match to any `e2e-*`-prefixed name, reclaiming residue from **prior**
crashed runs too (opt-in only — never safe to default on if another e2e run
might be in flight concurrently).

`teardown-regression.sh` proves the sweep works: it runs
`manifest-apply.sh` with `E2E_SIMULATE_DRIVER_DEATH=1` (which makes
`manifest-showcase-driver.ts` `process.exit(1)` right after its first
successful apply, before ever assembling its JSON summary — an intentional,
expected failure), then independently re-queries every admin API + kubectl
for residue matching that run's nonce. Exits 0 iff nothing leaked.

**Not part of the default `run-all.sh` sequence** — unlike the other three
stages, it deliberately provisions real resources and then deliberately
kills the driver mid-run, which is slower and more invasive than a normal
assertion pass. Run it explicitly:

```bash
./scripts/e2e/teardown-regression.sh
./scripts/e2e/run-all.sh --only teardown-regression
```

## 6. Long-running agent executions — `long-agent-execution.sh` (standalone)

Proves the async execution contract for an agent execution that outlives any
default HTTP client timeout, on the real pipeline (api-gateway ->
ai-agent-gateway -> JetStream -> agent-ai-service -> Redis projector). The
slowness is injected by the env-gated delay hook
(`services/agent-ai-service/src/nats-handlers/test-delay.ts`): a per-execution
`metadata.__test_delay_ms`, honoured only when `AGENT_TEST_DELAY_ENABLED=true`
is live on the running `agent-ai-service` revision — the script's preflight
FAILS LOUD if it is not, rather than passing vacuously.

Asserts, in order: an immediate 202 handle (< `E2E_LONG_HANDLE_MAX_S`, default
5 s) with the curl process exiting while the execution is still non-terminal;
a contention probe (a normal workflow run must complete within
`E2E_LONG_PROBE_BUDGET_S`, default 90 s, while the long execution is still
running); completion with duration >= the injected delay plus the hook's own
log line for that execution id; zero JetStream redeliveries and a drained
`num_ack_pending`; and `kubectl top pod` before/during/after, of which only
the during-wait CPU is a hard assertion (`E2E_LONG_CPU_CEILING_MILLICORES`,
default 500m). A final phase repeats the run through a workflow `agentCall`.

Defaults: `E2E_LONG_DELAY_MS` / `E2E_WORKFLOW_DELAY_MS` = 120000 (the service
caps both at 600000). Cleanup runs from an `EXIT` trap and is skipped with
`E2E_KEEP=1`.

**Not orchestrated by `run-all.sh`** — it has no stage entry there. Run it
directly:

```bash
./scripts/e2e/long-agent-execution.sh
```

## Full suite runtime

~2-4 minutes total for the three default stages, dominated by
`http-workflow.sh`'s Temporal execution polling.
`teardown-regression.sh` adds another manifest-apply.sh-sized round trip
(~30-60s) when run explicitly. `long-agent-execution.sh` is the slowest of
all and is not part of any suite: it deliberately waits out two 120 s
injected delays.
