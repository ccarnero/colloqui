# ai-agent-playground

A minimal AI agent wired to an LLM connector, published, and driven through one runtime execution.
Demonstrates the smallest possible "connector -> agent -> execute" shape through
`@yoizen/platform-sdk`. Provisioning is **declarative**: a single [`manifest.yaml`](./manifest.yaml)
applied through the `yoizen` CLI (no setup scripts).

```
manifest.yaml ─► yoizen manifests apply ─► agent-admin-service (connector, agent)

run.sh (src/index.ts) ─► client.runtime.createExecution() ─► poll ─► print reply
```

## Kind decision (`kind: LibraryManifest`)

This manifest provisions a connector + an agent — a PROCESS exists (the agent), but there is
**no channel account** (the agent's `channels: []`, matching the deleted setup.ts). An
`IntegrationManifest` unconditionally requires >=1 inbound channel; `kind: LibraryManifest` waives
that (and the >=1-process check) and instead requires >=1 of connector/mcpServer/service/
systemVariable — satisfied here by the LLM connector alone. Verified locally against
`integrationManifestSchema.safeParse` + `validateManifestStructuralRules` before committing this
manifest.

## What `manifest.yaml` provisions

| Resource | Name | Notes |
| --- | --- | --- |
| Connector | `sample-openai-llm` | `type: llm`, `authType: bearer` via `secretRef` |
| Agent | `ai-sample-playground` | `model_config.llm.connectorId: { connectorRef: sample-openai-llm }`, published |

`model_config.llm.connectorId` is a manifest-time symbolic ref (`manual-loops/provisioning-
manifest-gaps-2.md` T03, gap 2) — resolved to the real connector-admin id by the apply engine's
`SUBSTITUTION_ALLOWLIST`, never sent to agent-admin-service verbatim.

## Secrets (LLM connector bearer auth)

The deleted `setup.ts`'s default credential mode ("connector") created/reused an enabled HTTP
connector tagged `llm` with `authConfig: { bearerToken: apiKey }` — manifest v1's `auth` block is
`secretRef`-only by schema, so the manifest expresses `authType: bearer` with a nested `secretRef`
instead:

| Binding name (= env var for `--secrets-from-env`) | Targets | Value |
| --- | --- | --- |
| `ai-agent-playground-openai-api-key` | `authConfig.bearerToken` | Your real `OPENAI_API_KEY` |

## Prerequisites

- A running dev cluster with a provisioned tenant (`acme` by default).
- A real OpenAI API key (or edit `manifest.yaml`'s connector `config.baseUrl`/`auth` and the
  agent's `model_config.llm.provider`/`model` for a different provider).
- The `yoizen` CLI (`cd sdk && bun link`, or `cd sdk && bun run bin/yoizen.ts ...`).
- CLI environment: `YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`,
  `YOIZEN_PASSWORD` — same as every other sample.

## Provision (declarative)

```bash
cd sdk && bun link   # one-time; or prefix each call with `bun run bin/yoizen.ts`

yoizen manifests validate -f ../integrations/ai/ai-agent-playground/manifest.yaml
yoizen manifests plan     -f ../integrations/ai/ai-agent-playground/manifest.yaml
env "ai-agent-playground-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f ../integrations/ai/ai-agent-playground/manifest.yaml --secrets-from-env
```

A second `apply` is a no-op once converged.

## Run / verify

```bash
cd integrations/ai/ai-agent-playground
./run.sh
```

`run.sh` (`src/index.ts`) is **read-only**: it resolves the agent by name, submits one runtime
execution, polls until `completed`/`failed`, and prints the result. It never creates or modifies
platform objects.

## Environment (run.sh overrides only — provisioning is manifest-driven)

| Var | Default | Notes |
| --- | --- | --- |
| `AI_AGENT_NAME` | `ai-sample-playground` | Must match `manifest.yaml`'s agent name |
| `AI_AGENT_MESSAGE` | see `.env.example` | The message submitted to the agent |
| `POLL_TIMEOUT_S` | `90` | Execution poll timeout |

## Design notes & gotchas

- Editing the provider/model/connector requires editing `manifest.yaml` and re-applying — there is
  no per-run env override anymore (the manifest IS the config).
- `run.sh` only looks up the agent by name; it never provisions anything, so a name mismatch
  between `.env`/env vars and `manifest.yaml` fails with "agent not found — apply manifest.yaml
  first".
