# SPEC — crm-support-telegram demo (demos/)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/connector-invoke-api.md` (shipped, done 8/8 — `connectors.invoke()` sync/async).
> Origin: user decisions 2026-07-13/14 (Cowork sessions, demo showcase design).
> Engram topic: 'demo/crm-telegram-showcase'.

## Goal

A commercial showcase demo, first citizen of a NEW top-level `demos/` folder:
end-to-end customer support over Telegram against a REAL cloud CRM.

1. A customer writes to a Telegram bot; an AI agent (knowledge base, per-user
   memory, skills, system variables) leads the conversation.
2. A low-code workflow, visible in the builder, enriches every turn: HubSpot
   contact lookup (`endpointCall`), priority score (`serviceCall`), agent reply
   (`agentCall`), VIP conditional, `channelSend` back to Telegram.
3. A hosted service `priority-scorer` (code + `@yoizen/platform-sdk`) shows the
   code-over-low-code advantage: parallel `connectors.invoke()` sync fan-out to
   HubSpot deals/tickets (cache + trace preserved), readable business rules for
   the score, and ticket creation via ASYNC invoke with `idempotencyKey` +
   webhook confirmation.
4. Demo closes on two screens: the single trace in admin-console run-view
   (workflow AND code calls together) and the real ticket in HubSpot.

## User decisions (human boundary — do not reinterpret)

1. Demo lives in a NEW top-level `demos/` folder (NOT `sdk/samples/`) — first
   of several demos to come.
2. Artifact creation is SEQUENTIAL: one `.sh` per artifact plus one
   orchestrator `setup.sh` that runs them all in order.
3. External system: HubSpot Free CRM (private-app token; contacts, deals,
   tickets APIs).
4. The AI agent LEADS the conversation; the workflow silently enriches each
   turn — not intent-routing with a passive agent.
5. Ticket creation uses async `connectors.invoke()` with `idempotencyKey`
   (at-least-once semantics) + webhook confirmation back to the scorer.
6. Delivery method: manual-loop (this SPEC), not SDD.

## Prior art (validated 2026-07-14 — REUSE, do not duplicate)

- `sdk/samples/ai-call-center-supervisor/src/setup.ts` (~line 917 `buildWorkflowBody`) —
  the exact workflow action sequence (`serviceCall` → `jsFunction` → `agentCall` →
  `conditional` → `channelSend`) and Telegram outbound `sendBase` shape.
- `sdk/samples/telegram-transform-reply/` — Telegram inbound + reply to the
  SAME user; webhook via `TG_PUBLIC_URL`; `TELEGRAM_TEST_CHAT_ID` requirement.
- `sdk/samples/http-connectors/` — connector + endpoints + cache strategies
  provisioning via SDK.
- `sdk/samples/hosted-services-api/` — Knative hosted service registration via
  `client.registry.services`; PORT is reserved by Knative (never set it).
- `sdk/samples/http-bridge/` — the reference TS-SDK sample pattern: thin bash
  wrappers over `src/*.ts`, logging helpers, `requireEnv`/`fail`, stage functions.
- `sdk/README.md` "`connectors.invoke()`" section + `services/connector-runtime/README.md` —
  invoke contract: sync result `{ invocationId, status, data, headers, cacheResult }`;
  async 202 + Redis parking (TTL 900s) + webhook + `invocations.get()` fallback.
- `serviceCall.serviceId` must be the `registered_services` UUID (resolve by
  slug at setup time); pass `serviceSlug` too.
- `agentCall` args support per-user `conversationId`/`userId` — use
  `{{request.from}}` (the supervisor sample hardcodes them; we must not).

## Constraints (apply to every task)

- All artifacts in English (scripts, code, docs, workflow/agent names).
- Mirror the `sdk/samples/http-bridge` pattern: each `NN-<artifact>.sh` is a
  thin bash wrapper over `src/NN-<artifact>.ts` built on `@yoizen/platform-sdk`.
- Every provisioning script is IDEMPOTENT (create-or-update by name/externalId):
  running any script twice never duplicates artifacts.
- No secrets in the repo — everything env-driven (`HUBSPOT_PRIVATE_APP_TOKEN`,
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_TEST_CHAT_ID`, `OPENAI_API_KEY`, `TG_PUBLIC_URL`).
- Verbose logging on every path; nothing fails silently.
- NO changes to platform services, SDK, or admin-console. If a platform/SDK gap
  blocks a task: STOP, record findings in Progress, escalate to the human.
- Never weaken, skip, or delete existing tests — automatic reviewer rejection.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — demo typecheck (from T01 onward)
cd demos/crm-support-telegram && bunx tsc -p tsconfig.json --noEmit
# G2 — shell lint, all task scripts + orchestrator (from T01 onward)
shellcheck demos/crm-support-telegram/*.sh
# G3 — priority-scorer unit tests (from T05 onward)
cd demos/crm-support-telegram/priority-scorer && bun test
# G4 — TASK E2E: the task's own script runs green against the dev cluster TWICE
#      (second run proves idempotency: exit 0 and no duplicated artifacts)
demos/crm-support-telegram/<task-script>.sh && demos/crm-support-telegram/<task-script>.sh
```

Gate rules OVERRIDE for THIS queue (supersedes the inherited
`manual-loops/trace-console.md` rules): this loop touches NO platform services,
so dev-mode/rebuild-redeploy gates (G5a/G5b) do not apply. The task script's
double green run against the live dev cluster IS the commit gate.

PRECONDITION (before T02, once): dev cluster reachable, HubSpot private-app
token and Telegram bot token loaded in env by the HUMAN, `TG_PUBLIC_URL` tunnel
live (cloudflared `httpHostHeader` must point at the current gateway host — see
engram `demo/crm-telegram-showcase` for the stale-host gotcha).

E2E CLEANUP: `run.sh` tags every HubSpot artifact it creates with an `[E2E]`
subject prefix and deletes them at the end via the connector (trap-guarded,
idempotent). Provisioned platform artifacts (channel, connector, agent,
workflow, service) are NOT torn down — they ARE the demo.

Commits only happen after the double green cluster run of the task's script.

---

## Task queue

### T01 — Scaffolding: `demos/` folder + shared lib

- Create `demos/README.md` (one paragraph: what this folder is, how demos
  differ from `sdk/samples/` — demos are commercial showcases, samples are
  feature references) and `demos/crm-support-telegram/` with `package.json`,
  `tsconfig.json`, `src/lib/` (logging, `requireEnv`, `fail`, stage helpers —
  copied from the `http-bridge` pattern, adapted, NOT imported across trees).
- `demos/crm-support-telegram/README.md` skeleton: pitch, architecture sketch,
  env-var table, script inventory (01→05 + setup.sh + run.sh).
- No cluster interaction in this task — G4 does not apply.

**Accept**
```
cd demos/crm-support-telegram && bunx tsc -p tsconfig.json --noEmit
shellcheck demos/crm-support-telegram/*.sh || test ! -e demos/crm-support-telegram/*.sh
grep -n "commercial showcase" demos/README.md
```

### T02 — `01-telegram-channel.sh`: Telegram bot channel

- Thin wrapper over `src/01-telegram-channel.ts`: ensure the Telegram channel
  account (create-or-update by bot token), register the webhook against
  `TG_PUBLIC_URL`, auto-discover `TELEGRAM_TEST_CHAT_ID` like
  `telegram-transform-reply` does (fail fast with the "DM your bot first"
  message if missing).
- Print the resolved account id + webhook state as the script's last lines
  (the orchestrator and later scripts re-resolve by name, never parse stdout).

**Accept**
```
demos/crm-support-telegram/01-telegram-channel.sh && demos/crm-support-telegram/01-telegram-channel.sh
```

### T03 — `02-hubspot-connector.sh`: HubSpot connector + endpoints

- Thin wrapper over `src/02-hubspot-connector.ts`: ensure connector
  `demo-hubspot` (base URL `https://api.hubapi.com`, bearer auth from
  `HUBSPOT_PRIVATE_APP_TOKEN` header context) with endpoints:
  `search-contact` (POST /crm/v3/objects/contacts/search),
  `create-contact` (POST /crm/v3/objects/contacts),
  `list-deals-by-contact` (GET, associations),
  `list-tickets-by-contact` (GET, associations),
  `create-ticket` (POST /crm/v3/objects/tickets).
- Cache strategy on the two read/list endpoints (short TTL, e.g. 60s) so the
  demo shows `cacheResult` hit/miss; writes stay uncached.
- Smoke check inside the script: sync `connectors.invoke()` of `search-contact`
  with a probe payload; assert HTTP 200 from HubSpot.

**Accept**
```
demos/crm-support-telegram/02-hubspot-connector.sh && demos/crm-support-telegram/02-hubspot-connector.sh
```

### T04 — `03-ai-agent.sh`: the support agent (KB + skills + memory + system variables)

- Thin wrapper over `src/03-ai-agent.ts`: ensure LLM connector (reuse the
  shared `sample-<provider>-llm` convention), knowledge base with 5-8 seeded
  product FAQs, one custom skill (e.g. order-status phrasing guide), system
  variables (company name, SLA hours), and the published agent wired to all of
  them. Memory enabled per user.
- Agent system prompt: leads a support conversation, receives enriched CRM
  context + priority score in the message envelope, adapts tone for VIP.
- Follow `ai-knowledge-base-agent` + `ai-skill-support-agent` provisioning
  paths; the agent must end PUBLISHED (publish lifecycle via agent-admin).

**Accept**
```
demos/crm-support-telegram/03-ai-agent.sh && demos/crm-support-telegram/03-ai-agent.sh
```

### T05 — `04-priority-scorer.sh`: hosted service (code + SDK invoke)

- `priority-scorer/` subfolder: its own `package.json`, `src/`, unit tests,
  Dockerfile-or-buildpack per `hosted-services-api` conventions; never set PORT.
- Endpoints: `POST /score` — parallel `Promise.all` of SYNC
  `connectors.invoke()` to `list-deals-by-contact` + `list-tickets-by-contact`,
  aggregate, compute score with READABLE rules (constants named in business
  language: `OPEN_DEAL_VALUE_VIP_THRESHOLD`, `UNRESOLVED_TICKETS_ESCALATION_COUNT`);
  returns `{ score, tier, reasons[] }`. `POST /webhooks/invoke` — receives the
  async `create-ticket` confirmation; logs outcome. `POST /tickets` — fires the
  ASYNC `connectors.invoke()` `create-ticket` with `idempotencyKey`
  (`ticket-<tenant>-<conversationId>-<turn>`) + webhook pointing back at
  `/webhooks/invoke`; returns `{ invocationId }` immediately.
- Unit tests: scoring rules (VIP, standard, edge: no deals, HubSpot error →
  degraded score with `reasons: ["crm-unavailable"]`, never a crash).
- `04-priority-scorer.sh`: build, register via `client.registry.services`,
  wait Knative Ready, resolve service UUID by slug, direct-invoke `/score`
  smoke check.

**Accept**
```
cd demos/crm-support-telegram/priority-scorer && bun test && bunx tsc -p tsconfig.json --noEmit
demos/crm-support-telegram/04-priority-scorer.sh && demos/crm-support-telegram/04-priority-scorer.sh
```

### T06 — `05-workflow.sh`: the low-code orchestration

- Thin wrapper over `src/05-workflow.ts`: ensure workflow `crm-support-telegram`:
  trigger `message_received` on the Telegram account (account-scoped
  `accountIds`, NEVER a shared unscoped trigger — see the e2e trace
  contamination lesson in engram) → `endpointCall` `search-contact` →
  `jsFunction` (extract/normalize contact or mark unknown) → `serviceCall`
  scorer `/score` (UUID by slug) → `agentCall` (message = user text + enriched
  context block; `conversationId`/`userId` = `{{request.from}}`) →
  `conditional` on `tier == "vip"` (VIP branch prepends escalation notice and
  calls scorer `/tickets`) → `channelSend` reply to `{{request.from}}`.
- Depends on T02-T05 artifacts; resolve every id by name/slug at run time.

**Accept**
```
demos/crm-support-telegram/05-workflow.sh && demos/crm-support-telegram/05-workflow.sh
```

### T07 — `setup.sh` orchestrator + `run.sh` e2e driver

- `setup.sh`: runs 01→05 sequentially, fail-fast, numbered stage log lines;
  resumable by construction (every child script is idempotent — document that
  re-running setup.sh after a failure is THE recovery path).
- `run.sh`: end-to-end proof — simulated inbound (or real Telegram message if
  `TELEGRAM_TEST_CHAT_ID` live), poll the workflow execution API for the
  completed run, assert: contact searched (cache miss then hit on second
  message), score computed, agent replied, reply delivered; VIP path asserted
  with a seeded high-value contact; `[E2E]`-tagged HubSpot tickets deleted at
  the end (trap-guarded).
- `run.sh` prints the admin-console run-view URL for the demo's money shot.

**Accept**
```
demos/crm-support-telegram/setup.sh && demos/crm-support-telegram/setup.sh
demos/crm-support-telegram/run.sh
```

### T08 — Docs + index

- Finish `demos/crm-support-telegram/README.md`: pitch narrative (the two-screen
  close), architecture diagram (mermaid), env table, script-by-script guide,
  the async-invoke `idempotencyKey` + 900s polling-window caveats, demo-day
  runbook (what to click, what to say).
- `README.es.md` functional Spanish version (neutral/professional Spanish, per
  the existing samples' convention).
- Entry in `cowork/INDEX.md` + link `demos/` from the repo root `README.md`.

**Accept**
```
grep -n "crm-support-telegram" cowork/INDEX.md README.md
grep -n "idempotencyKey" demos/crm-support-telegram/README.md
test -f demos/crm-support-telegram/README.es.md
```

---

- [ ] T01 scaffolding demos/ + shared lib
- [ ] T02 01-telegram-channel.sh
- [ ] T03 02-hubspot-connector.sh
- [ ] T04 03-ai-agent.sh
- [ ] T05 04-priority-scorer.sh (hosted service)
- [ ] T06 05-workflow.sh
- [ ] T07 setup.sh orchestrator + run.sh e2e
- [ ] T08 docs + index

## Out of scope (explicit)

- Any change to platform services, SDK, or admin-console — this loop composes,
  it does not patch; gaps get escalated, not fixed inline.
- Other channels (WhatsApp, Instagram, web chat) — Telegram only for v1.
- HubSpot beyond contacts/deals/tickets (no custom objects, no OAuth app) —
  private-app token keeps the demo reproducible in minutes.
- Multi-tenant demo choreography — single dev tenant (`acme`-style) only.
- Load/performance testing of the scorer — demo-scale traffic only.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Human creates the HubSpot free portal + private-app token and the Telegram
  bot, and loads both tokens in env — tokens never enter the repo or the SPEC.
- Human triggers the FIRST full `setup.sh` run against the cluster and the
  first `run.sh` that writes to HubSpot.
- Any platform/SDK gap discovered mid-loop: stop, record findings in Progress,
  and let the human decide (new loop vs. demo redesign).
- Changing scoring-rule thresholds or the cache TTL defaults after T03/T05
  land requires human sign-off (they are part of the demo script/narrative).
