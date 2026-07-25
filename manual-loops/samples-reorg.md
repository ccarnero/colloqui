# SPEC — samples reorg: three-tier examples taxonomy (sdk/examples + integrations + demos)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/declarative-provisioning.md` (shipped 10/10
> — provisioning-service, `IntegrationManifest`, SDK `client.manifests` +
> `client.secrets`; T05 here consumes it).
> SEQUENCING OVERRIDE (user decision 2026-07-15): this loop runs FIRST, BEFORE
> `manual-loops/demos/crm-support-telegram.md` T08 (which was the original
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
- `manual-loops/demos/crm-support-telegram.md` Prior art section — cites
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
  `manual-loops/demos/crm-support-telegram.md` Prior art to the new paths.
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
rg -l "sdk/samples/" manual-loops/demos/crm-support-telegram.md ; test $? -eq 1
```

---

- [x] T01 inventory + reference map + provisioning audit
- [x] T02 git mv by group + path sweep
- [x] T03 tier READMEs
- [x] T04 canary e2e per group (pre-migration, original scripts)
- [x] T05 SDK CLI (`yoizen manifests` / `yoizen secrets`)
- [x] T06 manifest migration (delete setup scripts, CLI-driven provisioning)
- [x] T07 docs + index + gap SPEC + downstream SPEC fix

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

## Progress

### T01 — 2026-07-15

**1. Inventory of `sdk/samples/` vs decision-2 mapping**

`fd . sdk/samples -t f | sort` (94 files) classifies cleanly against decision 2,
except three root-level files (finding 8):

| Group (decision 2) | Sample dirs (all files inside move as a unit) |
| --- | --- |
| `integrations/channels/` | `telegram-transform-reply/`, `http-fanout-telegram/`, `telegram-onboard.sh` |
| `integrations/ai/` | `ai-agent-playground/`, `ai-agent-triage/`, `ai-call-center-supervisor/`, `ai-knowledge-base-agent/`, `ai-skill-support-agent/`, `ai-system-variables/` |
| `integrations/http/` | `http-connectors/`, `hosted-services-api/` |
| `integrations/mcp/` | `mcp-connections/`, `mcp-repo-support-bot/` |
| `integrations/lib/` | `lib/resolve-env.sh` |
| `sdk/examples/reference-pattern/` | `http-bridge/` |

13 sample directories total (12 platform integrations + `http-bridge`), matching
the Goal section's "one true SDK example with twelve platform integration
examples."

**2. Unmapped files (decision-2 gap — flagged per human-boundary rule "stop and
ask, do not guess its tier")**

```
$ fd . sdk/samples -t f | rg -v "^sdk/samples/(ai-agent-playground|ai-agent-triage|ai-call-center-supervisor|ai-knowledge-base-agent|ai-skill-support-agent|ai-system-variables|hosted-services-api|http-bridge|http-connectors|http-fanout-telegram|mcp-connections|mcp-repo-support-bot|telegram-transform-reply|lib)/"
sdk/samples/README.md
sdk/samples/telegram-onboard.sh
$ fd -H . sdk/samples -d 1 -t f
sdk/samples/.gitignore
sdk/samples/README.md
sdk/samples/telegram-onboard.sh
```

- `sdk/samples/telegram-onboard.sh` — decision 2 explicitly assigns this to
  `integrations/channels/` (named in the mapping text), so this one IS mapped;
  listed here only because `fd`'s directory-based filter above doesn't match
  loose root files. No action needed — moves per decision 2.
- `sdk/samples/README.md` — **unmapped**. Decision 2 does not name a
  destination for the tier-level index file. T03 supersedes its content with
  `integrations/README.md` + `sdk/examples/README.md`, but decision 2 itself
  says nothing about deleting vs. redirecting it. STOP-AND-ASK item per the
  human-boundaries rule; recommend `git rm` in T02 once T03's replacement
  READMEs exist (content-wise it is fully superseded, not moved), but this is
  a human decision, not T01's to make.
- `sdk/samples/.gitignore` — **unmapped**. Ignores `.env`, `**/.env`,
  `.telegram-chat-id` for the sample run scripts. Not named in decision 2.
  Recommend `git mv` to `integrations/.gitignore` (same ignore patterns apply
  to the moved trees) in T02, folded into the same commit — but flagging here
  per the stop-and-ask rule since decision 2 is silent on it.

**3. Full referrer map** (every file outside `manual-loops/**` containing
`sdk/samples/`; the T01 Accept command run verbatim)

```
$ rg -c "sdk/samples/" -g '!manual-loops/**' . | sort
```
90 files match the T01 Accept command (below, grouped 3a/3b/3c; full per-line
evidence via `rg -n` for each file is available by group — the summary above is
the literal Accept-command output).

IMPORTANT (attempt-2 correction): the Accept command uses PLAIN `rg`, which by
default SKIPS hidden directories. Six additional git-tracked referrer files live
under the hidden `.sdd/` directory and do NOT appear in the Accept output above —
they are enumerated in **3d** below. The "90 files" count is the Accept-command
result; the TRUE total including hidden-dir referrers is **96 files** (90 + 6).

*3a. Referrers OUTSIDE `sdk/samples/` (need a path rewrite in T02/T07; not
part of the move itself):*

| File | Lines (rg -n) | Planned rewrite |
| --- | --- | --- |
| `bootstrap-from-scratch.md` | 33,38,46,51,56,62,72,77,92,97,104,111 (12 hits) | Rewrite each `cd sdk/samples/<x>` / `.env` path to `integrations/<group>/<x>/` or `sdk/examples/reference-pattern/` (T07) |
| `cowork/DEBUG-fanout-telegram.md` | 8,62,83 | Historical debug note — rewrite live paths (`http-fanout-telegram`, `lib/resolve-env.sh`, `telegram-onboard.sh`) to `integrations/channels/...` (T07); this is NOT a `manual-loops/*` file so it is in-scope for G2 |
| `cowork/DOC-VS-CODE-AUDIT.md` | 43,108 | References `sdk/samples/README.md` as a pending-commit item; once T01/T02 land, this becomes historical — rewrite path or annotate as superseded (T07) |
| `cowork/SDK-http-sdk.md` | 147,168 | `sdk/samples/http-bridge` → `sdk/examples/reference-pattern`; `sdk/samples/README.md` reference drops (superseded) (T07) |
| `cowork/SESSION-HANDOFF.md` | 38,42 | `telegram-transform-reply` → `integrations/channels/...`; `http-connectors` → `integrations/http/...` (T07) |
| `demos/README.md` | 5 | `sdk/samples/` mention (contrast with demos) → keep the *concept* reference but repoint to `integrations/` per decision 3's distinction (T07; demos content itself is out of scope per decision 4, but this cross-link line is a referrer, not demo content) |
| `demos/crm-support-telegram/*` (19 files, verified `rg -l "sdk/samples/" demos/crm-support-telegram/ \| wc -l` → 19: four `01..04-*.sh`, `lib/resolve-demo-env.sh`, `priority-scorer/Dockerfile`, `README.md`, `run.sh`, `setup.sh`, six `src/01..06-*.ts`, four `src/lib/{fail,logging,require-env,run-stage}.ts` = 4+1+1+1+1+1+6+4) | see raw `rg -n` output captured below | All are **comments/doc citations** pointing at the sample they were adapted from (`http-bridge`, `http-connectors`, `ai-knowledge-base-agent`, `ai-skill-support-agent`, `ai-system-variables`, `hosted-services-api`, `ai-call-center-supervisor`, `telegram-transform-reply`, `lib/resolve-env.sh`, `ai-agent-playground`) plus one live `.env`-resolution path list in `lib/resolve-demo-env.sh`. Demo CONTENT is out of scope (decision 4) but these are referrer citations in comments/paths — rewrite to new `integrations/...` paths in T07 (crm-support-telegram.md's own Prior-art citations are T07's explicit job per the SPEC header; these source comments are the same category of citation) |
| `sdk/GROWTH-PLAN.md` | 46,86,88,130,132 | Historical growth-plan status entries citing `sdk/samples/README.md` and the migration plan — rewrite live paths, leave historical status prose intact (T07) |
| `sdk/test/e2e/agents.e2e.ts` | 13,14 | Doc-comment citing `ai-agent-playground/setup.sh`, `ai-agent-triage/setup.sh` → rewrite to `integrations/ai/...` (T02, mechanical, since this is a code comment in a moving-adjacent file) |
| `sdk/test/e2e/http-ingest.e2e.ts` | 26 | Doc-comment citing `lib/resolve-env.sh` → rewrite to `integrations/lib/resolve-env.sh` (T02) |
| `sdk/test/e2e/README.md` | 19 | Same rewrite as above (T02) |
| `services/admin-console/src/app/features/channels/channels.component.ts` | 72 | UI copy: `<span class="mono">sdk/samples/http-bridge</span> example.` → `sdk/examples/reference-pattern` (T07; touches a platform service file, flagged for explicit review since this loop's constraints say "no platform services" for GATES, but this is a doc-string edit, not a service behavior change) |

*3b. Internal referrers (inside `sdk/samples/`, moving with their own
sample — path text becomes stale only because it's a self-reference to the
sample's own dirname; fixed mechanically as part of the same `git mv` in T02,
zero cross-sample coupling):* every per-sample `README.md`/`README.es.md`
`cd sdk/samples/<name>` snippet, every `run.sh`/`setup.sh`
`echo "... (see sdk/samples/<name>/README.md) ..."` line, and self-referential
doc-comments in each sample's own `src/setup.ts` (e.g.
`ai-agent-playground/src/setup.ts:66`, `ai-system-variables/src/setup.ts:347,353,359,97`,
`mcp-connections/src/setup.ts:93,114`, `mcp-repo-support-bot/src/setup.ts:106,716,726`).
Full per-file list: `ai-agent-playground` (5), `ai-agent-triage` (5),
`ai-call-center-supervisor` (6), `ai-knowledge-base-agent` (4),
`ai-skill-support-agent` (5), `ai-system-variables` (6), `hosted-services-api`
(4), `http-bridge` (4), `http-connectors` (4), `http-fanout-telegram` (4),
`mcp-connections` (6), `mcp-repo-support-bot` (6), `telegram-transform-reply`
(5) — matches the per-file `rg -c` counts from the Accept command above.

*3c. `sdk/samples/README.md` itself* — 13 hits (all internal `cd sdk/samples/<x>`
snippets), superseded per finding 2, not rewritten in place.

*3d. HIDDEN-DIRECTORY referrers under `.sdd/` (missed by the Accept command's
plain `rg`; surfaced with `rg --hidden`).* These are git-tracked (`git ls-files
.sdd/changes/...` lists all seven files across the two changes) SDD change
artifacts. 6 files, 16 hits total:

```
$ rg --hidden -n "sdk/samples/" .sdd/changes/telegram-channel-instances/ .sdd/changes/http-channel-instances/
.sdd/changes/telegram-channel-instances/design.md:5
.sdd/changes/telegram-channel-instances/adr.md:79,80
.sdd/changes/telegram-channel-instances/tasks.md:3,9,37,69,106,156,208
.sdd/changes/telegram-channel-instances/archive.md:24,25
.sdd/changes/http-channel-instances/design.md:82
.sdd/changes/http-channel-instances/tasks.md:21,27,49
```

All 16 hits cite `sdk/samples/telegram-transform-reply/{setup.sh,README.md}`
(14) or `sdk/samples/http-fanout-telegram/setup.sh` (3 — one overlaps in
`tasks.md`). They are SDD change artifacts documenting a past change to those
samples.

**Closure status verified PER CHANGE (attempt-3 correction — NOT a blanket
`archive.md` claim):**
```
$ fd . .sdd/changes/telegram-channel-instances --hidden -t f
adr.md  archive.md  design.md  tasks.md
$ fd . .sdd/changes/http-channel-instances --hidden -t f
adr.md  design.md  tasks.md          # <-- NO archive.md
$ rg -n "status|Status|COMPLETE|DONE|closed|Closed|^- \[" .sdd/changes/http-channel-instances/tasks.md
(no output — no closure/status marker and no task checkboxes)
$ git log --oneline -5 -- .sdd/changes/http-channel-instances/
2778af7a fix: metrics, remove fake data in processes, connections and channels
```
- `telegram-channel-instances` — **CLOSED**: carries `archive.md` (the SDK
  archive artifact). Historical record; safe to treat as such.
- `http-channel-instances` — **CLOSURE UNVERIFIED**: has NO `archive.md`, no
  status/closure marker in `tasks.md`/`design.md`, and no task checkboxes to
  infer completion from. Git history shows only an unrelated commit touching
  the directory. Its "historical" status therefore CANNOT be asserted from the
  artifacts; it may be an in-flight or abandoned SDD change.

**Disposition (explicit — no guessing).** One fact is firm; the closure
asymmetry keeps this a stop-and-ask item:

1. **G2 does NOT see either change.** G2 runs
   `rg -l "sdk/samples/" --glob '!manual-loops/**' .` from the repo root —
   PLAIN `rg`, which skips hidden dirs. Verified:
   ```
   $ rg -l "sdk/samples/" --glob '!manual-loops/**' . | rg "\.sdd"
   (no output — plain rg skips .sdd when scanning `.`)
   ```
   (`rg` only descends into `.sdd/` when the path is named EXPLICITLY, as in the
   `rg --hidden` command above; the G2 sweep never names it, so these files can
   NEVER trip G2 as written.) Reviewer-2's claim that they "will trip G2's
   stale-path sweep after T02" is therefore not borne out by G2's literal
   command — but they ARE real git-tracked referrers, so they belong in this
   map regardless of closure status.
2. **Closure is asymmetric** (verified above): only `telegram-channel-instances`
   is provably closed; `http-channel-instances`'s status is unverified.

RECOMMENDATION: treat `.sdd/changes/telegram-channel-instances/*` as a
HISTORICAL closed-change record (leave its paths untouched, like old
`manual-loops/*` specs). For `.sdd/changes/http-channel-instances/*`, do NOT
assume closure — flag it as a **stop-and-ask escalation** (see finding 8): the
human must state whether it is closed history (leave untouched) or an active
change (in which case its `sdk/samples/http-fanout-telegram/setup.sh` citations
should be rewritten to `integrations/channels/http-fanout-telegram/` when its
change runs). Either way G2 stays green (hidden dir), so there is no gate
pressure forcing the decision at T02 — but the map records the true state
honestly rather than assuming both are closed. If a rewrite IS wanted, it is
mechanical: 2 sample dirs → `integrations/channels/telegram-transform-reply/`
and `integrations/channels/http-fanout-telegram/`.

*3d (completeness check).* Re-ran the referrer sweep WITH hidden paths to prove
`.sdd/` was the ONLY hidden-dir source missed:
```
$ rg --hidden -l "sdk/samples/" -g '!manual-loops/**' .
```
The only hidden-path hits are the six `.sdd/changes/...` files above; every other
line of that output is already covered by 3a/3b/3c (the `.env.example` files that
appear are NOT referrers — they are sample-local env templates that `rg --hidden`
lists as siblings, not `sdk/samples/`-string matches; re-verified per-file). No
other hidden directory (`.git` excluded by rg's ignore rules; `.claude`,
`.ywai`, etc.) contains a `sdk/samples/` referrer.

**4. Cross-check on the Prior-art section's "starting sweep list" (line 94-98)**
— it names `sdk/README.md`, `cowork/INDEX.md`, `DOCS/README.md`, and generic
`scripts/` as referrers. Verified NONE of them currently reference
`sdk/samples/` (or even the word "samples"):
```
$ rg -n "sdk/samples" cowork/INDEX.md DOCS/README.md sdk/README.md
(no output)
$ rg -n "samples" cowork/INDEX.md DOCS/README.md sdk/README.md
(no output)
```
T07's tasks against these three files (index entry, doc refresh, CLI section)
are therefore NEW ADDITIONS, not rewrites of stale paths — the Prior-art list
was aspirational/stale on this point. No G2 risk from these three files today.

**5. Provisioning audit (drives T06 — MIGRATABLE vs STAND-BY)**

Manifest v1 sections (`packages/shared/src/provisioning/manifest.schema.ts`):
`channels`, `connectors`, `agents`, `knowledgeBases`, `services` (name +
`image`/`buildRef` REFERENCE + `env` only — no port/scaling/routing fields),
`workflows`, `secrets` (name+scope bindings only). No `mcpServers` section, no
`systemVariables` section, no route/HTTP-routing concept anywhere in the
schema (`rg -n "route|Route" packages/shared/src/provisioning/manifest.schema.ts`
→ no output).

| Sample | Resources created (kind + how) | Classification | Notes |
| --- | --- | --- | --- |
| `telegram-transform-reply` | `client.channels` create/list/removeAccount (telegram inbound) L179,232; `client.workflows.create` L334 | **MIGRATABLE** | fits `channels`+`workflows` |
| `http-fanout-telegram` | `client.channels` create/list/removeAccount (http) L175,213,271; `client.workflows.create` L402; `client.connectors.list` L159 (READ-ONLY lookup of an existing connector by name — cross-sample dependency on `http-connectors`, not a create) | **MIGRATABLE** | manifest must declare the external connector via `connectors: [{ name: ..., external: true }]` or equivalent symbolic ref; no new resource kind needed |
| `ai-agent-playground` | `client.agents.create` L346 | **MIGRATABLE** | agent only |
| `ai-agent-triage` | `client.agents.create` L468; `client.workflows.create` L933; `client.channels.listAccounts` L493,750 (READ-ONLY) | **MIGRATABLE** | fits `agents`+`workflows` |
| `ai-call-center-supervisor` | `client.connectors.create` L554; `client.agents.create` L633; `client.workflows.create` L1047 | **MIGRATABLE** | fits `connectors`+`agents`+`workflows`; connector `authConfig: { bearerToken: apiKey }` at L545 — decision-7 flag (see finding 6) |
| `ai-knowledge-base-agent` | `client.connectors.create` L310; `client.knowledgeBases.create` L366; `client.agents.create` L529 | **MIGRATABLE** | fits `connectors`+`knowledgeBases`+`agents`; connector `authConfig: { bearerToken: apiKey }` L301 — decision-7 flag |
| `ai-skill-support-agent` | `client.connectors.create` L301; `client.knowledgeBases.create` L450; `client.agents.create` L619 | **MIGRATABLE** | same shape as above; `authConfig: { bearerToken: apiKey }` L292 — decision-7 flag |
| `ai-system-variables` | `client.agents.create` L489; `client.workflows.create` L755; `client.systemVariables.list/update` L287,306 | **STAND-BY** | `systemVariables` has NO manifest v1 section (anticipated in decision 6) |
| `hosted-services-api` | `client.registry.services.create/update` L246,234 (fields: `image`,`port`,`minScale`,`maxScale`,`concurrencyTarget`,`envVars` — L200-206); `client.registry.routes.create` L295 (`pathPrefix`,`methods`,`isPublic`,`stripPrefix`); `client.workflows.create` L502; `client.channels.listAccounts` L318,445 (READ-ONLY) | **STAND-BY (NEW finding, not one of the SPEC's anticipated candidates)** | manifest v1 `services` section is a REFERENCE only (`name`+`image`/`buildRef`+`env`) — it has NO `port`/`minScale`/`maxScale`/`concurrencyTarget` fields, and there is NO route/HTTP-routing concept anywhere in manifest v1 (`rg -n "route\|Route"` on the schema → zero hits). This sample's actual provisioned state (scaling knobs + a routed path) cannot be expressed in manifest v1 today — decision 6/8 stand-by, same as the MCP/system-variables gaps but a distinct gap kind (routing + scaling, not a whole missing section) |
| `http-connectors` | `client.connectors.create/update/addEndpoint` L266,237,205 | **MIGRATABLE** | fits `connectors`; per-connector JSON config files (`connectors/*.json`) map to the `config` field |
| `mcp-connections` | `client.mcpServers.create/update/remove/testConnection/listTools` L247,238,211,263,287; `client.agents.create` L335 | **STAND-BY** | `mcpServers` has NO manifest v1 section (anticipated in decision 6); auth: `authConfig: { token: MCP_AUTH_TOKEN }` L225, `MCP_AUTH_TOKEN` from env — decision-7 flag |
| `mcp-repo-support-bot` | `client.mcpServers.create/update/remove/testConnection/listTools` L528,519,493,544,561; `client.agents.create` L689; `client.workflows.create` L986; `client.channels.listAccounts` L741 (READ-ONLY) | **STAND-BY** | same `mcpServers` gap; two `authConfig: { bearerToken: apiKey }` L614,635 — decision-7 flag |
| `http-bridge` | `client.channels.create/list/removeAccount` L164,182,199,425; `client.workflows.create` L555 | **N/A — not migrated** | becomes `sdk/examples/reference-pattern` per decision 2/T06 explicit exclusion; not part of the MIGRATABLE/STAND-BY count |

**MIGRATABLE: 8** (`telegram-transform-reply`, `http-fanout-telegram`,
`ai-agent-playground`, `ai-agent-triage`, `ai-call-center-supervisor`,
`ai-knowledge-base-agent`, `ai-skill-support-agent`, `http-connectors`).
**STAND-BY: 4** (`ai-system-variables`, `hosted-services-api`,
`mcp-connections`, `mcp-repo-support-bot`). 8 + 4 + `http-bridge` = 13,
consistent with the Goal section's count.

**6. Decision-7 credential-handling flags** (connector `authConfig` wiring via
broker, LLM credential mode as `secretRef` — both documented-but-unshipped
follow-ups; samples keep CURRENT handling per decision 7, no inline fixes):

```
$ rg -n "authConfig|process\.env\." sdk/samples/{http-connectors,ai-call-center-supervisor,ai-knowledge-base-agent,ai-skill-support-agent,mcp-connections,mcp-repo-support-bot}/src/setup.ts | rg -i "authConfig|apiKey|token|OPENAI"
```
- Connector `authConfig` is set INLINE at create time from env vars/plaintext
  bearer tokens in `ai-call-center-supervisor:545`,
  `ai-knowledge-base-agent:301`, `ai-skill-support-agent:292`,
  `mcp-connections:225` (`MCP_AUTH_TOKEN`), `mcp-repo-support-bot:614,635` —
  none use the broker/`secretRef` mechanism (not shipped). Keep as-is.
- LLM/agent provider credentials read directly from
  `process.env.OPENAI_API_KEY` in `ai-skill-support-agent:244`,
  `ai-knowledge-base-agent:253`, and via `AI_AGENT_PROVIDER`/implicit
  `OPENAI_API_KEY` in `ai-agent-playground`, `ai-agent-triage`,
  `ai-call-center-supervisor`, `mcp-connections`, `mcp-repo-support-bot` — no
  `secretRef` LLM credential mode exists yet (not shipped). Keep as-is; T06
  manifests express these via plain env-sourced `secrets`/`secretRef`
  bindings (name+scope only), matching current behavior exactly per decision 7.

**7. G4 canary recommendation (adjusts the SPEC's default canary set at
T04/T06 Accept blocks)**

Default canaries (per T04/T06 Accept): `telegram-transform-reply` (channels),
`ai-agent-playground` (ai), `http-connectors` (http), `mcp-connections` (mcp).
Per the audit above:
- **channels**: `telegram-transform-reply` — MIGRATABLE, canary unchanged.
- **ai**: `ai-agent-playground` — MIGRATABLE, canary unchanged.
- **http**: `http-connectors` — MIGRATABLE, canary unchanged (the group's
  other sample, `hosted-services-api`, is STAND-BY per finding 5).
- **mcp**: `mcp-connections` is STAND-BY (not anticipated to change per
  decision 6, confirmed here) — AND its sibling `mcp-repo-support-bot` is
  ALSO STAND-BY. **The entire `mcp` group is stand-by; there is no migratable
  sample left to promote as canary.** Per the gate note ("a fully stand-by
  group drops out of G4 with a note in the progress entry"): the `mcp` group
  DROPS OUT of G4/G5/G6 from T06 onward. G4 from T06 onward runs 3 canaries
  (channels, ai, http), not 4. T04 (pre-migration, original setup scripts)
  still runs all 4 groups' original canaries since T04 predates the
  MIGRATABLE/STAND-BY split.

**8. Escalation items for human review (per the human-boundaries section)**

- `sdk/samples/README.md` and `sdk/samples/.gitignore` are unmapped by
  decision 2 (finding 2) — recommend `git rm`/`git mv` respectively in T02,
  pending explicit human sign-off alongside the T02 move-commit approval.
- `hosted-services-api` is a STAND-BY sample beyond the SPEC's anticipated gap
  candidates (MCP servers, system variables) — its gap is service
  scaling/routing fields, not a whole missing manifest section. This changes
  T07's `provisioning-manifest-gaps.md` scope (three gap kinds, not two) and
  reduces the `mcp` group's G4 presence to zero canaries from T06 onward
  (finding 7). Flagging for the human OK required before T06 deletes any
  script (per the human-boundaries section).
- `.sdd/changes/{telegram,http}-channel-instances/*` (6 git-tracked files, 16
  `sdk/samples/...` hits — finding 3d) are SDD change artifacts in a HIDDEN dir
  the G2 sweep never scans. Closure is ASYMMETRIC (verified per-change in 3d):
  `telegram-channel-instances` has an `archive.md` (closed → treat as historical,
  leave untouched like old `manual-loops/*` specs); `http-channel-instances` has
  NO `archive.md` and no status marker, so its closure is UNVERIFIED. The human
  must (a) confirm the SPEC's "historical specs keep their paths" rule
  (Out-of-scope, line 335-336, names only `manual-loops/`) extends to the closed
  telegram change, and (b) state whether `http-channel-instances` is closed
  history or an active change before T02. G2 stays green either way (hidden dir).

### T02 — 2026-07-15

Move executed per the T01 map + human rulings (approved 2026-07-15): all
`git mv` by group; `sdk/samples/README.md` removed (`git rm`, superseded by
T03 tier READMEs); `sdk/samples/.gitignore` → `integrations/.gitignore`;
`http-bridge` → `sdk/examples/reference-pattern` with `integrations/lib`
resolver logic inlined verbatim into its own `setup.sh`/`run.sh` (the SDK
tier carries no shared-lib dependency); `.sdd/changes/**` left untouched
(historical, hidden dir — G2 never scans it). All T01-mapped referrers
rewritten (sdk/test/e2e, bootstrap-from-scratch.md, cowork docs, demos
citations + the live path list in `demos/crm-support-telegram/lib/
resolve-demo-env.sh`, sdk/GROWTH-PLAN.md, admin-console UI copy string).
A stray untracked `.telegram-chat-id` runtime artifact inside the old tree
was removed so `sdk/samples/` could be deleted entirely.

Gates: G2 clean (no `sdk/samples/` reference outside `manual-loops/**`);
G3 no-op (no tsconfig in moved trees); Accept both PASS. G1 note: shellcheck
exits 1 on info-level SC1091 ("not following" sourced files) — verified
IDENTICAL notices exist at HEAD pre-move and `shellcheck -S error` is clean
pre and post; treated as pre-existing noise, not a move defect (fixing it
would violate the move-verbatim constraint). Dual review: 2× APPROVED
(attempt 1) — reviewers verified rename similarity indexes, the verbatim
resolver inlining, path-depth fixes (`../../lib` and telegram-onboard.sh's
`../lib`), README.es.md path-string-only edits, and no unauthorized
deletions.

### T03 — 2026-07-15

Tier READMEs written: `integrations/README.md` (new — reason to exist, group
index with all 12 samples + telegram-onboard.sh + lib, tier distinction),
`sdk/examples/README.md` (new — inventory `reference-pattern`, no-shared-lib
rule), `demos/README.md` (cross-link paragraph only), `sdk/README.md` (new
"Samples & examples" section linking the three tiers). Gates G1-G3 green;
Accept green. Dual review: 2× APPROVED (attempt 1); reviewers verified all
sample listings against disk and every relative link resolves.

CARRY-OVER for T04 (move-induced breakage found by review): four sample
READMEs still contain stale relative links to `../http-bridge`
(ai-agent-triage, telegram-transform-reply, http-connectors,
ai-call-center-supervisor) — the target is now `sdk/examples/reference-pattern`.
Fix within T04's "move-induced breakage" scope.

### T04 — 2026-07-15

All four G4 canaries GREEN against the dev cluster (original setup scripts,
pre-migration):
- `integrations/http/http-connectors/setup.sh` — 5 connectors reconciled,
  created=0 reused=5 failed=0 (idempotent re-run).
- `integrations/mcp/mcp-connections/setup.sh` — MCP server + agent + workflow
  provisioned; connection/discovery warnings are documented-expected (fake
  endpoint by design); description-override skip is a server feature flag,
  noted in the sample itself.
- `integrations/ai/ai-agent-playground/setup.sh` — LLM connector reused,
  agent created + published (connector credential mode, human-loaded .env).
- `integrations/channels/telegram-transform-reply/setup.sh` — account +
  workflow reused, Telegram webhook registered (human-loaded .env).

Move-induced breakage uncovered by real execution and fixed (3 attempts):
1. SDK dependency depth: all 12 integration `package.json` had
   `"@yoizen/platform-sdk": "file:../.."` (correct at the old flat depth) →
   bumped to `file:../../../sdk`; `sdk/examples/reference-pattern` keeps
   `file:../..` (correct at its depth). Untracked `node_modules/@yoizen/
   platform-sdk` symlinks repointed (no lockfiles; symlink IS the install
   artifact).
2. Cross-group relative paths broken by the flat→grouped layout, swept
   exhaustively across README.md/README.es.md/src/*.ts/env.example plus the
   cross-tree refs in `sdk/examples/reference-pattern`: functional fixes in
   `http-fanout-telegram/src/index.ts` (runSetupScript cwd) and user-facing
   `cd` instructions; the rest are prose/comment path strings. Same-group
   `../<sibling>` refs and `../lib/resolve-env.sh` prose left as-is
   (correct/non-navigable). Old-name `http-bridge` mentions in .ts comments
   left (rename artifact, not a path bug).

Attempt history: attempt 1 fixed package.json/README links (rejected: missed
src-level refs); attempt 2 fixed src refs (rejected: missed README-body +
env.example refs); attempt 3 ran the exhaustive classified sweep — 2× APPROVED
with both reviewers re-running the sweep and verifying zero cross-group refs
remain. Gates G1-G3 green throughout (G1 at error level; SC1091 info baseline
per T02 note).

### T05 — 2026-07-15

SDK CLI shipped: `yoizen` bin (`sdk/bin/yoizen.ts`) with
`manifests validate|plan|apply -f <file>` (+ `--secrets-from-env`) and
`secrets put <name> --scope <kind>:<owner> --value-env <VAR>`. Thin layer
over existing `client.manifests`/`client.secrets` (verified against the
resource clients — zero new SDK API surface); config resolution reuses
`createClient()`; zero new deps (node:util parseArgs + Bun.YAML built-in —
CLI requires the Bun runtime). Secret values flow env → `client.secrets.set`
only — never argv/disk/logs; missing env vars fail fast listing ALL names.
Verdict table `KIND\tNAME\tVERDICT` with literal create/update/noop is G5's
assertion source.

Accept run LIVE against the dev cluster: `bunx yoizen manifests validate -f
sdk/test/cli/fixtures/sample-manifest.yaml` → valid=true; `plan` → 2 create
verdicts (channel + workflow), grep-assertable. `cd sdk && bun test src/cli`
→ 41 pass; full `bun test` → 384 pass 0 fail. Dual review: 2× APPROVED
(attempt 1), both reviewers traced the secret flow end-to-end.

Deviations documented: (a) no repo workspace wiring — `bunx yoizen` needs a
one-time `cd sdk && bun link`, or run `cd sdk && bun run bin/yoizen.ts ...`;
(b) no canonical showcase-manifest file existed — fixture added at
`sdk/test/cli/fixtures/sample-manifest.yaml`; (c) CLI tests are colocated
under `sdk/src/cli/**` to satisfy the Accept command verbatim.

FOLLOW-UPS (non-blocking, from review): `sdk/package.json`'s `test` script
glob (`tsx --test 'test/**/*.test.ts'`) does not include the colocated
`src/cli` tests — `bun test` discovers them, the npm-script path does not;
align the glob or move the tests. Also `VALID_SCOPE_KINDS` array duplicated
in `parse-scope-arg.ts` + `extract-secret-bindings.ts` — extract to one
shared constant.

### T06 — 2026-07-15

ESCALATION + HUMAN RE-RULING: the implementer stopped before touching any
file — code inspection of the APPLY ENGINE (not just the schema) showed the
T01 audit's kind-level classification was too optimistic. Three hard gaps,
all code-verified: (a) connector `authConfig` unreachable through apply —
inline keys are dropped and `secretRef` fails loud `secret_not_resolvable`
(`connectors-writer.ts:41-73`, by design); (b) connector `endpoints` have no
schema/writer concept at all; (c) no manifest-time real-ID substitution —
workflows baking `adapterId`/`agentId` cannot be created correctly
(`workflows-writer.ts` sends definitions verbatim). Human ruled 2026-07-15:
MINIMAL T06 — migrate `telegram-transform-reply` only; the other seven
formerly-MIGRATABLE samples join the four original gap samples in stand-by
(11 total).

Executed: `telegram-transform-reply` → `manifest.yaml` (telegram channel via
`secretRef telegram-bot-token` + workflow with transform code and reply args
copied VERBATIM from the deleted setup script), `git rm setup.sh src/setup.ts`,
README/README.es.md rewritten to the CLI flow, `src/index.ts` rewritten as a
self-contained run-side driver. Documented deviations: trigger unpinned
(no ID substitution; equivalent in single-account tenants), writer-owned
`manifest:<name>` externalId + slug display name, webhook secret via
`TELEGRAM_WEBHOOK_SECRET` env (apply does not surface appSecret). 11×
STANDBY.md with per-sample gap + file:line evidence, all linking
`manual-loops/provisioning-manifest-gaps.md` (authored in T07). Stand-by
scripts untouched.

Gates: G1-G3 green. G4 (CLI canary, live cluster): first apply → channel
create + workflow noop. G5: validate=true; second apply appliedCount=0,
both verdicts noop (idempotence proven). G6 run at SAMPLE-ROOT granularity
(orchestrator interpretation, recorded): the SPEC's literal `dirname` check
false-positives on `src/setup.ts` since STANDBY.md sits at the sample root —
decision 8 marks the SAMPLE as stand-by, so a root STANDBY.md covers its
setup files; zero leftovers under that reading. Counts: 1 manifest,
11 STANDBY.md, 22 stand-by setup files. Dual review: 2× APPROVED (attempt 2
after the escalation round) — reviewers independently re-verified the writer
code, the verbatim workflow copy, and that no secret value exists in the repo.

CANARY SET from T06 onward: G4/G5 run on `telegram-transform-reply` only —
the ai, http and mcp groups are fully stand-by and drop out per the gate
rule. FOLLOW-UPS: `.env.example` of the migrated sample still documents the
old setup flow (write-denied in-session; update alongside T07 docs);
`secrets-from-env` binding names are slug-cased so env vars need `env
'telegram-bot-token=...'` form — ergonomics candidate for the gap SPEC.
T07 SCOPE CHANGE: `provisioning-manifest-gaps.md` must now cover SIX gap
kinds: connector credential wiring (broker secretRef + inline authConfig),
connector endpoints, manifest-time ID substitution, systemVariables,
service scaling+routes, mcpServers.

### T07 — 2026-07-15

Docs + index + gap SPEC shipped: `cowork/INDEX.md` reorg entry (reworded
once — attempt 2 — after the literal old path tripped G2); content refresh
of `bootstrap-from-scratch.md` (telegram step now CLI flow) and
`DOCS/README.md` (three-tier pointer); "Declarative provisioning" section
in `integrations/README.md` (manifest convention, CLI commands,
secrets-from-env slug rule, STANDBY.md meaning); CLI section in
`sdk/README.md`; every `sdk/samples/*` citation in
`manual-loops/demos/crm-support-telegram.md` rewritten to the new paths with
accurate migrated/stand-by annotations (crm T08 can now run).

AUTHORED `manual-loops/provisioning-manifest-gaps.md` (487 lines): the
companion SPEC covering all SIX manifest v1 gaps (connector credential
wiring, connector endpoints, manifest-time ID substitution, systemVariables,
service scaling+routes, mcpServers), task queue T01-T09, end state = the 11
stand-by samples migrated and STANDBY.md removed, full canary set restored.
It requires its own explicit human approval before it ever runs (stated in
three places). KNOWN NIT for that approval round (review finding,
non-blocking): the "(gap 5)"/"(gap 6)" parentheticals in its User decisions
are swapped relative to its Goal numbering — fix when approving.

Gates: G1-G3 green (G2 failed once on the INDEX wording, fixed), Accept all
green. Dual review: 2× APPROVED (attempt 2) — reviewers verified every code
citation line-for-line and the 11-sample stand-by list against disk.
