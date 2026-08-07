# SPEC — Group D+E: lying comments and strings, plus the rule-5 leftovers

> Task queue for the `/manual-loop` command. One task at a time, gated by
> tests and dual review. Queues live in `PENDIENTES/`.
> Depends on: nothing (text-only queue). AGENTS.md rule 9 (bash 3.2) and
> guard G16 landed in `ee8cffb1` — this queue inherits them from the
> constitution, not from copied constraints.
> Origin: register `PENDIENTES/03-group-d-e.md` (docs-truth audit, escalated
> because source files were out of the audit's allowed scope) + two rule-5
> leftovers from registers 05 and 09.
> Engram topic: 'platform-cluster/pendientes-group-d-e'.

## Goal

Every comment, JSDoc, header, and user-facing script string in the register
tells the truth about the code it lives next to. Zero behavior change — the
diffs must be text-only. Plus: the last two English-rule violations
(rule 5) die.

## User decisions (human boundary — do not reinterpret)

1. Text-only queue: NO logic, signature, or control-flow changes. A fix that
   needs a behavior change gets REPORTED and escalated, never smuggled in.
2. Fase-1 placement (plan ruling 2026-08-07): this queue runs before the
   transversal tooling work so stale text stops breeding drift (E22 already
   caused documented drift once).

## Constraints (apply to every task)

- Diffs are text-only: comments, JSDoc, headers, heredocs, `log`/`fail`/
  `usage()` string arguments, and Markdown. A reviewer finding ANY executable
  change is an automatic rejection.
- AGENTS.md universal rules apply as constitution — notably rule 5 (English
  everywhere) and rule 9 (bash 3.2, guard G16).
- Verify each claimed lie against the code BEFORE fixing it — if the register
  is stale and the text is already true (E32 pattern), record that in the
  task summary instead of editing.
- Conventional commits scoped per task. No Co-Authored-By.
- Scope discipline: adjacent smells reported, never patched.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 ITERATION — repo guards, every attempt (includes G10 links, G16 bash32)
bash scripts/checks/doc-code-guards.sh
# G1 ITERATION — every shell script touched by the attempt's diff:
bash -n <script> && /bin/bash -n <script>
# G2 ITERATION — every TS-bearing package touched: its typecheck row
#   (comments cannot break tsc — this catches accidental executable edits)
cd sdk && pnpm exec tsc --noEmit          # only if sdk/src touched
cd services/<svc> && bunx tsc -p tsconfig.build.json --noEmit   # per touched svc
```

Gate rules (self-contained):

- PRECONDITION (before each task): `git status --porcelain` empty EXCEPT the
  two user-owned files (`.opencode/opencode.json`,
  `integrations/channels/http-fanout-telegram/manifest.yaml`) — never touch
  or commit those.
- No cluster gate: text-only changes deploy nothing.
- Tasks touching no shell skip G1; tasks touching no TS skip G2.

---

## Task queue

### T01 — Group D: eight lying comments/JSDoc/headers

One text-only commit. Per item: verify the lie, fix the text to describe the
code as-built, cite nothing that does not exist. The register rows:

- **E14** — `ensureDurableConsumer` JSDoc says `backoff` is immutable;
  `reconcileDurableConsumer` diffs and updates it. Fix the JSDoc.
- **E16** — 5 headers in `sdk/src` claim "404s / pending deploy" against e2e
  tests proving the opposite; `config-files/types.ts` contradicts itself in
  consecutive sentences. Align all six spots with reality.
- **E19** — `ai-agent-triage` documents an example output (`🎧 Triage`) no
  branch can emit. Fix the example to one the code produces.
- **E20** — `hosted-services-api/manifest.yaml` header asserts a restriction
  already lifted. Update.
- **E21** — `reference-pattern/src/setup.ts` names a `resolve-env.sh` that
  does not exist in its tier. Point to what exists.
- **E22** — `registry-services-writer.ts` "COMPARABLE LIMITATION" block
  describes a superseded comparator — it already leaked into a README once
  (caught in review). Rewrite to the current comparator.
- **E26** — `reset-dev.ts` header lists Mongo variables as required;
  `REQUIRED_ENV` has ten names, none Mongo. Sync the header to the array.
- **E34** — `DOCS/guides/dev-mode.md` table omits `tracking-ingester-service`
  and `provisioning-service`, both implemented in `get_targets`. Add the rows.

Locate each file with rg (the register omits full paths on purpose — verify
against code, do not trust remembered paths).

**Accept**
```
bash scripts/checks/doc-code-guards.sh
rg -n "tracking-ingester-service" DOCS/guides/dev-mode.md
git diff --stat
```
(Reviewers verify text-only via the diff; typecheck rows per Gate G2 for every
touched package.)

### T02 — Group E: strings inside executable lines, plus the E32 verification

One text-only commit — the strings live in `log`/`fail` arguments, `usage()`
heredocs and `sed` ranges, so G1 runs on every touched script:

- **E30** — three `usage()` helpers print more steps than their script has:
  `kustomize-safe-apply.sh` (8 printed / 6 real), `rebuild-changed.sh`
  (5 / 3), `scripts/orbstack/startup.sh` (4 / 2). Count the real steps, fix
  the text.
- **E31** — `scripts/reset/purge-temporal.sh` prints two dead doc paths at
  runtime. Point them at the living successors (verify with G13's logic: the
  paths must resolve).
- **E35** — same script's `usage()` heredoc asserts the reverted HA topology
  in three places. Describe the current single-node reality.
- **E32 — VERIFY FIRST, likely obsolete**: the register says guard `K6c`
  tells users to edit `ROW_FILES` when the symbol is `row_files_for`; the
  K→G rename probably rewrote those messages. If the current text is correct,
  record "E32 obsolete, verified" in the summary and touch nothing.

**Accept**
```
bash -n scripts/kustomize-safe-apply.sh 2>/dev/null || bash -n kustomize-safe-apply.sh
bash -n rebuild-changed.sh && /bin/bash -n rebuild-changed.sh
bash -n scripts/orbstack/startup.sh && bash -n scripts/reset/purge-temporal.sh
bash scripts/checks/doc-code-guards.sh
```
(First line: locate the script wherever it lives; adjust to its real path and
record it.)

### T03 — Rule-5 leftovers: the Spanish README and the stale GROWTH-PLAN row

- Translate `demos/crm-support-telegram/README.md` to English — full
  translation, structure and content preserved (it documents a working demo;
  do not "improve" it, translate it). Rule 5 has ONE named filename
  exception and this is not it.
- `sdk/GROWTH-PLAN.md:84` still lists the retired `credentials-security` e2e
  suite (removed in `93523c51`) — drop or annotate the row to match reality.

**Accept**
```
rg -c "## " demos/crm-support-telegram/README.md
python3 -c "import re,sys; t=open('demos/crm-support-telegram/README.md').read(); sys.exit(1 if re.search(r'[áéíóúñ¿¡]', t) else 0)"
rg -n "credentials-security" sdk/GROWTH-PLAN.md ; test $? -eq 1
bash scripts/checks/doc-code-guards.sh
```

---

## Progress

- [x] T01 Group D — eight lying comments/headers
  - Done 2026-08-07, 1 attempt, 2× APPROVED. 8/8 lies verified against code
    and fixed (none was stale-register). 16 files, text-only (the one
    executable-line edit is E19's console.log string, explicitly allowed).
    Typechecks green: sdk, provisioning-service, packages/database.
  - FOLLOW-UPS (reviewer-flagged adjacent smells, same lie-class, one file
    over — candidates for the register): `desired-fields-of-resource.ts:76-78`
    still claims a "graceful fallback to serviceComparable" that
    `comparable-fields.ts:593-597` says no longer exists;
    `hosted-services-api/README.md:64-68` says the E20/E22 texts "still
    describe the OLD behaviour" — stale the moment this lands;
    `dev-mode.md:115` understates connector-runtime (1 Deployment listed,
    dev-mode.sh emits 3).
- [x] T02 Group E — script strings + E32 verification
  - Done 2026-08-07, 1 attempt, 2× APPROVED. E30: 3 rangos de sed exactos al
    cierre de cada banner. E31: half-obsolete (el `log` ya estaba fixeado por
    `983e6c10`; quedaba el `err` — y el LEDGER citaba mal la ruta:
    `DOCS/runbooks/archive/` no existe, la real es `DOCS/archive/runbooks/`).
    E35: 3 lugares del heredoc a la realidad single-node. E32: medio obsoleto —
    el nombre K6c→G6c sí se renombró pero el mensaje seguía diciendo
    `ROW_FILES`; fixeado a `row_files_for`.
  - FOLLOW-UPS (reviewer-flagged): 3 referencias vivas al path muerto
    `temporal-visibility-split.md` fuera del scope de E31
    (`DOCS/architecture/infrastructure.md:45`,
    `infrastructure/base/postgres/postgres-temporal-visibility-cluster.yaml:18`,
    `infrastructure/base/postgres/secret.yaml:61`); párrafo `counts` del
    heredoc con la misma afirmación stale (fuera de los 3 lugares de E35);
    artefacto preexistente de backticks en heredoc sin quotear
    (`purge-temporal.sh:295` renderiza `()` vacío);
    `manual-loops/architecture/docs-consistency.md:46` aún dice "K6c
    ROW_FILES".
- [ ] T03 rule-5 leftovers (README translation + GROWTH-PLAN)

## Out of scope (explicit)

- E4/E6 — already closed in the audit's T10.
- Any behavior change: if truth requires changing code instead of text, the
  item escalates to its own register entry.
- The remaining plan phases (transversal tooling, E13, Instagram, manifest
  evolution) — sequenced in the PENDIENTES plan, not here.

## Human boundaries for this change

- Human approves this SPEC before the first run (invoking the loop on it is
  that approval).
- Running the loop (`/manual-loop PENDIENTES/03-group-d-e.spec.md`).
