# AI agent playground sample

Create a real AI agent, wire it to an online LLM, publish it, then execute one runtime chat request through the same API surface used by the admin-console AI pages. Provisioning (`setup.sh`) and driving (`run.sh`) are SDK-powered TypeScript apps (`src/setup.ts` / `src/index.ts`, via `@yoizen/platform-sdk`) — the shell scripts only resolve the dev environment and exec `tsx`.

## Quick path

```bash
cd sdk/samples/ai-agent-playground
cp .env.example .env
# edit .env and set the API key for your provider, for example OPENAI_API_KEY
./setup.sh   # creates/updates the LLM connector + agent, then publishes it
./run.sh     # submits one runtime execution and polls the result
```

Expected result: `./run.sh` prints a completed execution with the model reply, token usage, provider, model, and cost estimate when available.

## What gets created

| Artifact | Purpose |
| --- | --- |
| LLM connector | Enabled HTTP connector tagged `llm`; stores the provider API key when `AI_CREDENTIAL_MODE=connector` |
| Agent | Minimal published AI agent with `model_config.llm.provider`, `model`, and optional `connectorId` |
| Runtime execution | One `/api/runtime/executions` request, then polling until `completed` or `failed` |

## LLM credential modes

### Connector mode — default

This is the closest match to the admin-console UX. The sample creates or reuses an enabled connector tagged `llm`, then saves the connector id in `model_config.llm.connectorId`.

```bash
AI_CREDENTIAL_MODE=connector
AI_AGENT_PROVIDER=openai
AI_AGENT_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
```

The runtime service must be able to resolve connector credentials. In the platform this is handled by `agent-ai-service` through `CONNECTOR_ADMIN_URL` and the connector id saved on the agent.

### Env mode

This leaves `connectorId` empty. Use it only when `agent-ai-service` already has the provider key in its own deployment environment.

```bash
AI_CREDENTIAL_MODE=env
AI_AGENT_PROVIDER=openai
AI_AGENT_MODEL=gpt-4o-mini
```

Setting `OPENAI_API_KEY` only in this sample shell is not enough for env mode, because the LLM call runs inside `agent-ai-service`, not in the shell script.

## Supported providers

The runtime code supports:

| Provider | Key env var | Base URL override |
| --- | --- | --- |
| `openai` | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` |
| `google` | `GOOGLE_API_KEY` | — |
| `groq` | `GROQ_API_KEY` | `GROQ_BASE_URL` |
| `mistral` | `MISTRAL_API_KEY` | `MISTRAL_BASE_URL` |
| `cohere` | `COHERE_API_KEY` | — |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL` |
| `xai` | `XAI_API_KEY` | `XAI_BASE_URL` |
| `ollama` | `OLLAMA_API_KEY` | `OLLAMA_BASE_URL` |
| `deepseek` | `DEEPSEEK_API_KEY` | — |

## Environment

`setup.sh` sources `../lib/resolve-env.sh`, so gateway coordinates and seed login defaults match the other SDK samples.

| Var | Default | Notes |
| --- | --- | --- |
| `AI_AGENT_NAME` | `ai-sample-playground` | Agent name to create/reuse |
| `AI_AGENT_PROVIDER` | `openai` | Runtime LLM provider |
| `AI_AGENT_MODEL` | `gpt-4o-mini` | Runtime model name |
| `AI_AGENT_MESSAGE` | short health prompt | Message submitted to runtime |
| `AI_CREDENTIAL_MODE` | `connector` | `connector` or `env` |
| `AI_LLM_CONNECTOR_NAME` | `sample-<provider>-llm` | Connector name in connector mode |
| `RECREATE` | `0` | `1` deletes and recreates the sample connector/agent |
| `POLL_TIMEOUT_S` | `90` | Runtime execution polling timeout |

## Troubleshooting

- **`OPENAI_API_KEY is required`** — connector mode needs a real provider key in `.env`.
- **Execution fails with missing API key** — you used env mode, but `agent-ai-service` does not have the provider key.
- **Agent creation says adapter is not tagged as `llm`** — an existing connector with the same name is missing the `llm` tag; run with `RECREATE=1`.
- **Connector mode falls back to env** — check `agent-ai-service` has a valid `CONNECTOR_ADMIN_URL` that can fetch `/connectors/:id`.
