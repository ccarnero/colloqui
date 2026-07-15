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

## Declarative provisioning

A migrated integration provisions its platform resources through ONE
`manifest.yaml` (`apiVersion: yoizen.io/v1`, `kind: IntegrationManifest`,
schema: `packages/shared/src/provisioning/manifest.schema.ts`), applied via
the SDK's `yoizen` CLI against `provisioning-service` — never through an
imperative `setup.sh`/`setup.ts`. See
[`telegram-transform-reply/manifest.yaml`](./channels/telegram-transform-reply/manifest.yaml)
and its README for a worked example, and
[`services/provisioning-service/README.md`](../services/provisioning-service/README.md)
for the full operational contract (plan verdicts, apply ordering, partial-failure
resume, RBAC).

### CLI commands

One-time setup (or run every command through `bun run bin/yoizen.ts` without
linking):

```bash
cd sdk && bun link   # exposes `yoizen` on PATH; or prefix calls with `cd sdk && bun run bin/yoizen.ts`
```

```bash
yoizen manifests validate -f manifest.yaml
yoizen manifests plan     -f manifest.yaml
yoizen manifests apply    -f manifest.yaml --secrets-from-env
```

`validate` and `plan` never mutate anything. `apply` executes the latest
plan in dependency order; a second `apply` against a converged manifest is a
no-op (`0 create / 0 update`, all verdicts `noop`) — the idempotence proof
every migrated integration's README documents.

### Secrets: `--secrets-from-env`

A manifest's `secrets` section carries only NAME + SCOPE bindings, never
values. `apply --secrets-from-env` reads each binding's VALUE from a
same-named environment variable — the value never touches the repo, disk,
or argv. Binding names are slug-cased (manifest `nameSchema`: lowercase
alphanumeric + hyphens), so when your shell doesn't allow hyphens in a bare
`VAR=value` assignment, use the `env` command form:

```bash
env 'telegram-bot-token=<real-bot-token>' \
  yoizen manifests apply -f manifest.yaml --secrets-from-env
```

Missing bindings fail fast, listing every missing variable name — `apply`
never partially resolves secrets silently.

### What `STANDBY.md` means

A sample carrying a `STANDBY.md` at its root is **not** manifest-migrated:
its resources exceed what manifest v1 can express (verified against the
apply engine's writer code, not just the schema — see each `STANDBY.md` for
the specific gap and file:line evidence). Its setup scripts stay untouched
until the gap is closed. The companion SPEC extending manifest v1 with the
missing kinds is
[`manual-loops/provisioning-manifest-gaps.md`](../manual-loops/provisioning-manifest-gaps.md)
— it needs its own human approval before it runs.

`channels/telegram-transform-reply/` is the one reference integration
migrated so far; the other eleven samples are stand-by.

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
