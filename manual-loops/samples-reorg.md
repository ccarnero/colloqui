# SPEC — samples reorg: three-tier examples taxonomy (sdk/examples + integrations + demos)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/declarative-provisioning.md` (shipped 10/10
> — provisioning-service, `IntegrationManifest`, SDK `client.manifests` +
> `client.secrets`; T05 here consumes it).
> SEQUENCING OVERRIDE (user decision 2026-07-15): this loop runs FIRST, BEFORE
> `manual-loops/crm-support-telegram.md` T08 (which was the original
> prerequisite). T07 here rewrites that SPEC's `sdk/samples/*` Prior-art
> citations, so crm T08 runs afterwards against the new paths.
> Origin: user decision 2026-07-14 (Cowork session, taxonomy discussion);
> amended 2026-07-15 (Cowork session): reorganized integrations must provision
> DECLARATIVELY through provisioning-service — this loop absorbs the "after"
> showcase that declarative-provisioning.md deferred.
> Engram topic: 'platform/samples-reorg'.

## Goal

`sdk/samples/` currently mixes one true SDK example with twelve platform
integration examples. Reorganize into three tiers, each with ONE reason to
exist:

1. `sdk/examples/` — examples of the SDK itself (API surface: auth/config,
   per-resource CRUD, `connectors.invoke()` sync/async, pagination, error
   handling). Small, focused, referenced from `sdk/README.md`.
2. `integrations/` (new top level) — end-to-end platform feature references
   (channels, AI, HTTP/connectors, MCP), grouped by category.
3. `demos/` (already exists) — commercial showcases with a business narrative.
   Untouched by this loop.

Additionally (2026-07-15 amendment, hardened same day): setup scripts are
ELIMINATED, not wrapped. Every migratable integration under `integrations/`
provisions exclusively through a `manifest.yaml` (`IntegrationManifest`,
`yoizen.io/v1`) applied via the new SDK CLI (`yoizen manifests apply`) against
provisioning-service; its `setup.sh`/setup `.ts` files are DELETED and the
README documents the CLI commands instead. Samples whose resources exceed the
manifest v1 schema go to STAND-BY (parked untouched, excluded from gates)
until `manual-loops/provisioning-manifest-gaps.md` ships the missing kinds.

After this loop, no doc, script, or index references `sdk/samples/` anymore,
no migrated integration carries imperative setup code, and `integrations/` is
the living "after" showcase of declarative provisioning.

## User decisions (human boundary — do not reinterpret)

1. Three tiers, not two: `sdk/examples/`, `integrations/`, `demos/`.
2. Target mapping (approved 2026-07-14):
   - `integrations/channels/` ← `telegram-transform-reply`,
     `http-fanout-telegram`, plus `telegram-onboard.sh`.
   - `integrations/ai/` ← `ai-agent-playground`, `ai-agent-triage`,
     `ai-call-center-supervisor`, `ai-knowledge-base-agent`,
     `ai-skill-support-agent`, `ai-system-variables`.
   - `integrations/http/` ← `http-connectors`, `hosted-services-api`.
   - `integrations/mcp/` ← `mcp-connections`, `mcp-repo-support-bot`.
   - `integrations/lib/` ← `sdk/samples/lib` (moves with the integrations;
     the SDK tier must not depend on it).
   - `sdk/examples/` ← `http-bridge` (seed, renamed `reference-pattern`).
3. Distinction to document: an integration documents a platform feature; a
   demo tells a business story; an sdk example demonstrates the SDK API.
4. `demos/` is out of this loop's write scope entirely.
5. Delivery method: manual-loop (this SPEC), not SDD.
6. (2026-07-15, hardened) NO hybrid, NO wrappers: a migrated integration has
   ZERO setup `.sh`/`.ts` files — `manifest.yaml` + README CLI instructions
   only. Samples with resource kinds the manifest v1 schema does not support
   (candidates: MCP servers, system variables — T01 produces the real list)
   are NOT migrated: they move to stand-by (decision 8), keeping their
   current scripts untouched until the gap spec ships.
7. (2026-07-15) Where declarative-provisioning documented follow-ups that are
   NOT shipped (connector `authConfig` wiring via broker, LLM credential mode
   as `secretRef`), samples keep their CURRENT credential handling (env vars /
   inline authConfig). Do not invent new mechanisms; do not fix the follow-ups
   inline — escalate.
8. (2026-07-15) Stand-by mechanics: gap samples move to their tier position
   normally in T02 (the reorg is universal) but carry a `STANDBY.md` stating
   why they are not manifest-migrated and linking
   `manual-loops/provisioning-manifest-gaps.md` — the NEW companion SPEC this
   loop authors (T07) to extend manifest v1 with the missing kinds. Stand-by
   samples are excluded from G4/G5.
9. (2026-07-15) Entry point is a minimal CLI added to the SDK (`yoizen` bin):
   `manifests validate|plan|apply -f <file>` and `secrets put` +
   `--secrets-from-env` on apply (secret VALUES from env vars, never the
   repo). This is an explicit, bounded exception to the no-SDK-changes rule
   (T05); it wraps `client.manifests`/`client.secrets`, no new API surface.

## Prior art (validated 2026-07-14 — REUSE, do not duplicate)

- `sdk/samples/README.md` + per-sample `README.md`/`README.es.md` pairs — the
  bilingual doc convention travels with each folder unchanged.
- `sdk/samples/http-bridge/` — the reference TS-SDK wrapper pattern all
  samples mirror; becomes the seed of `sdk/examples/`.
- `manual-loops/crm-support-telegram.md` Prior art section — cites
  `sdk/samples/*` paths that must be rewritten (T05).
- Known referrers of `sdk/samples/` (starting sweep list, NOT exhaustive —
  T01 produces the real map): `sdk/README.md`, `bootstrap-from-scratch.md`,
  `cowork/INDEX.md`, `DOCS/README.md`, per-sample READMEs cross-referencing
  siblings, `scripts/` (e2e and validation scripts), engram memories (noted,
  not editable — new memories will record the new paths).
- Declarative provisioning (shipped, REUSE for T05):
  `packages/shared/src/provisioning/manifest.schema.ts` — supported spec
  sections: `channels`, `connectors`, `agents`, `knowledgeBases`, `services`,
  `workflows`, `secrets` (name+scope bindings only, never values);
  `sdk/src/resources/{manifests,secrets}/` — SDK clients;
  `scripts/e2e-manifest-apply.sh` + `scripts/e2e-manifest-showcase-driver.ts`
  — the plan → apply → noop-re-apply pattern T05 wrappers mirror;
  `services/provisioning-service/README.md` — documented follow-ups that
  BOUND this loop (decision 7).

## Constraints (apply to every task)

- Every move is a `git mv` (history preserved) — never delete+recreate.
- No behavior changes DURING THE MOVE (T02–T04): scripts and code move
  verbatim except for path/import fixes required by the move itself. T06 is
  the ONLY task that touches (deletes) setup scripts, and the migration must
  preserve the provisioned END-STATE exactly (G5 noop re-apply is the proof).
- Each tier root gets a `README.md` stating its one-line reason to exist and
  linking the other two tiers (decision 3's distinction).
- `integrations/lib` relative imports inside moved samples are fixed
  mechanically; `sdk/examples/` must import ONLY `@yoizen/platform-sdk`
  (no shared sample lib).
- All artifacts in English; `README.es.md` files move untouched.
- Verbose logging on any new script; nothing fails silently.
- Never weaken, skip, or delete existing tests — automatic reviewer rejection.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — shell lint over the reorganized trees (from T02 onward)
shellcheck integrations/*/*/*.sh integrations/*/*.sh sdk/examples/*/*.sh
# G2 — stale-path sweep: no live reference to sdk/samples/ outside this SPEC
#      and historical loop specs (from T02 onward; must output nothing)
rg -l "sdk/samples/" --glob '!manual-loops/**' .
# G3 — per-moved-tree typecheck (from T02 onward, each moved sample with a tsconfig)
for d in integrations/*/*/ sdk/examples/*/; do [ -f "$d/tsconfig.json" ] && (cd "$d" && bunx tsc -p tsconfig.json --noEmit) || true; done
# G4 — CANARY E2E: one sample per group runs green against the dev cluster.
#      T04 (post-move, pre-migration): via the samples' original setup scripts.
#      T06 onward (post-migration): via the CLI — for each non-standby canary:
yoizen manifests apply -f integrations/<group>/<canary>/manifest.yaml --secrets-from-env
#      (canary set adjusts if T01 sends one to stand-by — pick the group's
#      next migratable sample; a fully stand-by group drops out of G4 with a
#      note in the progress entry)
# G5 — MANIFEST IDEMPOTENCE (T06 onward): every migrated integration's
#      manifest validates, applies, and a SECOND apply reports noop
#      (plan: 0 create / 0 update). Runs at minimum on the G4 canaries.
for m in integrations/*/*/manifest.yaml; do yoizen manifests validate -f "$m"; done
# G6 — NO IMPERATIVE SETUP LEFT (T06 onward; must output nothing — a setup
#      file may only survive next to a STANDBY.md):
for f in $(find integrations \( -name 'setup.sh' -o -name 'setup.ts' \)); do
  [ -f "$(dirname "$f")/STANDBY.md" ] || echo "LEFTOVER: $f"
done
```

Gate rules OVERRIDE for THIS queue (supersedes the inherited
`manual-loops/trace-console.md` rules): this loop touches NO platform services,
so dev-mode/rebuild-redeploy gates do not apply. Running all 13 setups per task
would be prohibitive: the four canaries in G4 are the cluster gate; the rest is
static (lint, typecheck, stale-path sweep).

PRECONDITION (before T04, once): dev cluster reachable with the samples' usual
env (`OPENAI_API_KEY` for the AI canary); canaries are idempotent by
construction, so re-runs are safe.

Commits only happen with G1-G3 green (G4 too from T04 onward).

---

## Task queue

### T01 — Inventory + reference map (report task, no code)

- Enumerate every file under `sdk/samples/` and classify it against the
  decision-2 mapping (flag anything unmapped, e.g. stray root files).
- Produce the FULL referrer map: every file in the repo containing
  `sdk/samples/` (docs, scripts, code, indexes), with line numbers, and the
  planned rewrite for each.
- PROVISIONING AUDIT (drives T06): for each sample, list every platform
  resource its setup scripts create (kind + how), and classify the SAMPLE as
  MIGRATABLE (every resource fits the manifest v1 spec sections: `channels`,
  `connectors`, `agents`, `knowledgeBases`, `services`, `workflows`,
  `secrets`) or STAND-BY (any resource outside them — decisions 6/8). Flag
  any credential handling that touches the decision-7 follow-ups.
- Record findings verbatim in this SPEC's progress entry (numbered, with
  `rg -n` evidence) — the T02 move script and the T06 migration are driven
  by this map, no guessing.

**Accept**
```
rg -c "sdk/samples/" -g '!manual-loops/**' . | sort
```

### T02 — Move: `git mv` by group + path sweep

- Execute the decision-2 mapping with `git mv` (channels, ai, http, mcp, lib,
  `http-bridge` → `sdk/examples/reference-pattern`).
- Fix relative imports to `integrations/lib` inside moved samples; fix every
  referrer found by T01 (docs, scripts, indexes, cross-README links).
- One commit for the whole move (moves + reference fixes are inseparable —
  splitting them leaves the repo broken between commits).

**Accept**
```
test -d integrations/channels && test -d sdk/examples/reference-pattern && test ! -d sdk/samples
rg -l "sdk/samples/" --glob '!manual-loops/**' . ; test $? -eq 1
```

### T03 — Tier READMEs: the taxonomy made explicit

- `integrations/README.md`: what an integration example is, group index
  (channels/ai/http/mcp), how it differs from `sdk/examples/` and `demos/`.
- `sdk/examples/README.md`: SDK-surface examples only; inventory; the
  no-shared-lib rule.
- Update `demos/README.md` cross-links (read-only elsewhere — decision 4).
- Update `sdk/README.md`: samples section now points at the three tiers.

**Accept**
```
grep -n "integrations" sdk/README.md
grep -n "demos/" integrations/README.md sdk/examples/README.md
```

### T04 — Canary verification against the cluster

- Run the four G4 canaries (one per group) end to end; fix any move-induced
  breakage (paths, imports, env docs) uncovered by real execution.
- Record per-canary results in the progress entry.

**Accept**
```
integrations/channels/telegram-transform-reply/setup.sh
integrations/ai/ai-agent-playground/setup.sh
integrations/http/http-connectors/setup.sh
integrations/mcp/mcp-connections/setup.sh
```

### T05 — SDK CLI: `yoizen manifests` + `yoizen secrets` (decision 9)

- Add a `bin` to `@yoizen/platform-sdk` (`yoizen`): subcommands
  `manifests validate|plan|apply -f <file>` and
  `secrets put <name> --scope <kind>:<owner> --value-env <VAR>`.
- `apply --secrets-from-env`: read the manifest's `secrets` bindings, take
  each VALUE from the same-named env var (fail fast listing missing vars),
  put via `client.secrets`, then apply. Values never touch disk or argv.
- Thin command layer over `client.manifests`/`client.secrets` — NO new SDK
  API surface, no new deps beyond arg parsing; functional style, one command
  per file, Result-based errors, verbose logging.
- Auth/config resolution identical to the SDK client (env vars, same
  precedence). `plan`/`apply` print the per-resource verdict table
  (create/update/noop) — that output is G5's assertion source.
- Unit tests per command (happy + missing-env + invalid manifest).

**Accept**
```
bunx yoizen manifests validate -f scripts/testdata/showcase-manifest.yaml   # or the e2e manifest T09 used
bunx yoizen manifests plan -f <same> | grep -E "create|update|noop"
cd sdk && bun test src/cli
```

### T06 — Manifest migration: delete setup scripts, provision via CLI

- For each MIGRATABLE integration (per the T01 audit), group by group:
  extract the platform resources its setup scripts create into a
  `manifest.yaml` (`IntegrationManifest`), DELETE the setup `.sh`/`.ts`
  files (`git rm`), and rewrite the sample README: prerequisites (env vars),
  then `yoizen manifests apply -f manifest.yaml --secrets-from-env`.
- STAND-BY samples (decision 8): scripts stay untouched; add `STANDBY.md`
  (why + which kinds are missing + link to
  `manual-loops/provisioning-manifest-gaps.md`).
- Re-run the G4 canaries (now CLI-driven) + G5 noop check on every migrated
  manifest + G6 leftover sweep.
- One commit PER GROUP (channels, ai, http, mcp — 4 commits);
  `sdk/examples/reference-pattern` is NOT migrated (it documents the SDK
  wrapper pattern, not platform provisioning).
- Any resource that cannot express its current end-state in manifest v1
  beyond the T01 map: stop and escalate — stand-by is the fallback, never
  approximation.

**Accept**
```
ls integrations/*/*/manifest.yaml | wc -l    # == migratable count per T01 audit
# G5 green on all migrated manifests; G6 outputs nothing
find integrations \( -name 'setup.sh' -o -name 'setup.ts' \) | wc -l   # == stand-by scripts only
```

### T07 — Docs + index + gap SPEC + downstream SPEC fix

- `cowork/INDEX.md` entry for the reorg; refresh `bootstrap-from-scratch.md`
  and `DOCS/README.md` sample references.
- Rewrite the `sdk/samples/*` citations in
  `manual-loops/crm-support-telegram.md` Prior art to the new paths.
- Document the declarative-provisioning usage in `integrations/README.md`
  (manifest.yaml convention, the CLI commands, secrets-from-env rule, what
  STAND-BY means) and link `services/provisioning-service/README.md`; add
  the CLI section to `sdk/README.md`.
- AUTHOR `manual-loops/provisioning-manifest-gaps.md`: the companion SPEC
  extending manifest v1 with the kinds the T01 audit flagged (schema +
  resolver/planner + apply engine + SDK + CLI + migrating the stand-by
  samples and deleting their scripts). Follows this SPEC's template; human
  approves it separately before it ever runs.
- Save an engram memory (topic 'platform/samples-reorg') recording the final
  mapping, per-sample migration status (migrated vs stand-by), and the CLI
  entry point so future sessions resolve old paths.

**Accept**
```
grep -n "samples-reorg" cowork/INDEX.md
grep -n "yoizen manifests apply" integrations/README.md
test -f manual-loops/provisioning-manifest-gaps.md
rg -l "sdk/samples/" manual-loops/crm-support-telegram.md ; test $? -eq 1
```

---

- [ ] T01 inventory + reference map + provisioning audit
- [ ] T02 git mv by group + path sweep
- [ ] T03 tier READMEs
- [ ] T04 canary e2e per group (pre-migration, original scripts)
- [ ] T05 SDK CLI (`yoizen manifests` / `yoizen secrets`)
- [ ] T06 manifest migration (delete setup scripts, CLI-driven provisioning)
- [ ] T07 docs + index + gap SPEC + downstream SPEC fix

## Out of scope (explicit)

- `demos/` content — different loop, different purpose (decision 4).
- Writing NEW `sdk/examples/` snippets (auth, pagination, invoke, errors) —
  follow-up loop once the taxonomy lands; this loop only seeds the tier with
  `reference-pattern`.
- Any change to platform services or admin-console. SDK source changes are
  limited to the T05 CLI (decision 9) — nothing else.
- Extending the manifest v1 schema to new kinds (MCP servers, system
  variables, …): that is `manual-loops/provisioning-manifest-gaps.md`
  (authored in T07, run as its own loop). Gap samples wait in stand-by.
- Fixing the provisioning-service documented follow-ups (connector authConfig
  via broker, secretRef LLM credentials, multipart bundle) — decision 7.
- Renaming individual samples beyond `http-bridge` → `reference-pattern`.
- Editing historical `manual-loops/*.md` specs other than
  `crm-support-telegram.md` — old specs keep their historical paths.

## Human boundaries for this change

- Human approves this SPEC before the first run. (The original "wait for
  crm-support-telegram" precondition was lifted by the 2026-07-15 sequencing
  override — this loop now runs first.)
- The T02 move commit (single, large, mechanical) gets an explicit human OK on
  the T01 reference map BEFORE the move runs.
- The T06 migration gets an explicit human OK on the T01 provisioning audit
  (MIGRATABLE vs STAND-BY per sample) BEFORE the first script is deleted.
- `manual-loops/provisioning-manifest-gaps.md` (authored in T07) needs its
  own human approval before it ever runs — authoring it here does not
  authorize executing it.
- Any unmapped file discovered by T01 (not covered by decision 2): stop and
  ask, do not guess its tier.
- Canary env/keys are loaded by the human, as in the samples' own docs;
  secret VALUES only ever travel env → `client.secrets`, never the repo.
