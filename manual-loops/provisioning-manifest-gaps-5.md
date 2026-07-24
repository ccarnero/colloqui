# SPEC — provisioning manifest gaps 5: manifest-provisioned agents never get published

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/declarative-provisioning.md` (shipped — manifest
> v1, `provisioning-service`, secrets broker, apply engine); `manual-loops/
> provisioning-manifest-gaps.md` (T01-T07 shipped); `manual-loops/
> provisioning-manifest-gaps-2.md` (T01-T06 + T08 shipped); `manual-loops/
> provisioning-manifest-gaps-3.md` (T01-T05 shipped, 12/12 samples
> declarative); `manual-loops/provisioning-manifest-gaps-4.md` (T01-T05
> shipped — `services[].env[]` secretRef/ref substitution, k8s-native).
> Origin: `demos/crm-support-telegram`'s first post-migration `run.sh`, live
> incident 2026-07-24. Human ruling (2026-07-24): **fix in the ENGINE**
> (`provisioning-service`'s `agents-writer.ts`), not in the demo, not in
> `agent-admin-service`.
> Engram topic: 'platform/provisioning-manifest-gaps-5'.

## Motivating incident (verified live 2026-07-24)

`demos/crm-support-telegram`'s `run.sh` applies a manifest that declares an
`agents[]` entry. The apply succeeds (HTTP 201, `resource_applied` event,
`agentCall`'s `agentRef` substitutes to a real `externalId` — the whole
symbolic-ref chain from `provisioning-manifest-gaps.md`/`-3.md` works
correctly). The workflow then runs and its `agentCall` activity fails at
runtime:

```
NotFoundException: Agent '<agentId>' not found for tenant '<tenantId>'
```

thrown by `agent-ai-service`'s `chat.service.ts:50-52` (also duplicated at
`:108-110` and `:141-143` for the streaming/non-streaming variants) — the
exact three call sites `services/workflow-service/src/temporal/activities/
agent-call.activity.ts` reaches through `generateReply`/`generateStreamReply`/
`generateStream`.

**Root cause**: `agent-admin-service`'s `agents.postgres.repository.ts`
`create()` (lines 101-141) inserts every new agent with `status = 'draft'`
(line 132, hard-coded, no create-time publish path exists). `agent-ai-service`
never queries agent-admin-service directly for a chat request — it maintains
its OWN store (`AgentConfigRepository`, synced) which is populated ONLY by
two NATS handlers: `agent-published.handler.ts` (`AgentConfigSyncService.
handlePublished`, `services/agent-ai-service/src/modules/config-sync/
agent-config-sync.service.ts:13-36`) and its unpublish counterpart — there is
NO "agent created" or "agent updated" handler anywhere in `agent-ai-service`
(confirmed: `ls services/agent-ai-service/src/nats-handlers/ | grep agent`
returns exactly one file, `agent-published.handler.ts`). A `draft` agent
therefore NEVER reaches `agent-ai-service`'s store, no matter how correctly
`provisioning-service` created/resolved it — `chat.service.ts` looks the
agent up in that store and finds nothing.

`services/provisioning-service/src/modules/apply/infrastructure/
agents-writer.ts` (`createAgentsWriter`, the `IPlatformResourceWriter` for
`agents[]`) `create()` (lines 354-480) and `update()` (lines 482-524) call
`POST /admin/agents` / reconcile the MCP-server and tool-field PATCH
endpoints, then return — **neither path ever calls `POST /admin/agents/:id/
publish`**. This is the gap. The deleted `03-ai-agent.ts` script (pre-manifest
era, superseded by declarative provisioning) did this publish step explicitly
via `agent-admin`'s SDK client; that lifecycle call has no equivalent in the
manifest engine today.

## Goal

`agents-writer.ts`'s `create()` ends with the agent `status = 'published'`
in `agent-admin-service` (so `agent-ai-service` syncs it and `agentCall`
resolves at runtime) — closing the exact `demos/crm-support-telegram` gap —
and `update()` re-publishes whenever it is invoked, without breaking the
existing "an unchanged agent noops on the second apply" contract. Live
verification extends `scripts/e2e/manifest-apply.sh`'s existing agent
fixture to assert real runtime visibility (agent-ai-service's own admin
endpoint returns the agent, value-free), plus the 12-manifest regression.

## User decisions (human boundary — do not reinterpret)

1. **Fix location: the ENGINE, not the demo.** Human ruling 2026-07-24 — the
   demo's `run.sh` is a correct CONSUMER of the manifest contract; the
   contract itself (declarative agent provisioning implies a *usable* agent)
   is what's broken. No demo-side workaround (e.g. a manual publish curl
   step bolted onto `run.sh`) satisfies this SPEC.
2. **`create()` ALWAYS publishes** — a manifest-declared agent is, by
   definition, meant to be live; there is no manifest field today
   (`packages/shared/src/provisioning/manifest.schema.ts`'s `agentSchema`)
   for "create but leave in draft," and inventing one is explicitly OUT OF
   SCOPE for this tight loop (see Out of scope).
3. **`update()` re-publishes whenever it runs, but does NOT gain a new
   trigger.** `agentComparable` (`comparable-fields.ts:325-350`) is
   existence-only for `system_prompt`/`model_config`/knowledge-base links —
   an `update()` verdict is reachable TODAY only via a declared
   `enabledMcpTools`/`toolDescriptionOverrides` diff (see `agents-writer.ts`'s
   own header comment, lines 53-67, and Prior art below). This SPEC does
   **not** widen `agentComparable` to make content-only changes (a bare
   `system_prompt` edit with no tool-field change) trigger an `update()` call
   — doing so is a SEPARATE, larger comparable-fields change with its own
   noop-semantics risk, explicitly deferred (see Out of scope). Consequence,
   recorded here rather than silently assumed: a manifest-only `system_prompt`
   edit on an ALREADY-published agent, with no tool-field change alongside
   it, still does not reach `update()` today and therefore does not
   re-publish under this SPEC either — this is a pre-existing
   `agentComparable` limitation this SPEC surfaces but does not fix.
4. Fail-loud, typed error if publish fails — reuse the existing
   `downstream_error` `ApplyWriteErrorKind` (`apply.interfaces.ts:42`, the
   SAME kind every other network/HTTP failure in `agents-writer.ts` already
   returns) — no new error kind needed, this is an ordinary downstream call.
5. Delivery method: manual-loop (this SPEC), not SDD — unchanged.
6. Any dependency this loop finds that still cannot be expressed after T01
   ships: stop and escalate — do not approximate, do not invent a further
   gap kind without a new human decision round (inherited boundary).

## Prior art (verified 2026-07-24 — REUSE, do not duplicate)

- `services/provisioning-service/src/modules/apply/infrastructure/
  agents-writer.ts:350-480` (`create()`) and `:482-524` (`update()`) — the
  writer this SPEC extends. `create()`'s existing call order: `POST /admin/
  agents` (line 399-441) -> `reconcileEnabledMcpServers` (line 448-460,
  PATCH `.../mcp-servers`) -> `reconcileAgentToolFields` (line 466-477, PATCH
  `.../mcp-tools` then `.../tool-descriptions`) -> return. T01's publish call
  is a FOURTH step appended at the END of this chain (both `create()` and
  `update()`), not inserted earlier — see next citation for why ordering
  matters.
- `services/agent-admin-service/src/modules/agents/agents.postgres.
  repository.ts:230-297` (`publish()`) — the snapshot it persists into
  `published_config`/`agent_versions` (lines 243-257) reads `enabled_tools`,
  `enabled_mcp_servers`, `enabled_mcp_tools`, `tool_description_overrides`,
  `channels`, `knowledge_base_ids`, etc. from the agent's CURRENT row state
  at the moment `publish()` runs. If T01 called publish BEFORE
  `reconcileEnabledMcpServers`/`reconcileAgentToolFields`, the published
  snapshot would capture the PRE-reconciliation state (stale MCP
  enablement/tool overrides) — this is why publish must be the LAST step in
  both `create()` and `update()`, not the first.
- `services/agent-admin-service/src/modules/agents/agents.controller.ts:
  109-117` — `POST /admin/agents/:id/publish` (no request body required;
  `@Headers(YOIZEN_USER_ID_HEADER)` is OPTIONAL — `agents-writer.ts` has no
  user identity to thread through today, so this SPEC calls it with no
  `x-yoizen-user-id` header, exactly like every other agents-writer call
  already omits user-scoped headers).
- `services/agent-admin-service/src/modules/agents/agents.service.ts:
  153-280` (`publish()`) — when `userId` is absent (T01's case, per the
  citation above), `semverContext` stays `undefined` the entire method (line
  158-251 is skipped in full), so no semver bump/diff computation runs; the
  repository call at line 253 (`this.repository.publish(tenantId, id,
  undefined)`) still unconditionally sets `status = 'published'` and inserts
  ONE new `agent_versions` row per call (postgres repo lines 259-269,
  272-293 — `versionNumber` falls back to `versionCount + 1` with no
  `context`). **This means every T01 publish call, even a no-content-change
  republish on an already-published agent, adds a version-history row** —
  an accepted, explicitly-recorded side effect (see Constraints), not a bug:
  it happens only when `create()`/`update()` are actually invoked by the
  planner, which per decision 3 above is already gated by a real diff (or
  the agent not existing yet).
- `services/agent-admin-service/src/modules/agents/agents.service.ts:
  253-277` — on success, `publish()` also emits
  `io.yoizen.platform.admin.agent.published.v1` via `natsPublisher.
  publishAgentPublished` (`nats.provider.ts:61,404-441`) — this is the ONLY
  event `agent-ai-service`'s sync path reacts to (next citation). Note the
  service-level `publish()` SWALLOWS a NATS publish failure (try/catch at
  lines 258-277, logs an error but still returns the agent `ok`) — this SPEC
  does not change that; `agents-writer.ts`'s own publish call only sees the
  HTTP response (2xx/non-2xx), which agent-admin-service always returns 2xx
  for even if the downstream NATS emit silently failed. Recording this as a
  KNOWN LIMITATION this SPEC inherits, not one it introduces or hides.
- `services/agent-ai-service/src/nats-handlers/agent-published.handler.ts`
  (whole file) + `services/agent-ai-service/src/modules/config-sync/
  agent-config-sync.service.ts:13-36` (`handlePublished`) — the ONLY path
  that populates `agent-ai-service`'s own agent store
  (`AgentConfigRepository`, via `AgentManagerService.reloadAgent`). Confirmed
  there is no "agent created"/"agent updated" NATS handler anywhere under
  `services/agent-ai-service/src/nats-handlers/` for agents (`ls` returns
  exactly `agent-published.handler.ts`) — a `draft` agent is structurally
  invisible to `agent-ai-service` no matter what `provisioning-service` does
  short of calling publish.
- `services/agent-ai-service/src/modules/chat/chat.service.ts:48-52,
  106-110, 139-143` — the three `NotFoundException` throw sites (`generate
  Reply`/`generateStreamReply`/`generateStream`), all reading through
  `AgentManagerService.getAgent(tenantId, agentId)` against the SAME store
  `handlePublished` populates. This is the exact runtime failure the
  incident hit.
- `services/workflow-service/src/temporal/activities/agent-call.activity.ts`
  — the `agentCall` workflow activity that calls into the three
  `chat.service.ts` methods above; the manifest-side symbolic-ref
  resolution (`agentRef` -> real `externalId`) it depends on already works
  correctly (`provisioning-manifest-gaps.md`/`-3.md`, unaffected by this
  gap) — confirms the failure is PURELY the publish-state gap, not a
  ref-resolution regression.
- `services/agent-admin-service/src/modules/agents/agents.postgres.
  repository.ts:101-141` (`create()`) — `status` hard-coded to `'draft'`
  (line 132), confirming the gap originates at agent creation, not at some
  later state transition.
- `services/agent-admin-service/src/modules/agents/agents.postgres.
  repository.ts:146-207` (`update()`) — `data.status` is only written when
  the CALLER explicitly passes it (line 192-194); an ordinary content update
  (`system_prompt`, `model_config`, etc.) leaves `status` untouched, i.e. an
  update never silently DEMOTES a published agent back to draft — confirms
  T01 does not need to "restore" published state after `update()`, only
  ADD it where it was never granted in the first place, or refresh the
  snapshot/event on a real update.
- `services/provisioning-service/src/modules/plan/lib/comparable-fields.ts:
  325-350` (`agentComparable`) — existence-only for `enabledMcpTools`/
  `toolDescriptionOverrides`; `system_prompt`/`model_config`/KB links are NOT
  projected on either side (decision 3's citation — the ONLY trigger for an
  `update()` call today).
- `services/provisioning-service/src/modules/plan/lib/comparable-fields.ts:
  352-374` (the `serviceComparable` header comment on scaling fields) — the
  general "a key present on only one side diffs forever" trap this SPEC
  deliberately avoids by NOT adding a `status`/`published` key to
  `agentComparable`: the manifest has no `status` field to declare, so
  projecting live `status` unconditionally would diff forever against a
  key the manifest side can never supply — the SAME class of bug this
  comment already warns against for `serviceComparable`. T01's fix is
  therefore writer-side only (an unconditional side effect of an
  already-triggered `create()`/`update()` call), never comparable-side —
  this is the concrete case that satisfies decision 3/the "study the
  comparable" instruction: **an already-published, truly-unchanged agent
  stays a full `noop` at the PLAN level** (the writer is never invoked at
  all on a `noop` verdict — `apply-manifest.ts` only calls `create()`/
  `update()` for `create`/`update` verdicts), so T01 adds zero new
  publish-triggering machinery and cannot regress the noop contract.
- `services/provisioning-service/src/modules/kb/lib/reconcile-knowledge-base.
  ts` + `services/provisioning-service/src/modules/kb/lib/
  decide-document-action.ts` — the ANALOGOUS precedent for "a manifest kind
  the writer contract alone doesn't fully cover has a SEPARATE lifecycle
  step reconciled out-of-band" (KB document ingestion, checksum-diffed,
  noop-safe by construction — `decide-document-action.ts`'s whole purpose).
  T01 does NOT need KB's out-of-band reconciler shape (publish is a single
  unconditional POST tied directly to `create()`/`update()`, no diffing of
  its own required per decision 3), but this confirms "a manifest kind
  needing an extra lifecycle call beyond plain create/update" is an
  established pattern in this codebase, not a novel shape.
- `services/provisioning-service/src/modules/apply/infrastructure/
  skills-writer.ts:80-211` — `createSkillsWriter`'s existing
  `downstream_error` shape (network failure / non-2xx / malformed JSON, all
  three branches) is the EXACT error-handling template T01's publish call
  reuses verbatim, same as `agents-writer.ts`'s own existing calls already
  do internally (`reconcileEnabledMcpServers` etc., lines 98-154).
- `services/provisioning-service/src/modules/apply/domain/apply.interfaces.
  ts:38-42` — `ApplyWriteErrorKind` already includes `"downstream_error"` —
  no new kind needed (decision 4).
- `services/agent-ai-service/src/modules/admin/admin.controller.ts:86-106`
  (`GET admin/agents/:id`) — returns `{ agent: null }` when the id is absent
  from `agent-ai-service`'s OWN store, `{ agent: {...status...} }` otherwise
  — a value-free, already-existing runtime-visibility probe. T02 uses this
  EXACT endpoint (no new endpoint needed) to assert the applied agent is
  actually synced/PUBLISHED, mirroring how T05
  (`provisioning-manifest-gaps-4.md`) proved its own chain "structurally,
  never exposing a value."
- `scripts/e2e/manifest-apply.sh:962-996` — the existing showcase fixture
  already applies an `agents[]` entry and captures `SHOWCASE_AGENT_NAME`/
  `SHOWCASE_AGENT_EXTERNAL_ID` from the driver's JSON output; T02 extends
  this SAME fixture (no new manifest resource declared) with two curl
  assertions: `agent_admin_curl GET /admin/agents/${SHOWCASE_AGENT_EXTERNAL_ID}`
  (`.status == "published"`) and a NEW `agent_ai_curl GET /admin/agents/
  ${SHOWCASE_AGENT_EXTERNAL_ID}` (`.agent != null`, `.agent.status ==
  "published"`).
- `scripts/e2e/manifest-apply.sh:119-138,191-196,205-211,234-239` — the
  per-service `*_URL`/`*_HOST`/`*_PORT`/`*_RESOLVE`/`*_curl()` quadruple
  every existing service integration in this script follows (e.g.
  `AGENT_ADMIN_URL`/`AGENT_ADMIN_HOST`/`AGENT_ADMIN_PORT`/
  `AGENT_ADMIN_RESOLVE`/`agent_admin_curl()`) — T02 adds the IDENTICAL
  quadruple for `agent-ai-service` (`E2E_AGENT_AI_URL`, default
  `http://agent-ai-service.platform-services-dev.dev.local`, mirroring the
  `<ksvc>.<namespace>.dev.local` convention every sibling already uses).
- `dev-mode.sh:225` (`agent-ai-service) echo "ksvc agent-ai-service ...`)
  and `rebuild-redeploy.sh:26` (`agent-memory-service agent-ai-service
  agent-scheduler-service`) — confirms `agent-ai-service` is an established
  dev-mode/rebuild target under the EXACT name T02's new `*_curl` helper
  targets; no new deploy plumbing needed.
- `services/provisioning-service/test/unit/apply/agents-writer.spec.ts:
  1-46` — the existing mock-`globalThis.fetch` test convention T01's new
  tests follow verbatim (one `mock()` per test, `afterEach` restores the
  original fetch).

## Constraints (apply to every task)

- `create()` publishes unconditionally, `update()` publishes whenever
  invoked — no manifest field or config flag makes publish optional in this
  loop (decision 2/3).
- No prune/delete semantics anywhere in this loop (inherited).
- Publish failures fail loud (`downstream_error`, decision 4) — `create()`/
  `update()` never return `ok: true` for an agent that is not actually
  published; a partially-applied agent (created but not published) is a
  hard apply failure for that resource, surfaced the same way every other
  `downstream_error` already is.
- `agentComparable` (`comparable-fields.ts`) is NOT modified by this loop —
  no `status`/`published` key is added to either side of the projection
  (decision 3's citation on the "diffs forever" trap). If a reviewer
  believes this SPEC secretly needs a comparable change to hold, that is a
  STOP-and-escalate case, not a silent addition.
- Verbose logging on the new publish call — logs `agent`, `tenant`,
  `externalId`, and the HTTP outcome; never logs agent content
  (`system_prompt`, tool definitions, etc.) beyond what `create()`/
  `update()` already log today.
- Every T01 publish call is an accepted `agent_versions` row addition per
  invocation (Prior art's `publish()` citation) — this is NOT a bug to
  "fix" with dedup/idempotency logic in this loop; if a reviewer wants
  version-row dedup, that is an explicit new decision round, not an
  in-loop addition.
- Never weaken, skip, or delete existing tests — automatic reviewer
  rejection. This explicitly includes every existing
  `agents-writer.spec.ts` assertion (T01 ADDS a publish-call assertion to
  each existing `create()`/`update()` test's mock-fetch sequence, does not
  remove or loosen any existing expectation).
- All artifacts in English.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — shared package tests (in case ApplyWriteError/writer types move)
cd packages/shared && bun test
# G2 — provisioning-service tests (every task)
cd services/provisioning-service && bun test
# G3 — provisioning-service typecheck (every task)
cd services/provisioning-service && bunx tsc -p tsconfig.json --noEmit
# G6 — sdk tests (in case client/type shapes move)
cd sdk && bun test
# G7 — REGRESSION: all 12 shipped manifests still validate and noop-reapply
#      (every task, run against the dev cluster)
for m in integrations/ai/ai-agent-playground/manifest.yaml \
         integrations/ai/ai-agent-triage/manifest.yaml \
         integrations/ai/ai-call-center-supervisor/manifest.yaml \
         integrations/ai/ai-knowledge-base-agent/manifest.yaml \
         integrations/ai/ai-skill-support-agent/manifest.yaml \
         integrations/ai/ai-system-variables/manifest.yaml \
         integrations/channels/http-fanout-telegram/manifest.yaml \
         integrations/channels/telegram-transform-reply/manifest.yaml \
         integrations/http/hosted-services-api/manifest.yaml \
         integrations/http/http-connectors/manifest.yaml \
         integrations/mcp/mcp-connections/manifest.yaml \
         integrations/mcp/mcp-repo-support-bot/manifest.yaml; do
  yoizen manifests validate -f "$m"
  yoizen manifests apply    -f "$m" --secrets-from-env
  yoizen manifests apply    -f "$m" --secrets-from-env   # second apply: 0 create / 0 update
done
# G8a — ITERATION (per attempt, source-mounted dev mode; provisioning-service
#       only — this loop touches no other service's source)
./dev-mode.sh deps && ./dev-mode.sh provisioning-service on \
  && ./scripts/e2e/manifest-apply.sh
# G8b — COMMIT GATE (once per task, built image)
./dev-mode.sh provisioning-service off \
  && ./rebuild-redeploy.sh provisioning-service dev \
  && ./scripts/e2e/manifest-apply.sh
```

Gate rules: identical spirit to the four parent SPECs (inherited) — G8a/G8b
apply from T01 onward. This loop touches ONLY `provisioning-service` source
(`agents-writer.ts` + its tests) and `scripts/e2e/manifest-apply.sh` (T02, a
test script, not a deployed service) — no `registry-service`/
`agent-admin-service`/`agent-ai-service` source change, so there is no
G4/G5-equivalent gate for another service in this loop.

**G8a-skip precondition** (inherited from all four parent SPECs):
`./scripts/validate-dev-mode.sh --with-e2e` — check first whether the KNOWN
stage-4/5 internal race documented by the parent SPECs still reproduces
before assuming a NEW failure; if it still reproduces, skip G8a and rely
solely on G8b, same as all four parents.

Commits only happen with dev-mode OFF and the built image live (G8b), plus
G1-G3/G6-G7 green.

---

## Task queue

### T01 — `agents-writer.ts` publishes on create and re-publishes on update

- Add a `publishAgent(baseUrl, logger, tenantId, agentName, externalId)`
  helper (mirrors `reconcileEnabledMcpServers`'s shape exactly — network
  failure / non-2xx both `downstream_error`, verbose log line on success)
  that calls `POST ${baseUrl}/admin/agents/${externalId}/publish` with NO
  request body and NO `x-yoizen-user-id` header (decision 2/Prior art —
  `agents-writer.ts` has no user identity to thread today).
- `create()`: call `publishAgent(...)` as the LAST step, after
  `reconcileEnabledMcpServers`/`reconcileAgentToolFields` both succeed
  (Prior art's snapshot-ordering citation) and before returning
  `{ ok: true, value: { externalId } }`. A publish failure returns the SAME
  `downstream_error` shape every other failure branch in this file already
  returns — the created-but-unpublished agent is NOT rolled back (no
  delete-on-publish-failure semantics exist anywhere in this writer today,
  and inventing one is out of scope for this tight loop), but the CALLER
  (apply engine) sees a hard `update`/`create` failure for that resource,
  never a silent `ok`.
- `update()`: call `publishAgent(...)` as the LAST step, after
  `reconcileEnabledMcpServers`/`reconcileAgentToolFields` (same ordering
  rule), before returning. Same fail-loud shape.
- Update this file's own header comment (currently silent on publish
  entirely) to record the new step and cite this SPEC, mirroring how prior
  gap SPECs updated writer header comments as part of their own T0x.
- New/updated unit tests in `agents-writer.spec.ts` (mock-fetch sequence
  convention, Prior art citation):
  - `create()`: happy path now asserts a THIRD (or fourth, after KB/MCP
    reconciliation) captured request is `POST .../publish` with no body.
  - `create()`: publish call failing (network throw, then separately a
    non-2xx response) both surface `downstream_error` — `create()` returns
    `ok: false`, never `ok: true`, in either case.
  - `update()`: an update triggered by `enabledMcpTools`/
    `toolDescriptionOverrides` also issues the publish call after both
    field-reconcile PATCHes; publish failure surfaces `downstream_error`.
  - Regression test proving call ORDER: publish is captured as occurring
    AFTER the MCP-servers/tool-fields PATCH calls, not before (a
    request-sequence assertion on the mock's call log, not just "was
    called").
  - Explicit regression note (comment in the test file, not a runtime
    assertion — there is no writer-level "noop" path to test since the
    writer is simply never invoked on a noop verdict): cites
    `comparable-fields.ts:325-374` and `apply-manifest.ts`'s create/update-
    only invocation contract as the reason no new noop test is needed here
    — if this reviewer-facing claim is wrong, the correction belongs in
    `apply-manifest.spec.ts`, not silently patched into this file.

**Accept**
```
cd services/provisioning-service && bun test -t "publish|agents-writer"
cd services/provisioning-service && bunx tsc -p tsconfig.json --noEmit
# regression: 12 shipped manifests still validate + noop-reapply
```

### T02 — Live verification: applied agent is actually published/runtime-visible

- Add the `agent-ai-service` URL/host/port/resolve/`agent_ai_curl()`
  quadruple to `scripts/e2e/manifest-apply.sh`, mirroring the existing
  `agent_admin_curl` block exactly (Prior art citation) —
  `E2E_AGENT_AI_URL`/`E2E_AGENT_AI_HOST` env-overridable, default
  `agent-ai-service.platform-services-dev.dev.local`.
- After the existing showcase-fixture apply (the `SHOWCASE_AGENT_EXTERNAL_ID`
  capture already present, Prior art citation), add two value-free
  assertions:
  1. `agent_admin_curl GET /admin/agents/${SHOWCASE_AGENT_EXTERNAL_ID}` ->
     `.status == "published"`.
  2. `agent_ai_curl GET /admin/agents/${SHOWCASE_AGENT_EXTERNAL_ID}` ->
     `.agent != null` AND `.agent.status == "published"` — proves the SYNC
     actually happened (agent-ai-service's own store), not just that
     agent-admin-service's row flipped, closing the exact gap the incident
     hit (a workflow's `agentCall` reads THIS store, never agent-admin
     directly).
- Second apply (already exercised by the 12-manifest G7 loop and by this
  script's own existing second-apply stage): assert the agent resource
  itself is a noop (0 create / 0 update for the agent specifically, not just
  the aggregate counts already checked) — proves T01 did not turn a
  genuinely-unchanged agent into a forever-`update` resource.
- No new manifest resource or fixture teardown entry needed — the agent
  fixture already exists and is already torn down by the script's existing
  cleanup path (Prior art).

**Accept**
```
./scripts/e2e/manifest-apply.sh
# must show: agent-admin status=published AND agent-ai-service .agent.status=published
# for the showcase fixture's agent; second apply agent-specific noop confirmed
# regression: 12 shipped manifests still validate + noop-reapply (G7)
```

---

- [ ] T01 `agents-writer.ts` publishes on create, re-publishes on update
- [ ] T02 live verification: applied agent is published/runtime-visible

## Out of scope (explicit)

- Widening `agentComparable` so a content-only change (`system_prompt`/
  `model_config`/KB links with no tool-field change) reaches `update()` at
  all — decision 3's documented pre-existing limitation, a separate,
  larger change with its own noop-semantics risk.
- A manifest-declarable "leave this agent in draft" escape hatch — no
  current use case motivates it (decision 2); if one appears, it needs its
  own SPEC and schema decision.
- De-duplicating/skipping redundant `agent_versions` rows when `publish()`
  is called with no actual content change (Constraints' accepted side
  effect) — a `publishAgent` idempotency improvement, not part of this
  gap's closure.
- Recovering from a publish failure by rolling back the just-created agent
  (delete-on-publish-failure) — no such rollback semantics exist anywhere
  in this writer file today; inventing one here would be a new, unrelated
  failure-handling pattern.
- `agent-admin-service`'s own swallowed-NATS-publish-failure behavior
  (`agents.service.ts:258-277`) — a pre-existing limitation in a service
  this SPEC does not touch, recorded in Prior art, not fixed here.
- Shape-aware `services[].env[]` comparable (stale-state masking) — a
  DIFFERENT, already-identified follow-up (recorded in engram from the
  gaps-4 loop), unrelated to agents.
- `knowledgeBases` missing from the plan/apply verdict tables — a
  DIFFERENT, already-identified follow-up (recorded in engram), unrelated
  to this gap.
- Any dependency this loop finds that still cannot express its end-state
  after T01-T02 ship: stop and ask — do not invent a further gap kind or
  approximate (inherited boundary).

## Human boundaries for this change

- **This entire SPEC needs its own human approval before T01 starts.**
- Decision 1 (fix location: engine, not demo) is a CLOSED human ruling
  (2026-07-24) — do not reopen it mid-loop.
- Decision 3's documented limitation (content-only agent edits on an
  already-published agent don't currently re-publish) is surfaced, not
  fixed, in this loop — if a reviewer or the human wants it fixed now
  instead of deferred, that is a scope-expansion decision requiring
  explicit sign-off before T01 proceeds past its current boundary, not a
  silent addition mid-task.
- Any dependency that still cannot express its end-state after T01-T02
  ship: stop and ask — do not invent a further gap kind or approximate.
- `demos/crm-support-telegram`'s own re-run (confirming the incident is
  actually closed end-to-end) is NOT part of this SPEC's Accept criteria —
  it is a follow-up the human triggers separately once this loop ships,
  mirroring how `provisioning-manifest-gaps-4.md` T05 unblocked (but did
  not itself resume) the crm loop's own paused task.

## Progress

(none yet — human approves this SPEC before the first run)
