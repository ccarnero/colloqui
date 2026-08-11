# SPEC — Instagram/Meta channel decommission (register 05, Fase 3)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `PENDIENTES/`.
> Depends on: none open (Fase 1 = register 03 CLOSED, Fase 2 = register 11 run).
> Origin: register `PENDIENTES/05-deuda-plataforma.md` §"Dar de baja el canal
> Instagram/Meta" — APPROVED by ruling D3 (2026-08-07, Engram #1362). E11-style
> removal spec (sanctioned removal, precedent: register 01 T01).
> Engram topic: 'platform-cluster/pendientes-meta-decommission'.

## Goal

The Meta channel family is live, fully-wired production code that the user no
longer wants: `InstagramProvider` + `WhatsAppProvider` +
`MetaChannelProviderBase`/`meta-base.ts`/`meta-token.ts` under
`services/channel-service/src/providers/meta/**`, the `"whatsapp"`/`"instagram"`
tokens in the `Channel` union and every downstream literal union, provider
`"meta"` in `ChannelProvider` and as the DB `DEFAULT`, the Meta-only webhook
paths (hub.challenge GET verification, legacy first-active-account fallback,
`refreshMetaToken`), the Meta-only account columns/DTO fields, and
`DOCS/channels/instagram.md`.

After this queue: no Meta code, token, provider value, column, route, test or
doc survives anywhere outside the frozen archive; the surviving channels are
`telegram`, `http`, `e2e-tests`; `providerFor`/the DB no longer silently
default anything to `"meta"` (which also kills register 05's cosmetic bug of
e2e-tests envelopes stamped `provider: "meta"`). The manifest schema is NOT
touched — that is Fase 4.

## User decisions (human boundary — do not reinterpret)

1. **D3 (2026-08-07, Engram #1362)**: Instagram/Meta decommission APPROVED as
   an E11-style removal. Sequencing: MUST land before adding channel
   `provider` to the manifest schema (Fase 4).
2. **Scope ruling (2026-08-11, this spec's authoring session)**: the removal
   covers the WHOLE Meta family — WhatsApp included. Delete
   `providers/meta/**` entirely, drop both channel tokens and provider
   `"meta"`. (Resolves the ambiguity between the register's `meta/**` glob and
   Engram #1239's file list, which never named `whatsapp.provider.ts`.)
3. Register 05's other items stay PARKED, out of scope here: declarative
   teardown, manifest publish, manifest `provider` field, KB `file` source —
   all batched in Fase 4 (order: defaultCache → provider → publish → teardown
   → file-source). Do not touch `manifest.schema.ts` or any manifest sample.
4. Register 05's rule-5 item (crm README in Spanish) was already closed by
   Fase 1 — verified 2026-08-11: `demos/crm-support-telegram/README.md` is in
   English. T03 only updates the register; no translation work exists.

## Prior art (surface verified 2026-08-11 — the sweep re-verifies live)

- `services/channel-service/src/providers/meta/**` — the family to delete:
  `instagram/instagram.provider.ts`, `whatsapp/whatsapp.provider.ts`,
  `meta-channel-provider.base.ts`, `meta-base.ts`, `meta-token.ts`,
  `provider-registry.ts` (registry maps ONLY whatsapp+instagram — with both
  gone decide: delete it and its wiring, or keep an empty registry only if
  something structural still consumes it; justify in the task summary).
- Channel-service wiring: `modules/webhooks/webhooks.module.ts` (providers
  registered), `webhook-ingress.service.ts` (`channel === "whatsapp"` branch,
  Meta legacy first-active-account fallback, `phone_number_id`/`ig_user_id`
  disambiguation), `webhook-verify-rpc.server.ts:105` (hub.challenge — Meta
  channels only; if nothing else uses the verify path, remove it end-to-end
  including the api-gateway GET route, else strip the Meta branches),
  `modules/accounts/accounts.service.ts:175` `refreshMetaToken` +
  `accounts.controller.ts:95` `POST :id/refresh-token` (Meta-only — remove),
  `modules/auto-reply/auto-reply.dto.ts:14` `@IsIn(["whatsapp","instagram"])`
  (auto-reply is Meta-only today — decide remove-vs-retarget by reading what
  consumes it; REPORT the verdict),
  `modules/accounts/accounts.dto.ts` channel unions + Meta-only fields.
- Contract: `packages/shared/src/channel.interfaces.ts:14-20` (`Channel` +
  `ChannelProvider` unions), `packages/shared/src/channel-schema.ts` (CHECK
  lists ×2, `provider TEXT NOT NULL DEFAULT 'meta'`, Meta-only columns
  `phone_number_id`, `waba_id`, `ig_user_id`, `app_id`, `app_secret`,
  `verify_token` — verify each is Meta-only before dropping; `verify_token`
  especially), `channel-usage-schema.ts:18` comment,
  `packages/shared/test/unit/envelope-schema.spec.ts` fixtures.
- `services/provisioning-service/src/modules/apply/infrastructure/channels-writer.ts:110`
  — `providerFor` falls through to `"meta"`; must become exhaustive over
  surviving channels (`e2e-tests` → `"e2e-tests"`, unknown → error).
- Downstream literal unions:
  `services/api-gateway/src/modules/channels/channels-gateway.dto.ts:40-45,218`,
  `services/workflow-service/src/modules/workflows/dto/workflow-trigger.dto.ts:19,24`,
  `services/admin-console/.../domain/validation/trigger.validator.ts:8,18-19`,
  `services/tracking-ingester-service/src/lib/classify.ts:15-16,69-70`,
  `sdk/src/resources/channels/types.ts:33-34,125-126`,
  `sdk/src/resources/webhooks/types.ts:37`.
- Tests that die with the feature: `channel-service/test/unit/`
  `instagram.provider.spec.ts`, `meta-base.spec.ts`,
  `provider-registry.spec.ts`; Meta cases inside `channel-router.spec.ts`,
  `webhook-ingress.service.spec.ts`, api-gateway
  `webhook-ingress-type.spec.ts` / `webhook-ingress-publisher.spec.ts`,
  tracking-ingester fixtures, sdk tests. Channel-agnostic tests that merely
  USE a Meta token as fixture retarget to `telegram`/`e2e-tests` and keep
  their assertions.
- Docs: `DOCS/channels/instagram.md` (delete), Meta sections in
  `DOCS/messaging/ingress.md`, `DOCS/architecture/security.md:152`,
  `DOCS/architecture/multi-tenancy.md`, `DOCS/channels/channel-service.md`,
  `DOCS/workflows/patterns.md`, `DOCS/architecture/overview.md`,
  `DOCS/README.md`, `sdk/README.md`, `services/channel-service/README.md`,
  `services/workflow-service/README.md`, comment in
  `scripts/e2e/http-workflow.sh:280`, WhatsApp mentions in egress/e2e-tests
  provider comments.
- DDL re-apply gotcha (`channel-schema.ts:43-51`): the `DO $$` block re-adds
  the channel CHECK on every schema init but swallows ALL errors — if a
  tenant DB still holds `whatsapp`/`instagram` rows, the DROP succeeds and
  the ADD fails silently, leaving the table with NO check. Operator handling
  in Post-queue; the code change itself stays a plain list edit.

## Constraints (apply to every task)

- Conventional commits scoped to the touched package/service. No Co-Authored-By.
- E11 removal discipline: tests OF the removed feature are deleted; every
  OTHER test keeps its assertions — retarget fixtures, never weaken. A
  surviving test losing an assertion is automatic reviewer rejection.
- `packages/shared/src/provisioning/manifest.schema.ts` and every
  `manifest.yaml` are UNTOUCHABLE in this queue (User decision 3).
- `DOCS/archive/**` is a frozen ledger — never edit it; archive hits are
  excluded from every accept grep.
- No silent defaults survive: after T02, an unknown channel type in
  `providerFor` is an explicit error, not `"meta"`. The resulting e2e-tests
  envelope change (`provider: "e2e-tests"`, type
  `...e2e-tests.e2e-tests.sent.v1`) is EXPECTED fallout — report the observed
  before/after in the task summary.
- Adjacent smells get REPORTED in the task summary, never patched.
- Any helper script: bash 3.2 syntax (AGENTS.md rule 9, D2 ruling).
- Code, comments, and docs in English (register file is Spanish — match it).

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards (ITERATION, every attempt, every task)
bash scripts/checks/doc-code-guards.sh
# G1 — channel-service unit tests + build (ITERATION: T01, T02)
cd services/channel-service && bun run test:unit && bun run build
# G2 — shared contract tests (ITERATION: T02)
cd packages/shared && bun test
# G3 — downstream services, each: unit tests + build (ITERATION: T02)
cd services/api-gateway && bun run test:unit && bun run build
cd services/workflow-service && bun run test:unit && bun run build
cd services/tracking-ingester-service && bun run test:unit && bun run build
cd services/provisioning-service && bun run test:unit && bun run build
cd sdk && bun test && bun run build
# G4 — admin-console build (ITERATION: T02; ng test needs a browser — build only)
cd services/admin-console && bun run build
# G5 — COMMIT GATE (T01 and T02, once each, after iteration gates green):
cd services/channel-service && bun test
# G6 — COMMIT GATE (T02 only, after G5): full api-gateway suite
cd services/api-gateway && bun test
```

Gate rules (self-contained — the engine runs THIS file verbatim):

- PRECONDITION (before task 1): `git status --porcelain` empty except the
  standing user-owned modifications (`.opencode/opencode.json`,
  `integrations/channels/http-fanout-telegram/manifest.yaml`) — never touch,
  stage, or revert those two.
- T01 runs G0, G1, then G5. T02 runs G0-G4, then G5+G6. T03 runs G0 only.
- ALL existing tests of a touched service must pass — no skips added.
- No cluster deploy gate: rebuilds are batched POST-QUEUE.

---

## Task queue

### T01 — remove the Meta provider family from channel-service

Shared `Channel` tokens stay in place this task (dead but typed) so nothing
outside channel-service moves; the contract shrink is T02.

1. Delete `services/channel-service/src/providers/meta/**` — both providers,
   the base classes, `meta-token.ts`, and `provider-registry.ts` per the
   Prior-art decision note.
2. Unwire `webhooks.module.ts`; strip the Meta branches from
   `webhook-ingress.service.ts` (whatsapp branch, legacy first-active-account
   fallback, `phone_number_id`/`ig_user_id` disambiguation) and
   `webhook-verify-rpc.server.ts` (hub.challenge: remove end-to-end if
   Meta-only — including the api-gateway GET route — else strip Meta
   branches; record the verdict in the task summary).
3. Remove `refreshMetaToken` + the `POST :id/refresh-token` route; resolve
   auto-reply per the Prior-art note (remove if Meta-only, retarget if not).
4. Strip Meta-only fields from `accounts.dto.ts` and Meta handling from
   `accounts.service.ts`/`accounts.controller.ts` (channel token lists in
   DTOs may keep the dead tokens until T02 if removing them here breaks
   type-compat with the still-unshrunk shared union — implementer's call,
   justified in the summary).
5. Delete the dead tests (`instagram.provider.spec.ts`, `meta-base.spec.ts`,
   `provider-registry.spec.ts`); retarget Meta fixtures in surviving specs
   (`channel-router.spec.ts`, `webhook-ingress.service.spec.ts`, …) to
   `telegram`/`e2e-tests` keeping their assertions.
6. Update `services/channel-service/README.md` and in-service comments that
   name WhatsApp/Instagram as live channels (egress, e2e-tests provider).

**Accept** (after G1 green):

```
eza services/channel-service/src/providers 2>/dev/null | rg -i "meta" ; echo "exit=$?"
# ^ expected: no meta/ directory (exit=1 from rg).
rg -n -i "instagram|whatsapp|refreshMetaToken|MetaChannelProviderBase" services/channel-service/src services/channel-service/test
# ^ expected: zero hits (DTO channel-token lists exempt ONLY if step 4's type-compat justification says so).
```

### T02 — shrink the contract: shared unions, DDL, provider "meta", downstream sweep

1. `packages/shared/src/channel.interfaces.ts`: drop `"whatsapp"`/`"instagram"`
   from `Channel`, `"meta"` from `ChannelProvider`.
2. `packages/shared/src/channel-schema.ts`: shrink BOTH channel CHECK lists;
   drop `DEFAULT 'meta'` (provider becomes explicit — writers must always
   set it); drop the Meta-only columns after verifying each is Meta-only
   (`phone_number_id`, `waba_id`, `ig_user_id`, `app_id`, `app_secret`,
   `verify_token`) — any column with a surviving consumer stays and is
   REPORTED. Update the "keep this list identical" comment and
   `channel-usage-schema.ts`'s docblock.
3. `channels-writer.ts`: make `providerFor` exhaustive over
   `telegram`/`http`/`e2e-tests`; unknown type → explicit error. Report the
   observed e2e-tests envelope before/after (expected fallout, Constraints).
4. Sweep every downstream literal union and fixture listed in Prior art:
   api-gateway (`channels-gateway.dto.ts`, webhook-ingress specs),
   workflow-service (`workflow-trigger.dto.ts`), admin-console
   (`trigger.validator.ts`), tracking-ingester (`classify.ts` + test
   fixtures), sdk (`channels/types.ts`, `webhooks/types.ts`, README, tests),
   `packages/shared/test/unit/envelope-schema.spec.ts`. Dead-token DTO lists
   deferred from T01 step 4 die here.
5. Any remaining `channel-service` compile/test fallout from the shrunk
   union resolves in this task (G1 re-runs).

**Accept** (after G0-G4 green):

```
rg -n "'whatsapp'|\"whatsapp\"|'instagram'|\"instagram\"" packages/*/src services/*/src sdk/src scripts --glob '!**/node_modules/**'
# ^ expected: zero hits.
rg -n "'meta'|\"meta\"" packages/*/src services/*/src sdk/src --glob '!**/node_modules/**' --glob '!packages/shared/src/channel-usage-mongo-schema.ts'
# ^ expected: zero hits (bare-word "meta"/"metadata" prose is fine; the quoted token is not).
# Exclusion amended during T02 (spec-authoring fix, not a scope change): that file's
# `metaField: "meta"` is MongoDB's time-series metadata sub-document key — a persisted
# collection-layout identifier written by usage-aggregator and read by channel-service
# usage queries. Renaming it would rewrite every tenant's usage collection layout; it
# has nothing to do with the removed Meta provider. The file carries its own sweep note.
```

### T03 — docs sweep + register close-out

1. Delete `DOCS/channels/instagram.md`; remove/rewrite the Meta sections and
   mentions in the docs listed in Prior art (ingress.md hub.challenge +
   legacy-fallback + sequence diagram sections rewrite around Telegram;
   security.md HMAC row; multi-tenancy.md examples; channel tables in
   overview/README/channel-service.md; workflow-service README;
   `scripts/e2e/http-workflow.sh:280` comment). `DOCS/archive/**` untouched.
2. Update register `PENDIENTES/05-deuda-plataforma.md` (in Spanish): mark the
   Instagram/Meta TODO EJECUTADO with the T01/T02 commit hashes; mark the
   rule-5 README item CERRADO by Fase 1 (User decision 4); leave teardown /
   publish / provider / file-source explicitly parked for Fase 4.
3. Update `PENDIENTES/README.md` row 5 status.
4. *(Amended after T02 — carried findings, same removal, doc-locked
   surfaces)*: update `skills/envelope-messages/` assets
   (`assets/envelope-schema.json` Channel/ChannelProvider enums + examples,
   `assets/subject-builder.ts`, `SKILL.md`) TOGETHER WITH their KNOWN-DRIFT
   pin in `packages/shared/test/unit/envelope-schema.spec.ts`; drop
   `x-hub-signature-256`/`x-hub-signature` from `WEBHOOK_FORWARDED_HEADERS`
   in `packages/shared/src/channel.constants.ts` together with the
   doc-locked `DOCS/messaging/envelope.md` §4.1 and SKILL.md updates it
   forces; sweep the T02-reported stragglers (sdk/GROWTH-PLAN.md,
   sdk/examples/reference-pattern/README.md, packages/shared/README.md,
   SCHEMAS.md verify-RPC rows, channel-service README verify-RPC row,
   DOCS/messaging/service-bus.md, agent-admin-service data/ seed prose,
   bare-word WhatsApp/Meta comments listed in the T02 summary).

**Accept** (after G0 green; because step 4 touches `packages/shared` code
and its doc-locks pins, `cd packages/shared && bun test` is ALSO a T03 gate
— amendment recorded 2026-08-11):

```
rg -ln -i "instagram" DOCS --glob '!DOCS/archive/**'
# ^ expected: zero files.
rg -n -i "whatsapp" DOCS --glob '!DOCS/archive/**'
# ^ expected: zero hits.
rg -n -i "whatsapp|instagram|'meta'|\"meta\"" skills/envelope-messages
# ^ expected: zero hits (amended after T02).
```

---

## Progress

- [x] T01 — Meta provider family removed from channel-service, dead tests
      deleted, fixtures retargeted (2026-08-11, gates + G5 full suite 151/0
      green, 2× APPROVED first attempt. Verdicts: ProviderRegistry deleted
      (router registers telegram/http/e2e-tests directly); hub.challenge
      verify path Meta-only → removed end-to-end incl. api-gateway GET route;
      auto-reply channel-agnostic → retargeted to telegram/http/e2e-tests.
      Behavior pin: unsigned webhooks are signature_mismatch on every channel
      (legacy first-active-account fallback dead, 3 regression tests). Carried
      to T02: gateway/SDK refresh-token surface, gateway auto-reply +
      account-DTO Meta fields, repo-layer Meta column plumbing,
      WEBHOOK_VERIFY_RPC_SUBJECT + verify types now unreferenced,
      channel-router negative pin can drop its `as never` once the union
      shrinks)
- [x] T02 — unions/DDL/provider shrunk, providerFor exhaustive, downstream
      sweep clean (2026-08-11, all gates + G5 151/0 + G6 362/0 green, 2×
      APPROVED first attempt. 96 files. Columns dropped: phone_number_id,
      waba_id, ig_user_id, app_id, verify_token; app_secret + telegram_bot_token
      stay. Added idempotent ALTER COLUMN provider DROP DEFAULT for existing
      tenants. e2e-tests envelopes now provider "e2e-tests" (was "meta"),
      pinned. Breaking: SDK loses refreshAccountToken() + Meta account fields,
      unions now telegram|http|e2e-tests (+e2e-tests newly present); gateway
      loses POST accounts/:id/refresh-token; auto-reply channel list aligned.
      Accept grep 2 amended: channel-usage-mongo-schema.ts metaField:"meta"
      is MongoDB time-series layout, excluded. Carried to T03: skills/
      envelope-messages assets stale (KNOWN DRIFT pin in envelope-schema.spec
      — update asset + pin together), WEBHOOK_FORWARDED_HEADERS still lists
      x-hub-signature* (needs envelope.md + SKILL.md in same change),
      sdk/GROWTH-PLAN.md + reference-pattern README refresh-token mentions,
      packages/shared/README.md + SCHEMAS.md verify-RPC rows,
      agent-admin data/agents seed prose, bare-word WhatsApp comments list in
      T02 summary)
- [x] T03 — docs swept, instagram.md deleted, register 05 + index updated
      (2026-08-11, G0 + shared 384/0 + api-gateway 362/0 + agent-admin 796/0 +
      channel-service 150/0 green, 3 accept greps zero. 2× APPROVED on second
      round — round-1 rejections were both the orchestrator's diff-capture
      including the two PRECONDITION-exempt user files; corrected diff
      approved with no new objections. Amended step 4 executed: skills/
      envelope-messages assets + pin rebuilt STRONGER (union mirror parsed
      from source, dead-token negatives, mutation-checked),
      WEBHOOK_FORWARDED_HEADERS 7→5 with envelope.md §4.1 + SKILL.md +
      doc-locks pin in the same change. ingress.md rewritten around Telegram.
      Smells reported for future rounds: TAXONOMY.md still registers
      whatsapp/instagram tech values (needs its own ruling — persisted
      history), phone.utils.ts is dead code with no callers since the
      removal, envelope-schema.json:225 stale non-Meta line cite)

## Post-queue (operator, outside the loop)

- Rebuild: channel-service, api-gateway, workflow-service,
  provisioning-service, tracking-ingester-service, tenant-service (re-applies
  the channel DDL), admin-console.
- BEFORE redeploying: delete any `whatsapp`/`instagram` rows from every
  tenant's `channel_accounts` — the DDL's `DO $$` re-apply swallows errors,
  so violating rows would leave the table with NO channel CHECK (Prior-art
  gotcha). Then verify post-deploy that
  `channel_accounts_channel_check` exists with the 3-token list.
- Fase 4 (manifest evolution: defaultCache → provider → publish → teardown →
  file-source) is now unblocked per D3 sequencing; it gets its own spec
  batched with register 08.
