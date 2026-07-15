# integrations

**Reason to exist:** each folder under `integrations/` documents one platform FEATURE
end-to-end (a channel, an AI capability, an HTTP/connectors flow, an MCP integration) —
minimal, dependency-light, and provisioned through the platform SDK.

## What an integration example is

An integration is a small, focused reference for a single platform capability: it
provisions the resources that capability needs (a channel account, a connector, an
agent, a knowledge base, a workflow, ...), then drives one representative run through
it. It is meant to be read end to end by an engineer learning that one feature's
surface — not a business narrative and not a tour of the SDK's API shape.

## Group index

### `channels/` — channel provisioning and message flow

- `telegram-transform-reply/` — a message arriving on Telegram is transformed by a
  workflow and replied back over Telegram to the same chat.
- `http-fanout-telegram/` — a message arriving on a dedicated HTTP channel instance is
  fanned out to Telegram via a workflow.
- `telegram-onboard.sh` — interactive helper to resolve a Telegram bot's chat id for
  local runs of the samples above.

### `ai/` — AI agents, knowledge bases, skills, and system variables

- `ai-agent-playground/` — create an AI agent, wire it to an online LLM, publish it,
  and run one chat request through the same API surface as the admin-console AI pages.
- `ai-agent-triage/` — an AI agent classifies an inbound message (intent, sentiment,
  priority) inside a workflow, routed to a dedicated HTTP channel instance.
- `ai-call-center-supervisor/` — the capstone sample: a hosted service, an AI agent,
  and conditional workflow routing combined into one supervisor loop.
- `ai-knowledge-base-agent/` — create a knowledge base, upload a document, attach it
  to an AI agent, and ask a question answered from that document.
- `ai-skill-support-agent/` — a support agent combining a custom AI skill and a
  knowledge base.
- `ai-system-variables/` — admin-console System Variables drive live configuration at
  runtime resolution points inside a workflow.

### `http/` — hosted services and outbound connectors

- `hosted-services-api/` — register a tenant-scoped hosted service, create a dynamic
  route for it, and invoke it through `api-gateway`.
- `http-connectors/` — declarative outbound HTTP connectors wrapping public developer
  APIs as platform adapters, invoked from a workflow's `endpointCall` action.

### `mcp/` — Model Context Protocol servers

- `mcp-connections/` — the MCP Connections feature end to end: typed auth on an MCP
  server, a live connectivity probe, tool discovery, and per-agent tool enablement.
- `mcp-repo-support-bot/` — a Telegram bot answering questions about a GitHub
  repository through the `mcpCall` workflow action.

## Shared library

`lib/resolve-env.sh` is a shared shell helper for resolving the dev-cluster environment
that the samples' `setup.sh`/`run.sh` scripts source. It exists only for this tier —
see the no-shared-lib rule below for why `sdk/examples/` cannot depend on it.

## How this tier differs from the other two

- **`sdk/examples/`** demonstrates the SDK's own API surface (auth/config, per-resource
  CRUD, `connectors.invoke()`, pagination, error handling) — small snippets about the
  client library itself, not a platform feature. See [`sdk/examples/README.md`](../sdk/examples/README.md).
- **`integrations/`** (this tier) documents a platform feature end to end, provisioning
  real resources through the SDK.
- **`demos/`** tells a business story: a believable customer scenario that may compose
  several integrations' worth of capability into one narrative, with longer setup and
  external SaaS dependencies. See [`demos/README.md`](../demos/README.md).
