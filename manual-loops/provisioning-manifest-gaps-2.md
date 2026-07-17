# SPEC — provisioning manifest gaps 2: library manifests, LLM/KB connector ID refs, agent per-tool MCP fields, service env vars

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/declarative-provisioning.md` (shipped — manifest
> v1, `provisioning-service`, `IntegrationManifest` schema, apply engine, SDK
> `client.manifests`/`client.secrets`); `manual-loops/provisioning-manifest-gaps.md`
> (T01-T07 shipped — connector credential wiring, connector endpoints,
> manifest-time real-ID substitution/`connectorRef`, `systemVariables`,
> service scaling+routes, `mcpServers`, SDK/CLI sweep; T08 migrated 2/11
> stand-by samples then escalated four NEW gap kinds found while migrating
> the remaining 9, code-verified against the apply engine and structural
> validator, not just the schema).
> Origin: `manual-loops/provisioning-manifest-gaps.md` T08 escalation (batches
> 2-3, 2026-07-16) + human ruling (2026-07-16): close that loop (its own six
> gaps fully shipped, T01-T07 complete) rather than keep extending it, and
> author this SPEC as the companion for the newly-found gaps. The 9 remaining
> stand-by samples stay in stand-by until this SPEC ships.
> Engram topic: 'platform/provisioning-manifest-gaps-2'.
> HUMAN APPROVAL REQUIRED BEFORE THIS SPEC EVER RUNS. Authoring it as the
> closing act of `manual-loops/provisioning-manifest-gaps.md` does not
> authorize executing it — the human must review and approve this SPEC on its
> own, separately, exactly like its parent required
> (`manual-loops/provisioning-manifest-gaps.md` §Human boundaries).

## Goal

Extend manifest v1 further with the four gap kinds `provisioning-manifest-gaps.md`
T08 found while attempting to migrate the 9 remaining stand-by samples,
code-verified against the apply engine, the structural validator, and
agent-ai-service's credential resolver:

1. **Library/channel-less manifests** — `validate-structural-rules.ts`
   unconditionally requires >=1 inbound channel AND >=1 process
   (`checkAtLeastOneInboundChannel`/`checkAtLeastOneProcess`) in every
   manifest; a connector-catalog manifest (`http-connectors`) or an
   MCP-server-only manifest (`mcp-connections`) is structurally invalid by
   construction, with no way to express "this manifest exists to provision
   shared resources other manifests reference, not to run a channel/process."
2. **LLM connector ID references** — `agents[].model_config.llm.connectorId`
   and `knowledgeBases[].ingestion_config.provider_connector_id` bake a REAL
   connector id; `credential-resolver.service.ts` fetches the connector
   directly by that id with no name-based lookup, and neither key
   participates in manifest-time substitution today (`connectorId` is not in
   `SUBSTITUTION_ALLOWLIST`; `ingestion_config` is not walked by the
   substitution mechanism at all). Blocks all 6 `ai` samples plus
   `mcp-repo-support-bot`.
3. **Safety fix — silent corruption of ref-shaped objects at non-allowlisted
   keys.** Adjacent to gap 2: `substitute-symbolic-refs.ts`'s walker only
   inspects a key's value for the recognized `{ <refType>: <name> }` shape
   WHEN that key is in `SUBSTITUTION_ALLOWLIST`; at any other key it just
   recurses, so a ref-shaped object placed at a non-allowlisted key (e.g.
   today's un-substituted `connectorId`) is walked as a plain nested object
   and persisted verbatim with no fail-loud, no warning — a silent
   correctness bug independent of which gap 2 mechanism ships.
4. **Agent per-tool MCP fields** — `enabled_mcp_tools` (per-tool allowlist
   scoped to one MCP server) and `tool_description_overrides` (including its
   `"<serverName>:<toolName>"` keys for MCP tools) have no manifest
   expression; `agents-writer.ts`'s `PASSTHROUGH_PROFILE_KEYS` excludes both,
   and neither corresponding PATCH endpoint
   (`updateEnabledMcpTools`/`updateToolDescriptionOverrides`) is called by
   any writer. Blocks `mcp-connections`, `mcp-repo-support-bot`.
5. **Service `env` vars** — `registry-services-writer.ts`'s
   `checkEnvSupport()` fails loud on ANY non-empty `service.env`, a
   restriction `provisioning-manifest-gaps.md` T05 (service scaling+routes)
   did not lift; `hosted-services-api`'s `YOIZEN_SAMPLE` env marker is
   inexpressible. Env VALUES are credential-capable, so the field must follow
   the `string | { secretRef }` pattern T06 established for `mcpServers`
   headers, not a bare string.

End goal: the remaining **9** stand-by samples migrate — `setup.sh`/
`src/setup.ts` deleted, `STANDBY.md` removed, `manifest.yaml` + CLI-driven
README in their place — completing the 12-sample set (1 originally shipped +
2 migrated in T08 batch 1 + 9 here), and the full G8 canary set from
`provisioning-manifest-gaps.md` (one per group: channels, ai, http, mcp) is
restored with a REAL migratable `mcp` canary for the first time.

## User decisions (human boundary — do not reinterpret)

1. Additive-only schema evolution, unchanged from the parent SPEC: every new
   field/section is OPTIONAL, defaults to empty/absent. THREE shipped
   manifests now anchor the regression check throughout this loop —
   `telegram-transform-reply/manifest.yaml` (original),
   `integrations/channels/http-fanout-telegram/manifest.yaml`, and
   `integrations/http/hosted-services-api/manifest.yaml` (both from the
   parent SPEC's T08 batch 1) — all three must keep validating and
   noop-re-applying after every task in this loop.
2. No prune/delete semantics — unchanged (parent decision 2). Every writer
   this loop touches remains create-or-update only.
3. Library/channel-less manifests (gap 1): **OPEN — needs human ruling before
   T01 starts.** Three candidate mechanisms, all inspected against
   `validate-structural-rules.ts`:
   - (a) a manifest-level `kind: library` marker in the manifest's top-level
     metadata (mirrors Kubernetes' own `kind` field the manifest format is
     modeled on) that structurally waives both checks when present;
   - (b) auto-detection: if a manifest declares zero channels AND zero
     agents/workflows but at least one connector/mcpServer/service, treat it
     as a library manifest implicitly, no new field;
   - (c) drop `checkAtLeastOneProcess`/`checkAtLeastOneInboundChannel`
     entirely as manifest-level invariants, moving any such enforcement (if
     still wanted) to a lint/advisory warning rather than a validation error.
   T01 must get this ruling before touching `validate-structural-rules.ts`.
4. LLM/KB connector ID references (gap 2): **OPEN — needs human ruling before
   T03 starts.** Two candidate mechanisms, both inspected against
   `credential-resolver.service.ts:174-247` and `SUBSTITUTION_ALLOWLIST`:
   - (a) extend `SUBSTITUTION_ALLOWLIST` with `connectorId` (agent
     `model_config.llm`) and `provider_connector_id` (KB
     `ingestion_config`), and extend the substitution walker (or a sibling
     walker) to also walk `knowledgeBases[].ingestion_config` trees — today
     ONLY `workflows[].definition`/agent `profile` trees are walked, so this
     is a new tree root, not just a new allowlist entry;
   - (b) a name-based lookup added directly to
     `credential-resolver.service.ts` (agent-ai-service), so `connectorId`
     could carry a manifest-time-resolved real id OR (if this mechanism
     ships) a name resolved at LLM-call time — inspected as more invasive
     (changes a live runtime credential path, not just apply-time
     substitution) and probably NOT worth it if (a) fully covers the need;
     record explicitly if the human still wants it as a defense-in-depth
     fallback.
   T03 must get this ruling before writing the schema/walker changes.
5. The safety fix (gap 3, ships as T02, standalone and BEFORE gap 2's chosen
   mechanism lands) makes `substitute-symbolic-refs.ts`'s walker recognize
   a ref-shaped object at ANY key, not only allowlisted ones. **OPEN — needs
   human ruling recorded in T02's own Accept, decide at task time**: fail
   loud (new error kind, e.g. `unallowlisted_symbolic_ref`, naming the key,
   the ref kind/name, and the owning resource) vs. warn-and-passthrough (log
   loudly, keep the current behavior of persisting it verbatim). The parent
   SPEC's Constraints ("nothing fails silently... a substitution that cannot
   resolve a ref fails loud") point toward fail-loud as the consistent
   choice, but this SPEC records it as OPEN rather than pre-deciding, since
   fail-loud here could newly reject manifests that today apply "successfully"
   with corrupted nested ref-objects — a behavior change worth an explicit
   human sign-off.
6. Agent per-tool MCP fields (gap 4): `enabled_mcp_tools` and
   `tool_description_overrides` are added to `agentSchema` mirroring
   `mcp-connections/src/setup.ts:352-374`'s exact shapes
   (`enabled_mcp_tools: Record<mcpServerName, string[] | null>`,
   `tool_description_overrides: Record<string, string>` with
   `"<serverName>:<toolName>"` keys for MCP tools, existing plain-name keys
   for adapter/builtin tools unaffected). Per T06's DOCUMENTED DEVIATION
   (agents reference MCP servers by NAME, not id, in
   `enabledMcpServerRefs`/`enabled_mcp_servers`): these two new fields ALSO
   key by MCP server NAME, never substituted to an id — consistent with the
   T06 precedent, not a new decision, but stated here so T04 does not
   reintroduce the id-substitution bug T06 avoided.
7. Service `env` vars (gap 5): `serviceSchema.env` becomes an array of
   `{ name: string, value: string | { secretRef: string } }` (mirrors T06's
   `mcpServers` headers pattern exactly), lifting `checkEnvSupport()`'s
   blanket rejection to per-entry resolution through the secrets broker for
   `secretRef` entries and pass-through for plain string entries (same
   plaintext-string-could-be-a-secret caveat T06 documented for headers,
   inherited verbatim, not re-litigated here).
8. Delivery method: manual-loop (this SPEC), not SDD — unchanged from the
   parent.
9. Sample migration (T07 here, mirrors parent T08): ONE commit per sample,
   same granularity rule as the parent's decision 8.
10. Any of the 9 remaining samples whose end-state STILL cannot be expressed
    after all four gaps + the safety fix ship: stop and escalate — do not
    approximate, do not invent a further gap kind without a new human
    decision round (identical boundary to the parent SPEC's T08 rule).

## Prior art (verified 2026-07-16 — REUSE, do not duplicate)

- `packages/shared/src/provisioning/validate-structural-rules.ts:146-147`
  (call sites) and `:172-200`
  (`checkAtLeastOneInboundChannel`/`checkAtLeastOneProcess` bodies) — the
  exact two checks gap 1 must relax/parameterize. Also note (line ~353, a
  comment already in the file): `connectorRef` is absent from
  `checkRefResolution`'s workflow-ref-walk `switch` — a pre-existing,
  documented gap from T03/T06, ADJACENT to this loop but not one of its four
  gaps (folded into the low-priority cleanup task, T06 below).
- `services/agent-ai-service/src/modules/llm/credential-resolver.service.ts:171-248`
  (`resolveFromConnector`) — fetches
  `${CONNECTOR_ADMIN_URL}/connectors/${connectorId}` directly by id, no
  name-based lookup path exists; gap 2's exact target.
- `services/provisioning-service/src/modules/apply/lib/substitution-allowlist.ts`
  — `SUBSTITUTION_ALLOWLIST` (four entries: `accountId`/`adapterId`/
  `agentId`/`serviceId`, plus T06's `serverId`); gap 2's candidate extension
  point (mechanism (a)); the file's own header comment states the allowlist
  is hand-kept in sync with `@yoizen/shared` workflow action types — the same
  discipline gap 2's new entries (if mechanism (a) ships) must follow.
- `services/provisioning-service/src/modules/apply/lib/substitute-symbolic-refs.ts:108-171`
  (the `walk` function) — confirms the safety-fix gap precisely: when
  `ALLOWLISTED_SUBSTITUTION_KEYS.get(key)` is `undefined` (line 114), the
  walker recurses into `child` (line 164) WITHOUT ever calling
  `readRecognizedRefObject` on it at that key — a ref-shaped object
  therefore only gets fail-loud treatment if it happens to land at an
  allowlisted key. `readRecognizedRefObject` (lines 68-83) is the existing
  single-key-shape detector gap 3 reuses, not reimplements.
- `integrations/mcp/mcp-connections/src/setup.ts:352-374` — the exact
  `updateEnabledMcpTools`/`updateToolDescriptionOverrides` calls and their
  argument shapes (`enabled_mcp_tools: { [MCP_SERVER_NAME]: SAMPLE_TOOL_NAMES }`,
  `tool_description_overrides: { [overrideKey]: DESCRIPTION_OVERRIDE_TEXT }`
  with `overrideKey = "<serverName>:<toolName>"`); gap 4's target shape and
  the two live client methods (`client.agents.updateEnabledMcpTools`/
  `updateToolDescriptionOverrides`) already exist on the SDK.
- `services/provisioning-service/src/modules/apply/infrastructure/agents-writer.ts:49-57`
  (`PASSTHROUGH_PROFILE_KEYS`) — the exact list gap 4 must extend (or wire a
  parallel dedicated call path for, since `enabled_mcp_tools`/
  `tool_description_overrides` are separate PATCH endpoints, not part of the
  agent's own `profile` PATCH body — confirm which at T04 implementation
  time).
- `services/provisioning-service/src/modules/apply/infrastructure/registry-services-writer.ts:106-116`
  (`checkEnvSupport`) — the exact fail-loud-on-any-env branch gap 5 replaces
  with per-entry `string | { secretRef }` resolution.
- `services/provisioning-service/src/modules/apply/infrastructure/mcp-servers-writer.ts`
  and its header schema (`ManifestMcpServer.headers`, T06) — the
  `string | { secretRef }` pattern gap 5 mirrors field-for-field for
  `serviceSchema.env` entries.
- `manual-loops/provisioning-manifest-gaps.md` T08 batch 1 + batches 2-3
  Progress entries (2026-07-16) — the authoritative evidence trail this SPEC
  is built from; also documents the 2 already-migrated samples
  (`http-fanout-telegram`, `hosted-services-api`) and the latent
  externalId-derivation bug already fixed en route
  (`channels-writer.ts:164`, `manifest:<name>` vs `<name>`).
- The 9 remaining `STANDBY.md` files (per-sample gap + evidence, updated
  2026-07-16 for `mcp-connections`) — authoritative per-sample scope map;
  read each one before migrating that sample (T07 here).
- `integrations/channels/telegram-transform-reply/manifest.yaml`,
  `integrations/channels/http-fanout-telegram/manifest.yaml`,
  `integrations/http/hosted-services-api/manifest.yaml` — the THREE shipped
  manifests; every task's regression check re-validates and re-applies
  (noop) all three.

## Constraints (apply to every task)

- Every new schema field/section is OPTIONAL, defaults to empty/absent, and
  additive — the THREE shipped manifests (above) must keep validating and
  noop-re-applying after every task. Regression-checked in every task's
  Accept block.
- No prune/delete semantics anywhere in this loop — every writer this loop
  adds or extends is create-or-update only.
- Secret VALUES never appear in logs, events, API responses, plan output, the
  database, or the manifest file itself. Automatic reviewer rejection on any
  violation, including the new `service.env` `string | { secretRef }` field
  (T05's `hosted-services-api` marker is a metadata string, not a credential —
  document per-entry which is which in the sample's manifest comment).
- Verbose logging on every new/extended writer/resolver/validator code path;
  nothing fails silently.
- Never weaken, skip, or delete existing tests — automatic reviewer
  rejection. This explicitly includes `validate-structural-rules.test.ts`'s
  existing >=1-channel/>=1-process assertions (gap 1 relaxes the RULE, not
  the test coverage of the non-library case — extend, never replace) and
  `substitute-symbolic-refs.test.ts`'s existing allowlisted-key assertions
  (gap 3 adds coverage for non-allowlisted keys, does not touch the existing
  ones).
- All artifacts in English.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — provisioning-service tests (every task)
cd services/provisioning-service && bun test
# G2 — provisioning-service typecheck (every task)
cd services/provisioning-service && bunx tsc -p tsconfig.json --noEmit
# G3 — shared package tests (schema lives in packages/shared, every task)
cd packages/shared && bun test
# G4 — sdk tests (every task, since T03/T04 may touch client method shapes)
cd sdk && bun test
# G5 — REGRESSION: all THREE shipped manifests still validate and
#      noop-re-apply (every task from T01 onward; run against the dev cluster)
for m in integrations/channels/telegram-transform-reply/manifest.yaml \
         integrations/channels/http-fanout-telegram/manifest.yaml \
         integrations/http/hosted-services-api/manifest.yaml; do
  yoizen manifests validate -f "$m"
  yoizen manifests apply    -f "$m" --secrets-from-env
  yoizen manifests apply    -f "$m" --secrets-from-env   # second apply: 0 create / 0 update
done
# G6a — ITERATION (per attempt, source-mounted dev mode)
./dev-mode.sh deps && ./dev-mode.sh provisioning-service on && ./scripts/e2e-manifest-apply.sh
# G6b — COMMIT GATE (once per task, built image)
./dev-mode.sh provisioning-service off && ./rebuild-redeploy.sh provisioning-service dev && ./scripts/e2e-manifest-apply.sh
# G7 — NO IMPERATIVE SETUP LEFT for a migrated sample (T07, per sample):
#      must output nothing once that sample's migration commit lands
find integrations/<group>/<sample> \( -name 'setup.sh' -o -name 'setup.ts' \) -o -name 'STANDBY.md'
# G8 — FULL CANARY SET RESTORED (T08 here): one migratable sample per group,
#      including a REAL mcp canary for the first time
for m in integrations/channels/telegram-transform-reply/manifest.yaml \
         integrations/ai/<canary>/manifest.yaml \
         integrations/http/<canary>/manifest.yaml \
         integrations/mcp/<canary>/manifest.yaml; do
  yoizen manifests validate -f "$m"; yoizen manifests apply -f "$m" --secrets-from-env
done
```

Gate rules: identical to `manual-loops/provisioning-manifest-gaps.md`
(inherited). G6a/G6b apply from T01 onward — every task in this loop touches
`provisioning-service`, a real platform service.

PRECONDITION: `./scripts/validate-dev-mode.sh --with-e2e` green once before
T01; if it fails, skip G6a and rely solely on G6b (the parent SPEC's Run
Approval entry documents a known internal race in this validator's stage 5 —
check first whether it still reproduces before assuming a NEW failure).

E2E CLEANUP: `scripts/e2e-manifest-apply.sh` (extended per task) provisions
with account-scoped, e2e-prefixed names and tears down what it creates
(trap-guarded, idempotent). The migrated samples' own provisioned resources
(T07) are NOT torn down by the gate — they ARE the sample.

Commits only happen with dev-mode OFF and the built image live (G6b), plus
G1-G5 green.

---

## Task queue

### T01 — Library/channel-less manifests (gap 1)

- Resolve decision 3's OPEN ruling (marker vs. auto-detect vs. drop) with the
  human BEFORE touching `validate-structural-rules.ts`.
- Implement the ruling: relax/parameterize
  `checkAtLeastOneInboundChannel`/`checkAtLeastOneProcess` so a manifest that
  qualifies as a library (per the ruling's mechanism) is structurally valid
  with zero channels and zero agents/workflows, PROVIDED it still declares at
  least one real resource (connector/mcpServer/service/systemVariable) — an
  entirely empty manifest remains invalid regardless of the ruling.
- Extend `validate-structural-rules.test.ts`: keep the existing non-library
  assertions, add library-manifest-valid and truly-empty-manifest-still-invalid
  cases.

**Accept**
```
cd packages/shared && bun test -t "structural"
cd services/provisioning-service && bun test -t "structural"
# regression: three shipped manifests still noop-reapply
```

### T02 — Safety fix: fail loud on ref-shaped objects at non-allowlisted keys (gap 3)

- Resolve decision 5's OPEN ruling (fail-loud vs. warn) with the human before
  implementation.
- Extend `substitute-symbolic-refs.ts`'s `walk`: at a NON-allowlisted key,
  also call `readRecognizedRefObject` on the child value; per the ruling,
  either return a new typed error (naming the key, ref kind/name, owning
  resource) or log a loud warning and continue passing it through verbatim —
  document the chosen semantics in the file's header comment.
- Regression-test: the THREE shipped manifests contain no such ref-shaped
  objects at non-allowlisted keys today, so this must remain a pure
  regression check (no behavior change for them) plus new unit tests proving
  the new detection fires on a synthetic non-allowlisted ref-object.

**Accept**
```
cd services/provisioning-service && bun test -t "substitut"
# regression: three shipped manifests still noop-reapply
```

### T03 — LLM/KB connector ID references (gap 2)

- Resolve decision 4's OPEN ruling (allowlist+KB-tree-walk extension vs.
  name-based lookup in `credential-resolver.service.ts`) with the human
  before writing the schema/walker changes.
- Per the ruling: either (a) add `connectorId`/`provider_connector_id` to the
  substitution mechanism (extending `SUBSTITUTION_ALLOWLIST` and adding
  `knowledgeBases[].ingestion_config` as a new tree root the substitution
  pass walks, alongside the existing workflow/agent-profile roots), or (b)
  add name-based resolution directly to `credential-resolver.service.ts`.
- Extend `RESOURCE_KIND_ORDER`/dependency graph if the ruling requires
  connectors to resolve before agents/knowledgeBases are written (verify the
  existing order already satisfies this before assuming a change is needed).
- Wire T02's safety fix to prove it: a `connectorId`/`provider_connector_id`
  key with a mismatched or unresolved ref must fail loud through the same
  path T02 established, not a bespoke error.

**Accept**
```
cd services/provisioning-service && bun test -t "connectorId|ingestion"
cd packages/shared && bun test -t "ingestion|connectorId"
cd services/agent-ai-service && bun test -t "credential-resolver"   # only if ruling (b) touches this service
# regression: three shipped manifests still noop-reapply
```

### T04 — Agent per-tool MCP fields (gap 4)

- Add `enabledMcpTools` (`Record<mcpServerName, string[] | null>`) and
  `toolDescriptionOverrides` (`Record<string, string>`) to `agentSchema`,
  mirroring `mcp-connections/src/setup.ts:352-374`'s field shapes exactly.
- Extend `agents-writer.ts` to call
  `client.agents.updateEnabledMcpTools`/`updateToolDescriptionOverrides`
  after the agent itself is created/resolved (separate PATCH endpoints per
  the setup script, not part of the `profile` PATCH body — confirm and
  document which at implementation time).
- Validate `enabledMcpTools`' keys against `spec.mcpServers[].name` in
  `validate-structural-rules.ts`'s `checkRefResolution` (name-keyed, never
  substituted to an id — decision 6, mirrors T06's `enabledMcpServerRefs`
  precedent exactly).
- Extend the planner's agent comparable to diff both new fields so a
  tools-only change produces an `update` verdict.

**Accept**
```
cd services/provisioning-service && bun test -t "enabledMcpTools|toolDescriptionOverrides"
cd packages/shared && bun test -t "enabledMcpTools|toolDescriptionOverrides"
# regression: three shipped manifests still noop-reapply
```

### T05 — Service `env` vars (gap 5)

- Change `serviceSchema.env` from rejected-if-present to an array of
  `{ name: string, value: string | { secretRef: string } }`, mirroring T06's
  `mcpServers` headers pattern field-for-field.
- Replace `checkEnvSupport()`'s blanket rejection with per-entry resolution:
  plain string values pass through, `{ secretRef }` values resolve through
  the secrets broker exactly like every other `secretRef` consumer in this
  loop's lineage.
- Extend `validate-structural-rules.ts`'s existing `service.env[].secretRef`
  ref-resolution check (it already exists per the parent SPEC's
  `checkRefResolution` — confirm it still fires correctly against the new
  shape, do not duplicate it).

**Accept**
```
cd services/provisioning-service && bun test -t "service.*env"
cd packages/shared && bun test -t "env"
# regression: three shipped manifests still noop-reapply
```

### T06 — Low-priority cleanup fold-in (optional, does not block T07/T08)

- Add the missing `connectorRef` case to `validate-structural-rules.ts`'s
  `checkRefResolution` workflow-ref-walk `switch` (documented gap since T03,
  restated in this SPEC's Prior art) — a real correctness gap: an unresolved
  `connectorRef` in a workflow `definition` is invisible to `validate`,
  surfacing only at `apply` time via T03's substitution walker.
- Fold the parent SPEC's recorded DRY follow-ups while touching adjacent
  code, if convenient, not mandatory: `safeFetchJson` shared helper
  (pre-existing unguarded `response.json()` parses across writers'
  `create()` paths), `DEFAULT_ROUTE_METHODS` normalization duplication
  (writer vs. comparable), cache-method enum duplication
  (`AdapterCacheMethod`).
- If any item here turns out non-trivial or risks scope creep into this
  loop's four gaps, split it out of this task and record it as a fresh
  Out-of-scope follow-up instead of stalling T07/T08 on it.

**Accept**
```
cd services/provisioning-service && bun test -t "connectorRef"
# no regression on any of the DRY-fold items — full G1-G3 green
# regression: three shipped manifests still noop-reapply
```

### T07 — Migrate the 9 remaining stand-by samples

- For each of the 9 remaining stand-by samples (per their `STANDBY.md`, plus
  the current `http-connectors`/`mcp-connections` blockers this SPEC targets
  directly), in the order the gap kinds above unblock them: extract its
  resources into a `manifest.yaml`, `git rm` its `setup.sh`/`src/setup.ts`,
  `git rm` its `STANDBY.md`, rewrite its README to the CLI flow (mirrors
  `telegram-transform-reply/README.md`'s structure, same as the parent
  SPEC's T08 contract, carried over verbatim).
- One commit PER SAMPLE (decision 9).
- Any sample whose end-state STILL cannot be expressed after all four gaps +
  the safety fix ship: stop and escalate — do not approximate, do not invent
  a further gap kind without a new human decision round.

**Accept**
```
ls integrations/*/*/manifest.yaml | wc -l    # == 12 (3 already shipped + 9 migrated here)
find integrations \( -name 'setup.sh' -o -name 'setup.ts' -o -name 'STANDBY.md' \)   # must output nothing
```

### T08 — Restore the full G8 canary set

- Confirm one migratable canary per group, including a REAL `mcp` canary for
  the first time (`mcp-connections` or `mcp-repo-support-bot`, human's choice
  if both migrate cleanly).
- Run G8 (all four canaries) live against the dev cluster, twice each
  (idempotence proof), and record results in the progress entry.

**Accept**
```
# G8 verbatim (above) — all four canaries validate, apply, and
# a second apply per canary reports 0 create / 0 update
```

---

- [x] T01 library/channel-less manifests (gap 1)
- [x] T02 safety fix: fail loud on ref-shaped objects at non-allowlisted keys (gap 3)
- [x] T03 LLM/KB connector ID references (gap 2)
- [x] T04 agent per-tool MCP fields (gap 4)
- [x] T05 service `env` vars (gap 5)
- [x] T06 low-priority cleanup fold-in (optional)
- [ ] T07 migrate the 9 remaining stand-by samples
- [x] T08 restore the full G8 canary set (mcp included for real)

## Out of scope (explicit)

- Prune/delete semantics for any manifest section — still deferred, unchanged
  by this loop.
- Unifying LLM/agent credential modes (profile/connector/env) onto
  `secretRef` broadly — this loop only fixes CONNECTOR-ID manifest-time
  resolution (gap 2) for the specific `connectorId`/`provider_connector_id`
  fields found; a wider credential-mode unification remains a separate,
  still-open follow-up (inherited from `declarative-provisioning.md`).
- `multipart/form-data` for the KB bundle apply transport — unrelated
  follow-up, untouched here.
- Any NEW resource kind beyond the four gaps enumerated in the Goal — a
  sample needing a fifth kind is a stop-and-escalate item (T07), not an
  invitation to extend scope inline.
- Cross-manifest route collision enforcement — already shipped in the parent
  SPEC's T05, unchanged by this loop.
- `systemVariables` secret-typed values (parent SPEC's T04 OPEN human
  ruling, still unresolved) — not revisited here; still rejected fail-loud by
  the manifest schema.
- If T06's DRY fold-in items turn out non-trivial, they are explicitly
  deferred to a future follow-up rather than expanded into their own task
  here (see T06's own escape hatch).

## Human boundaries for this change

- **This entire SPEC needs its own human approval before T01 starts** — it is
  authored here (`manual-loops/provisioning-manifest-gaps.md`'s closing
  Progress entry) but that authoring does NOT authorize execution.
- Decision 3's OPEN ruling (marker vs. auto-detect vs. drop for library
  manifests) — human decides before T01 starts.
- Decision 4's OPEN ruling (allowlist+KB-walk extension vs. name-based
  credential-resolver lookup) — human decides before T03 starts.
- Decision 5's OPEN ruling (fail-loud vs. warn for the safety fix) — human
  decides before T02's implementation (may be decided together with T01/T03
  in one round, human's choice).
- T07's per-sample migration order and human sign-off pattern mirrors the
  parent SPEC's T08: the human gets an explicit OK on the migration plan for
  each sample BEFORE its `setup.sh`/`STANDBY.md` is deleted.
- Any sample that still cannot express its end-state after all four gaps +
  the safety fix ship (T07): stop and ask — do not invent a further gap kind
  or approximate the end-state.
- Canary env/keys (`OPENAI_API_KEY`, `MCP_AUTH_TOKEN`, per-sample secrets) are
  loaded by the human, as in every prior loop; secret VALUES only ever travel
  env → `client.secrets`, never the repo — this explicitly includes the new
  `service.env[].value` field (gap 5), which MUST use `{ secretRef }` for
  anything credential-capable, never a literal secret string.

## Progress

### Run approval — 2026-07-16

Human approved this SPEC by invoking `/manual-loop` on it. All three OPEN
rulings resolved in one round (per Human boundaries): decision 3 = `kind:
library` marker; decision 5 = FAIL-LOUD; decision 4 = allowlist + KB-tree
walk. PRECONDITION: `validate-dev-mode.sh --with-e2e` still fails at the
KNOWN stage-4/5 internal race documented by the parent SPEC (verified same
signature, not a new failure) — G6a skipped, G6b is the cluster gate.

### T01 — 2026-07-16

HUMAN RULING (decision 3): `kind: library` marker. Implemented as `kind:
z.enum(["IntegrationManifest", "LibraryManifest"]).default(
"IntegrationManifest")` — additive (old manifests declare the literal or
default in). `validateManifestStructuralRules` branches on kind:
LibraryManifest waives the >=1-channel/>=1-process checks and instead
requires >=1 of connector/mcpServer/service/systemVariable
(`checkAtLeastOneLibraryResource`, fail-loud); non-library path byte-
identical to before. Mixed library manifests (with channels too) permitted —
waiver not prohibition, documented. No production code assumed non-empty
sections (grep-verified by implementer AND both reviewers). PUT/GET
round-trip persists kind. SDK unaffected (Record<string,unknown> by design).

Gates: G1 321/321, G2 clean, G3 265/265 + tsc, G4 392/392, G6b revision
00027 + e2e-manifest-apply PASSED, G5 TRIPLE regression (3 shipped
manifests) all VALID + all-noop. Dual review: 2x APPROVED (attempt 1).


### T02 — 2026-07-16

HUMAN RULING (decision 5): FAIL LOUD. `walk` now also inspects children at
NON-allowlisted keys: a recognized `{ <refKind>: <name> }` object returns
NEW error kind `unallowlisted_symbolic_ref` (key + kind + name + owning
resource, value-free) — closing the silent-corruption path where a stranded
ref-object persisted verbatim. TWO review rounds: attempt 1 REJECTED — the
check wrongly included `secretRef`; reviewer proved with two sources
(workflow schema comment manifest.schema.ts:610-618 + checkRefResolution's
live `case "secretRef"`) that secretRef legitimately appears inside walked
definitions. Attempt 2: secretRef EXEMPTED (different lifecycle — validated
structurally against spec.secrets, broker/consumer-resolved, never
substituted); the FIVE substitutable kinds keep the fail-loud; mixed test
proves the split at the identical nesting position; secretRef at an
ALLOWLISTED key still correctly hits `mismatched_symbolic_ref` (unchanged).
Header rewritten to the two-source truth. The pre-existing test that encoded
the silent-passthrough bug was upgraded (sanctioned — non-allowlisted-key
behavior, not a protected assertion). Three shipped manifests' definitions
transcribed as regression tests — walk clean.

Gates (attempt 2): G1 333/333, G2 clean, G3 265, G4 392, G6b revision 00029
+ e2e-manifest-apply PASSED (note: one rebuild attempt silently no-opped —
revision verified before gates re-ran), G5 triple regression all-noop.
Dual review: attempt 1 split (secretRef inclusion), attempt 2 → 2x APPROVED.

### T03 — 2026-07-16

HUMAN RULING (decision 4): allowlist + KB-tree walk; agent-ai-service
untouched. SUBSTITUTION_ALLOWLIST +2: `connectorId` → connectorRef (agent
model_config.llm — consumer credential-resolver.service.ts:171-248) and
`provider_connector_id` → connectorRef (KB ingestion_config — consumer
documents.service.ts:470-514). `knowledgeBaseSchema.ingestion_config` added
(opaque record, additive — the schema had no such field). NEW TREE ROOT via
a `reconcileKnowledgeBases` hook inside applyManifestPlan's ordered loop —
which FIXED A REAL PRE-EXISTING ORDERING BUG: KB reconciliation used to run
BEFORE the plan, so a KB referencing a same-apply connector could never
resolve; the hook now fires exactly once after all connectors are processed
(after-loop fallback for connector+KB-only library manifests), one
applyStarted/Completed chain preserved, hook failures mirror writer
failures. KB substitution reuses substituteSymbolicRefs verbatim (T02 error
kinds, CREATE-path only per the no-mutable-KB-fields precedent). KB module
deliberately NOT added to ResourceKind/RESOURCE_KIND_ORDER (its "no generic
writer" architecture respected; error types widened additively).

TWO review rounds: attempt 1 REJECTED (one reviewer; procedural note: only
one reviewer was launched that round) — the hook re-fetched getLatest
mid-apply, a TOCTOU race vs the run's loaded snapshot under concurrent PUT.
Attempt 2: hook closes over apply()'s already-loaded revision.manifest, the
second fetch and its "deleted concurrently" branch deleted, regression test
proves getLatest is called exactly once and a mid-run rev-2 PUT never leaks
into the reconciliation → 2x APPROVED.

Gates (attempt 2): G1 350/350, G2 clean, G3 269 + G4 392 untouched, G6b
revision 00031 + e2e-manifest-apply PASSED, G5 triple regression all-noop.

### T04 — 2026-07-16

Agent per-tool MCP fields shipped (decision 6: NAME-keyed, T06 precedent):
`agentSchema.enabledMcpTools` (Record<serverName, string[]|null>) +
`toolDescriptionOverrides` (colon keys "<server>:<tool>" validated against
spec.mcpServers incl. external; plain keys skipped, documented).
agents-writer reconciles via PATCH /admin/agents/:id/mcp-tools and
/:id/tool-descriptions after the T06 enablement PATCH; agent comparable
upgraded for JUST these two fields (readable-live confirmed via
AGENT_ROW_COLUMNS; declared-gate idiom — no forever-diffs); generic client
factory forwards declaredResource (backward-compatible).

TWO review rounds: attempt 1 REJECTED — update() reconciled tool fields but
NOT enabledMcpServerRefs (both-changed-at-once apply silently dropped the
server-refs change). Attempt 2: update() mirrors create()'s
order/gate/short-circuit for all three name-keyed fields; both-changed test
+ 500-short-circuit test; header updated → 2x APPROVED.

Gates (attempt 2): G1 367/367 + tsc, G3 281 + G4 392, G6b revision 00033 +
e2e PASSED, G5 triple regression all-noop.
FOLLOW-UP (cosmetic): reconcileEnabledMcpServers logs a `create:` prefix
even from update().

### T05 — 2026-07-16/17

TWO review rounds with a HUMAN RULING in between. Attempt 1 implemented
decision 7's string|{secretRef} shape but a reviewer proved the secretRef
branch resolved values to PLAINTEXT inside provisioning-service and baked
them literally into the Knative spec (etcd-persisted, kubectl-visible) —
contradicting declarative-provisioning decision 7's k8s-native secretKeyRef
mandate (the psec-* k8s Secrets the broker already materializes are the
intended vehicle). HUMAN RULING (2026-07-16): PLAIN STRINGS ONLY —
`serviceEnvVarSchema` = { name, value: string }; the secretRef branch is
REMOVED from gap 5 and deferred to a future k8s-native (valueFrom.
secretKeyRef) design; the 9 samples only need plain values. Attempt 2
delivered exactly that: pure `buildEnvVars` passthrough (no broker/
secretResolver in the env path), checkEnvSupport's blanket rejection lifted,
schema/writer headers cite the ruling + decision 7, comparable stays
NAMES-only (value-only change no-ops at plan — documented limitation,
T02 precedent). 2x APPROVED.

Gates (attempt 2): G1 368/368 + tsc, G3 292/292 + tsc, G4 392, G6b revision
00035 + e2e PASSED, G5 triple regression all-noop.
FOLLOW-UP (recorded): k8s-native secretKeyRef env design — needs its own
decision round (provisioning ensures the k8s Secret; registry/knative-builder
emits valueFrom.secretKeyRef; touches registry-service).

### T06 — 2026-07-17

Cleanup fold-in: `connectorRef` case added to checkRefResolution's workflow
ref walk (validates against spec.connectors incl. external, mirroring the
sibling cases; switch now exhaustive over all 6 SYMBOLIC_REF_KEYS; stale
follow-up comment removed; unresolved connectorRefs are now caught at
VALIDATE time, not only at apply). DRY: DEFAULT_ROUTE_METHODS extracted to
one shared constant (writer + comparable import it);
connectorEndpointCacheMethodSchema derives from AdapterCacheMethod (cast
sound — 6 static keys). `safeFetchJson` RECORDED as out-of-scope follow-up
(7 non-mechanical sites needing an error-kind decision).

Gates: G1 368/368 + tsc, G3 295/295 + tsc, G4 392, G6b revision 00036 + e2e
PASSED, G5 triple regression all-noop. Dual review: 2x APPROVED (attempt 1).

### T07 batch A (http-connectors + mcp-connections) — 2026-07-17

MIGRATED 2/9 across four attempts, each unblocked by a LIVE-GATE finding:
1. `http-connectors` → `kind: LibraryManifest`, 5 connectors + 31 endpoints
   verbatim, httpbin-basic-auth via nested basic secretRef auth (2 bindings,
   env vars = binding names). Reconciled live 5-noop (no duplicates),
   idempotent. Deviations documented: connector-level defaultCache
   re-expressed per-endpoint (schema has no connector-level cache); dynamic
   basic-auth path rewrite is now a documented manual step.
2. `mcp-connections` → `kind: LibraryManifest` (mcpServer qualifies; mixed
   library+process permitted per T01), mcpServer bearer auth via secretRef,
   agent with enabledMcpTools + toolDescriptionOverrides (NO
   enabledMcpServerRefs — the old setup never enabled servers; null = all),
   workflow mcpCall via {mcpServerRef}. Names verified against the DELETED
   setup.ts (git show): workflow `mcp-connections-demo` IS the code default.
   Converged live: second apply FULL NOOP 3/3.

LIVE-GATE FINDINGS FIXED (all in this batch, each reviewer-verified):
(a) secrets.controller had a THIRD hand-kept VALID_SCOPE_KINDS copy missing
`mcpServer` (parent-T07 dedup missed it); (b) `secretResourceName`
interpolated the kind verbatim — camelCase `mcpServer` violated RFC 1123
(k8s 422); now lowercased (no-op for the original five kinds, read/write
symmetric); (c) `desired-fields-of-resource.ts` had NO case "mcpServer" —
desired side projected empty → forever-update (parent-T06 escape); now
delegates to mcpServerComparable; (d) the sample's documented server-side
feature flags (AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED on agent-admin +
agent-ai, AGENT_MCP_TOOL_FILTERING_ENABLED on agent-ai) enabled in the
IN-REPO knative base + both local overlays (overlays replace env wholesale)
— without them the overrides PATCH skip caused a forever-diff.

Gates: G1 373/373 + tsc, provisioning revision 00039 + overlay applied
(agent services Ready), e2e-manifest-apply PASSED, G5 triple all-noop,
both new manifests live-idempotent. Dual review: 2x APPROVED.

### T07 batch B (6 ai samples) — 2026-07-17

MIGRATED 5/6 (7/9 total for T07) across three attempts; every sample
live-verified: first apply creates/repairs, second apply FULL NOOP; all
prior manifests remain all-noop. Commits: tags fix 64f38ad9 +
c16e247e/57232179/812020fd/220b0426/d51f6146 (one per sample).

ATTEMPT HISTORY: (1) migrations written; live applies all 400'd at agent
create. (2) suspected lost substitution — implementer PROVED the source
correct at three reproduction levels and the pod binary probe confirmed
T02/T03 present; a defensive noop-connector regression test was added.
(3) REAL root cause found by POSTing the substituted body: agent-admin
requires the referenced adapter to carry the `llm` TAG; the old setups all
sent `tags: ["llm"]` (git-show verified per sample) and connectorSchema had
NO tags field. FIDELITY FIX (orchestrator-authorized, same class as
parent-T02 endpoints): `connectorSchema.tags` mirroring connector-admin's
DTO; writer passes tags on create + PATCHes on update BEFORE endpoints;
comparable projects sorted tags via the declared-gate idiom (live listing
exposes tags) — the pre-existing tagless live connector SELF-REPAIRED via
update verdict on the next apply (observed live).

Sample notes: triage/supervisor/sysvars are IntegrationManifests with the
documented unpinned-trigger + chat-id-via-systemVariable patterns;
playground/kb-agent are LibraryManifests; KB doc expressed as inline source
(CLI has no bundle flag; byte-identical content, name sans extension per
nameSchema); sysvars renamed camelCase→kebab-case per nameSchema with every
runtime reference updated (reviewer-grepped).

ESCALATED (2/9 remain): `ai-skill-support-agent` — needs a `skills`
manifest section (catalog Skill via client.skills + agent catalog_skill_id):
a genuine FIFTH resource kind beyond this SPEC's four gaps; STANDBY.md
updated with citations; needs its own human decision round per decision 10.
`mcp-repo-support-bot` remains for batch C.

Gates: G1 383/383 + tsc, G3 299/299 + tsc, revision 00041 + e2e PASSED,
full regression sweep (8 manifests) all-noop. Dual review: 2x APPROVED.

### T07 batch C (mcp-repo-support-bot) — 2026-07-17

MIGRATED (8/9 total): IntegrationManifest — telegram inbound channel
(secretRef), mcpServer `deepwiki` (http, NO auth — the task brief's bearer
assumption was corrected against the deleted setup.ts: authType "none"),
shared `sample-openai-llm` connector (byte-identical to the ai samples' —
reviewer-verified zero update-loop risk), two agents (connectorId refs),
workflow triage→route→conditional(mcpCall via mcpServerRef)→summarize→reply
verbatim. Live: create×5 + connector noop; second apply FULL NOOP 6/6.
Commit 4317eb97. Dual review 2x APPROVED.

T07 FINAL STATE: 8/9 migrated (11 manifests total in integrations/**).
Literal Accept (12 manifests, zero setup files) NOT met — by the SANCTIONED
decision-10 escalation: `ai-skill-support-agent` requires a `skills`
manifest section (a fifth resource kind) and stays imperative with an
updated STANDBY.md until its own decision round. T07 checkbox left
unchecked to reflect that honestly.

### T08 — 2026-07-17

FULL G8 CANARY SET RESTORED: channels (telegram-transform-reply), ai
(ai-agent-playground), http (http-connectors — a LibraryManifest canary),
mcp (mcp-connections — the first REAL mcp canary, human-chosen). All four:
VALID + two applies each with appliedCount=0 (all-noop both passes).
The declarative provisioning showcase now covers every group.

LOOP END STATE: T01-T06 + T08 complete; T07 8/9 with one sanctioned
escalation. OPEN ITEMS FOR FUTURE DECISION ROUNDS: (a) `skills` manifest
section (fifth resource kind — ai-skill-support-agent); (b) k8s-native
secretKeyRef service env values (T05 ruling deferral); (c) secret-typed
systemVariables (parent T04 deferral); (d) trigger accountIds pinning
(plural-key substitution).
