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

## Provisioning

**One declarative path**: `manifest.yaml` is the SOLE provisioning artifact for every platform
resource this demo needs (Telegram channel, HubSpot connector, LLM connector, knowledge base,
skill, system variables, AI agent, the `priority-scorer` hosted service, and the
`crm-support-telegram` workflow). The former sequential `01-…05-*.sh`/`setup.sh` scripts are
DELETED (T06) — there is no other provisioning path, do not attempt to resurrect them.

Provisioning order:

```
./bootstrap.sh                                                       # (1) out-of-band items
yoizen manifests apply -f manifest.yaml --secrets-from-env            # (2) everything else
./run.sh                                                              # (3) end-to-end proof
```

1. **`./bootstrap.sh`** — the ONLY provisioning step left outside `manifest.yaml`, carrying
   exclusively what the manifest engine genuinely cannot express: builds/tags the
   `dev.local/priority-scorer:local` Docker image, ensures the HubSpot custom contact property
   `telegram_user_id` (a one-time Properties API schema mutation, not a connector endpoint), and
   registers the Telegram webhook + resolves `TELEGRAM_TEST_CHAT_ID` (direct Telegram Bot API
   calls, not platform resources). Idempotent — safe to re-run. Its webhook-registration stage
   reads the Telegram channel account `manifests apply` creates, so it is written to run either
   before OR after the first apply — before, it registers the webhook against a not-yet-existing
   account and fails loud with a clear message naming this same order; after, it succeeds
   immediately. Re-running it after `manifests apply` is the recommended order and always safe.
2. **`yoizen manifests apply -f manifest.yaml --secrets-from-env`** — creates/updates every
   platform resource. Needs the SDK checked out at `../../sdk` (run from there, or `bunx yoizen`
   once published) and the five secret bindings below present in the environment.
3. **`./run.sh`** — the end-to-end proof (simulated Telegram messages, execution polling,
   assertions, HubSpot cleanup). Verifies the manifest has been applied itself (fails fast naming
   this exact order if the workflow/service aren't found yet).

Re-running `bootstrap.sh` and `manifests apply` is always safe (both are idempotent,
create-or-update) — this is the standard recovery path if any step fails partway.

## Environment variables

**`--secrets-from-env` bindings** (read by `yoizen manifests apply --secrets-from-env`; binding
NAME must match the env var name exactly — see `manifest.yaml`'s `secrets:` block):

| Env var | Manifest secret binding | Scope |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` (as `telegram-bot-token`) | `telegram-bot-token` | `channel: crm-support-telegram-bot` |
| `HUBSPOT_SERVICE_KEY` (as `hubspot-service-key`) | `hubspot-service-key` | `connector: demo-hubspot` |
| `OPENAI_API_KEY` (as `crm-support-telegram-openai-api-key`) | `crm-support-telegram-openai-api-key` | `connector: sample-openai-llm` |
| `YOIZEN_EMAIL` (as `priority-scorer-yoizen-email`) | `priority-scorer-yoizen-email` | `service: priority-scorer` |
| `YOIZEN_PASSWORD` (as `priority-scorer-yoizen-password`) | `priority-scorer-yoizen-password` | `service: priority-scorer` |

Each binding name differs from its underlying credential's usual env var name (e.g.
`TELEGRAM_BOT_TOKEN` binds under `telegram-bot-token`), so `--secrets-from-env` needs the value
exposed under the BINDING name at apply time, e.g.:

```
env "telegram-bot-token=$TELEGRAM_BOT_TOKEN" \
    "hubspot-service-key=$HUBSPOT_SERVICE_KEY" \
    "crm-support-telegram-openai-api-key=$OPENAI_API_KEY" \
    "priority-scorer-yoizen-email=$YOIZEN_EMAIL" \
    "priority-scorer-yoizen-password=$YOIZEN_PASSWORD" \
    bun run bin/yoizen.ts manifests apply -f ../demos/crm-support-telegram/manifest.yaml --secrets-from-env
```

(run from `sdk/`; `YOIZEN_EMAIL`/`YOIZEN_PASSWORD` also double as the `priority-scorer` hosted
service's OWN platform login credentials at runtime — same values, two different purposes: the
CLI's own session auth, and the scorer's bound secret. The `priority-scorer-yoizen-*` bindings
resolve k8s-natively via `valueFrom.secretKeyRef`, never a plaintext env var in the Knative spec —
see `manual-loops/provisioning-manifest-gaps-4.md`.)

**Run-side env vars** (not manifest secrets — read directly by `bootstrap.sh`/`run.sh`):

| Var | Purpose |
| --- | --- |
| `TG_PUBLIC_URL` | Public URL (e.g. cloudflared tunnel) the Telegram webhook is reachable at — read by `bootstrap.sh`'s webhook-registration stage |
| `TELEGRAM_TEST_CHAT_ID` | Chat id used by `run.sh` to simulate a customer message. Auto-discovered by `bootstrap.sh` (DM the bot first) and cached if unset |
| `YOIZEN_TENANT`/`YOIZEN_EMAIL`/`YOIZEN_PASSWORD`/`YOIZEN_BASE_URL` | Platform login/session — not demo-specific, auto-defaulted by `lib/resolve-demo-env.sh` to the shared dev-seed convention |

No secrets are committed — every credential above is read from the environment (`.env`, not
tracked; see `.env.example` for the documented shape) at run time, sourced by
`lib/resolve-demo-env.sh` (same convention `bootstrap.sh`/`run.sh` both use).

## Script inventory

| Script | Purpose |
| --- | --- |
| `bootstrap.sh` | Thin wrapper over `src/bootstrap.ts` — the out-of-band provisioning step (image build, HubSpot custom property, Telegram webhook + chat-id) — see Provisioning above |
| `run.sh` | Thin wrapper over `src/06-run-e2e.ts` — sends two simulated customer messages (standard-tier, then VIP-tier) end to end and reports the resulting Telegram reply + HubSpot ticket |

`manifest.yaml` (applied via the `yoizen` CLI, not a script in this directory) provisions
everything else. `priority-scorer/` is the hosted service's own source + Dockerfile, unrelated to
provisioning.
