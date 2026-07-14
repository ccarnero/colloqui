# crm-support-telegram

> Commercial showcase (see `../README.md`) — not an SDK feature sample.

## Pitch

End-to-end customer support over Telegram, backed by a real HubSpot CRM. An AI agent leads the
conversation with the customer; a low-code workflow enriches every turn (looks up/creates the
HubSpot contact, fetches ticket history, scores priority); a hosted **priority-scorer** connector
service demonstrates **code-over-low-code** for the one step that's easier to express in a real
language than in the workflow builder. The scorer is invoked two ways in the same demo: a
**parallel sync `connectors.invoke()`** call for the fast path (score available before the agent's
next reply), and an **async invoke with `idempotencyKey` + webhook callback** for the slow path
(ticket creation in HubSpot), so the demo showcases both invocation modes of
`@yoizen/platform-sdk`'s connectors resource.

## Architecture sketch

```
Telegram customer message
        │
        ▼
Telegram channel (workflow trigger: message_received)
        │
        ▼
Workflow (low-code)
  ├─ HubSpot contact lookup/create   (connector or jsFunction + HubSpot API)
  ├─ priority-scorer  connectors.invoke()  [sync, parallel branch]  ──► score
  ├─ AI agent turn                    (agent-ai-service, sees score + CRM context)
  └─ ticket creation  connectors.invoke()  [async, idempotencyKey + webhook]
        │                                        │
        ▼                                        ▼
   Telegram reply to customer          webhook delivers ticket result back
                                        into the workflow / HubSpot
```

## Environment variables

| Var | Purpose |
| --- | --- |
| `HUBSPOT_SERVICE_KEY` | HubSpot account Service Key (Bearer `pat-na1-…`, public beta since 2026-02-10, Development > Keys > Service keys, object scopes) used for contact lookup/create, deal/ticket association reads, and ticket creation. A legacy private-app token is an equally free, interchangeable Bearer-token fallback. |
| `TELEGRAM_BOT_TOKEN` | Bot token for the customer-facing Telegram channel |
| `TELEGRAM_TEST_CHAT_ID` | Chat id used by test/demo scripts to simulate a customer message |
| `OPENAI_API_KEY` | Backing model for the AI agent leading the support conversation |
| `TG_PUBLIC_URL` | Public URL (e.g. cloudflared tunnel) the Telegram webhook and async-invoke webhook callback are reachable at |

No secrets are committed — every credential above is read from the environment (`.env`, not
tracked; see `.env.example` for the documented shape) at run time. `YOIZEN_TENANT`, `YOIZEN_EMAIL`,
`YOIZEN_PASSWORD`, `YOIZEN_BASE_URL` (platform login/session) are not demo-specific — they are
sourced from the sibling SDK sample `.env` files (see the numbered scripts' own header comments).

## Script inventory

| Script | Purpose |
| --- | --- |
| `setup.sh` | Resolves the dev environment (mirrors `sdk/samples/lib/resolve-env.sh`) and drives provisioning end to end |
| `01-telegram-channel.sh` | Provisions the customer-facing Telegram channel account |
| `02-hubspot-connector.sh` | Registers the HubSpot connector deployment (contact lookup/create, ticket API) |
| `03-ai-agent.sh` | Provisions the AI support agent that leads the conversation — knowledge base, skills, memory, and system variables |
| `04-priority-scorer.sh` | Deploys/registers the hosted priority-scorer connector service (code-over-low-code step) |
| `05-workflow.sh` | Assembles the low-code workflow wiring trigger → CRM enrichment → parallel sync scorer invoke → agent turn → async ticket invoke (idempotencyKey + webhook) |
| `run.sh` | Sends a simulated customer message end to end and reports the resulting Telegram reply + HubSpot ticket |

None of the above scripts exist yet in this task — this README documents the intended shape for
the follow-up tasks that add them.

## Status

Scaffolding only (this task). No cluster interaction, no provisioning logic yet — see
`src/lib/` for the shared logging/`requireEnv`/`fail`/stage helpers that the numbered scripts
above will build on, adapted from `sdk/samples/http-bridge`'s pattern.
