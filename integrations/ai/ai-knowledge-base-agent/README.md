# ai-knowledge-base-agent

A knowledge base with an inline Markdown FAQ document, attached to a published AI agent, then
asked a question whose answer only exists in that document (RAG). Provisioning is **declarative**:
a single [`manifest.yaml`](./manifest.yaml) applied through the `yoizen` CLI (no setup scripts).

```
manifest.yaml ─► yoizen manifests apply ─► agent-admin-service (connector, KB + document, agent)

run.sh (src/index.ts) ─► client.runtime.createExecution() ─► poll ─► print reply (should cite CONDOR-KB-READY)
```

## Kind decision (`kind: LibraryManifest`)

This manifest provisions a connector + a knowledge base + an agent — a PROCESS exists (the agent),
but there is **no channel account**. `kind: LibraryManifest` waives the >=1-inbound-channel/
>=1-process checks and instead requires `checkAtLeastOneLibraryResource`: >=1 of connector/
mcpServer/service/systemVariable — satisfied here by the connector alone (knowledge bases do NOT
count toward this check).

## What `manifest.yaml` provisions

| Resource | Name | Notes |
| --- | --- | --- |
| Connector | `sample-openai-llm` | Reused for BOTH the agent's LLM and the KB's embedding provider |
| Knowledge base | `ai-sample-support-kb` | One inline document (`support-faq`), `ingestion_config.provider_connector_id: { connectorRef: sample-openai-llm }` |
| Agent | `ai-sample-kb-agent` | `knowledgeBaseRefs: [ai-sample-support-kb]`, `model_config.llm.connectorId: { connectorRef: sample-openai-llm }` |

`ingestion_config.provider_connector_id` is a manifest-time symbolic ref (`manual-loops/
provisioning-manifest-gaps-2.md` T03, gap 2) resolved to the real connector-admin id by
`substitute-kb-ingestion-config.ts` before the KB reconciler creates this (non-external) knowledge
base. `knowledgeBaseRefs` resolves the KB NAME to `knowledge_base_ids` via `agents-writer.ts`'s
`reconcileKnowledgeBases` (parent SPEC T06 precedent).

## Document source (inline, not file/bundle)

The FAQ content (originally `docs/support-faq.md`) is embedded VERBATIM in `manifest.yaml` via
`type: inline` (781 bytes, well under the 64 KiB cap). `type: file` (path + sha256, resolved
through an uploaded tar bundle) was considered and rejected: the `yoizen` CLI's `manifests apply`/
`plan`/`validate` commands have no `--bundle` flag today — only the SDK's
`client.manifests.apply(..., { bundle })` accepts one directly — so `type: file` would be
inexpressible through this README's CLI-only flow. `type: inline` is the faithful, fully
CLI-reachable choice for a document this small.

**Limitation**: the manifest schema's `documents[].name` is a slug (lowercase alphanumeric +
hyphens, no dots), and IS what gets uploaded as the document's `original_filename` — so the `.md`
extension cannot be preserved verbatim (`support-faq` instead of `support-faq.md`). Ingestion is
unaffected: `uploadTextDocument` hardcodes `mime_type: text/plain`/`content_type: text` for inline
sources regardless of filename extension.

## Secrets (LLM/embedding connector bearer auth)

| Binding name (= env var for `--secrets-from-env`) | Targets | Value |
| --- | --- | --- |
| `ai-knowledge-base-agent-openai-api-key` | `authConfig.bearerToken` | Your real `OPENAI_API_KEY` |

## Prerequisites

- A running dev cluster with a provisioned tenant (`acme` by default).
- A real OpenAI API key — `agent-ai-service`'s runtime KB search currently uses OpenAI embeddings
  regardless of the connector, so `OPENAI_API_KEY` must also be present in that service's own
  environment.
- The `yoizen` CLI (`cd sdk && bun link`, or `cd sdk && bun run bin/yoizen.ts ...`).
- CLI environment: `YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`,
  `YOIZEN_PASSWORD`.

## Provision (declarative)

```bash
cd sdk && bun link

yoizen manifests validate -f ../integrations/ai/ai-knowledge-base-agent/manifest.yaml
yoizen manifests plan     -f ../integrations/ai/ai-knowledge-base-agent/manifest.yaml
env "ai-knowledge-base-agent-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f ../integrations/ai/ai-knowledge-base-agent/manifest.yaml --secrets-from-env
```

A second `apply` is a no-op once converged (the KB reconciler's checksum tracking skips re-ingesting
an unchanged document — see `reconcile-knowledge-base.ts`'s "no mutable KB fields to reconcile"
limitation: an already-existing KB's `ingestion_config` itself is not re-reconciled after creation).

## Run / verify

```bash
cd integrations/ai/ai-knowledge-base-agent
./run.sh
```

`run.sh` (`src/index.ts`) is **read-only**: it resolves the agent by name, submits one runtime
execution asking about the refund policy, polls until `completed`/`failed`, and prints the result.
The reply should mention the FAQ's verification phrase, `CONDOR-KB-READY`.

## Environment (run.sh overrides only — provisioning is manifest-driven)

| Var | Default | Notes |
| --- | --- | --- |
| `AI_AGENT_NAME` | `ai-sample-kb-agent` | Must match `manifest.yaml`'s agent name |
| `AI_AGENT_MESSAGE` | see `.env.example` | The question submitted to the agent |
| `POLL_TIMEOUT_S` | `120` | Execution poll timeout |

## Design notes & gotchas

- Editing the FAQ content, chunking config, or embedding model requires editing `manifest.yaml`
  and re-applying.
- If the reply never mentions `CONDOR-KB-READY`, check that `OPENAI_API_KEY` is set in
  `agent-ai-service`'s own runtime environment (embeddings/search path), not just in the manifest
  secret binding (connector auth path).
