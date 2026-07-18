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

### Provisioning from a blank tenant (dependency order)

From the repo root, resolve infra coordinates and put the bot token in the
environment:

```bash
source integrations/lib/resolve-env.sh   # YOIZEN_* + gateway detection
export TELEGRAM_BOT_TOKEN=<bot-token-from-botfather>   # or however you keep it locally
```

`resolve-env.sh` derives the gateway endpoint (port-forward vs ingress,
picked by a `/health` probe) and exports `YOIZEN_*` (base URL, tenant,
email, password) the same way `port-forward.sh` does. (If you keep a local
gitignored `.env` with your token, source it first — the repo does not ship
one.)

Against a tenant with nothing provisioned yet, apply in this order:

1. [`http/http-connectors/manifest.yaml`](./http/http-connectors/manifest.yaml)
   (`kind: LibraryManifest`) — provisions the shared connector catalog
   (`catfacts`, `httpbin`, `httpbin-basic-auth`, `jsonplaceholder`,
   `pokeapi`) that other samples reference via `external: true`. Its
   `httpbin-basic-auth` connector needs the demo secret defaults documented
   in its own README:
   `env 'httpbin-basic-auth-username=user' 'httpbin-basic-auth-password=passwd'`.
2. [`channels/telegram-transform-reply/manifest.yaml`](./channels/telegram-transform-reply/manifest.yaml)
   — creates the shared Telegram channel account `telegram-transform-reply-bot`,
   the one other samples reference via `external: true`. Bind the token
   inline (double quotes so `$TELEGRAM_BOT_TOKEN` expands) — it travels only
   via `--secrets-from-env`, never a repo file:
   `env "telegram-bot-token=$TELEGRAM_BOT_TOKEN" yoizen manifests apply -f integrations/channels/telegram-transform-reply/manifest.yaml --secrets-from-env`.
3. Everything that declares an `external: true` ref to either of the above —
   currently `channels/http-fanout-telegram`, `http/hosted-services-api`,
   `ai/ai-agent-triage`, `ai/ai-call-center-supervisor`, and
   `ai/ai-system-variables` (each `manifest.yaml` header comments the
   dependency). Applying one of these before its dependency exists fails at
   `apply` with an `unresolved_symbolic_ref` failure; `yoizen manifests plan`
   surfaces the full `unresolvable_external_ref` precondition set instead
   (`plan` records every unresolvable ref, `apply` stops at the first one it
   hits downstream) — the CLI now renders both the failing resource/message
   and a `plan` hint on a 409 (`sdk/src/cli/format-error-detail.ts`,
   `sdk/src/cli/format-typed-error.ts`).

`apply` is convergent: a partial failure is safe to re-run — resources
already applied noop on the next attempt. For the full from-zero walkthrough
(cluster bring-up included), see
[`bootstrap-from-scratch.md`](../bootstrap-from-scratch.md).

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

### History: `STANDBY.md`

All 12 samples are now manifest-migrated; none carry a `STANDBY.md` anymore.
Earlier loops parked samples whose resources exceeded manifest v1
(`STANDBY.md` + untouched setup scripts) until
[`manual-loops/provisioning-manifest-gaps.md`](../manual-loops/provisioning-manifest-gaps.md)
and its follow-ups (`-2.md`/`-3.md`) closed the gaps (`LibraryManifest`,
skills, array `accountIds` substitution, and more).

### `kind: LibraryManifest`

A channel-less, process-less manifest that provisions only shared library
resources — connectors, mcpServers, hosted services, or system variables —
for other manifests to reference via `external: true`. It waives the
`IntegrationManifest`'s ">=1 inbound channel" and ">=1 process" structural
rules, requiring instead ">=1 of connector/mcpServer/service/systemVariable"
(`checkAtLeastOneLibraryResource`). Used by 5 samples: `http-connectors`,
`mcp-connections`, `ai-agent-playground`, `ai-knowledge-base-agent`, and
`ai-skill-support-agent` — see each sample's own `manifest.yaml` header
comment for its specific kind-decision reasoning.

### `skills`

A manifest's `skills` section declares catalog skills (name + prompt/files),
referenced from an agent's `profile.model_config.subagents[].catalog_skill_id`
via a `skillRef` symbolic ref, resolved to the skill's real id at apply time.
Skills are resolved/created BEFORE agents in `RESOURCE_KIND_ORDER`
(`services/provisioning-service/src/modules/plan/domain/plan.interfaces.ts`),
mirroring the existing `mcpServer`-before-`agent` ordering. See
`ai-skill-support-agent/manifest.yaml` for a worked example.

### Trigger pinning: array `accountIds` substitution

A workflow trigger's `config.accountIds` accepts an ARRAY of `{channelRef:
<name>}` entries, substituted element-wise to the real channel account id at
apply time (`ARRAY_SUBSTITUTION_ALLOWLIST`,
`services/provisioning-service/src/modules/apply/lib/array-substitution-allowlist.ts`
— the plural sibling of the scalar `accountId`/`channelRef` mapping). Every
migrated manifest pins its trigger to its own manifest-created channel this
way, so no other workflow fires on that channel's traffic.

### Known caveat: Telegram webhook self-registration

`channel-service` self-registers the Telegram webhook on account creation,
using `CHANNEL_SERVICE_PUBLIC_URL` as the URL base. If that env var is
unset on a deployment, the base falls back to an internal `http://` URL and
Telegram rejects `setWebhook` (`bad webhook: An HTTPS URL must be
provided`) — the account ends up with no webhook and inbound messages
queue at Telegram until it's registered by hand. Once
`CHANNEL_SERVICE_PUBLIC_URL` is set on `channel-service`, self-registration
succeeds and no manual step is needed. See
[`channels/telegram-transform-reply/README.md`](./channels/telegram-transform-reply/README.md)
§ Run / exercise for the full manual remediation procedure (reading the
account's `appSecret` from Postgres and calling `setWebhook` directly).

## Shared library

`lib/resolve-env.sh` is a shared shell helper for resolving the dev-cluster environment
that the samples' `run.sh` drivers source. It exists only for this tier —
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
