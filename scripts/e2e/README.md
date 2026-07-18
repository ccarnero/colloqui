# scripts/e2e/README.md — end-to-end checks against the live dev cluster

Four scripts exercise the deployed platform (OrbStack dev cluster) end to
end. Each is dry-run-free by design: it creates real e2e-prefixed resources,
asserts against them, and tears itself down (idempotent, via an `EXIT`
trap) — there is no `--dry-run` mode here, unlike `scripts/reset/`.

## 1. Declarative provisioning — `manifest-apply.sh`

Full coverage of the T04 declarative-provisioning apply engine
(`manual-loops/declarative-provisioning.md`): plan -> apply -> re-plan
(all-noop) -> re-apply (no-op) -> teardown, talking directly to
provisioning-service's Knative ingress (no api-gateway route existed when
this was written — Knative ksvc are activator/ingress-routed, so
`kubectl port-forward` does not work on them).

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

Runs all three stages in order (`manifest-apply.sh` -> `http-workflow.sh`
-> `connector-invoke.sh`), aborting on the first failing stage and printing
a pass/fail summary at the end.

```bash
./scripts/e2e/run-all.sh                          # run everything
./scripts/e2e/run-all.sh --only connector-invoke   # run just one stage
./scripts/e2e/run-all.sh --skip http-workflow      # run the other two
```

## Full suite runtime

~2-4 minutes total, dominated by `http-workflow.sh`'s Temporal execution
polling.
