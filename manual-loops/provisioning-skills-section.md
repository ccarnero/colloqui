# SPEC — Manifest `skills` section: the fifth resource kind

> **SUPERSEDED AT AUTHORING (2026-07-31).** Every deliverable in this SPEC had
> already shipped on 2026-07-17 as `manual-loops/provisioning-manifest-gaps-3.md`
> T01-T05 (commit `00ec5487`, "gaps-3 T04 skills writer and
> ai-skill-support-agent final migration"). Verified at implementation time:
> the `skills[]` schema section (`packages/shared/src/provisioning/manifest.schema.ts:941`,
> `skillSchema` `:450-467`), `skillRef` in the substitution allowlist (`:63`, `:72`),
> the writer (`services/provisioning-service/src/modules/apply/infrastructure/skills-writer.ts`),
> the `case "skill"` comparable (`plan/lib/desired-fields-of-resource.ts:51-52`),
> the SDK surface (`sdk/src/infrastructure/create-client.ts:72`), and the migrated
> sample (`integrations/ai/ai-skill-support-agent/manifest.yaml:53,244-245`) with
> no `STANDBY.md` left in the repo.
>
> Kept, not deleted: this is the record of the decision round gaps-2 decision 10
> required, of the human approval that granted it, and of this adjudication.
>
> ROOT CAUSE: authored from gaps-2's escalation text without running `git log`
> on the sample directory, so a record that was true on 2026-07-17 was read as
> still-open on 2026-07-31. Cheap prevention: before scoping a SPEC from another
> loop's open item, `git log --oneline -- <the artifact the item names>`.

> Task queue for the `/manual-loop` command. One task at a time, gated by
> tests and dual review.
> Depends on: `manual-loops/provisioning-manifest-gaps-2.md` (shipped; its
> T07 batch B escalated `ai-skill-support-agent` as needing exactly this —
> decision 10 required a human decision round, granted 2026-07-31
> ("adelante con todo", pending-items queue item 7).
> Origin: gaps-2 T07 escalation (2026-07-17) + human approval 2026-07-31.
> Engram topic: 'platform/provisioning-skills-section'.

## Goal

`IntegrationManifest` (and `LibraryManifest` where applicable) can declare
catalog **skills** — the resource `ai-skill-support-agent`'s deleted
`setup.ts` provisioned via `client.skills` — and agents can reference them
(`catalog_skill_id`). End state: the LAST stand-by sample migrates
(`setup.sh`/`src/setup.ts` and `STANDBY.md` deleted, `manifest.yaml` +
CLI-driven README in their place), completing the 12-sample declarative set,
with the full G8 canary set still green.

## User decisions (human boundary — do not reinterpret)

1. (2026-07-31) The fifth resource kind is APPROVED — this SPEC is the
   decision round gaps-2 decision 10 demanded.
2. Additive-only schema evolution (carried from the parent SPECs): every new
   key optional; zero existing manifests change meaning.
3. One commit per task; the sample migration is its own commit (parent
   decision 9 carried over).
4. Prior-art rules carry over verbatim: substitution allowlist discipline
   (gaps-2 T02 safety fix — ref-shaped objects at non-allowlisted keys fail
   loud), real-ID substitution via `<kind>Ref` (parent T03), name-based
   idempotency, apply-engine verdict model (create/update/noop), structural
   validator additivity (gaps-2 T01 LibraryManifest rules).

## Prior art (REUSE, do not duplicate — repeat citations inside tasks)

- The escalation record: `manual-loops/provisioning-manifest-gaps-2.md`
  T07 batch B ("ESCALATED... needs a `skills` manifest section (catalog
  Skill via client.skills + agent catalog_skill_id)"); the sample's
  `STANDBY.md` carries the citations (verify at implementation).
- The sample: `sdk/samples/ai-skill-support-agent/` (setup.sh, src/setup.ts
  via git if deleted, STANDBY.md, README, policy asset).
- The sixth-kind precedent to mirror END TO END: `mcpServers` (gaps T06) —
  schema key, writer, comparable/desired-fields, substitution, secretRef
  handling, SDK/CLI surface, VALID_SCOPE_KINDS, secretResourceName casing
  (the T07-batch-A live-gate fixes list every hand-kept registry that must
  gain the new kind: secrets.controller VALID_SCOPE_KINDS,
  `desired-fields-of-resource.ts`, comparable projections).
- Skills API: agent-admin-service `skills` module (controller/service/DTO)
  + SDK `client.skills` (verify surface; agent-admin README documents the
  endpoints since docs-consistency T02).
- Gates/scripts: `scripts/e2e-manifest-apply.sh`; the G8 canary set
  (channels/ai/http/mcp per gaps-2 T08).

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests. Every fix/feature lands
  with red-first regression tests.
- Additive-only: existing manifests re-validate and re-apply all-noop.
- Verbose logging; nothing fails silently; fire-and-forget/causal untouched.
- Anchor-sweep discipline (post-LAST-edit, symbol-aware) on every doc edit.
- Touched: provisioning-service, packages/shared (manifest schema),
  sdk, agent-admin-service READ-only (its skills API is consumed, not
  changed — if it must change, STOP: human boundary), the sample dir,
  SCHEMAS/TAXONOMY/docs as rippled. English.

## Gates (run verbatim, in order)

```
# G1 — provisioning-service tests (every attempt)
cd services/provisioning-service && bun test
# G2 — provisioning-service typecheck (every attempt)
cd services/provisioning-service && bunx tsc -p tsconfig.json --noEmit
# G3 — shared package tests (every attempt)
cd packages/shared && bun test
# G4 — sdk tests (every attempt)
cd sdk && bun test
# G5 — REGRESSION: the four G8 canaries validate + double-apply all-noop
for m in integrations/channels/telegram-transform-reply/manifest.yaml \
         integrations/ai/ai-agent-playground/manifest.yaml \
         integrations/http/http-connectors/manifest.yaml \
         integrations/mcp/mcp-connections/manifest.yaml; do
  yoizen manifests validate -f "$m"
  yoizen manifests apply    -f "$m" --secrets-from-env
  yoizen manifests apply    -f "$m" --secrets-from-env
done
# G6b — COMMIT GATE (once per task, built image)
./rebuild-redeploy.sh provisioning-service dev && ./scripts/e2e-manifest-apply.sh
```

(Verify canary paths at run time — if a canary lives elsewhere, correct the
path as a dated accept note, intent unchanged.)

---

## Task queue

### T01 — `skills` schema + writer + substitution + validator + SDK

- Mirror the `mcpServers` sixth-kind precedent end to end: schema key
  (`skills[]` — fields per what the deleted setup.ts actually sent to
  `client.skills`), skills-writer (create/update by name, PATCH semantics
  per the agent-admin API), comparable + `desired-fields-of-resource.ts`
  case, substitution (`skillRef` for `catalog_skill_id` on agents — join
  the SUBSTITUTION_ALLOWLIST; ref-shape fail-loud already guards the rest),
  VALID_SCOPE_KINDS + secretResourceName IF skills carry secrets (verify —
  if the API has no secret fields, state so and skip), SDK/CLI surface.
- Red-first unit tests per piece; existing manifests unaffected (additive).

**Accept**
```
cd services/provisioning-service && bun test && bunx tsc -p tsconfig.json --noEmit
rg -n "skills" services/provisioning-service/src/lib 2>/dev/null || rg -n "skillRef|skills" services/provisioning-service/src | head -5
```

### T02 — Migrate `ai-skill-support-agent`

- Extract the manifest (skills + agent with `skillRef` + channel/workflow
  per the deleted setup), `git rm` setup files + STANDBY.md, README to the
  CLI flow (telegram-transform-reply structure). Live: first apply
  creates, second apply FULL NOOP. One commit.

**Accept**
```
ls integrations/*/ai-skill-support-agent/manifest.yaml
find integrations sdk/samples -name "STANDBY.md" | wc -l | tr -d ' ' | grep -x 0
```
(Verify the sample's target group dir at run time; correct path as dated
note if needed.)

### T03 — Docs + closeout

- SCHEMAS.md manifest section, provisioning README, gaps-2 SPEC closure
  note (T07 9/9 via this SPEC), `cowork/INDEX.md` entry, Engram topic.

**Accept**
```
grep -n "provisioning-skills-section" cowork/INDEX.md
```

## Progress

- [x] T01 schema + writer + substitution + validator + SDK (already shipped, gaps-3 T01-T04)
- [x] T02 sample migration (already shipped, gaps-3 T04 — `00ec5487`)
- [x] T03 docs + closeout (verified 2026-07-31: provisioning README already
  documents `skills`/`skillRef`; `cowork/INDEX.md:363-364` already records the
  12/12 end state; SCHEMAS.md documents no manifest sections at all, so it has
  nothing to extend — no genuine gap found)

## Out of scope (explicit)

- Any agent-admin-service skills-API change (STOP if needed).
- Prune/delete semantics (still deferred, all parents).
- The other deferred parent items (secret systemVariables, k8s secretKeyRef
  env values, accountIds pinning).

## Human boundaries

- This SPEC = the granted decision round; further kinds need a new one.
- Any agent-admin API change.
- If the deleted setup.ts's skill payload cannot be expressed additively,
  STOP and report.
