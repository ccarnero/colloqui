# AI knowledge-base agent sample

Create a knowledge base, upload a Markdown FAQ, attach it to an AI agent, publish the agent, then ask a question whose answer exists in the uploaded document.

## Quick path

```bash
cd integrations/ai/ai-knowledge-base-agent
cp .env.example .env
# set OPENAI_API_KEY or the provider key you use for the agent LLM
./run.sh
```

Expected result: the reply explains the sample refund policy and includes `CONDOR-KB-READY`.

## Are knowledge bases only for agents?

No. Knowledge bases are standalone admin resources under `/api/admin/knowledge-bases`: you can create them, upload documents, inspect chunks, and reingest documents independently.

But today, runtime RAG consumption is agent-attached: agents store `knowledge_base_ids`, and `agent-ai-service` uses those ids when generating a reply. So practically: **KBs are standalone content assets, but agents are the current runtime consumer.**

## What gets created

| Artifact | Purpose |
| --- | --- |
| LLM connector | Enabled connector tagged `llm`; used by the agent and as `provider_connector_id` for ingestion in connector mode |
| Knowledge base | `ai-sample-support-kb`, configured for recursive chunking and OpenAI embeddings |
| Document | `docs/support-faq.md`, uploaded and embedded into chunks |
| Agent | Published agent with `knowledge_base_ids: [<kb id>]` |
| Runtime execution | One `/api/runtime/executions` request asking about the FAQ refund policy |

## Important LLM and embedding requirements

This sample has two online-AI needs:

1. **Agent generation** — the agent needs an LLM provider/model.
2. **KB embeddings** — ingestion and query-time search need embeddings.

Connector mode can provide credentials for document ingestion through `provider_connector_id`. However, current runtime KB search in `agent-ai-service` uses OpenAI embeddings directly, so the service deployment still needs `OPENAI_API_KEY` in its environment. Setting it only in this shell may not be enough for query-time search.

That distinction matters. If we blur it, you get a sample that provisions fine but answers from model memory instead of the KB. Ese es el tipo de atajo que después te hace perder horas.

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `KB_NAME` | `ai-sample-support-kb` | Knowledge base name |
| `KB_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model stored with chunks |
| `AI_AGENT_NAME` | `ai-sample-kb-agent` | Agent name |
| `AI_AGENT_PROVIDER` | `openai` | Agent LLM provider |
| `AI_AGENT_MODEL` | `gpt-4o-mini` | Agent LLM model |
| `AI_CREDENTIAL_MODE` | `connector` | `connector` or `env` |
| `AI_LLM_CONNECTOR_NAME` | `sample-<provider>-llm` | Connector name in connector mode |
| `AI_AGENT_MESSAGE` | refund-policy question | Runtime prompt |
| `RECREATE` | `0` | `1` recreates sample resources where possible |
| `DOC_TIMEOUT_S` | `120` | Document ingestion timeout |
| `POLL_TIMEOUT_S` | `120` | Runtime execution timeout |

## Troubleshooting

- **Document ingestion fails with no API key** — set `OPENAI_API_KEY`, or use connector mode with a reachable connector-admin URL from `agent-admin-service`.
- **Agent answers but does not mention `CONDOR-KB-READY`** — the KB was not retrieved at runtime. Check `agent-ai-service` has `OPENAI_API_KEY`; also confirm the document status is `ready`.
- **Agent creation says adapter is not tagged `llm`** — run with `RECREATE=1` or rename `AI_LLM_CONNECTOR_NAME`.
- **Provisioning works but runtime fails** — check the same LLM requirements as `../ai-agent-playground`.
