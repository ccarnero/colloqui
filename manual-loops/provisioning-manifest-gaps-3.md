# SPEC — provisioning manifest gaps 3: `skills` catalog resource, `skillRef` substitution, ARRAY symbolic-ref substitution, final sample migration

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/declarative-provisioning.md` (shipped — manifest
> v1, `provisioning-service`, `IntegrationManifest` schema, apply engine, SDK
> `client.manifests`/`client.secrets`); `manual-loops/provisioning-manifest-gaps.md`
> (T01-T07 shipped); `manual-loops/provisioning-manifest-gaps-2.md` (T01-T06 +
> T08 shipped, T07 8/9 — `ai-skill-support-agent` escalated with a genuine
> fifth resource kind, `mcp-repo-support-bot`'s trigger left unpinned as a
> documented deviation alongside six siblings).
> Origin: `manual-loops/provisioning-manifest-gaps-2.md` T07 batch B escalation
> (`ai-skill-support-agent` needs a `skills` manifest section — a fifth
> resource kind, explicitly out of that SPEC's four-gap scope per its own
> "Out of scope" boundary) plus its final Progress entry's two remaining open
> items: (d) trigger `accountIds` pinning (plural-key substitution) affecting
> the SEVEN already-migrated manifests that carry the documented
> unpinned-trigger deviation.
> HUMAN RULING (2026-07-17): both workstreams — (a) the `skills` manifest
> section (to migrate the last imperative sample) and (d) ARRAY symbolic-ref
> substitution (to properly re-pin the migrated workflows' triggers) — are
> APPROVED IN ADVANCE. This SPEC records that ruling; it still runs under the
> same loop discipline as its parents (gated tasks, dual review, live G6b
> commit gate) and any GENUINELY NEW decision that surfaces mid-task still
> stops and escalates per the inherited boundary.
> Engram topic: 'platform/provisioning-manifest-gaps-3'.

## Goal

Close the two open items `provisioning-manifest-gaps-2.md` ended on:

1. **`skills` catalog resource (workstream a)** — `ai-skill-support-agent`
   creates a standalone, reusable **catalog Skill** entity
   (`client.skills.create`/`update`, `services/agent-admin-service/src/modules/skills/`)
   later referenced by an agent's `model_config.subagents[].catalog_skill_id`
   plus a full field snapshot on the subagent entry itself. Manifest v1 has no
   `skills` section — this is a genuine fifth resource kind, not an extension
   of an existing one. Shipping it: schema + planner comparable + apply-engine
   writer + `skillRef` symbolic-ref substitution + SDK/CLI sweep, migrating
   the LAST stand-by sample (12/12 imperative samples fully migrated).
2. **ARRAY symbolic-ref substitution (workstream d)** — `substitute-symbolic-refs.ts`
   only recognizes the SINGLE-VALUE ref-object shape `{ <refType>: <name> }` at
   an allowlisted SCALAR argument key (e.g. `accountId`). The workflow
   trigger's `config.accountIds` is a PLURAL array field with no manifest-time
   substitution path at all today — every one of the SEVEN already-migrated
   manifests with an HTTP/Telegram-triggered workflow documents this as a
   known deviation ("DEVIATION (reported to the human)" comments) and ships
   an UNPINNED trigger instead of the imperative setup's pinned one. This
   workstream adds ARRAY-of-ref-object substitution so those triggers can be
   properly re-pinned to their own manifest-created channel, closing the
   deviation for real rather than leaving it permanently documented as a
   limitation.

End goal: `ai-skill-support-agent` migrates (`setup.ts`/`STANDBY.md` deleted,
`manifest.yaml` + CLI-driven README in their place), completing the full
12/12 sample set first attempted in `provisioning-manifest-gaps.md` T08; the
SEVEN migrated manifests carrying the unpinned-trigger deviation are
re-pinned to their own channel/account via the new ARRAY substitution
mechanism, and their now-false deviation comments are removed.

## User decisions (human boundary — do not reinterpret)

1. Additive-only schema evolution, unchanged from both parent SPECs: every
   new field/section is OPTIONAL, defaults to empty/absent.
2. **Regression set: the ELEVEN shipped manifests** (not just the four G8
   canaries) — every task's Accept block regression-checks all eleven
   `integrations/*/*/manifest.yaml` files present at loop start (validate +
   noop-reapply), gate economy inherited from the parent SPEC's G5 pattern
   widened to the full shipped set now that eleven exist. The four G8
   canaries (one per group) remain the LIVE-apply subset re-run at every
   commit gate (G6b); the full eleven are the validate+plan regression run at
   every task (G5), matching how the parent SPEC scaled its own regression set
   as more manifests shipped (three -> eleven across its lifetime).
3. No prune/delete semantics — unchanged (inherited decision 2 from both
   parents). Every writer this loop touches remains create-or-update only.
4. `skills` manifest section (workstream a): schema mirrors `CreateSkillInput`
   exactly (`sdk/src/resources/skills/types.ts`) — `name`, `description?`,
   `system_prompt`, `icon?`, `color?`, `trigger_commands?`, `when_to_use?`,
   `priority?`, `allowed_tools?`, `mode?` (`"router"|"llm_driven"|"inline"`),
   `files?` (`{name, path, type: "script"|"reference"|"asset", content}[]`).
   NO field in this shape is credential-capable (no auth/token/key/secret
   field anywhere in `CreateSkillDto`/`UpdateSkillDto`) — `secretRef` support
   is NOT needed for `skillSchema`, confirmed by inspecting every field in
   `skills.dto.ts`. `skills` is a FULL `ResourceKind` (unlike `knowledgeBases`,
   which deliberately has no generic writer per
   `provisioning-manifest-gaps-2.md` T03) placed in `RESOURCE_KIND_ORDER`
   BEFORE `agent` (an agent's subagent entry references a skill by id via
   `catalog_skill_id`, mirroring the connector-before-agent /
   mcpServer-before-agent ordering already established).

   **`ResourceKind`/`SecretScopeKind` plumbing (follows the human-ratified
   `systemVariable` precedent from `provisioning-manifest-gaps.md` T04/T07
   EXACTLY).** `services/provisioning-service/src/modules/plan/domain/plan.interfaces.ts:10`
   declares `ResourceKind` as a literal TYPE ALIAS of `@yoizen/shared`'s
   `SecretScopeKind` (`export type ResourceKind = SecretScopeKind`), so a
   `ResourceKind` member that is NOT also a `SecretScopeKind` member is a type
   impossibility — the generic plan/apply pipeline (`RESOURCE_KIND_ORDER`,
   `PlatformResourceWriters`) is keyed on this union. Therefore `"skill"` IS
   added to `secretScopeKindSchema`
   (`packages/shared/src/provisioning/manifest.schema.ts:733-741`) as PLUMBING
   ONLY — so the alias keeps compiling and `skill` can flow through the
   generic pipeline — EXACTLY as `systemVariable` (T04) and `mcpServer` (T06)
   were added before it. But because no `skillSchema` field is
   credential-capable (see the DTO audit above), a skill-scoped secret binding
   is SEMANTICALLY DEAD (inert — no writer or resolver ever consumes one), so
   `"skill"` is DELIBERATELY EXCLUDED from BOTH hand-kept `VALID_SCOPE_KINDS`
   copies — `sdk/src/cli/valid-scope-kinds.ts:24-46` (the CLI's
   `systemVariable`-omission block is the drift-guard template to mirror
   line-for-line) and
   `services/provisioning-service/src/modules/secrets/secrets.controller.ts:39-54`
   (its own `systemVariable`-omission comment is the sibling template) — each
   with the same "gained the enum member only so `ResourceKind` could carry it
   through the generic pipeline, NOT to enable secret bindings; a skill-scoped
   binding is schema-valid but inert, rejected up front" rationale and
   drift-guard comment `systemVariable` already carries. STRUCTURAL-VALIDATOR
   stance mirrors `systemVariable` too: `validate-structural-rules.ts` never
   expects a `scope.kind === "skill"` binding and no `skillSchema` field
   produces a nested `secretRef`, so no skill-scoped secret binding ever
   validates — no new `checkRefResolution` branch is needed for skills.
5. **The SDK skills-client `update()`-returns-500 comment is STALE — the bug
   is FIXED.** `sdk/src/resources/skills/types.ts:33-51` (and the
   `client.ts:~36` WARNING referencing it) document a HISTORICAL HTTP-500 bug
   in `SkillsService.update` (dynamic `SET` clauses joined with
   `Array.prototype.join`, losing `postgres.js` fragment parameterization).
   The CURRENT `services/agent-admin-service/src/modules/skills/skills.service.ts:144-215`
   uses the CORRECT fragment-nesting pattern (`sql\`${setClause}, col =
   ${value}\``) — no cast, no `.join()` — with its own comment explicitly
   contrasting against the old join anti-pattern. LIVE PROBE (orchestrator,
   2026-07-17, decisive): created a skill, `PATCH`ed it via the gateway ->
   HTTP 200, field updated, cleanup 200. So `client.skills.update()` is a
   NORMAL, working update path; `skills-writer.ts` (T04) uses it exactly like
   `mcp-servers-writer.ts`/`agents-writer.ts` use their own update calls — no
   special-casing, no "expect the 500". The e2e test ALREADY asserts success:
   `sdk/test/e2e/admin-resources.e2e.ts:~100-110` calls `client.skills.update()`
   and asserts the persisted `200` result, with its own comment recording the
   fix ("FIXED (GROWTH-PLAN.md Phase 4 ...) — confirmed live on the dev
   cluster 2026-07-05: 200 with the persisted update"). There is nothing to
   flip. The ONLY stale artifacts are the SDK's own doc comments: (1)
   `types.ts:33-51`'s header narrative (still claiming `update()` "currently
   returns HTTP 500 for EVERY payload", AND mis-describing the e2e as
   asserting the broken behavior — doubly stale) and (2) `client.ts:35-37`'s
   `update()` WARNING comment (still claiming the 500 is current). A SMALL work
   item (folded into T04, or T01 if convenient): correct THOSE TWO comments to
   record the bug is fixed (server-side, live-verified 2026-07-05 by the e2e
   and again 2026-07-17 by the orchestrator probe, HTTP 200). No test change.
6. `skillRef` substitution (workstream a, continued): new `SymbolicRefType`
   member added to `SYMBOLIC_REF_KEYS`
   (`packages/shared/src/provisioning/manifest.schema.ts`), new
   `SUBSTITUTION_ALLOWLIST` entry pairing argKey `catalog_skill_id` ->
   `skillRef`, mirroring `connectorId`/`provider_connector_id`'s precedent
   (`provisioning-manifest-gaps-2.md` T03) exactly: the exact key path is
   `profile.model_config.subagents[].catalog_skill_id`, inside an agent's
   OWN `profile` tree — the PRE-EXISTING agent-profile substitution walk
   already covers this path structurally (no new tree root needed, unlike
   gap 2's `ingestion_config` which needed one). `RESOURCE_KIND_ORDER`
   places `skill` before `agent` so the id resolves within the same apply.
7. ARRAY symbolic-ref substitution (workstream d): the walker must be
   extended to recognize an ARRAY of single-key ref-objects
   (`[{ <refType>: <name> }, ...]`) at a DESIGNATED PLURAL argument key,
   substituting every element to its real id, exactly like the scalar case
   but element-wise. **Design choice, investigated and proposed here**: a
   PARALLEL allowlist, `ARRAY_SUBSTITUTION_ALLOWLIST` (same
   `{ argKey, refType, source }` shape as `SUBSTITUTION_ALLOWLIST`), rather
   than a shape flag bolted onto the existing entries — reasons: (i) the
   existing `SubstitutionAllowlistEntry` type and its consuming code
   (`ALLOWLISTED_SUBSTITUTION_KEYS` map, `walk`'s per-key branch) is written
   assuming ONE ref-object value per key; overloading it with a
   scalar-or-array flag would force every existing call site to branch on
   that flag even though today's five entries (`accountId`/`adapterId`/
   `agentId`/`serviceId`/`serverId`) plus the two `provisioning-manifest-gaps-2.md`
   additions (`connectorId`/`provider_connector_id`) are ALL scalar and
   should stay that way — a parallel map keeps the scalar path
   byte-identical and adds a SEPARATE, small, auditable array-only path;
   (ii) `accountIds` is the ONLY known plural ref-bearing key today (a
   workflow trigger's `config.accountIds`) — a single new allowlist with one
   entry (`argKey: "accountIds"`, `refType: "channelRef"`, mirroring
   `accountId`'s existing `channelRef` mapping) is proportionate to the one
   real need, not a speculative general mechanism. T03 must confirm this
   design against the walker's actual code shape before implementing — if
   the investigation finds a cleaner single-map design that does not
   compromise the scalar path's simplicity, propose it in the task's own
   Accept/Progress entry rather than deviating from this default silently.
   Fail-loud semantics mirror the SCALAR case, applied per-array-element,
   consistent with the parent SPEC's T02 (gap 3) constraint that nothing
   fails silently:
   - an element that is a recognized ref-object of the WRONG kind for that
     array key -> `mismatched_symbolic_ref` (element index included in the
     path, e.g. `...trigger.config.accountIds[0]`);
   - an element that is a recognized ref-object of the RIGHT kind but
     unresolved (name not found) -> `unresolved_symbolic_ref`;
   - a MIXED array (some elements are ref-objects, some are already-literal
     id strings) is legal and must substitute only the ref-object elements,
     passing literal strings through untouched — mirrors how a scalar
     allowlisted key already accepts either a ref-object or a passthrough
     literal;
   - the safety fix (T02, gap 3, `unallowlisted_symbolic_ref`) must ALSO
     fire per-element for an array of ref-objects sitting at a
     NON-allowlisted plural key, not just for the scalar case, so a
     stray ref-shaped array element that would silently corrupt the
     resource is caught with the same rigor as a scalar one.
8. Trigger re-pinning (workstream d, continued): each of the SEVEN migrated
   manifests carrying the "DEVIATION (reported to the human)" comment gets
   `trigger.config.accountIds: [{ channelRef: <its own manifest-created
   channel/account name> }]` added, and its now-false deviation comment
   removed. Per-manifest, which OWN channel/account to pin to must be
   verified individually (some manifests provision an HTTP channel
   specifically for the trigger, one provisions a Telegram channel) — see
   Prior art for the concrete list; do not assume a uniform "first channel in
   the manifest" rule without checking each one's own comment/structure.
9. Delivery method: manual-loop (this SPEC), not SDD — unchanged from both
   parents.
10. Sample migration (T04 here): ONE commit for the migration, same
    granularity rule as both parents' sample-migration decisions.
11. Any dependency this loop finds that STILL cannot be expressed after both
    workstreams ship: stop and escalate — do not approximate, do not invent a
    further gap kind without a new human decision round (identical boundary
    to both parent SPECs).

## Prior art (verified 2026-07-17 — REUSE, do not duplicate)

- `services/agent-admin-service/src/modules/skills/skills.controller.ts` —
  `SkillsController` (`admin/skills`): `GET` (list, no real pagination —
  `findAll(tenantId)` ignores limit/offset and returns everything),
  `GET /:id` (returns `null` not 404 on missing), `POST` (create),
  `PATCH /:id` (update — a normal working call; the SDK's historical 500-bug
  comment on it is STALE, see decision 5), `DELETE /:id` (soft-delete,
  returns bare boolean). `TenantGuard`-scoped like every other admin module
  this loop's siblings already write against.
- `services/agent-admin-service/src/modules/skills/skills.dto.ts` —
  `CreateSkillDto`/`UpdateSkillDto`/`SkillFileDto` — the EXACT field list
  gap (workstream a)'s `skillSchema` mirrors: `name` (required, 1-255),
  `description?`, `system_prompt` (required on create), `icon?`, `color?`,
  `trigger_commands?: string[]`, `when_to_use?`, `priority?` (int, 0-1000),
  `allowed_tools?: string[]`, `mode?` (`"router"|"llm_driven"|"inline"`),
  `files?: SkillFileDto[]` (`{name, path, type: "script"|"reference"|"asset", content}`).
  `UpdateSkillDto` additionally allows `is_active?: boolean`. No auth/token/
  secret-shaped field anywhere in either DTO.
- `sdk/src/resources/skills/client.ts` + `sdk/src/resources/skills/types.ts` —
  `SkillsClient` (`create`/`list`/`get`/`update`/`remove`) already exists and
  is fully typed; `skills-writer.ts` (T04) consumes this client directly, no
  new SDK surface needed for the writer itself. `types.ts`'s header comment
  (lines 1-52) documents TWO live gotchas the writer must still handle: (1)
  `list()` `total` always equals `items.length` (no real server-side
  pagination — same shape as the KB precedent from
  `provisioning-manifest-gaps-2.md`); (2) `get`/`update` return `null` (HTTP
  200) on a missing id, never a 404 — writer code must null-check, not rely
  on an exception. The header's THIRD gotcha — the `update()`-returns-HTTP-500
  WARNING at `client.ts:35-37` and the narrative at `types.ts:33-51` — is
  STALE (see decision 5): the current `skills.service.ts:144-215` uses correct
  fragment-nesting, the e2e (`admin-resources.e2e.ts:~100-110`) already
  asserts a `200` persisted update (fixed 2026-07-05 per its own comment), and
  a 2026-07-17 live probe re-confirmed HTTP 200. The writer's update path is
  normal; only those two SDK comments get corrected (decision 5's work item) —
  no test change (the e2e needs none).
- `integrations/ai/ai-skill-support-agent/src/setup.ts` (STILL PRESENT —
  never deleted; this sample stayed stand-by, unlike a normally-migrated
  sample whose imperative script gets `git rm`'d) —
  - lines 373-412 (`stageEnsureSkill`): `client.skills.list()` for a
    name+`is_active`-matched lookup, optional `RECREATE=1` delete, then
    `client.skills.create`/`client.skills.update` by the found/created id —
    the EXACT create-or-update-by-name shape `skills-writer.ts` (T04) must
    mirror (name-based lookup, since the catalog has no manifest-stable id
    of its own until first apply).
  - lines 549-597 (`buildAgentPayload`): the subagent entry embedded in
    `model_config.subagents[]` carries `name`, `description`,
    `system_prompt`, `enabled: true`, `catalog_skill_id: skillId`,
    `trigger_commands`, `when_to_use`, `priority`, `mode` — i.e. the FULL
    skill snapshot PLUS the catalog id link, confirmed by the comment at
    lines 550-558: "agent-ai-service maps `model_config.subagents` ->
    `agent.skills` ... reading `trigger_commands`/`when_to_use`/`priority`/
    `mode` from the ENTRY ITSELF" — the runtime does NOT re-fetch the skill
    by `catalog_skill_id` at chat time, so a manifest re-apply that changes
    the catalog skill's fields must ALSO update the subagent snapshot fields
    to stay consistent (documented as a migration note in the sample's own
    manifest comment, not a new schema mechanism).
  - `STANDBY.md`'s "Update (2026-07-17...)" section: the original connector
    `authConfig` gap is RESOLVED (nested-secretRef connector auth shipped in
    the parent-of-parents SPEC); the ONLY remaining blocker is the `skills`
    section itself — cites `src/setup.ts:394-411` (skills.create/update),
    `:566` (`catalog_skill_id`), `:550-558` (the snapshot-not-refetch runtime
    contract) — all three citations verified against the live file above.
- `services/provisioning-service/src/modules/apply/lib/substitution-allowlist.ts` —
  `SUBSTITUTION_ALLOWLIST` (seven scalar entries after `provisioning-manifest-gaps-2.md`
  T03: `accountId`/`adapterId`/`agentId`/`serviceId`/`serverId`/`connectorId`/
  `provider_connector_id`); T02 (this SPEC)'s exact extension point for the
  new `catalog_skill_id` -> `skillRef` scalar entry, and T03 (this SPEC)'s
  reference for the proposed sibling `ARRAY_SUBSTITUTION_ALLOWLIST`.
- `services/provisioning-service/src/modules/apply/lib/substitute-symbolic-refs.ts` —
  the `walk` function (lines 108-171 area): recognizes ONLY a single-key
  `{ refType: name }` OBJECT (`readRecognizedRefObject`, lines 108-124) —
  today's `walk` already has an `Array.isArray(value)` branch (lines 137-147)
  that recurses element-wise into arrays, but that branch treats every
  element as an independent tree to `walk()` INTO, never checking whether the
  ARRAY ITSELF sits at an allowlisted (or now, array-allowlisted) key before
  recursing — the exact place T03 (this SPEC) must add a check: when `path`'s
  owning key is in `ARRAY_SUBSTITUTION_ALLOWLIST` AND `value` is an array,
  substitute per-element via the SAME `readRecognizedRefObject`/`resolveRef`/
  fail-loud logic already proven for the scalar case, instead of falling
  through to the generic recurse-into-array branch. The `unallowlisted_symbolic_ref`
  safety-fix branch (T02, gap 3, `provisioning-manifest-gaps-2.md`) is the
  reused enforcement path for a stray ref-object array at a non-allowlisted
  plural key.
- The SEVEN migrated manifests carrying the "DEVIATION (reported to the
  human)" unpinned-trigger comment, grep-verified 2026-07-17 (their own
  in-file comments name which pin env var and which own account/channel the
  imperative setup used to pin to):
  - `integrations/channels/telegram-transform-reply/manifest.yaml:32-37` —
    `TG_PIN` default 1, pins to the `telegram-transform-reply-bot` channel
    account created in the SAME manifest (line 21).
  - `integrations/channels/http-fanout-telegram/manifest.yaml:176-181` —
    `FANOUT_PIN=1` default, pins to the manifest's own HTTP account.
  - `integrations/http/hosted-services-api/manifest.yaml:139-142` —
    `HOSTED_WORKFLOW_PIN=1` default, pins to the manifest's own HTTP account.
  - `integrations/ai/ai-call-center-supervisor/manifest.yaml:245-248` —
    `SUPERVISOR_PIN=1` default, pins to the manifest's own HTTP account.
  - `integrations/ai/ai-system-variables/manifest.yaml:229-232` —
    `SYSVARS_PIN=1` default, pins to the manifest's own HTTP account.
  - `integrations/ai/ai-agent-triage/manifest.yaml:212-215` —
    `TRIAGE_PIN=1` default, pins to the manifest's own HTTP account.
  - `integrations/mcp/mcp-repo-support-bot/manifest.yaml:151,275` —
    pins to the manifest's own account (verify exact channel type/name at
    T05 implementation time — this manifest's trigger section needs its own
    read, not assumed identical to the HTTP-triggered siblings).
  Every one of the above declares its own pin-target channel/account IN THE
  SAME MANIFEST, so `{ channelRef: <that name> }` resolves within a single
  apply with no new dependency-order requirement (channels already rank
  first in `RESOURCE_KIND_ORDER`).
- `packages/shared/src/provisioning/manifest.schema.ts`:
  - `SYMBOLIC_REF_KEYS` (lines 58-65) — the six-member tuple T02 (this SPEC)
    extends to seven with `skillRef`.
  - `agentSchema` (lines 409-469) — `profile: z.record(z.string(), z.unknown())`
    stays fully opaque; `catalog_skill_id` lives inside this record's
    substituted-at-apply-time tree, never a typed schema field, mirroring how
    `connectorId`/`provider_connector_id` (gap 2, prior SPEC) also live inside
    opaque `profile`/`ingestion_config` records rather than typed fields.
  - `manifestSpecSchema` (lines 777-793) — the exact section list T01 (this
    SPEC) extends with `skills: z.array(skillSchema).default([])`, placed
    (per decision 4) before `agents` in both the zod object AND the
    corresponding `RESOURCE_KIND_ORDER` entry.
  - `secretScopeKindSchema` (lines 733-741) — the seven-member
    `SecretScopeKind` enum (`channel`/`connector`/`agent`/`service`/
    `systemVariable`/`mcpServer`/`workflow`); per decision 4's PLUMBING
    stance, T01 ADDS `"skill"` here (eighth member) so the
    `ResourceKind = SecretScopeKind` TYPE ALIAS keeps compiling — EXACTLY as
    `systemVariable` (T04) and `mcpServer` (T06) were added before it. The
    accompanying comment mirrors the existing `systemVariable`/`mcpServer`
    comment block (lines 716-732) verbatim in spirit: added for pipeline
    plumbing only, NOT to enable a secret-scope binding.
- `sdk/src/cli/valid-scope-kinds.ts:24-46` and
  `services/provisioning-service/src/modules/secrets/secrets.controller.ts:39-54` —
  the TWO hand-kept `VALID_SCOPE_KINDS` copies, each already carrying a
  `systemVariable`-DELIBERATELY-OMITTED drift-guard block (the CLI copy's is
  the fuller template). T01 adds a parallel `skill`-DELIBERATELY-OMITTED block
  to BOTH, citing the same rationale: `skill` gained the `SecretScopeKind`
  member only so `ResourceKind` could carry it through the generic pipeline;
  no `skillSchema` field is credential-capable, so a skill-scoped binding is
  schema-valid but semantically inert and rejected up front. This is the
  `systemVariable` precedent applied one-for-one.
- `services/provisioning-service/src/modules/plan/domain/plan.interfaces.ts:10`
  — `export type ResourceKind = SecretScopeKind` (a TYPE ALIAS, not a
  separate enum) + `RESOURCE_KIND_ORDER` (currently
  `channel, connector, mcpServer, agent, service, systemVariable, workflow`);
  T01's exact insertion point: `skill` between `mcpServer` and `agent` in
  `RESOURCE_KIND_ORDER`, mirroring the existing `mcpServer`-before-`agent`
  comment's reasoning (agents reference this new kind by id, so it must
  resolve/create first). Because `ResourceKind` is a literal alias of
  `SecretScopeKind`, `skill` becomes a `ResourceKind` member AUTOMATICALLY
  once decision 4 adds it to `secretScopeKindSchema` — the file's header
  comment describing the two as "the SAME union" stays TRUE (they remain
  identical; the divergence is ONLY in the two hand-kept `VALID_SCOPE_KINDS`
  runtime lists, which are a strict SUBSET of the enum by design, exactly as
  they already are for `systemVariable`). No header-comment correction is
  needed — the earlier draft's "diverge the two enums" plan was wrong and is
  dropped.
- `services/provisioning-service/src/modules/plan/lib/desired-fields-of-resource.ts`
  and `services/provisioning-service/src/modules/plan/lib/comparable-fields.ts` —
  the exact "declared vs. live" projection pair every writer needs a case in;
  `provisioning-manifest-gaps-2.md` T07 batch A's LIVE-GATE finding (c)
  proved a missing case here causes a forever-update loop (no case ->
  desired side projects empty). T01/T04 (this SPEC) must add a `skill` case
  to BOTH, projecting the same fields `skills.dto.ts` actually persists
  (verify via `client.skills.list()`'s real response shape — `Skill` in
  `sdk/src/resources/skills/types.ts` — an "honest projection", per the task
  brief, not an assumed one).
- `services/provisioning-service/src/modules/apply/infrastructure/mcp-servers-writer.ts`
  and `agents-writer.ts` — the two closest writer precedents `skills-writer.ts`
  (T04) mirrors: name-based lookup via `list()`, create-or-update, verbose
  logging of every stage, fail-loud on any client error. The update path is a
  normal working call (decision 5 — the historical 500 is fixed), so no
  special-casing is needed.

## Constraints (apply to every task)

- Every new schema field/section is OPTIONAL, defaults to empty/absent, and
  additive — the ELEVEN shipped manifests (decision 2) must keep validating
  and noop-re-applying after every task. Regression-checked in every task's
  Accept block.
- No prune/delete semantics anywhere in this loop — every writer this loop
  adds or extends is create-or-update only.
- Secret VALUES never appear in logs, events, API responses, plan output, the
  database, or the manifest file itself. Automatic reviewer rejection on any
  violation. `skillSchema` carries no secret-capable field per decision 4 —
  any reviewer finding one during implementation is a stop-and-report item,
  not something to silently wire a `secretRef` for without a new decision.
- Verbose logging on every new/extended writer/resolver/validator/walker code
  path; nothing fails silently — this explicitly includes the ARRAY
  substitution path (T03) firing the SAME three fail-loud error kinds
  (`mismatched_symbolic_ref`/`unresolved_symbolic_ref`/`unallowlisted_symbolic_ref`)
  per-element that the scalar path already proves.
- Never weaken, skip, or delete existing tests — automatic reviewer
  rejection. This explicitly includes `substitute-symbolic-refs.test.ts`'s
  existing scalar-allowlist assertions (T03 ADDS array coverage, does not
  touch the existing scalar ones) and `validate-structural-rules.test.ts`'s
  existing assertions. Decision 5's work item touches NO test —
  `sdk/test/e2e/admin-resources.e2e.ts:~100-110` already asserts the
  successful `update()` (fixed 2026-07-05 per its own comment); the work item
  is a doc-comment correction only (`types.ts:33-51` / `client.ts:35-37`).
- All artifacts in English.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — provisioning-service tests (every task)
cd services/provisioning-service && bun test
# G2 — provisioning-service typecheck (every task)
cd services/provisioning-service && bunx tsc -p tsconfig.json --noEmit
# G3 — shared package tests (schema lives in packages/shared, every task)
cd packages/shared && bun test
# G4 — sdk tests (every task, since T01/T02/T03 may touch client method shapes)
cd sdk && bun test
# G5 — REGRESSION: all ELEVEN shipped manifests still validate and
#      noop-re-apply (every task from T01 onward; run against the dev cluster)
for m in integrations/channels/telegram-transform-reply/manifest.yaml \
         integrations/channels/http-fanout-telegram/manifest.yaml \
         integrations/http/hosted-services-api/manifest.yaml \
         integrations/http/http-connectors/manifest.yaml \
         integrations/mcp/mcp-connections/manifest.yaml \
         integrations/mcp/mcp-repo-support-bot/manifest.yaml \
         integrations/ai/ai-agent-playground/manifest.yaml \
         integrations/ai/ai-agent-triage/manifest.yaml \
         integrations/ai/ai-call-center-supervisor/manifest.yaml \
         integrations/ai/ai-knowledge-base-agent/manifest.yaml \
         integrations/ai/ai-system-variables/manifest.yaml; do
  yoizen manifests validate -f "$m"
  yoizen manifests apply    -f "$m" --secrets-from-env
  yoizen manifests apply    -f "$m" --secrets-from-env   # second apply: 0 create / 0 update
done
# G6a — ITERATION (per attempt, source-mounted dev mode)
./dev-mode.sh deps && ./dev-mode.sh provisioning-service on && ./scripts/e2e-manifest-apply.sh
# G6b — COMMIT GATE (once per task, built image)
./dev-mode.sh provisioning-service off && ./rebuild-redeploy.sh provisioning-service dev && ./scripts/e2e-manifest-apply.sh
# G7 — NO IMPERATIVE SETUP LEFT for the migrated sample (T04):
#      must output nothing once the migration commit lands
find integrations/ai/ai-skill-support-agent \( -name 'setup.sh' -o -name 'setup.ts' \) -o -name 'STANDBY.md'
# G8 — FULL CANARY SET, re-run live (T05 here): the same four G8 canaries from
#      provisioning-manifest-gaps-2.md, now including the re-pinned trigger
#      check on whichever canaries have one
for m in integrations/channels/telegram-transform-reply/manifest.yaml \
         integrations/ai/ai-agent-playground/manifest.yaml \
         integrations/http/http-connectors/manifest.yaml \
         integrations/mcp/mcp-connections/manifest.yaml; do
  yoizen manifests validate -f "$m"; yoizen manifests apply -f "$m" --secrets-from-env
done
```

Gate rules: identical to `manual-loops/provisioning-manifest-gaps-2.md`
(inherited). G6a/G6b apply from T01 onward — every task in this loop touches
`provisioning-service`, a real platform service.

PRECONDITION: `./scripts/validate-dev-mode.sh --with-e2e` — check first
whether the KNOWN stage-4/5 internal race documented by both parent SPECs
still reproduces before assuming a NEW failure; if it still reproduces, skip
G6a and rely solely on G6b, same as both parents.

E2E CLEANUP: `scripts/e2e-manifest-apply.sh` (extended per task) provisions
with account-scoped, e2e-prefixed names and tears down what it creates
(trap-guarded, idempotent). The migrated sample's own provisioned resources
(T04) are NOT torn down by the gate — they ARE the sample.

Commits only happen with dev-mode OFF and the built image live (G6b), plus
G1-G5 green.

---

## Task queue

### T01 — `skills` manifest section (schema + planner)

- Add `skillSchema` to `manifest.schema.ts` mirroring `CreateSkillInput`
  field-for-field (decision 4); add `skills: z.array(skillSchema).default([])`
  to `manifestSpecSchema`, placed before `agents`.
- Add `"skill"` to `secretScopeKindSchema` (eighth member, PLUMBING ONLY —
  decision 4) so the `ResourceKind = SecretScopeKind` type alias keeps
  compiling; add the accompanying "pipeline plumbing, not a binding target"
  comment mirroring the existing `systemVariable`/`mcpServer` comment block
  (`manifest.schema.ts:716-732`).
- Add a parallel `skill`-DELIBERATELY-OMITTED drift-guard block to BOTH
  hand-kept `VALID_SCOPE_KINDS` copies — `sdk/src/cli/valid-scope-kinds.ts`
  (mirror its `systemVariable`-omission block line-for-line) and
  `services/provisioning-service/src/modules/secrets/secrets.controller.ts`
  (its sibling block) — WITHOUT adding `skill` to either runtime list
  (decision 4: a skill-scoped binding is inert; the CLI/controller reject it
  up front, exactly like `systemVariable`).
- Add `skill` to `RESOURCE_KIND_ORDER` (`plan.interfaces.ts`), positioned
  before `agent`. Do NOT alter the file's "SAME union" header comment — it
  stays true (the alias is unchanged; only the two `VALID_SCOPE_KINDS` runtime
  subsets omit `skill`, exactly as they already omit `systemVariable`).
- Add a `skill` case to `desired-fields-of-resource.ts` and
  `comparable-fields.ts`, projecting fields honestly against what
  `client.skills.list()` actually returns (`Skill` type) — a MISSING case
  here causes a forever-update loop (`provisioning-manifest-gaps-2.md` T07
  batch A finding (c)).
- Extend `validate-structural-rules.test.ts`/schema tests for the new
  section's presence/defaults AND for the inert-skill-scope rejection (mirror
  the existing `systemVariable`-scope-rejection coverage); confirm
  `checkAtLeastOneProcess`/library-manifest rules from
  `provisioning-manifest-gaps-2.md` T01 are unaffected.

**Accept**
```
cd packages/shared && bun test -t "skill"
cd services/provisioning-service && bun test -t "skill"
cd sdk && bun test -t "scope"      # skill omitted from VALID_SCOPE_KINDS, like systemVariable
# regression: eleven shipped manifests still noop-reapply
```

### T02 — `skillRef` scalar substitution

- Add `skillRef` to `SYMBOLIC_REF_KEYS` (seventh member).
- Add a `catalog_skill_id` -> `skillRef` entry to `SUBSTITUTION_ALLOWLIST`,
  citing the exact `profile.model_config.subagents[].catalog_skill_id` path
  and the runtime consumer (agent-ai-service's subagent-mapping, per
  `setup.ts:550-558`'s documented contract).
- Confirm the PRE-EXISTING agent-`profile` substitution tree walk already
  covers `subagents[]` (an array nested inside `profile`) — if the walker's
  array-recursion (see Prior art) does not reach nested object arrays inside
  an arbitrarily-shaped `profile` record today, fix that gap here as part of
  wiring `skillRef` through, not as a separate task.
- Regression-test: a synthetic agent with `catalog_skill_id: { skillRef: <name> }`
  resolves to a real id at apply; an unresolved/mismatched-kind case fails
  loud through the existing T02-of-gaps-2 error kinds (reused, not
  reimplemented).

**Accept**
```
cd services/provisioning-service && bun test -t "skillRef|catalog_skill_id"
cd packages/shared && bun test -t "skillRef"
# regression: eleven shipped manifests still noop-reapply
```

### T03 — ARRAY symbolic-ref substitution (workstream d)

- Implement the `ARRAY_SUBSTITUTION_ALLOWLIST` design from decision 7 (or a
  cleaner design found during implementation, recorded explicitly if it
  deviates) with its one entry: `accountIds` -> `channelRef`.
- Extend `substitute-symbolic-refs.ts`'s `walk`: before falling through to
  the generic array-recursion branch, check whether the CURRENT key is in
  `ARRAY_SUBSTITUTION_ALLOWLIST` and the value is an array; if so, substitute
  per-element with the same `readRecognizedRefObject`/`resolveRef` logic,
  mixed literal/ref-object arrays legal, per-element fail-loud
  (`mismatched_symbolic_ref`/`unresolved_symbolic_ref`) with the element
  index in the path.
- Extend the `unallowlisted_symbolic_ref` safety-fix check (gap 3,
  `provisioning-manifest-gaps-2.md` T02) to also fire per-element for an
  array of ref-objects at a non-array-allowlisted plural key.
- New unit tests: array-of-ref-objects resolves; mixed array (literal +
  ref-object) resolves the ref-object elements only; wrong-kind element
  fails loud with element index; unresolved element fails loud with element
  index; ref-object array at a non-allowlisted key fails loud
  (`unallowlisted_symbolic_ref`) per-element.
- Regression: the existing SCALAR allowlist tests (accountId, adapterId,
  etc.) are untouched — this task adds coverage, never replaces it.

**Accept**
```
cd services/provisioning-service && bun test -t "ARRAY_SUBSTITUTION|accountIds"
# regression: eleven shipped manifests still noop-reapply
# regression: existing scalar substitution tests still pass unmodified
```

### T04 — `skills` apply-engine writer + migrate `ai-skill-support-agent`

- Add `skills-writer.ts` (`services/provisioning-service/src/modules/apply/infrastructure/`)
  mirroring `mcp-servers-writer.ts`/`agents-writer.ts`'s create-or-update-by-name
  shape: `client.skills.list()` name lookup, `create()` if absent,
  `update()` if present (a normal working call — decision 5; fails loud on
  any client error like every sibling writer). Wire into
  `PlatformResourceWriters`, `RESOURCE_KIND_ORDER`.
- Fold in decision 5's small work item: correct the TWO STALE SDK doc
  comments — `sdk/src/resources/skills/client.ts:35-37`'s `update()` WARNING
  and `sdk/src/resources/skills/types.ts:33-51`'s header narrative (which also
  mis-describes the e2e state) — to record the 500 bug is fixed server-side
  (live-verified 2026-07-05 by the e2e and 2026-07-17 by the orchestrator
  probe, HTTP 200). NO test change (`admin-resources.e2e.ts:~100-110` already
  asserts the successful update). Only if it does not balloon T04 — otherwise
  record it as a tiny standalone follow-up.
- Wire the `skillRef` substitution (T02) to prove it end-to-end: an agent's
  `catalog_skill_id` referencing a manifest-declared skill resolves to the
  real id created by `skills-writer.ts` in the SAME apply.
- Migrate `ai-skill-support-agent`: `manifest.yaml` with a `skills` entry
  (`refund-policy-expert`, verbatim fields from `buildSkillPayload()`), the
  agent's `profile.model_config.subagents[]` entry with `catalog_skill_id: { skillRef: refund-policy-expert }`
  plus the full snapshot fields, the knowledge base
  (`ai-sample-callcenter-kb`) and connector exactly as the sibling `ai`
  samples from `provisioning-manifest-gaps-2.md` T07 batch B already
  migrated (reuse their connector `tags: ["llm"]` fidelity fix). `git rm`
  `setup.sh`/`src/setup.ts`, `git rm` `STANDBY.md`, rewrite README to the CLI
  flow mirroring the sibling `ai` samples' READMEs. One commit (decision 10).
- If the end-state still cannot be expressed after T01-T03 ship: stop and
  escalate — do not approximate.

**Accept**
```
cd services/provisioning-service && bun test -t "skills-writer|skillsWriter"
cd sdk && bun test    # unchanged assertions; the update()-succeeds e2e already passes
ls integrations/*/*/manifest.yaml | wc -l    # == 12
find integrations \( -name 'setup.sh' -o -name 'setup.ts' -o -name 'STANDBY.md' \)   # must output nothing
# regression: eleven PRE-EXISTING shipped manifests still noop-reapply
# live: ai-skill-support-agent manifest applies (create), second apply 0 create/0 update
#       (create-then-noop proves the update-verdict path via name lookup)
```

### T05 — Re-pin the SEVEN migrated triggers + restore the full canary set

- For each of the SEVEN manifests listed in Prior art: add
  `trigger.config.accountIds: [{ channelRef: <its own manifest-created
  channel/account name> }]` (verified per-manifest, not assumed uniform);
  remove the now-false "DEVIATION (reported to the human)" comment, replacing
  it with a short note that the trigger is now properly pinned via ARRAY
  `channelRef` substitution (T03).
- Re-verify `mcp-repo-support-bot`'s trigger section specifically (flagged in
  Prior art as needing its own read, not assumed identical to the
  HTTP-triggered siblings).
- Regression: ALL TWELVE manifests (eleven pre-existing + the new
  `ai-skill-support-agent`) re-apply update-then-noop after the pin change
  (first apply after adding the pin is an UPDATE verdict on the affected
  workflow, second apply is a full noop).
- Run the G8 canary set live (validate + two applies each, 0 create/0 update
  on the second), confirming any canary among the four that also has a
  re-pinned trigger behaves correctly end-to-end.

**Accept**
```
# G8 verbatim (above) — all four canaries validate, apply, and
# a second apply per canary reports 0 create / 0 update
# full regression: all twelve manifests validate + update-then-noop
```

---

- [x] T01 `skills` manifest section (schema + planner)
- [x] T02 `skillRef` scalar substitution
- [x] T03 ARRAY symbolic-ref substitution (workstream d)
- [x] T04 `skills` apply-engine writer + migrate `ai-skill-support-agent`
- [ ] T05 re-pin the seven migrated triggers + restore the full canary set

## Out of scope (explicit)

- Any FURTHER `agent-admin-service` skills-module change beyond the stale-SDK-
  comment correction (decision 5) — the update-500 bug is already fixed
  server-side; this loop only corrects the SDK's stale documentation and test
  assertion, it does not touch `skills.service.ts`.
- Prune/delete semantics for any manifest section — still deferred,
  unchanged by this loop.
- k8s-native `secretKeyRef` service env values
  (`provisioning-manifest-gaps-2.md` T05 ruling deferral) — not revisited
  here.
- Secret-typed `systemVariables`
  (`provisioning-manifest-gaps.md` T04 OPEN human ruling) — not revisited
  here.
- Any NEW resource kind beyond `skills` — a dependency needing a SIXTH kind
  is a stop-and-escalate item, not an invitation to extend scope inline.
- Generalizing `ARRAY_SUBSTITUTION_ALLOWLIST` beyond the one `accountIds`
  entry to other plural keys not yet known to need it — speculative, not
  part of this SPEC's proven need.
- `SkillFileDto`'s `content` field being anything other than an inline
  string (e.g. a file/bundle source like `kbSourceSchema`'s discriminated
  union) — the sample's own skill file is small enough to embed inline
  verbatim; a file/url source variant for skill files is a future follow-up
  if a sample ever needs it.

## Human boundaries for this change

- The pre-approval recorded above (HUMAN RULING 2026-07-17) covers BOTH
  workstreams' SCOPE as described in this SPEC's Goal/decisions — it does
  NOT pre-approve any genuinely NEW decision that surfaces mid-task (e.g. if
  T01 finds a `skillSchema` field IS credential-capable after all, or T03's
  proposed `ARRAY_SUBSTITUTION_ALLOWLIST` design turns out unworkable against
  the real walker code). Any such finding stops and escalates for its own
  ruling, per the inherited boundary from both parent SPECs.
- T04's per-sample migration sign-off mirrors both parents' T07/T08 pattern:
  the human gets an explicit OK on the migration plan before
  `setup.ts`/`STANDBY.md` is deleted.
- Canary env/keys (`OPENAI_API_KEY`, `MCP_AUTH_TOKEN`, per-sample secrets) are
  loaded by the human, as in every prior loop.
- Any dependency that still cannot express its end-state after both
  workstreams ship (T04): stop and ask — do not invent a further gap kind or
  approximate the end-state.
- **End state this SPEC targets**: 12/12 samples migrated (the full set first
  attempted in `provisioning-manifest-gaps.md` T08), zero remaining
  `setup.sh`/`setup.ts`/`STANDBY.md` files under `integrations/`, and the
  seven documented unpinned-trigger deviations closed for real.

## Progress

## Progress

### T01 — 2026-07-17

`skills` section shipped: `skillSchema`/`skillFileSchema` mirror agent-admin's
CreateSkillDto/SkillFileDto field-for-field (mode router/llm_driven/inline;
file types script/reference/asset); `manifestSpecSchema.skills` before
agents. Kind plumbing per the systemVariable precedent: `"skill"` added to
secretScopeKindSchema (alias compiles), EXCLUDED from both VALID_SCOPE_KINDS
copies with drift guards, consumer policy apply-engine-only;
RESOURCE_KIND_ORDER gains skill before agent. Planner wired end-to-end:
skills client (GET /admin/skills {skills,total}), skillComparable with
server-default parity (icon smart_toy / color #42a5f5 / mode llm_driven —
verified against SkillsService.create's SQL defaults, no forever-diff),
desired-fields case + integration test (the gaps-2 mcpServer lesson).
SDK stale-500 comments corrected (doc-only). DEVIATION (reviewer-adjudicated
legitimate): a type-satisfying skills-writer STUB (fail-loud
unsupported_kind_shape, unreachable — no manifest declares skills) was
forced by the total Record<ResourceKind,...> maps; T04 replaces the body.

Gates: G1 388/388, G2/G3/G4 clean (shared 309, sdk 394), G6b revision 00042
+ e2e PASSED, four-canary regression all-noop. Dual review: 2x APPROVED
(attempt 1).

### T02 — 2026-07-17

`skillRef` shipped as the 7th symbolic ref kind: schema alias +
SYMBOLIC_REF_KEYS; `resource-kind-of-ref-type` skillRef→skill (edges via the
generic walk; skill<agent order from T01); SUBSTITUTION_ALLOWLIST +
`catalog_skill_id`→skillRef (source: deleted setup.ts:566 + runtime contract
:550-558, verified verbatim); substitution reaches
model_config.subagents[].catalog_skill_id via the EXISTING array-recursion
branch (test-proven, no walker change). checkRefResolution gains a NEW walk
root over agent.profile validating skillRef ONLY (reviewers traced: other
collected ref kinds are ignored — the five AI manifests' connectorRef in
profile cannot newly error; that pre-existing unvalidated gap stays
documented, untouched). Fail-loud reuses the existing error kinds.

Gates: G1 392/392, shared 314/314, sdk 394, all tsc clean, G6b revision
00043 + e2e PASSED, four-canary regression all-noop. INFRA NOTE: a wedged
workflow-service-api pod (1/2 for 27h) caused transient plan timeouts
mid-gates — recycled, re-verified; not a T02 issue. Dual review: 2x APPROVED
(attempt 1).

### T03 — 2026-07-17

ARRAY substitution shipped: parallel `ARRAY_SUBSTITUTION_ALLOWLIST` (one
entry `accountIds`→channelRef, disjoint from the scalar keys); walk
substitutes per-element at array-allowlisted keys (right-kind ref →
resolved id; wrong kind / unresolved → the existing fail-loud kinds with
`key[index]` in the message, value-free); non-array at an array key → NEW
typed `invalid_array_substitution_shape` (SPEC left it unstated; fail-loud
chosen + documented); the unallowlisted branch extended element-wise with
the secretRef exemption preserved. Deps already sound (generic walk +
channel<workflow order). 11 new tests (report said 12 — reviewer counted;
corrected here). Scalar/T02-parent behavior byte-identical (reviewers
traced both shadowing edge cases).

Gates: G1 403/403 + tsc, shared/sdk untouched, G6b revision 00044 + e2e
PASSED, four-canary regression all-noop. Dual review: 2x APPROVED
(attempt 1).

### T04 — 2026-07-17

Real skills-writer shipped (stub replaced): POST/PATCH /admin/skills
mirroring mcp-servers-writer (guarded parses, fail-loud, value-free logs);
only-when-declared optionals so server defaults win — reviewer-traced
byte-identical to skillComparable's defaults (no forever-diff possible).
FINAL MIGRATION (12/12): `ai-skill-support-agent` → LibraryManifest with the
shared LLM connector, the CATALOG SKILL `refund-policy-expert` (all fields
verbatim from the deleted buildSkillPayload), KB with inline policy doc +
provider_connector_id ref, and the agent with connectorId/knowledgeBaseRefs
+ the full subagent snapshot with catalog_skill_id -> {skillRef}. LIVE:
connector noop + skill CREATE (the first manifest-created catalog skill) +
agent create; second apply FULL NOOP 3/3. Zero setup/STANDBY files remain
repo-wide; 12 manifests validate.

Gates: G1 411/411 + tsc, shared 314, sdk 394, G6b revision 00045 + e2e
PASSED. Dual review: split — one rejection SOLELY for an unrelated stray
`manual-loops-templates/README.md` swept in by staging (not authored by
this task; excluded from the commit, left untracked for the human);
everything else verified APPROVED by both. FOLLOW-UP (style): skills-writer
update() omits the explicit `_diff` param the siblings declare.
