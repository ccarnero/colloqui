# SPEC — crm-support-telegram: manifest migration + docs (demos/)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> REPLACES the original crm-support-telegram SPEC (user decision 2026-07-24:
> overwrite). The original loop shipped T01–T07 (script-based provisioning);
> its task history and platform-gap findings live in git history and in the
> engram topic 'demo/crm-telegram-showcase' — they remain binding prior art.
> Depends on: `manual-loops/provisioning-manifest-gaps.md`, `-2.md`, `-3.md`
> (shipped — the manifest v1 apply engine now carries connectors with
> authConfig + endpoints + cache strategies, agents with KB/skills/memory,
> knowledgeBases, systemVariables, services, workflows with manifest-time
> ref substitution, and secrets via `--secrets-from-env`).
> Engram topic: 'demo/crm-telegram-showcase'.

## Goal

Retake the commercial showcase demo `demos/crm-support-telegram/` and migrate
its provisioning from the five sequential setup scripts
(`01-telegram-channel.sh` … `05-workflow.sh` + `setup.sh`) to a single
declarative `manifest.yaml` applied with
`yoizen manifests apply -f manifest.yaml --secrets-from-env` — the same
end-state `integrations/channels/telegram-transform-reply` reached in its
migration (setup scripts DELETED, manifest is the only provisioning path).
Then finish the docs + index work the original loop left pending (its T08).

The demo itself does not change: Telegram support conversation led by an AI
agent (KB, per-user memory, skill, system variables), a low-code workflow
enriching every turn (HubSpot `endpointCall` → `jsFunction` → `serviceCall`
priority-scorer → `agentCall` → VIP `conditional` → `channelSend`), and the
`priority-scorer` hosted service showing code-over-low-code with sync/async
`connectors.invoke()`. Demo closes on the run-view trace and the real HubSpot
ticket.

## User decisions (human boundary — do not reinterpret)

1. This SPEC OVERWRITES the original; delivery method stays manual-loop.
2. End state mirrors `telegram-transform-reply`: `manifest.yaml` +
   `yoizen` CLI, setup scripts (`01`–`05`, `setup.sh`, and their `src/NN-*.ts`
   drivers) DELETED, not kept as fallback.
3. `run.sh` (e2e driver) SURVIVES the migration — run-side behavior
   (simulated inbound, assertions, HubSpot seeding/cleanup) is not
   provisioning and stays script-based, like `telegram-transform-reply`'s
   run-side driver did.
4. Anything genuinely out-of-band for the manifest engine (HubSpot custom
   contact property `telegram_user_id`, priority-scorer image build, Telegram
   webhook liveness/`TELEGRAM_TEST_CHAT_ID` discovery) is allowed to live in a
   SINGLE `bootstrap.sh` (thin wrapper over `src/bootstrap.ts`) — but T01
   must first prove each item cannot be carried by the manifest before it
   lands there.
5. External system stays HubSpot Free CRM with Service Key (or legacy
   private-app token) — Bearer auth, outbound REST only, zero cost.
6. No platform/SDK/admin-console changes. A manifest-engine gap that blocks a
   resource kind this demo needs = STOP, record findings, escalate (candidate
   `provisioning-manifest-gaps-4`), do NOT fall back to keeping that setup
   script.

## Prior art (validated — REUSE, do not duplicate)

- `integrations/channels/telegram-transform-reply/manifest.yaml` — the
  reference migrated integration: channel + `secretRef` + workflow pinned via
  ARRAY `channelRef` substitution; secret binding scoped
  `kind: channel, owner: <channel name>`; binding NAME == env var read by
  `--secrets-from-env`; header comments document the accessToken/externalId
  end-state vs the deleted setup script.
- `integrations/http/http-connectors/manifest.yaml` — connector with
  authConfig + endpoints + cache strategies, declaratively.
- `integrations/ai/ai-skill-support-agent/manifest.yaml` and
  `integrations/ai/ai-knowledge-base-agent/manifest.yaml` — agents wired to
  knowledgeBases + skills declaratively.
- `integrations/ai/ai-call-center-supervisor/manifest.yaml` — the closest
  full-shape sibling: channels + connectors + agents + systemVariables +
  services + workflows + secrets in ONE manifest.
- `integrations/http/hosted-services-api/manifest.yaml` — `services:` kind
  (Knative registration; PORT is reserved, never set it).
- `demos/crm-support-telegram/src/01-…05-*.ts` (to be deleted) — the exact
  resource shapes to translate: connector endpoints incl. the
  `associations/.../batch/read` POST endpoints with `keyBody: true` 60s
  cache, uncached `search-contact`, agent prompt + KB seed docs + skill +
  system variables, scorer registration envVars (precomputed in-cluster
  URLs), workflow body incl. `{{executionId}}`/`{{workflow.tenant}}`
  idempotency-key args and the account-scoped trigger.
- Original-loop findings (git history of this file + engram topic
  'demo/crm-telegram-showcase'): gateway `UpdateAgentDto` drops
  `knowledge_base_ids` (wire KB at CREATE), `PATCH /admin/skills/:id` 500s,
  KB ingestion-worker stalls, `sdk/dist` staleness, `.dockerignore` excludes
  `**/dist`, OrbStack `*.svc.cluster.local` host resolution. Verify which of
  these the manifest writers already absorb before re-working around them.
- `yoizen` CLI: `manifests validate|plan|apply -f <file> [--secrets-from-env]`,
  `secrets put`. Secret binding names are slug-cased — invoke as
  `env 'telegram-bot-token=…' bunx yoizen …` when the env var name differs.

## Constraints (apply to every task)

- All artifacts in English (manifest comments, code, docs, scripts).
- The manifest is the SINGLE source of truth for platform resources; `run.sh`
  and `bootstrap.sh` resolve ids by name/slug via the SDK, never create
  platform artifacts.
- Idempotency contract upgrades from "script re-run safe" to MANIFEST NOOP:
  a second `yoizen manifests apply` immediately after a successful apply must
  produce a no-op plan (0 creates / 0 updates) — same G5 proof
  `telegram-transform-reply` shipped with.
- No secrets in the repo — `--secrets-from-env` at apply time
  (`HUBSPOT_SERVICE_KEY`, `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY`; plus
  `TELEGRAM_TEST_CHAT_ID`, `TG_PUBLIC_URL` for run-side).
- Verbose logging on every path; nothing fails silently.
- NO changes to platform services, SDK, or admin-console (see user decision 6).
- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
  (Deleting the setup scripts is sanctioned by decision 2 and is not a test
  deletion; `priority-scorer` unit tests must survive untouched.)

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — demo typecheck (always)
cd demos/crm-support-telegram && bunx tsc -p tsconfig.json --noEmit
# G2 — shell lint, all remaining scripts (always)
shellcheck demos/crm-support-telegram/*.sh
# G3 — priority-scorer unit tests (always — they must survive the migration)
cd demos/crm-support-telegram/priority-scorer && bun test
# G4 — manifest validates and plans cleanly (from T02 onward)
cd sdk && bun run bin/yoizen.ts manifests validate -f ../demos/crm-support-telegram/manifest.yaml
# G5 — TASK E2E (per-task, from T02 onward): apply against the dev cluster,
#      then apply AGAIN — the second plan must be a NO-OP (0 creates/updates)
cd sdk && bun run bin/yoizen.ts manifests apply -f ../demos/crm-support-telegram/manifest.yaml --secrets-from-env \
  && bun run bin/yoizen.ts manifests plan -f ../demos/crm-support-telegram/manifest.yaml
```

Gate rules OVERRIDE for THIS queue: this loop touches NO platform services, so
dev-mode/rebuild-redeploy gates do not apply. The apply + noop-plan proof
against the live dev cluster IS the commit gate for manifest tasks.

PRECONDITION (before T02, once): dev cluster reachable; HubSpot Service Key,
Telegram bot token, and OpenAI key loaded in env by the HUMAN; `TG_PUBLIC_URL`
tunnel live (cloudflared origin port 80 + current gateway host — see engram
'demo/crm-telegram-showcase' for both gotchas). The EXISTING script-provisioned
artifacts from the original loop are live on the cluster: the manifest must
ADOPT them (create-or-update by the same names), not duplicate them — verify
by name inventory before the first apply, and treat a duplicated artifact as a
gate failure.

Commits only happen after the task's gates run green against the cluster.

---

## Task queue

### T01 — Migration audit: script → manifest mapping

- Read the five `src/NN-*.ts` drivers and produce a mapping table (in this
  SPEC's Progress section): every resource each script creates → the manifest
  kind + writer that will carry it, citing the sibling manifest that proves
  the writer supports it (per Prior art).
- Explicitly disposition the suspected out-of-band items (user decision 4):
  HubSpot custom property `telegram_user_id`, priority-scorer image build
  (`dev.local/priority-scorer:local`), Telegram webhook registration +
  `TELEGRAM_TEST_CHAT_ID` discovery, KB document seeding (check how
  `ai-knowledge-base-agent/manifest.yaml` carries documents), LLM connector
  reuse (`sample-<provider>-llm` shared convention — adopt, don't duplicate).
- Name inventory of the live script-provisioned artifacts (channel, connector,
  agent, KB, skill, system variables, service, workflow) so the manifest
  reuses the exact names — the adoption contract for the G5 noop proof.
- Output: mapping table + `bootstrap.sh` scope (possibly empty) + any
  manifest-engine gap that forces escalation (user decision 6). No cluster
  writes; G4/G5 do not apply.

**Accept**
```
grep -n "T01 mapping" manual-loops/crm-support-telegram.md
```

### T02 — `manifest.yaml`: channel + HubSpot connector + secrets

- Author `demos/crm-support-telegram/manifest.yaml`
  (`kind: IntegrationManifest`, `metadata.name: crm-support-telegram`) with:
  the Telegram channel (secretRef → `telegram-bot-token` binding, channel
  scope, per the `telegram-transform-reply` pattern), the `demo-hubspot`
  connector (base URL `https://api.hubapi.com`, bearer auth from the
  `hubspot-service-key` binding) with the five endpoints exactly as shipped:
  `search-contact` (POST search, UNCACHED — original-loop decision),
  `create-contact`, `list-deals-by-contact` + `list-tickets-by-contact`
  (POST `associations/.../batch/read`, `keyBody: true`, 60s cache),
  `create-ticket`; secrets block with both bindings.
- Header comments document the end-state vs the deleted scripts, same style
  as `telegram-transform-reply/manifest.yaml`.
- Names must match the live artifacts (T01 inventory) — apply must adopt,
  not duplicate.

**Accept**
```
cd sdk && bun run bin/yoizen.ts manifests validate -f ../demos/crm-support-telegram/manifest.yaml
```

### T03 — Manifest: agent + knowledge base + skill + system variables

- Extend the manifest with: the knowledge base + its seeded FAQ documents
  (per the `ai-knowledge-base-agent` manifest pattern), the custom skill, the
  system variables (company name, SLA hours), the LLM connector reference
  (reuse the shared `sample-<provider>-llm` — T01 disposition decides whether
  it is declared here or assumed present), and the PUBLISHED support agent
  wired to all of them with per-user memory — same prompt and wiring as the
  deleted `03-ai-agent.ts`.
- Honor the original-loop findings if the writers do not already: KB wired at
  agent CREATE (gateway `UpdateAgentDto` gap), static skill payload
  (skills PATCH 500), skip reingest for unchanged ready documents.

**Accept**
```
cd sdk && bun run bin/yoizen.ts manifests validate -f ../demos/crm-support-telegram/manifest.yaml
```

### T04 — Manifest: priority-scorer service + `bootstrap.sh` (image build)

- Extend the manifest with the `services:` entry for `priority-scorer`
  (Knative registration per `hosted-services-api` pattern; never set PORT;
  envVars carry the precomputed in-cluster gateway + self URLs exactly as the
  deleted `04-priority-scorer.ts` did — they are deterministic per
  registry-service naming).
- `bootstrap.sh` (thin wrapper over `src/bootstrap.ts`) carries ONLY the
  T01-dispositioned out-of-band items — at minimum the Docker image build/tag
  (`dev.local/priority-scorer:local`) and the HubSpot custom property
  `telegram_user_id` ensure — idempotent, verbose, fail-fast. Document in
  README order: bootstrap → apply → run.
- `priority-scorer/` code and unit tests remain UNTOUCHED.

**Accept**
```
cd demos/crm-support-telegram/priority-scorer && bun test
demos/crm-support-telegram/bootstrap.sh && demos/crm-support-telegram/bootstrap.sh
cd sdk && bun run bin/yoizen.ts manifests validate -f ../demos/crm-support-telegram/manifest.yaml
```

### T05 — Manifest: the workflow (full graph, refs substituted)

- Extend the manifest with the `crm-support-telegram` workflow: account-scoped
  `message_received` trigger pinned via `channelRef` substitution (never a
  shared unscoped trigger) → `endpointCall` `search-contact` (connector ref
  substitution) → `jsFunction` normalize → `serviceCall` scorer `/score`
  (service ref) → `agentCall` (`conversationId`/`userId` =
  `{{request.from}}`) → `conditional` `tier == "vip"` (escalation notice +
  scorer `/tickets`) → `channelSend` to `{{request.from}}`.
- Preserve the shipped runtime-template args verbatim — especially the
  idempotency-key args `{{executionId}}` / `{{workflow.tenant}}` (original
  T06 finding: `{{workflow.tenantId}}`/`{{workflow.startTime}}` silently
  resolve to `""` and collapse the key).
- This completes the manifest: the G5 apply must now converge the ENTIRE
  demo and noop on the second plan.

**Accept**
```
cd sdk && bun run bin/yoizen.ts manifests apply -f ../demos/crm-support-telegram/manifest.yaml --secrets-from-env
cd sdk && bun run bin/yoizen.ts manifests plan -f ../demos/crm-support-telegram/manifest.yaml
```

### T06 — Delete setup scripts, rewire `run.sh`, README core rewrite

- DELETE `01-…05-*.sh`, `setup.sh`, and their `src/NN-*.ts` drivers (git rm).
  Keep `run.sh`, `src/06-run-e2e.ts` (adjust imports/shared lib as needed),
  `bootstrap.sh`, `priority-scorer/`, `lib`.
- `run.sh` prerequisites section now checks "manifest applied" (resolve the
  workflow + service by name via SDK, fail fast with the
  bootstrap→apply→run instruction) instead of "run setup.sh first".
- Rewrite `README.md` provisioning sections: bootstrap → `yoizen manifests
  apply --secrets-from-env` → `run.sh`; env table updated; script inventory
  reduced to `bootstrap.sh` + `run.sh`.
- Full-demo convergence proof: G5 apply + noop plan, then `bootstrap.sh`
  re-run (still idempotent against an applied cluster).

**Accept**
```
test ! -e demos/crm-support-telegram/setup.sh
test ! -e demos/crm-support-telegram/01-telegram-channel.sh
cd sdk && bun run bin/yoizen.ts manifests apply -f ../demos/crm-support-telegram/manifest.yaml --secrets-from-env
cd sdk && bun run bin/yoizen.ts manifests plan -f ../demos/crm-support-telegram/manifest.yaml
grep -n "manifests apply" demos/crm-support-telegram/README.md
```

### T07 — Docs + index (absorbs the original T08)

- Finish `README.md`: pitch narrative (two-screen close), mermaid
  architecture diagram, env table, bootstrap/apply/run guide, async-invoke
  `idempotencyKey` + 900s polling-window caveats, demo-day runbook, and a
  short "declarative provisioning" section selling the manifest as part of
  the showcase (one YAML, one apply, noop-idempotent).
- `README.es.md` functional Spanish version (neutral/professional Spanish,
  per the existing samples' convention).
- Entry in `cowork/INDEX.md` + link `demos/` from the repo root `README.md`.

**Accept**
```
grep -n "crm-support-telegram" cowork/INDEX.md README.md
grep -n "idempotencyKey" demos/crm-support-telegram/README.md
grep -n "manifests apply" demos/crm-support-telegram/README.md
test -f demos/crm-support-telegram/README.es.md
```

---

- [ ] T01 migration audit (script → manifest mapping)
- [ ] T02 manifest: channel + HubSpot connector + secrets
- [ ] T03 manifest: agent + KB + skill + system variables
- [ ] T04 manifest: priority-scorer service + bootstrap.sh
- [ ] T05 manifest: workflow (completes the manifest)
- [ ] T06 delete setup scripts + rewire run.sh + README core
- [ ] T07 docs + index

## Out of scope (explicit)

- Any change to platform services, SDK, or admin-console — gaps get escalated
  (candidate `provisioning-manifest-gaps-4`), not fixed inline.
- Changing the demo's behavior, scoring rules, cache TTLs, prompts, or
  workflow shape — this loop migrates provisioning, it does not redesign.
- Other channels, HubSpot beyond contacts/deals/tickets, multi-tenant
  choreography, load testing — unchanged from the original SPEC.
- Migrating `run.sh`/e2e assertions to a declarative form — run-side stays
  code by design (user decision 3).

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Human keeps the HubSpot Service Key and Telegram bot token in env — tokens
  never enter the repo or the SPEC.
- Human triggers the FIRST `manifests apply` against the cluster (T02) and
  the first post-migration `run.sh` that writes to HubSpot (T06).
- Any manifest-engine gap discovered mid-loop: stop, record findings in
  Progress, and let the human decide (gaps-4 loop vs. bootstrap.sh scope
  extension).
