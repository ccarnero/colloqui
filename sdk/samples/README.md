# Samples

Runnable examples of platform features (AI agents, knowledge bases, workflows, channels,
connectors, hosted services). Most samples are still self-contained **bash scripts** that
drive the platform REST APIs directly via `curl`+`jq`, with no `package.json` and no
dependency on `@yoizen/platform-sdk`. The SDK (`sdk/src/*.ts`) now covers 19 resource
namespaces (workflows, channels, webhooks, agents, and more — see
[`sdk/README.md`](../README.md)), and migration is underway: **`http-bridge`** is the first
sample whose `run.sh` is SDK-powered (see [`sdk/GROWTH-PLAN.md`](../GROWTH-PLAN.md) Phase 3,
P3.1) — its `package.json` depends on `@yoizen/platform-sdk` via `file:../..`, and `run.sh`
execs a small TypeScript app (`src/index.ts`) that calls `client.workflows.list()`,
`client.channels.listAccounts()`, and `client.webhooks.ingest()` instead of inline `curl`+`jq`.
`setup.sh` (Telegram bot/chat_id discovery and provisioning) stays bash for now — that surface
has no SDK coverage yet.

The remaining samples below migrate the same way as follow-ups; until a sample's own README
says otherwise, treat it as a shell script, not an SDK consumer.


## ai-agent-playground

A minimal admin-console AI counterpart: it creates/reuses an LLM connector, creates and
publishes an AI agent, submits one `/api/runtime/executions` request, and polls the result.
Unlike HTTP-only samples, this requires a real online LLM credential.

```bash
cd sdk/samples/ai-agent-playground
cp .env.example .env   # set OPENAI_API_KEY or another provider key
./run.sh
```

Default mode is connector-based, matching the admin-console “LLM Connector” field. Use
`AI_CREDENTIAL_MODE=env` only when `agent-ai-service` already has the provider key in its own
deployment environment.


## ai-agent-triage

A call-center **AI triage** workflow — the first sample to run an agent *inside* a workflow
via the `agentCall` action. A customer message arriving on a dedicated HTTP channel instance
is classified by a published AI agent (intent / sentiment / priority / summary as strict
JSON), parsed by a `jsFunction` (fail-safe: unparseable replies escalate), and routed by a
`conditional` exclusive gateway to either a 🚨 escalation alert or a ✅ triage summary DM'd
over Telegram (`channelSend`) — the canonical *parse-then-gate* pairing.

```bash
cd sdk/samples/ai-agent-triage
cp .env.example .env   # set OPENAI_API_KEY or another provider key
./setup.sh
./run.sh   # POSTs three contrasting customer messages to the instance URL
```

See [`ai-agent-triage/README.md`](ai-agent-triage/README.md) for the step-by-engine mapping
and prerequisites (Telegram account via `../telegram-transform-reply/setup.sh` + an LLM key).

## ai-call-center-supervisor

The **capstone call-center sample** — combines a hosted service, an AI agent, conditional
routing, and Telegram escalation in one workflow. An inbound customer message triggers a
`serviceCall` to a registered mock-CRM hosted service (`sample-crm`, Knative echo server),
the CRM record + message are triaged by an AI agent (`agentCall`) that returns an
escalate/resolve verdict, and a `conditional` exclusive gateway routes to either a 🚨
supervisor escalation or a ✅ auto-resolve summary over Telegram. Parse failures fail safe:
a broken triage escalates to a human.

```bash
cd sdk/samples/ai-call-center-supervisor
cp .env.example .env   # set OPENAI_API_KEY or another provider key
./setup.sh
./run.sh   # POSTs an angry refund demand (escalates) and a calm question (auto-resolves)
```

See [`ai-call-center-supervisor/README.md`](ai-call-center-supervisor/README.md) for the
full flow, engine mapping, and prerequisites (Telegram account, LLM key, and a cluster with
`registry-service`/Knative for hosted services).

## ai-knowledge-base-agent

A knowledge-base/RAG counterpart to `ai-agent-playground`: it creates a KB, uploads a
Markdown FAQ, waits for ingestion, attaches the KB to an AI agent, publishes it, and asks a
question whose answer must come from the uploaded document.

```bash
cd sdk/samples/ai-knowledge-base-agent
cp .env.example .env   # set OPENAI_API_KEY or provider key
./run.sh
```

Knowledge bases are standalone admin resources, but current runtime consumption is through
agents via `knowledge_base_ids`. Runtime KB search also needs OpenAI embeddings available in
`agent-ai-service`.

## ai-skill-support-agent

A call-center **support agent with a custom Skill and a Knowledge Base** — demonstrates the
AI > Skills catalog and AI > Knowledge Bases features together. It creates a
`refund-policy-expert` skill (system prompt, trigger commands, reference cheat-sheet file),
a KB with a fictional Acme Telco policy handbook, and an `ai-sample-support` agent that
attaches both (skill via a subagent's `catalog_skill_id` + embedded snapshot,
KB via `knowledge_base_ids`). `run.sh` asks refund/shipping questions through
`/api/runtime/executions` — including an out-of-policy demand to show the rules guardrail.

```bash
cd sdk/samples/ai-skill-support-agent
cp .env.example .env   # set OPENAI_API_KEY or another provider key
./setup.sh
./run.sh
```

See [`ai-skill-support-agent/README.md`](ai-skill-support-agent/README.md) for the verified
skills/subagent contract notes (e.g. skill `files[]` are catalog-only today). No Telegram
needed — only an LLM key.

## ai-system-variables

**System Variables as live configuration** — demonstrates the AI > System Variables store at
its three wired runtime resolution points, in one brand-stamped escalation router:
`companyName` is templated into the `channelSend` notification text, `escalationPriority` is
the **templated right-hand side of a `conditional` rule** (the routing policy is data — PATCH
the variable and the workflow re-routes with no workflow edit, subject to a 5-minute cache),
and `brandVoice` is resolved inside the agent's `system_prompt` when invoked via the
workflow `agentCall`.

```bash
cd sdk/samples/ai-system-variables
cp .env.example .env   # set OPENAI_API_KEY or another provider key
./setup.sh
./run.sh   # posts a furious (🚨 escalates) and a calm (✅ handled) message
```

See [`ai-system-variables/README.md`](ai-system-variables/README.md) for the engine mapping
and gotchas (5-min variable cache, playground/direct chat is NOT wired to the store,
`secret` type has no runtime masking).

## hosted-services-api

A shell sample for the Hosted Services API: it registers a Knative-backed service through
`/api/registry/services`, creates a dynamic route, and invokes it through `api-gateway`.

```bash
cd sdk/samples/hosted-services-api
cp .env.example .env
./setup.sh
./run.sh
```

The sample uses the same idempotent setup style as `http-fanout-telegram`: reruns reuse/update the
service and route; `RECREATE=1 ./setup.sh` rebuilds them.

## http-bridge

**SDK-powered** (`sdk/GROWTH-PLAN.md` P3.1) — a workflow that, on any message arriving over a
**dedicated HTTP channel instance**, **echoes** the received payload (text/from/metadata) plus
an ISO timestamp/epoch ms, and DMs the result to you over Telegram (`channelSend`). It's the
HTTP-channel counterpart to `telegram-transform-reply` — same echo-and-reply shape, different
inbound transport.

```bash
cd sdk/samples/http-bridge
cp .env.example .env   # fill in TELEGRAM_CHAT_ID
./setup.sh             # still bash — Telegram bot/chat_id discovery + provisioning
./run.sh                # SDK-powered: npm-installs on first run, then drives
                        # client.workflows.list() / client.channels.listAccounts() /
                        # client.webhooks.ingest() to POST a test payload
```

See [`http-bridge/README.md`](http-bridge/README.md) for the step-by-engine mapping, the full
message flow, and prerequisites (provision a Telegram account via
`../telegram-transform-reply/setup.sh` first).

## http-connectors

Declarative **outbound HTTP connectors**: each JSON file in `connectors/` wraps a well-known
public API (jsonplaceholder, httpbin, pokeapi, catfacts, httpbin-basic-auth) as a platform
adapter that workflows can call via `endpointCall`. An idempotent `setup.sh` upserts each
connector, `PATCH`es its declarative config (e.g. the `catfacts` 300-second `defaultCache`) on
every run, and reconciles endpoints — re-runs apply only the drift.

```bash
cd sdk/samples/http-connectors
./setup.sh
```

See [`http-connectors/README.md`](http-connectors/README.md) for the connector table and the
config file format.

## http-fanout-telegram

A workflow that, on any message arriving over the HTTP channel, fans out **three connector
calls in parallel** (`branch`), joins the results with a `jsFunction`, POSTs the combined
payload to httpbin, and DMs a summary over Telegram (`channelSend`). It stitches together
`http-connectors` (the outbound connectors) and `telegram-transform-reply` (the Telegram
channel account) into one end-to-end flow.

```bash
cd sdk/samples/http-fanout-telegram
./setup.sh
```

See [`http-fanout-telegram/README.md`](http-fanout-telegram/README.md) for the step-by-engine
mapping and the full message flow.

## telegram-transform-reply

The **automation-side** counterpart to `http-bridge`: a message that arrives on **Telegram**
is transformed by a workflow (echo + a millisecond-precision timestamp) and **replied back over
Telegram** to the same chat. A single idempotent `setup.sh` provisions both artifacts — a
Telegram **channel account** (wires the built-in adapter for receive + send) and the
**workflow** — through the platform API. Unlike `http-bridge` it's shell-based and doesn't use
`@yoizen/http-sdk`; the Telegram path is driven by the platform's built-in `TelegramProvider`.

```bash
cd sdk/samples/telegram-transform-reply
TELEGRAM_BOT_TOKEN="123456:ABC-your-bot-token" ./setup.sh
```

See [`telegram-transform-reply/README.md`](telegram-transform-reply/README.md) for the
end-to-end (`SIMULATE_INBOUND=1`) flow and the full env reference.
