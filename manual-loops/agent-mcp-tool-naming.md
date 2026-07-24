# SPEC — agent MCP tool naming: colon-namespaced tool keys break OpenAI tool-name validation

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/mcp-connections.md` (shipped — MCP connection
> service, per-tool filtering §4, usage metering §3; the `mcpToolFilteringEnabled`
> flag and the `"<serverName>:<toolName>"` addressing key this loop must fix
> without breaking).
> Engram topic: 'platform/agent-mcp-tool-naming'.

## Motivating incident (verified live 2026-07-24)

Every agent of tenant `acme` failed in the admin-console test UI with:

```
AI_APICallError: Invalid 'tools[1].name': string does not match pattern
'^[a-zA-Z0-9_-]+$'
```

Three root causes, all re-verified 2026-07-24:

1. **Colon in the tool name sent to the LLM.**
   `services/agent-ai-service/src/modules/tools/tool-bridge.service.ts:228`
   (`mergeMcpTools`) computes the record key every merged MCP tool is stored
   under — `const key = filteringEnabled ? \`${serverName}:${toolName}\` :
   toolName;` — and that key becomes both the AI-SDK `tools` record key AND
   the tool's exposed `name` in the OpenAI request. `filteringEnabled`
   (`agentAiServiceConfig.mcpToolFilteringEnabled`) is hard-coded `"true"` in
   `knative/services/base/agent-ai-service.yaml:56-57` (env var
   `AGENT_MCP_TOOL_FILTERING_ENABLED`), and repeated identically in both local
   overlays — `knative/services/overlays/local/postgres-dev/env-patches.yaml:
   601-602` and `knative/services/overlays/local/mongo-dev/env-patches.yaml:
   655-656`. The colon violates OpenAI's tool-name pattern
   `^[a-zA-Z0-9_-]+$`, so ANY reachable MCP server breaks EVERY chat execution
   for EVERY agent that ends up with at least one MCP tool merged in (deepwiki
   was the live offender for tenant `acme`).
2. **No agent-level MCP scoping — every enabled+active tenant MCP server
   connects for every agent.**
   `McpConnectionService.connectForTenant()`
   (`services/agent-ai-service/src/modules/tools/mcp-connection.service.ts:
   50-67`, via `loadEnabledMcpServers`, lines 69-113) loads and connects every
   row in `mcp_servers` with `enabled = true AND is_active = true` for the
   TENANT — with no scoping to the executing agent. `chat.service.ts` calls
   `connectForTenant` unconditionally on every chat turn
   (`services/agent-ai-service/src/modules/chat/chat.service.ts:286`), and
   `agent.enabledMcpServers == null` is documented and treated as allow-all
   (`chat.service.ts:291-293`: `// enabledMcpServers: null/undefined = all
   connected MCP servers; [] = explicitly none`). An unreachable server adds
   per-execution connect latency/noise to every agent's every turn; a
   reachable one injects its tools into agents that never declared it.
3. **E2E residue.** `scripts/e2e/manifest-showcase-driver.ts:173`
   (`MCP_SERVER_NAME = \`e2e-mcp-${NONCE}\``) has its mcpServer's teardown
   wired in the calling bash script — `scripts/e2e/manifest-apply.sh:459-468`
   resolves-by-name (falling back to a live `GET /admin/mcp-servers` lookup if
   the driver's own JSON summary line, parsed at `manifest-apply.sh:984`, was
   never captured) and issues `DELETE /admin/mcp-servers/${id}`
   (`agent_admin_curl DELETE ...`) inside the `trap cleanup EXIT` handler
   (`manifest-apply.sh:715`). Despite this, ONE `e2e-mcp-<nonce>` row was
   found live and ENABLED in the `acme` tenant's `mcp_servers` table — the
   trap-guarded teardown depends on the driver process reaching `main()`'s
   JSON-summary print (or, failing that, a matching name existing at cleanup
   time); a run that dies before emitting that summary (crash, `SIGKILL`,
   manual interruption) leaves `SHOWCASE_MCP_SERVER_NAME` empty, and
   `cleanup()`'s own name-resolution fallback only fires when
   `SHOWCASE_MCP_SERVER_NAME` is already non-empty
   (`manifest-apply.sh:459: if [[ -n "$SHOWCASE_MCP_SERVER_NAME" ]]`) — so a
   dead-before-summary run's residue is never found or deleted by the
   existing trap at all. That residue server (enabled+active) was itself a
   second, independent contributor to root cause 1/2 for any tenant sharing
   that Postgres/Mongo instance.

## Interim state (recorded 2026-07-24 — this SPEC's starting point)

All three `acme` MCP servers were DEACTIVATED data-side (`is_active =
false`, `enabled` left as-is) as an unblock, ahead of any code fix:
`sample-mcp-server`, `deepwiki`, and the discovered `e2e-mcp-<nonce>` residue
row. Re-activating `deepwiki` and `sample-mcp-server` after the fix ships,
then proving a real chat execution succeeds, is T03's live verification —
it is NOT done ahead of T01/T02, so the incident stays reproducible/blocked
for `acme` chat traffic until this loop ships.

## Goal

An MCP tool's name as sent to the LLM API always matches
`^[a-zA-Z0-9_-]+$`, for any server/tool name combination, without losing the
tool's stable `<server>:<tool>` addressing identity used internally for
per-tool filtering (`enabledMcpTools`) and description overrides
(`toolDescriptionOverrides`). `McpConnectionService` only connects the MCP
servers an agent can actually use, so an unrelated tenant server never adds
latency or tool-merge noise to an agent that didn't declare it, while
preserving today's `enabledMcpServers == null` = allow-all default for
backward compatibility. The e2e showcase driver's own `e2e-mcp-*` residue
cannot outlive a completed OR incomplete run. Live verification re-activates
`deepwiki` + `sample-mcp-server` for tenant `acme` and proves a real
playground execution for `crm-support-agent` (externalId `b3ea57af…`) merges
MCP tools and completes without the OpenAI 400.

## User decisions (human boundary — do not reinterpret)

1. **Fix location: `agent-ai-service` runtime, not a data/manifest
   workaround.** The interim deactivation (see above) is explicitly a
   temporary unblock, not the fix. No task in this loop is satisfied by
   leaving MCP servers deactivated as the "solution."
2. **Naming: T01 must document BOTH viable designs (see T01 below) and state
   its own recommendation with the tradeoff, but the human makes the final
   call before T01's code lands** — this is flagged genuinely contested
   (see T01's two options and Open questions), not a unilateral SPEC
   decision.
3. **`enabledMcpServers == null` keeps meaning allow-all** — no default
   behavior change for existing agents that never set the field
   (backward-compat constraint). T02 changes WHEN/WHICH servers connect
   (scoped, lazy), never the null-semantics contract `chat.service.ts:
   291-293` already documents.
4. Fail-loud is NOT required for T02's scoping change — an agent that
   declares zero `enabledMcpServers` (`[]`, not `null`) already skips MCP
   entirely today (`chat.service.ts:290,293` — `mcpEnabled` is `false`), and
   this SPEC does not change that; a scoping bug here should surface as
   "expected tool missing," not a new throw class the caller must add
   handling for.
5. Delivery method: manual-loop (this SPEC), not SDD.
6. Any dependency this loop finds that still cannot be expressed after T01
   ships: stop and escalate — do not approximate, do not invent a further
   naming scheme without a new human decision round.

## Prior art (verified 2026-07-24 — REUSE, do not duplicate)

- `services/agent-ai-service/src/modules/tools/tool-bridge.service.ts:
  184-260` (`mergeMcpTools`) — the exact merge loop T01 changes. Line 228 is
  the tool-name computation; line 249 (`tools[key] = merged`) is where that
  name becomes both the record key and (via the AI SDK's `tool()` shape) the
  name sent to the LLM. Lines 172-182 (JSDoc) already document the
  filtering-on/off dual behavior T01 must preserve for the `filteringEnabled
  === false` branch (raw `toolName`, unaffected by this SPEC — a
  non-namespaced single-server setup was never broken).
- `services/agent-ai-service/src/modules/tools/tool-bridge.service.ts:
  242-247` — `toolDescriptionOverrides` lookup, keyed by the SAME `key`
  variable T01 changes; whatever T01 does to the exposed name, the override
  lookup must keep resolving correctly (either both keyed the new way, or
  overrides keyed by the stable addressing key independent of the exposed
  name — T01 picks one, see Design options below).
- `services/agent-ai-service/src/modules/tools/tool-definition.ts:12-22`
  (`AdapterReference`/`McpReference`) — `McpReference`'s own doc comment
  already calls `"<serverName>:<toolName>"` a "stable, addressable identity
  ... for per-tool filtering and description overrides," explicitly
  DISTINCT from tool execution routing (`Tool.execute`, AI-SDK-owned). This
  is the existing vocabulary T01's Option A (below) formalizes rather than
  invents.
- `services/agent-admin-service/src/modules/agents/agents.postgres.
  repository.ts:345-365,428-450` — `enabled_mcp_tools` and
  `tool_description_overrides` are both persisted as opaque JSON
  (`sql.json(...)`), no column-level schema constraining key shape.
  `enabled_mcp_tools` is keyed by SERVER NAME only (confirmed against
  `tool-bridge.service.ts`'s `enabledMcpTools?: Record<string, string[] |
  null>` — the outer key is `serverName`, the value is a per-server tool
  NAME list, never colon-joined) — T01's naming change does NOT touch this
  field's shape at all. `tool_description_overrides` IS keyed with the
  colon-joined form today (per `tool-bridge.service.ts:182`'s doc comment)
  — this is the ONLY persisted data structure whose key shape is even
  candidate for change, and only under Option B below.
- `services/agent-ai-service/src/modules/chat/chat.service.ts:284-311` — the
  MCP connect + tool-resolve call site T02 changes.
  `mcpConnection.connectForTenant(tenantId)` (line 286) is called
  unconditionally before the `mcpEnabled` check (line 290-293) even
  evaluates whether MCP is relevant to this agent at all — this is the
  ordering bug T02 fixes (connect-then-check instead of check-then-connect,
  or connect-scoped-to-agent instead of connect-all-of-tenant).
- `services/agent-ai-service/src/modules/tools/mcp-connection.service.ts:
  38-127` — `connectAllServers()` (unused, dead — only logs "lazy connect
  per tenant," never actually iterates anything) and `connectForTenant()`
  (the real path, tenant-wide, no agent parameter) T02 extends with agent
  scoping. `loadEnabledMcpServers` (lines 69-113) is the query T02 must
  parameterize by server NAME/id list when scoping, reusing the SAME
  Postgres/Mongo dual-path shape already there (do not add a third branch).
- `knative/services/base/agent-ai-service.yaml:50-59` +
  `knative/services/overlays/local/postgres-dev/env-patches.yaml:598-604` +
  `knative/services/overlays/local/mongo-dev/env-patches.yaml:652-658` — the
  `AGENT_MCP_TOOL_FILTERING_ENABLED`/`AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED`
  flag definitions, all three copies hard-coded `"true"`. T01 does not flip
  these off as a workaround (that would silently regress §4 filtering for
  every agent that already relies on it) — it makes the `true` state safe.
- `scripts/e2e/manifest-showcase-driver.ts:173` (`MCP_SERVER_NAME`
  definition) and its full-file header comment (lines 1-104, esp. line
  98-99: "Exits 0 with a single JSON summary line on stdout (parsed by the
  bash caller for teardown externalIds...)") — confirms teardown is
  driver-summary-dependent by design; T03 either makes the driver itself
  deactivate/delete on its OWN exit path (defense in depth, independent of
  whether the bash caller's trap ever runs) or hardens the bash-side
  fallback to not require a prior non-empty `SHOWCASE_MCP_SERVER_NAME`.
- `scripts/e2e/manifest-apply.sh:315` (`SHOWCASE_MCP_SERVER_NAME=""` init),
  `:365` (`cleanup()` def start), `:459-468` (the mcpServer teardown block),
  `:715` (`trap cleanup EXIT`), `:984`
  (`SHOWCASE_MCP_SERVER_NAME="$(echo "$SHOWCASE_JSON" | jq -r
  '.mcpServerName')"`) — the exact teardown chain T03 hardens.
- `services/agent-admin-service/src/modules/mcp-servers/mcp-servers.
  controller.ts:36-143` — full CRUD surface already exists
  (`@Get()`, `@Get(":id")`, `@Post()`, `@Patch(":id")`, `@Delete(":id")`,
  plus `@Post(":id/test")` for a side-effect-free connectivity probe at line
  108). T03 reuses `PATCH :id` (`{ is_active: false }` or `{ enabled: false
  }`, whichever the DTO already accepts — check `mcp-servers.dto.ts`) if a
  softer "deactivate" is preferred over the existing hard `DELETE` the
  script already calls, OR simply confirms the existing `DELETE` call is
  sufficient once T03 fixes WHEN it fires — no new endpoint needed either
  way.
- `services/agent-ai-service/package.json:9` (`"test": "bun test --preload
  ./test/preload-env.ts"`) and `services/agent-ai-service/tsconfig.json` —
  the test/typecheck commands this loop's gates run verbatim.
- `rebuild-redeploy.sh:26` (`agent-memory-service agent-ai-service
  agent-scheduler-service`) and `dev-mode.sh:225` (`agent-ai-service) echo
  "ksvc agent-ai-service src/main.ts agent-ai-service"`) — confirms
  `agent-ai-service` is an established dev-mode/rebuild target under the
  exact name this loop's gates target; no new deploy plumbing needed.
- `manual-loops/mcp-connections.md` (shipped) — §3 (usage metering,
  `withMcpUsageLogging`) and §4 (per-tool filtering, `enabledMcpTools`) are
  the features this SPEC's naming fix must not regress; T01's tests must
  keep both green.

## Constraints (apply to every task)

- The `filteringEnabled === false` branch of `mergeMcpTools` (raw
  `toolName`, no namespace) is OUT OF SCOPE for behavior change — it was
  never broken (single implicit server, no collision risk by construction)
  and this loop does not touch it beyond what a shared helper function
  requires.
- No change to `enabled_mcp_tools`'s persisted shape (server-name-keyed,
  confirmed unaffected — Prior art).
- `enabledMcpServers == null` allow-all semantics are UNCHANGED (decision 3).
- Never weaken, skip, or delete existing tests — this explicitly includes
  every existing `mcp-connections.md`-loop test for filtering (§4) and usage
  metering (§3); T01/T02 ADD assertions, never loosen existing ones.
- Verbose logging on every new/changed code path: the sanitized/derived name
  decision (T01), the scoping decision (T02, which servers were
  connected/skipped and why), and the teardown outcome (T03) — never log
  MCP server URLs, headers, or tool arguments/results beyond what already
  logs today.
- All artifacts in English.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — agent-ai-service unit tests (every task)
cd services/agent-ai-service && bun test
# G2 — agent-ai-service typecheck (every task)
cd services/agent-ai-service && bunx tsc -p tsconfig.json --noEmit
# G3 — e2e-manifest-apply regression (every task, dev cluster; exercises the
#      showcase driver's own mcpServer resource end-to-end, T03's direct target)
./scripts/e2e/manifest-apply.sh
# G4a — ITERATION (per attempt, source-mounted dev mode)
./dev-mode.sh deps && ./dev-mode.sh agent-ai-service on \
  && ./scripts/e2e/manifest-apply.sh
# G4b — COMMIT GATE (once per task, built image — the actual runtime this
#       incident hit; source-mounted dev mode alone does not satisfy this loop)
./dev-mode.sh agent-ai-service off \
  && ./rebuild-redeploy.sh agent-ai-service dev \
  && ./scripts/e2e/manifest-apply.sh
```

Gate rules: G1-G2 and G3 run for every task. G4a/G4b (rebuild-redeploy)
apply from T01 onward — this loop's whole premise is a runtime bug only a
real built image reproduces/proves-fixed (the incident itself was caught
against the deployed knative revision, not dev-mode source-mount).
**G4a-skip precondition** (inherited convention from the provisioning-gap
SPECs): `./scripts/validate-dev-mode.sh --with-e2e` — check first whether
the known stage-4/5 internal race still reproduces before assuming a NEW
failure; if it still reproduces, skip G4a and rely solely on G4b.

Commits only happen with dev-mode OFF and the built image live (G4b), plus
G1-G3 green.

---

## Task queue

### T01 — MCP tool names sent to the LLM always match `^[a-zA-Z0-9_-]+$`

**Design options (contested — human decides before code lands, per decision
2). Both keep `mergeMcpTools`'s existing `filteringEnabled === false`
branch untouched.**

- **Option A — RECOMMENDED: split "addressing key" from "API name."** Keep
  `"<serverName>:<toolName>"` as the internal addressing/lookup identity
  used for `toolDescriptionOverrides` lookups (Prior art:
  `tool-definition.ts`'s `McpReference` doc already calls this identity
  stable and filtering/override-scoped, never LLM-facing by contract). Add a
  pure sanitize function (e.g. `sanitizeMcpToolName(serverName, toolName):
  string`, one function per file per repo convention) that derives an
  API-safe name — replace `:` with `__` (double underscore, chosen over `_`
  because a single underscore can already appear in server/tool names,
  so `__` stays a syntactically distinguishable joiner without needing a
  denylist of the character), then strip any remaining character outside
  `[a-zA-Z0-9_-]`. Store the merged tool in the `tools` record under the
  DERIVED name; the loop's existing `if (tools[key]) continue` precedence
  check (agent-defined tools win) and the `toolDescriptionOverrides` lookup
  both keep using the ORIGINAL colon-joined addressing key, not the derived
  name. Collision handling: if the derived name already exists in `tools`
  (either from an agent-defined tool of the same sanitized name, or from
  another server/tool pair that sanitizes to the same string — e.g.
  `srv:a-b` and `srv:a_b` could theoretically collide once `-`/`_` both
  fold), append a short deterministic disambiguator (e.g. a 6-hex-char slice
  of a hash of the ORIGINAL addressing key) and log a warning citing both
  colliding addressing keys. **Tradeoff**: the tool's exposed LLM-facing
  name is no longer human-legible as `server:tool` (it becomes
  `server__tool` in the common case) — anyone reading raw LLM traces/tool
  call logs needs the addressing-key mapping to know which MCP server a
  call came from; T01 mitigates this by logging BOTH names together on every
  merge (verbose logging constraint). Zero migration: no persisted data
  changes shape, no manifest fixture needs updating, `enabledMcpTools`
  filtering (server-name-keyed) is entirely unaffected.
- **Option B — global separator change.** Replace `:` with a safe separator
  (e.g. `__`) EVERYWHERE the colon-joined form appears, including
  `toolDescriptionOverrides`' persisted JSON keys. Requires: (1) a data
  migration/backfill for every tenant's already-stored
  `tool_description_overrides` blob (`agents.postgres.repository.ts:345-365,
  428-450` — rewrite `"server:tool"` keys to `"server__tool"` in place, one
  UPDATE per row with a non-empty overrides map), (2) auditing
  `mcp-connections.md`'s own spec text and any sample manifest that
  documents or supplies colon-keyed override maps for consistency, (3) a
  backward-compat read path (accept EITHER separator on read, at least for
  one deploy cycle) if a zero-downtime rollout is required. **Tradeoff**:
  a single separator/identity used everywhere (simpler mental model, no
  addressing-key/API-name split to keep straight) at the cost of a real
  data migration with its own rollback risk — the exact kind of blast
  radius `provisioning-manifest-gaps-5.md`'s Prior art
  (`comparable-fields.ts`'s "diffs forever" trap) warns this codebase to
  avoid taking on lightly.
- T01 implements **Option A** unless the human overrules it in the Progress
  log before work starts (see Open questions / Human boundaries) — Option A
  requires no persisted-data migration and has the smaller, more
  contained blast radius, which this SPEC weighs as decisive absent a
  countervailing product reason to prefer one global separator.
- New/updated unit tests in `services/agent-ai-service/test/` (mirror the
  existing `tool-bridge.service` test file's mock-`McpClientService`
  convention):
  - A merged tool's record key / exposed `name` matches
    `^[a-zA-Z0-9_-]+$` for a representative set of server/tool name pairs,
    INCLUDING one that contains characters outside that pattern today
    (e.g. a server name with a space or dot, mirroring `deepwiki`-shaped
    real names) — regression test for the exact incident class.
  - `toolDescriptionOverrides` still resolves correctly post-sanitization
    (Option A: keyed by the untouched addressing key; assert the override
    text lands on the SANITIZED tool's `description`).
  - Collision case: two distinct addressing keys that sanitize to the same
    name both end up present in the merged `tools` record under distinct
    (disambiguated) keys — neither silently overwrites the other.
  - `filteringEnabled === false` path is unchanged (existing raw-`toolName`
    tests still pass verbatim — explicit non-regression assertion).
  - Existing §3/§4 `mcp-connections.md` tests (usage metering, per-tool
    filtering) still pass with no loosened assertions.

**Accept**
```
cd services/agent-ai-service && bun test -t "mergeMcpTools|tool-bridge|sanitize"
cd services/agent-ai-service && bunx tsc -p tsconfig.json --noEmit
```

### T02 — MCP connections scoped to the executing agent

- `McpConnectionService.connectForTenant(tenantId)` gains an agent-scoping
  path — either a new method (e.g. `connectForAgent(tenantId,
  enabledMcpServers: readonly string[] | null)`) or an added optional
  parameter, whichever keeps the existing `connectForTenant` call sites
  (if any exist beyond `chat.service.ts:286`) compiling unchanged. Recheck
  before implementing whether `chat.service.ts:286` is the ONLY caller
  (search `connectForTenant(` repo-wide) — the SPEC's understanding is that
  it is, but this must be re-verified, not assumed, before deciding whether
  to replace vs. add.
- Semantics (decision 3, human boundary — do not reinterpret):
  `agent.enabledMcpServers == null` still connects every enabled+active
  tenant server (unchanged default), but ONLY when the agent will actually
  merge MCP tools at all — i.e. move/gate the connect call so it only runs
  when `mcpEnabled` (`chat.service.ts:290-293`) is true, closing the
  connect-before-check ordering bug (Prior art). `agent.enabledMcpServers`
  as a non-null, non-empty array connects ONLY those named/id'd servers
  (`loadEnabledMcpServers` gains a `WHERE name = ANY($1)` / equivalent Mongo
  `$in` filter, parameterized by the agent's list) — reusing the SAME
  Postgres/Mongo dual-path shape already in `mcp-connection.service.ts:
  69-113`, no new branch kind.
- `agent.enabledMcpServers === []` (explicitly empty, distinct from `null`)
  already short-circuits `mcpEnabled` to `false` today
  (`chat.service.ts:293`) — T02 must confirm (test) that this path now also
  skips the connect call entirely (today it still calls
  `connectForTenant` unconditionally at line 286, wastefully connecting
  servers for an agent that will use none of them — T02 fixes this as part
  of the same ordering change, not a separate task).
- New/updated unit tests in `services/agent-ai-service/test/` (mock the
  tenant connection manager / SQL client per `mcp-connection.service`'s
  existing test convention, if one exists — otherwise establish it
  following the repo's postgres-provider mocking pattern):
  - `enabledMcpServers == null`: every enabled+active tenant server is
    still connected (no default-behavior regression — decision 3).
  - `enabledMcpServers = ["serverA"]`: only `serverA` is connected, even
    when other enabled+active servers exist for the tenant.
  - `enabledMcpServers = []`: zero connect calls are made at all (new
    assertion — today's wasted-connect bug).
  - An agent with `enabledMcpServers = ["serverA"]` running concurrently
    with a chat turn for an agent with `enabledMcpServers = ["serverB"]`
    (or `null`) does not leak `serverB`'s tools into the first agent's
    merged tool set — the exact "reachable server injects tools into
    unrelated agents" failure mode from the incident, expressed as a test.

**Accept**
```
cd services/agent-ai-service && bun test -t "connectForTenant|connectForAgent|mcp-connection"
cd services/agent-ai-service && bunx tsc -p tsconfig.json --noEmit
```

### T03 — e2e residue teardown + live verification

- `scripts/e2e/manifest-showcase-driver.ts`'s own cleanup path (whatever
  form the file already documents as owned by the bash caller — recheck
  this division of responsibility before implementing) gains a
  defense-in-depth teardown that does not depend on the driver reaching its
  final JSON-summary print: either (a) the driver itself issues the
  `DELETE /admin/mcp-servers/${id}` call in its OWN `finally`/error path
  before exiting non-zero, independent of whether `manifest-apply.sh`'s
  trap ever gets a name to look up, or (b) `manifest-apply.sh`'s `cleanup()`
  gains an unconditional (not gated on non-empty
  `SHOWCASE_MCP_SERVER_NAME`) sweep — e.g. `GET /admin/mcp-servers`, filter
  by a name PREFIX (`e2e-mcp-`) rather than exact match, delete every match
  older than the current run's nonce. Pick whichever fits the file's
  existing ownership boundary (driver = SDK round trips only, bash = trap
  teardown, per the driver's own header comment) — do not blur that
  boundary without recording why in this task's Progress entry.
  Recheck: does a prefix-sweep risk deleting a DIFFERENT, currently-running
  e2e invocation's server if two runs overlap? If so, scope the sweep to
  rows older than some age threshold (e.g. skip rows created in the last N
  minutes), not just prefix-matched — record whichever guard is chosen and
  why.
- Live verification (dev cluster, tenant `acme`):
  1. Re-activate `deepwiki` and `sample-mcp-server`
     (`PATCH /admin/mcp-servers/:id` with `is_active: true` — or whatever
     the interim deactivation actually flipped, confirm before writing the
     re-activation call) via `agent-admin-service`'s admin API.
  2. Run a playground-path chat execution for `crm-support-agent`
     (externalId `b3ea57af…`) through the SAME code path the admin-console
     test UI hit in the incident (not a synthetic unit test) — confirm the
     request completes with HTTP 200/streamed success, the merged tool set
     includes at least one MCP tool from a reachable server, and no
     `AI_APICallError`/400 occurs.
  3. Capture (log only, no PII/secret values) the merged tool names used in
     that execution, confirming every one matches
     `^[a-zA-Z0-9_-]+$` — the exact assertion class the incident violated.
  4. Run the residue-teardown fix's own regression: trigger (or simulate,
     if a real interrupted run isn't feasible in this environment) a driver
     exit BEFORE the JSON summary prints, and confirm no `e2e-mcp-*` row
     from that run survives past the script's own completion.

**Accept**
```
./scripts/e2e/manifest-apply.sh
# must show: no surviving e2e-mcp-* mcp_servers row after a normal run
cd services/agent-ai-service && bun test
cd services/agent-ai-service && bunx tsc -p tsconfig.json --noEmit
# live: crm-support-agent (b3ea57af…) playground execution succeeds with
# deepwiki + sample-mcp-server re-activated, merged tool names all match
# ^[a-zA-Z0-9_-]+$, no AI_APICallError
```

---

- [x] T01 MCP tool names sent to the LLM always match `^[a-zA-Z0-9_-]+$` —
  2026-07-24, Option B shipped: global `__` separator, single identity, NO
  legacy bridge (zero-row measured surface, recorded above); sanitization +
  deterministic collision hashing; expanded surface (shared validator,
  admin-console composer, sample manifest/docs) sanctioned and recorded.
  Gates: agent-ai 937 / shared 325 / provisioning 450 green, admin-console
  tsc clean, G3 e2e PASSED, G4b rebuild + e2e PASSED (twice — re-run after
  round-2 changes). Review: round 1 2×REJECTED (Progress record missing,
  docs audit skipped, permanent legacy bridge vs the "migrate" ruling) →
  round 2 2×REJECTED (one stale comment claiming legacy acceptance) →
  round 3 2×APPROVED.
- [ ] T02 MCP connections scoped to the executing agent
- [ ] T03 e2e residue teardown + live verification (deepwiki +
      sample-mcp-server re-activated, crm-support-agent proven)

## Out of scope (explicit)

- Changing `enabledMcpServers == null`'s allow-all default — a separate,
  larger product decision (decision 3, human boundary).
- Any change to `enabled_mcp_tools`'s persisted shape (server-name-keyed) —
  confirmed unaffected by T01's naming fix (Prior art).
- Flipping `AGENT_MCP_TOOL_FILTERING_ENABLED`/
  `AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED` off as a workaround — would
  silently regress `mcp-connections.md` §4 for every agent already relying
  on it; this loop fixes the `true` state instead.
- A full rename/migration of the `"<serverName>:<toolName>"` addressing
  identity across every consumer (manifest schema docs, admin-console
  display strings, etc.) beyond what T01's chosen option strictly requires
  — if Option B is chosen by the human and its migration surface turns out
  wider than Prior art currently shows, that widening is a STOP-and-escalate
  case, not a silent scope expansion.
- Any other MCP server reachability/timeout hardening beyond what's needed
  to prove T03's live verification — a broader MCP resilience pass, if
  needed, is a separate loop.
- Any dependency this loop finds that still cannot express its end-state
  after T01-T03 ship: stop and ask — do not invent a further gap kind or
  approximate (inherited boundary).

## Human boundaries for this change

- **This entire SPEC needs its own human approval before T01 starts.**
- **Open question — human must resolve before T01's code lands (decision
  2):** confirm Option A (addressing-key/API-name split, this SPEC's
  recommendation) over Option B (global separator + data migration), or
  explicitly choose Option B and accept its migration/rollout scope as part
  of T01 rather than a follow-up.
- **Open question — human must confirm the T03 teardown approach (driver
  self-cleanup vs. bash-side prefix/age sweep)** before implementation,
  given the "could a sweep delete a concurrently-running run's server"
  risk flagged in T03.
- **Open question — confirm `chat.service.ts:286` is genuinely the ONLY
  `connectForTenant` call site** before T02 decides whether to replace or
  add a method — this SPEC states its current understanding but requires
  re-verification at task start, not blind trust in this document.
- The interim deactivation of all three `acme` MCP servers is NOT reversed
  by this SPEC automatically — T03 explicitly re-activates `deepwiki` and
  `sample-mcp-server` only as part of its own live-verification step, after
  T01/T02 ship; `sample-mcp-server`'s and `deepwiki`'s re-activation must
  not happen ahead of that point.
- Any dependency that still cannot express its end-state after T01-T03
  ship: stop and ask — do not invent a further gap kind or approximate.

## Progress

Human approved this SPEC 2026-07-24 and RESOLVED the open questions:
- Decision 2 RULED: **Option B — global separator change** (human explicitly
  chose B over this SPEC's Option-A recommendation, accepting the
  migration/rollout scope as part of T01: persisted
  `tool_description_overrides` JSON keys migrate to the new separator;
  T01 must first measure the actual live migration surface on the dev
  tenant and record it here before writing the migration).
- T03 teardown RULED: **driver self-cleanup** (the driver tracks what it
  creates and deactivates it in its own finally/trap path, regardless of
  where the run dies; no bash prefix sweep).
- The `connectForTenant` single-call-site claim still requires
  re-verification at T02 start (unchanged).

### T01 — measured live migration surface (recorded 2026-07-24, before writing the migration)

- **How measured**: read-only `GET /admin/agents` against `agent-admin-service`
  for tenant `acme` (the only tenant in scope for this loop's live
  verification), via `kubectl -n kourier-system port-forward svc/kourier` +
  `curl -H "Host: agent-admin-service.platform-services-dev.dev.local" -H
  "x-yoizen-tenant: acme"`. No write performed.
- **Result**: tenant `acme` has **1 agent total** (`crm-support-agent`,
  externalId `b3ea57af…`); its `tool_description_overrides` field is
  **`null`**. **0 colon-keyed `tool_description_overrides` entries found**
  — anywhere, for the only tenant this dev-only, single-config platform
  currently has live data for.
- **Resulting design decision**: with a measured surface of zero rows,
  there is nothing to bridge. T01 implements Option B as a **single global
  identity with NO legacy-form compatibility layer** — `:` is replaced with
  `__` everywhere the addressing key is composed, read, or validated, full
  stop. No lazy dual-read, no opportunistic migrate-on-save, no sunset
  debt. (An earlier T01 pass had added a temporary lazy dual-read bridge
  for legacy colon-form keys; dual review round 1 rejected it as
  contradicting this ruling's "persisted keys MIGRATE to the new
  separator" given the zero-row measurement above — it was removed.)
- **Expanded-surface sanction**: the orchestrator, holding this Option-B
  ruling, explicitly sanctions the following four files as strictly
  entailed by the single-global-identity premise (Option B replaces `:`
  "EVERYWHERE the colon-joined form appears" — not just the three
  Prior-art-listed files), not a scope-widening STOP case under this
  SPEC's "Out of scope" bullet:
  - `packages/shared/src/provisioning/validate-structural-rules.ts` —
    parses the `toolDescriptionOverrides` key prefix for manifest
    validation; must recognize `__`, not `:`.
  - `packages/shared/src/provisioning/manifest.schema.ts` — doc comment
    documenting the key shape.
  - `services/admin-console/src/app/features/automation/ai/mcp-servers-selector.component.ts` —
    the only other real key-COMPOSING site in the repo (client-side
    override-key builder); must write `__`, not `:`.
  - `scripts/e2e/manifest-showcase-driver.ts` — the e2e fixture's override
    key (feeds gate G3).
  Also updated for the same reason (doc/sample-manifest audit, Option B's
  own checklist item): `DOCS/architecture/mcp-connections.md` (lines
  ~160, ~319, ~331) and `integrations/mcp/mcp-connections/README.md` /
  `README.es.md` / `manifest.yaml` (sample manifest's
  `toolDescriptionOverrides` key and prose).
