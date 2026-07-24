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

### T01 mapping (audit findings)

Audited: the five `src/NN-*.ts` drivers (`01-telegram-channel.ts`,
`02-hubspot-connector.ts`, `03-ai-agent.ts`, `04-priority-scorer.ts`,
`05-workflow.ts`); the sibling manifests listed in "Prior art"
(`telegram-transform-reply`, `http-connectors`, `ai-skill-support-agent`,
`ai-knowledge-base-agent`, `ai-call-center-supervisor`,
`hosted-services-api`); the writer sources under
`services/provisioning-service/src/modules/apply/infrastructure/`
(`channels-writer.ts`, `registry-services-writer.ts`) and
`services/provisioning-service/src/modules/apply/lib/substitution-allowlist.ts`;
and the manifest schema `packages/shared/src/provisioning/manifest.schema.ts`.

#### Mapping table

| Script resource | Manifest kind + field | Writer / proof (sibling manifest or writer source) |
| --- | --- | --- |
| `01`: Telegram channel account (`ACCOUNT_NAME`/bot token) | `channels[]`, `type: telegram`, `secretRef` | `telegram-transform-reply/manifest.yaml` lines 20-24; `channels-writer.ts` `create()`/`update()` — update only patches `name` (comparable field is `type`), never touches `accessToken`, so an already-live account with an unrelated `externalId` is safely ADOPTED and left alone on reapply (NOOP-safe). |
| `01`: Telegram webhook registration (`setWebhook`) | none — direct Telegram Bot API call, not a platform resource | `channels-writer.ts` never calls the Telegram API; confirmed out-of-band → `bootstrap.sh` (or `run.sh` per decision 3 boundary — see disposition below). |
| `01`: `TELEGRAM_TEST_CHAT_ID` discovery (`getUpdates` polling) | none — local run-side value, not a platform resource | same as above; not applicable to any writer. |
| `02`: `demo-hubspot` connector (bearer auth, base URL) | `connectors[]`, `type: http`, `auth.authType: bearer`, `auth.bearerToken.secretRef` | `http-connectors/manifest.yaml` (endpoints/cache) + `ai-call-center-supervisor/manifest.yaml` lines 26-39 (bearer `auth` block) — proves connectors-writer supports HTTP+bearer with a `secretRef`-bound token, the exact HubSpot Service Key shape. |
| `02`: 5 connector endpoints (`search-contact`, `create-contact`, `list-deals-by-contact`, `list-tickets-by-contact`, `create-ticket`) | `connectors[].endpoints[]`, `method`/`path`/`label`/`cache` | `http-connectors/manifest.yaml` lines 50-77 (per-endpoint `cache` block, `keyBody`/`ttlSeconds`/`methods` — identical shape to `readCacheStrategy` in `02-hubspot-connector.ts`). |
| `02`: HubSpot custom contact property `telegram_user_id` | none — HubSpot Properties API call, not a connector endpoint or any manifest kind | script's own header comment: "the Properties API... is a one-time setup call, not one of the demo's 5 declared connector endpoints"; no manifest kind models a schema-mutation call → `bootstrap.sh` (decision 4, explicit). |
| `03`: LLM connector (`sample-<provider>-llm`) | `connectors[]`, `type: llm`, reused across ai samples | `ai-skill-support-agent/manifest.yaml` lines 28-42 and `ai-knowledge-base-agent/manifest.yaml` lines 19-34 — BYTE-IDENTICAL `sample-openai-llm` declarations in 3+ sibling manifests, proven noop-safe on cross-sample reapply (`connectorComparable` excludes `auth`'s secretRef name from the diff). Disposition: DECLARE in T03 (byte-identical shape, demo-local secret binding name), not "assume present" and not bootstrap.sh. |
| `03`: Knowledge base (`crm-support-faq-kb`) + `ingestion_config` | `knowledgeBases[]`, `ingestion_config.provider_connector_id: { connectorRef }` | `ai-knowledge-base-agent/manifest.yaml` lines 56-96 (KB + `provider_connector_id` symbolic ref) — same `chunk_size`/`chunk_overlap`/`embedding_model`/`chunking_strategy` fields the script sets. |
| `03`: KB seed document (`product-faq.md`, one markdown doc) | `knowledgeBases[].documents[]`, `source.type: inline` | `ai-knowledge-base-agent/manifest.yaml` lines 58-89 — `type: inline` carries the FAQ content verbatim in the manifest; CLI-reachable (no `--bundle` flag needed). Confirms KB document seeding is NOT out-of-band. |
| `03`: Skill (`order-status-phrasing-guide`) | `skills[]` | `ai-skill-support-agent/manifest.yaml` lines 53-93 — exact `files[]`/`trigger_commands`/`mode` shape the script's `buildSkillPayload()` builds. |
| `03`: System variables (`crmSupportCompanyName`, `crmSupportSlaHours`) | `systemVariables[]` | `ai-call-center-supervisor/manifest.yaml` lines 99-108 / `hosted-services-api/manifest.yaml` lines 68-77 — `name`/`type`/`value`/`label`/`description` fields match `ensureSystemVariable()`'s `CreateSystemVariableInput` call exactly. |
| `03`: Support agent (`crm-support-agent`), KB wiring, skill subagent, memory tool, per-user memory | `agents[]`, `profile` (free-form passthrough) + `knowledgeBaseRefs` | `ai-skill-support-agent/manifest.yaml` lines 199-257 (`profile.model_config.subagents[].catalog_skill_id: { skillRef }`, `profile.tools`) + `ai-knowledge-base-agent/manifest.yaml` lines 102-132 (`knowledgeBaseRefs`). `agentSchema.profile` is `z.record(z.string(), z.unknown())` (`manifest.schema.ts:478`) — fully permissive, so the `memory`/`loadSkill` builtin tool entries the script's `buildAgentBody()` sends are expressible verbatim. `knowledgeBaseRefs` (not raw `knowledge_base_ids`) is how the manifest carries the KB-at-CREATE workaround the script hand-rolls — the writer resolves the ref and wires it at create time, so the original-loop `UpdateAgentDto` gap does not resurface. |
| `04`: `priority-scorer` Docker image build (`dev.local/priority-scorer:local`) | none — `serviceSchema` has `image`/`buildRef`, but `registry-services-writer.ts`'s `create()` fails loud (`unsupported_kind_shape`) on any `buildRef` ("registry-service has no buildRef -> image resolution path yet") | confirmed gap, matches `registry-services-writer.ts` lines 481-493 and `hosted-services-api/manifest.yaml`'s own header note ("Only `image` is supported today"). Image build stays `bootstrap.sh` (decision 4, explicit); the manifest's `services[].image` references the pre-built tag. |
| `04`: Registered Knative service (`priority-scorer`, scaling fields) | `services[]`, `name`/`image`/`port`/`minScale`/`maxScale`/`concurrencyTarget` | `hosted-services-api/manifest.yaml` lines 49-63 — same fields as the script's `RegisterServiceInput`/`UpdateServiceInput`. |
| `04`: Service envVars — `YOIZEN_TENANT`, `YOIZEN_BASE_URL` (in-cluster gateway), `SELF_INTERNAL_BASE_URL` | `services[].env[]`, `{name, value}` plain strings | `registry-services-writer.ts` `buildEnvVars()` + `serviceEnvVarSchema` (`manifest.schema.ts:563-570`) — plain-string passthrough. These three values are DETERMINISTIC at manifest-authoring time (`${SERVICE_NAME}-${tenant}` / `${tenant}-${env}-ns` / the fixed in-cluster gateway URL — same formula `04-priority-scorer.ts` computes at Stage 4), so they can be hardcoded literals in the manifest with no ref-substitution needed. |
| `04`: Service envVars — `YOIZEN_EMAIL`, `YOIZEN_PASSWORD`, `HUBSPOT_CONNECTOR_ID`, `HUBSPOT_DEALS_ENDPOINT_ID`, `HUBSPOT_TICKETS_ENDPOINT_ID`, `HUBSPOT_CREATE_TICKET_ENDPOINT_ID` | **NO manifest kind carries these — see "Manifest-engine gap" below.** | n/a |
| `05`: workflow trigger (`message_received`, account-scoped `accountIds`) | `workflows[].definition.trigger`, `config.accountIds: [{ channelRef }]` (ARRAY substitution) | `telegram-transform-reply/manifest.yaml` lines 57-66 — proves the ARRAY `channelRef` substitution the script's `triggerAccountIds: [telegramAccountId]` needs. |
| `05`: `searchContact` endpointCall (connector + endpoint, filtered search) | `workflows[].definition.actions[].activity: endpointCall`, `args.adapterId: { connectorRef }` + `args.url` as a relative path (NOT `args.endpointId`) | `substitution-allowlist.ts` lines 44-49 (`adapterId` → `connectorRef`, the ONLY endpointCall arg on the allowlist — `endpointId` is NOT substitutable); `workflow.interfaces.ts` `EndpointCallArgs` docstring lines 57-72, shape (2): `adapterId` (no `endpointId`) + `url` as a path — "adapter's `baseUrl` is joined with `url`... Adapter headers/auth/timeouts/retries still apply." This is a **deliberate deviation from the script's literal `endpointId` wiring**, not an approximation: `search-contact` is UNCACHED in the original design, so bypassing the specific endpoint id (and its cache config) changes nothing observable. |
| `05`: `scoreContact`/`createTicket` serviceCall (priority-scorer) | `workflows[].definition.actions[].activity: serviceCall`, `args.serviceId: { serviceRef }` | `ai-call-center-supervisor/manifest.yaml` lines 120-131 (`serviceId: { serviceRef: sample-crm }`) + `substitution-allowlist.ts` lines 57-63. |
| `05`: `supportAgent` agentCall | `workflows[].definition.actions[].activity: agentCall`, `args.agentId: { agentRef }` | `ai-call-center-supervisor/manifest.yaml` lines 146-154 + `substitution-allowlist.ts` lines 50-56. |
| `05`: `vipRoute` conditional + `replyEscalated`/`replyStandard` channelSend | `workflows[].definition.actions[].activity: conditional` (`branches`/`default`) and `channelSend` (`args.accountId: { channelRef }`) | `ai-call-center-supervisor/manifest.yaml` lines 211-240 — same `conditional`/`channelSend` shape, `channelRef` on `accountId`. |
| `05`: `normalizeContact`/`buildAgentContext`/`buildEscalationReply` jsFunction bodies | `workflows[].definition.actions[].activity: jsFunction`, `args.code` | `telegram-transform-reply/manifest.yaml` lines 39-47 and `ai-call-center-supervisor/manifest.yaml` lines 132-210 — `code` embedded verbatim, matches the script's `(ctx) => {...}` bodies. |

#### Manifest-engine gap (escalation candidate, flags T04 — does NOT block T02/T03/T05)

`services[].env[]` (`serviceEnvVarSchema`, `manifest.schema.ts:563-570`) is
`{ name: string, value: string }` — a **plain-string-only** field, `.strict()`,
with no `{ secretRef }` or `{ <kind>Ref }` variant. Confirmed against the
writer (`registry-services-writer.ts` `buildEnvVars()`, lines 132-149:
`envVars[envVar.name] = envVar.value` — a literal passthrough, no broker
call) and against the schema's own header comment (lines 539-562):
`{ secretRef }` was deliberately excluded ("would bake the literal secret
into the Knative spec... SECRET-VALUED env vars are NOT EXPRESSIBLE pending
a k8s-native `secretKeyRef` follow-up design"). There is also no
`connectorRef`/`endpointRef` entry for any `services[].env[]` key in
`substitution-allowlist.ts` (the allowlist only covers workflow/agent-tree
argument keys, not service env values).

This blocks TWO of the priority-scorer's required env vars (`04-priority-scorer.ts`
Stage 5 / `priority-scorer/src/config.ts`):
- `YOIZEN_EMAIL` / `YOIZEN_PASSWORD` — the scorer's own platform login
  credentials (used to call `connectors.invoke()` at runtime). Expressing
  these as a manifest literal would violate this SPEC's own "No secrets in
  the repo" constraint; the schema offers no secretRef alternative for
  services.
- `HUBSPOT_CONNECTOR_ID`, `HUBSPOT_DEALS_ENDPOINT_ID`,
  `HUBSPOT_TICKETS_ENDPOINT_ID`, `HUBSPOT_CREATE_TICKET_ENDPOINT_ID` — real
  ids generated at connector/endpoint CREATE time, unknowable at manifest-
  authoring time, and there is no ref-substitution mechanism for service env
  values (unlike workflow action args, which DO have `substitution-allowlist.ts`).

The other three env vars the script sets (`YOIZEN_TENANT`, `YOIZEN_BASE_URL`,
`SELF_INTERNAL_BASE_URL`) are deterministic given the service/tenant names
and CAN be hardcoded literals — no gap there.

Per user decision 6 ("A manifest-engine gap that blocks a resource kind
this demo needs = STOP, record findings, escalate... do NOT fall back to
keeping that setup script"): the `services` resource KIND itself is fully
supported (proven above) — only this specific env-value substitution/secret
capability is missing. T01 records this now so the human can decide, before
T04 is attempted, between (a) a `provisioning-manifest-gaps-4` follow-up
adding `secretRef`/ref-substitution support to `services[].env[]`, or (b)
widening `bootstrap.sh`'s scope so it resolves these 6 values via the SDK
(same name-lookup pattern `bootstrap.sh` already uses for everything else)
and calls `client.registry.services.update(id, { envVars })` directly
against the manifest-created service, immediately after `manifests apply`,
in the bootstrap → apply → run order — this still keeps the MANIFEST as the
resource's source of truth (name/image/scaling), it only defers these 6
env-value fields to a thin, idempotent post-apply reconcile script, which
is consistent with decision 4's "genuinely out-of-band" carve-out. This
decision does not block T02/T03/T05 (none of them touch `services[].env`);
it must be resolved before T04 starts.

No other manifest-engine gap was found: every other resource kind the
scripts provision (channel, connector + endpoints + cache, LLM connector,
knowledge base + inline documents, skill, system variables, agent with
KB/skill/memory-tool wiring, registered service scaling fields, workflow
with trigger/endpointCall/serviceCall/agentCall/conditional/channelSend/
jsFunction) has a cited writer or sibling-manifest proof above.

#### Out-of-band disposition summary → `bootstrap.sh` scope

1. HubSpot custom contact property `telegram_user_id` (Properties API
   one-time call — no manifest kind models a schema mutation).
2. `priority-scorer` Docker image build/tag (`dev.local/priority-scorer:local`
   — `registry-services-writer.ts` only supports `image`, never `buildRef`).
3. Telegram webhook registration (`setWebhook`) + `TELEGRAM_TEST_CHAT_ID`
   discovery (`getUpdates` polling) — direct Telegram Bot API calls, not
   platform resources; `channels-writer.ts` never touches the Telegram API.
4. (Pending human decision, see gap above) — possibly the priority-scorer's
   6 credential/id env vars, IF the human rules for disposition (b) instead
   of a manifest-engine fix.

Everything else (KB documents, LLM connector reuse) is NOT out-of-band —
both map to manifest kinds with cited proof above.

#### Name inventory (exact names/slugs the manifest must reuse to ADOPT, not duplicate)

| Artifact | Name/slug | Source in script |
| --- | --- | --- |
| Telegram channel account | `CRM Support Telegram Bot` | `01-telegram-channel.ts` `ACCOUNT_NAME` default (`TG_ACCOUNT_NAME` env override) |
| HubSpot connector | `demo-hubspot` | `02-hubspot-connector.ts` `CONNECTOR_NAME` (no env override) |
| HubSpot connector endpoints | `POST /crm/v3/objects/contacts/search`, `POST /crm/v3/objects/contacts`, `POST /crm/v3/associations/contacts/deals/batch/read`, `POST /crm/v3/associations/contacts/tickets/batch/read`, `POST /crm/v3/objects/tickets` | `02-hubspot-connector.ts` `ENDPOINTS` (matched live by method+path, not by label) |
| HubSpot custom contact property | `telegram_user_id` | `02-hubspot-connector.ts` `TELEGRAM_USER_ID_PROPERTY` |
| LLM connector | `sample-openai-llm` | `03-ai-agent.ts` `LLM_CONNECTOR_NAME` = `sample-${AGENT_PROVIDER}-llm`, `AGENT_PROVIDER` default `openai` (`AI_LLM_CONNECTOR_NAME`/`AI_AGENT_PROVIDER` env overrides) |
| Knowledge base | `crm-support-faq-kb` | `03-ai-agent.ts` `KB_NAME` default (`CRM_KB_NAME` env override) |
| KB document | `product-faq.md` in the live API (must become the slug `product-faq` in the manifest — `documents[].name` is `nameSchema`, no dots, per the `ai-knowledge-base-agent` precedent) | `03-ai-agent.ts` `KB_DOC_NAME` default (`CRM_KB_DOC_NAME` env override) |
| Skill | `order-status-phrasing-guide` | `03-ai-agent.ts` `SKILL_NAME` default (`CRM_SKILL_NAME` env override) |
| Support agent | `crm-support-agent` | `03-ai-agent.ts` `AGENT_NAME` default (`CRM_AGENT_NAME` env override) |
| System variables | `crmSupportCompanyName`, `crmSupportSlaHours` | `03-ai-agent.ts` `ensureSystemVariable()` calls (hardcoded names, not env-overridable) |
| Registered service | `priority-scorer` | `04-priority-scorer.ts` `SERVICE_NAME` default (`SCORER_SERVICE_NAME` env override) |
| Workflow | `crm-support-telegram`, `application: crm-support` | `05-workflow.ts` `WORKFLOW_NAME`/`APPLICATION` defaults (`CRM_WORKFLOW_NAME`/`CRM_WORKFLOW_APPLICATION` env overrides) |

PRECONDITION reminder (SPEC, before T02): verify these exact names/slugs
against the LIVE cluster (`client.channels.listAccounts`,
`client.connectors.list`, etc., or the admin console) before the first
apply — any env override used in the ORIGINAL live run (e.g. a non-default
`TG_ACCOUNT_NAME`) must be reflected in the manifest, or apply will create a
duplicate instead of adopting.

---

- [x] T01 migration audit (script → manifest mapping)
- [x] T02 manifest: channel + HubSpot connector + secrets (merged with T03 — user decision 2026-07-24: the structural validator requires ≥1 process, so a channel+connector-only manifest cannot validate in isolation)
- [x] T03 manifest: agent + KB + skill + system variables (merged with T02; live cutover 2026-07-24: dev tenant found reset, first apply CREATED all resources fresh, second plan = clean noop; KB created but not enumerated in the plan verdict table)
> PAUSED before T04 (user decision 2026-07-24): waiting on manual-loops/provisioning-manifest-gaps-4.md — services[].env[] cannot carry secretRef or ref substitution; T04 resumes fully declarative once gaps-4 ships.
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
