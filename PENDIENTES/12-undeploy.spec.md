# SPEC — declarative teardown: `yoizen manifests undeploy`

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `PENDIENTES/`.
> Depends on: none (Fase 3 closed; this pulls the teardown item FORWARD out of
> the Fase 4 batch — user ruling 2026-08-12; the rest of Fase 4 stays batched).
> Origin: register `PENDIENTES/05-deuda-plataforma.md` §"Sin teardown
> declarativo" (parked there since the D3 round).
> Engram topic: 'platform-cluster/manifest-undeploy'.

## Goal

provisioning-service exposes `validate`, `PUT :name`, `GET :name`, `plan`,
`apply` — no delete concept exists, so every e2e script tears down
imperatively resource-by-resource ("no es desprolijidad de los scripts — es
que no hay alternativa", register 05). After this queue: `POST
/provisioning/manifests/:name/undeploy` deletes, in reverse dependency
order, exactly the resources the STORED manifest owns; the api-gateway
proxies it; the SDK exposes `client.manifests.undeploy()`; the CLI grows the
`undeploy` verb (with confirmation) and its `--help`; and the e2e proves the
full cycle apply → undeploy → re-apply live. `apply` itself still NEVER
deletes — decisions 2 and 8 of the manifest rounds stay intact; undeploy is
a separate explicit verb.

## User decisions (human boundary — do not reinterpret)

1. **Undeploy sanctioned (2026-08-12)**: teardown pulled forward from Fase 4
   as its own verb. Apply's create-or-update-only contract (decisions 2/8)
   is untouched.
2. **Secrets die with the manifest**: undeploy deletes the secrets its
   `secrets:` bindings declare (their owners are being deleted). This
   requires the missing DELETE route on provisioning's own secrets
   controller — in scope.
3. **External side effects stay manual**: Telegram `setWebhook` removal,
   HubSpot properties, Docker images — out of scope, mirror of bootstrap.
4. **Shared-resource protection**: undeploy REFUSES (409, listing the
   dependents) when another STORED manifest references this manifest's owned
   resources as `external: true`. No `--force` in v1. Additionally,
   resources the manifest itself marks `external: true` are NEVER deleted —
   they were never owned.
5. **Published agents**: deleted directly — delete implies unpublish, no
   separate step.
6. **Idempotent**: undeploying already-absent resources yields `not_found`
   outcomes and exit 0 (declarative semantics, same spirit as re-apply noop).

## Prior art (verified 2026-08-12 — REUSE, do not duplicate)

- Routes today: `manifests.controller.ts` (`POST validate`, `PUT :name`,
  `GET :name`), `plan.controller.ts` (`POST :name/plan`),
  `apply.controller.ts` (`POST :name/apply`), `secrets.controller.ts`
  (`PUT :name`, `GET` — NO delete). Stored manifests live behind
  `manifests.service.ts`; KB checksums in `kb_document_checksums`
  (`manifest-schema.sql`).
- The 9 writers under `modules/apply/infrastructure/` hold the downstream
  admin clients (channels, connectors, agents, workflows,
  registry-services, system-variables, mcp-servers, skills; KB via
  `modules/kb`). They are create-or-update only ("decision 2, no
  prune/delete anywhere in this loop" — that comment stays TRUE for apply;
  undeploy gets its own reverse path, reusing the same HTTP clients).
- Downstream delete primitives PROVEN live 2026-08-11 (e2e cleanup, all
  204): workflows DELETE, channel accounts DELETE, agents DELETE;
  connector-admin delete exists (`manifest-apply.sh` teardown sweep);
  registry routes DELETE exists (`registry-services-writer.ts:592`
  remove-then-recreate). UNVERIFIED: delete routes for mcp-servers, skills,
  system variables, KBs, registry services (vs routes) — T01 verifies each
  live; a missing delete API on a downstream surface is a FINDING +
  `skipped_no_delete_api` outcome, never a crash and never a blocker.
- Ownership marker: `channels-writer.ts:186` stamps
  `externalId: "manifest:<name>"`. T01 inventories the equivalent marker
  per resource kind; where a kind has NO provable ownership marker, its
  deletion key is the stored manifest's resource name via the same
  find-by-name the writers already use for create-or-update, and the task
  summary documents per kind which key was used.
- Plan entries carry `external: boolean` (`plan.interfaces.ts`) — the flag
  decision 4 keys on.
- Gateway proxy: `services/api-gateway/src/modules/provisioning/*` (T07
  proxy routes — follow the same pattern for undeploy).
- SDK: `sdk/src/resources/manifests/` (client + types),
  `sdk/src/cli/handle-manifests-command.ts` (dispatcher + `--help` from
  commit 3b742e05 — extend both), `format-verdict-table.ts` /
  `format-kb-section.ts` (output style to mirror).
- e2e imperative cleanup to replace: `scripts/e2e/http-workflow.sh` cleanup
  section (deletes workflows, http account, echo agent one by one);
  `scripts/e2e/manifest-apply.sh` teardown sweep ("straight to
  connector-admin", register 05).
- Apply outcome/report shape to mirror: `ManifestApplySuccess`
  (`apply.interfaces.ts:136`) and the stop-at-first-error semantics of
  `apply-manifest.ts`.

## Constraints (apply to every task)

- Conventional commits scoped to the touched package/service. No
  Co-Authored-By.
- `apply` behavior untouched: no writer gains delete behavior on the apply
  path; the "decision 2" comments stay true.
- Owned-only deletion: a resource is deleted ONLY via the ownership key T01
  documents for its kind; `external: true` resources never. No name-pattern
  guessing.
- Never weaken, skip, or delete an existing test — automatic reviewer
  rejection (imperative-cleanup e2e code REPLACED by undeploy keeps its
  verification assertions: what got deleted must still be asserted gone).
- Downstream admin APIs are consumed, never modified in this queue: a
  missing delete route there is a FINDING for its own round.
- Undeploy must be safe to run twice (decision 6) — pinned by test.
- Adjacent smells REPORTED in the task summary, never patched.
- Any helper script: bash 3.2 syntax (AGENTS.md rule 9).
- Code, comments, and docs in English (register file is Spanish — match it).

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards (ITERATION, every attempt, every task)
bash scripts/checks/doc-code-guards.sh
# G1 — provisioning-service unit tests + build (ITERATION: T01; T02/T03 if touched)
cd services/provisioning-service && bun run test:unit && bun run build
# G2 — api-gateway unit tests + build (ITERATION: T02)
cd services/api-gateway && bun run test:unit && bun run build
# G3 — sdk tests + build (ITERATION: T02; T03 if touched)
cd sdk && bun test && bun run build
# G4 — COMMIT GATE (T01, once): full provisioning suite
cd services/provisioning-service && bun test
# G5 — COMMIT GATE (T02, once): full api-gateway suite
cd services/api-gateway && bun test
```

Gate rules (self-contained — the engine runs THIS file verbatim):

- PRECONDITION (before task 1): `git status --porcelain` empty except the
  standing user-owned modifications (`.opencode/opencode.json`,
  `integrations/channels/http-fanout-telegram/manifest.yaml`) — never
  touch, stage, or revert those two.
- T03's Accept includes LIVE cluster commands — the orchestrator runs them
  after rebuilding the touched services (exception to the post-queue-batch
  rule: T03 IS the live proof, it needs provisioning-service + api-gateway
  rebuilt first).
- ALL existing tests of a touched service must pass — no skips added.

---

## Task queue

### T01 — provisioning-service: the undeploy verb

1. New `undeploy` module (mirror `apply`'s layout): `POST
   /provisioning/manifests/:name/undeploy`. Loads the STORED manifest
   (404 `manifest_not_found` if absent), computes the reverse dependency
   order of apply, and deletes per resource kind via the writers' existing
   HTTP clients (extend the CLIENTS with delete calls where the downstream
   route exists — writer apply paths untouched).
2. Ownership inventory (Prior art): document per kind the deletion key;
   `external: true` resources → `skipped_external`. Kinds whose downstream
   admin API has no delete route → `skipped_no_delete_api` + FINDING in the
   task summary (Constraints).
3. Shared-resource guard (decision 4): before deleting, scan the OTHER
   stored manifests for `external: true` references to this manifest's
   owned resources → 409 `undeploy_blocked` listing manifest + resource
   pairs.
4. Secrets: add the missing `DELETE :name` (scope-checked) to
   `secrets.controller.ts`; undeploy deletes each `secrets:` binding after
   its owner resource is deleted (decision 2 of this spec).
5. Cleanup of provisioning's own state: `kb_document_checksums` rows and
   the stored manifest record (delete LAST, only if every non-skipped
   outcome succeeded — a partial undeploy keeps the manifest so re-running
   resumes).
6. Response shape mirrors `ManifestApplySuccess`: per-resource outcomes
   (`deleted | not_found | skipped_external | skipped_no_delete_api`),
   counts, durationMs; stop-at-first-error with partial report.
7. Unit tests: reverse ordering, idempotent double-run (decision 6), the
   409 guard, secrets deletion, partial-failure resume, `not_found`
   tolerance. Follow the apply module's existing test patterns.

**Accept** (after G1 green):

```
rg -n "undeploy" services/provisioning-service/src/modules --no-heading | rg "@Post|controller" 
# ^ expected: the new route in an undeploy controller (or manifests controller) — one route only.
rg -n "delete" services/provisioning-service/src/modules/apply/infrastructure/*-writer.ts | rg -v "^.*//" | rg -i "no prune|remove-then-recreate" -v
# ^ reviewer judgment aid: apply-path writers gained NO delete behavior (client delete methods live outside the apply write path).
```

### T02 — gateway proxy + SDK client + CLI verb

1. api-gateway: proxy `POST /api/provisioning/manifests/:name/undeploy`
   following the existing provisioning proxy pattern (auth, tenant header,
   error passthrough). Unit test alongside the existing proxy tests.
2. SDK: `client.manifests.undeploy(name)` + response types mirroring T01's
   shape (learn from the ReconcileKbOutcome drift fixed in d6fca63f — the
   SDK type MUST mirror the service interface field-for-field; cite the
   service file in the JSDoc).
3. CLI: `yoizen manifests undeploy -f <file> [--yes]` — resolves the
   manifest NAME from the file (reuse `extract-manifest-name.ts`); without
   `--yes` prints what will be deleted (kind/name table reusing
   `format-verdict-table.ts` style) and aborts asking for `--yes` (no
   interactive prompt — non-TTY safe); with `--yes` calls undeploy and
   prints the outcome table. Extend `MANIFESTS_USAGE` + `subUsage` (both
   `--help` levels) and the unknown-subcommand usage line.
4. Unit tests: run-cli routing, --yes gate (no client call without it),
   outcome rendering (no `undefined` — pin it), --help mentions undeploy.
5. Update `sdk/README.md` CLI section + `integrations/README.md` manifest
   section with the new verb.

**Accept** (after G1-G3 green):

```
cd sdk && bun test src/cli 2>&1 | tail -3
rg -n "undeploy" sdk/src/cli/handle-manifests-command.ts | head -5
# ^ expected: dispatcher + usage lines include undeploy.
rg -n "undeploy" sdk/README.md integrations/README.md
# ^ expected: both documented.
```

### T03 — live proof + e2e adoption + register close

1. (Orchestrator, before Accept): rebuild + redeploy provisioning-service
   and api-gateway via `./rebuild-redeploy.sh`.
2. Replace the imperative cleanup in `scripts/e2e/http-workflow.sh` with
   `undeploy` via the gateway (same authenticated transport the script
   already uses), keeping every "resource is gone" assertion and the
   imperative fallback ONLY for resources outside the manifest (document
   which in the script comment). `scripts/e2e/manifest-apply.sh` teardown
   sweep likewise if its resources are manifest-owned.
3. Register updates (Spanish): `PENDIENTES/05-deuda-plataforma.md`
   §teardown → EJECUTADO (this spec + commits), noting what stays manual
   (decision 3) and any `skipped_no_delete_api` findings;
   `PENDIENTES/README.md` index row for this spec.
4. Docs: provisioning docs page (DOCS/ wherever apply is documented) gains
   the undeploy contract (route, ordering, outcomes, the 409 guard).
5. *(Amended 2026-08-12 after the T03 implementer's finding)*: the
   `provisioning-service-secrets-manager` ClusterRole
   (`knative/services/rbac/cluster-role.yaml`) lacks the `delete` verb on
   secrets — its comment cites decision 8's no-prune stance, which User
   decision 1/2 of THIS spec supersedes for the undeploy verb. Add
   `delete`, rewrite the comment truthfully (write-only API + undeploy's
   binding deletion; apply still never deletes), and the orchestrator
   applies the ClusterRole to the cluster before the live Accept. Without
   it, undeploying any manifest with secret bindings 409s when removing
   the last key of a Secret.

**Accept** (after G0 + touched-service gates green; LIVE, orchestrator-run):

```
bash scripts/e2e/http-workflow.sh
# ^ expected: full run green with undeploy-based cleanup.
# Then live cycle proof on the crm demo manifest (names from its manifest.yaml):
#   apply (already applied) -> undeploy -> GET agents/channels return not-found -> re-apply -> agent/channel back.
# The orchestrator scripts this against the gateway and records the outcome in the task summary.
```

---

## Progress

- [x] T01 — undeploy verb in provisioning-service (route, reverse order,
      ownership keys, 409 guard, secrets DELETE, idempotent, unit-pinned)
      (2026-08-12, gates + G4 full suite 560/0 green, 2× APPROVED on attempt
      2 — round-1 objections both real: ISecretsStore fixtures missing the
      new required deleteKey in 6 sites, and the channels marker matched
      `manifest:<MANIFEST name>` while the writer stamps
      `manifest:<CHANNEL name>` (silent-orphan bug, fixed red-first with a
      crm-shape regression pin; marker semantics honestly downgraded to
      apply-provenance). Inventory: ALL 9 downstream admin APIs have delete
      routes — zero skipped_no_delete_api. FINDINGS for future rounds: no
      audit events for undeploy (new event kinds need registration);
      downstream not-found conventions split 404 vs 200-false (soft
      deletes); per-manifest ownership marker missing on all kinds
      (competing same-name owners indistinguishable at teardown — writer
      round: stamp manifest:<manifest>/<resource>); second FULL undeploy
      404s (record deleted last) — T02 must render it "already undeployed"
      exit 0; test-tree typecheck baseline 183 pre-existing errors)
- [x] T02 — gateway proxy + SDK `manifests.undeploy()` + CLI verb with
      `--yes` gate and `--help`, docs updated (2026-08-12, gates + G5
      full api-gateway 368/0 green, sdk 547/0, 2× APPROVED first attempt.
      SDK types mirror undeploy.interfaces.ts field-for-field; 404 renders
      "already undeployed" exit 0; 409 renders dependents; preview without
      --yes calls nothing, exit 1. Reviewer notes for T03/rounds: exercise
      the second-undeploy 404 against the REBUILT gateway in the live proof
      (version-skew false-success risk until then — FINDING: typed 404 body
      kind:"manifest_not_found" for a provisioning round); SecretScopeKind
      drift sdk vs shared (missing systemVariable/skill — fold into T07
      ruling); double "manifests <verb>:" error prefix mirrors apply
      (cleanup round across verbs); gateway authz for undeploy sits at
      apply's level — dedicated permission needs its own ruling)
- [x] T03 — e2e cleanup migrated to undeploy, live cycle proven, register
      05 teardown item closed (2026-08-12, G0 + bash -n green, 2× APPROVED
      first attempt. Amended step 5 shipped: secrets ClusterRole gained
      `delete`, applied to the cluster, grant verified with `kubectl auth
      can-i`. LIVE PROOF: full http-workflow e2e green with declarative
      cleanup — undeploy 200, deleted=6, skipped_external=2 (pokeapi +
      sample-echo protected), manifestRecordDeleted=true, 6/6 is-gone
      verifications; separate proof-manifest cycle: apply(2 create) →
      undeploy (reverse order visible: agent before channel; secret binding
      deleted; k8s Secret physically gone) → channel+agent absent via APIs →
      second undeploy 404 against the rebuilt gateway. The crm demo manifest
      was deliberately NOT used for the live cycle — it is in active use by
      the user; the proof manifest exercises the same path including
      secrets, which crm's cycle would have. Surviving findings live in
      register 05: no audit events for undeploy, per-manifest ownership
      marker pending writer round, typed 404 body, stored-record cleanup
      gap in teardown-regression.sh, PROVISIONING_RESOLVE set -u edge)

## Post-queue (operator, outside the loop)

- Rebuilds beyond T03's own (provisioning-service, api-gateway): none
  expected — SDK/CLI are client-side.
- Any `skipped_no_delete_api` findings feed the next PENDIENTES ruling
  round (downstream admin APIs missing delete routes).
- Fase 4 remainder (defaultCache → provider → publish → file-source) stays
  batched and parked.
