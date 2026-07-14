# SPEC — samples reorg: three-tier examples taxonomy (sdk/examples + integrations + demos)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/crm-support-telegram.md` (run this loop only AFTER
> that queue completes — its Prior art cites `sdk/samples/*` paths that T05
> rewrites here).
> Origin: user decision 2026-07-14 (Cowork session, taxonomy discussion).
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

After this loop, no doc, script, or index references `sdk/samples/` anymore.

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

## Constraints (apply to every task)

- Every move is a `git mv` (history preserved) — never delete+recreate.
- No behavior changes: scripts and code move verbatim except for path/import
  fixes required by the move itself.
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
# G4 — CANARY E2E (T04 onward): one sample per group runs green against the dev cluster
integrations/channels/telegram-transform-reply/setup.sh
integrations/ai/ai-agent-playground/setup.sh
integrations/http/http-connectors/setup.sh
integrations/mcp/mcp-connections/setup.sh
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
- Record findings verbatim in this SPEC's progress entry (numbered, with
  `rg -n` evidence) — the T02 move script is driven by this map, no guessing.

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

### T05 — Docs + index + downstream SPEC fix

- `cowork/INDEX.md` entry for the reorg; refresh `bootstrap-from-scratch.md`
  and `DOCS/README.md` sample references.
- Rewrite the `sdk/samples/*` citations in
  `manual-loops/crm-support-telegram.md` Prior art to the new paths.
- Save an engram memory (topic 'platform/samples-reorg') recording the final
  mapping so future sessions resolve old paths.

**Accept**
```
grep -n "samples-reorg" cowork/INDEX.md
rg -l "sdk/samples/" manual-loops/crm-support-telegram.md ; test $? -eq 1
```

---

- [ ] T01 inventory + reference map
- [ ] T02 git mv by group + path sweep
- [ ] T03 tier READMEs
- [ ] T04 canary e2e per group
- [ ] T05 docs + index + downstream SPEC fix

## Out of scope (explicit)

- `demos/` content — different loop, different purpose (decision 4).
- Writing NEW `sdk/examples/` snippets (auth, pagination, invoke, errors) —
  follow-up loop once the taxonomy lands; this loop only seeds the tier with
  `reference-pattern`.
- Any change to platform services, SDK source, or admin-console.
- Renaming individual samples beyond `http-bridge` → `reference-pattern`.
- Editing historical `manual-loops/*.md` specs other than
  `crm-support-telegram.md` — old specs keep their historical paths.

## Human boundaries for this change

- Human approves this SPEC before the first run — and this loop MUST NOT start
  until `manual-loops/crm-support-telegram.md` is complete.
- The T02 move commit (single, large, mechanical) gets an explicit human OK on
  the T01 reference map BEFORE the move runs.
- Any unmapped file discovered by T01 (not covered by decision 2): stop and
  ask, do not guess its tier.
- Canary env/keys are loaded by the human, as in the samples' own docs.
