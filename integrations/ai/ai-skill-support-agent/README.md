# ai-skill-support-agent

A call-center support agent that combines the two AI catalog features: a custom **skill** from
AI > Skills (`refund-policy-expert`, attached via `model_config.subagents` with `catalog_skill_id`)
and a **knowledge base** from AI > Knowledge Bases (`ai-sample-callcenter-kb`, the fictional Acme
Telco policy handbook, attached via `knowledgeBaseRefs`). Provisioning is **declarative**: a single
[`manifest.yaml`](./manifest.yaml) applied through the `yoizen` CLI (no setup scripts). The run
script then asks three questions that exercise the skill trigger, the KB grounding, and the policy
guardrail.

```
manifest.yaml ─► yoizen manifests apply ─► agent-admin-service (connector, skill, KB + document, agent)

run.sh (src/index.ts) ─► client.runtime.createExecution() x3 ─► poll ─► print replies
```

## Kind decision (`kind: LibraryManifest`)

This manifest provisions a connector + a skill + a knowledge base + an agent — a PROCESS exists
(the agent), but there is **no channel account** anywhere (the deleted `setup.ts`'s agent has
`channels: []`). `kind: LibraryManifest` waives the >=1-inbound-channel/>=1-process checks and
instead requires `checkAtLeastOneLibraryResource`: >=1 of connector/mcpServer/service/
systemVariable — satisfied here by the LLM connector alone (knowledge bases and skills do NOT count
toward this check). Same decision as the sibling `../ai-knowledge-base-agent` and
`../ai-agent-playground` samples.

## What `manifest.yaml` provisions

| Resource | Name | Notes |
| --- | --- | --- |
| Connector | `sample-openai-llm` | Byte-identical to every other `ai` sample's connector (shared, no update-loop). Reused for BOTH the agent's LLM and the KB's embedding provider |
| Skill | `refund-policy-expert` | The fifth resource kind (`skills[]`). Triggers `refund` / `reembolso`, one `files[]` reference cheat-sheet, `mode: llm_driven` |
| Knowledge base | `ai-sample-callcenter-kb` | One inline document (`acme-telco-policy`), `ingestion_config.provider_connector_id: { connectorRef: sample-openai-llm }` |
| Agent | `ai-sample-support` | `knowledgeBaseRefs: [ai-sample-callcenter-kb]`, `model_config.llm.connectorId: { connectorRef: sample-openai-llm }`, and a `model_config.subagents[]` entry linking the skill by `catalog_skill_id: { skillRef: refund-policy-expert }` plus the full skill snapshot |

### The skill and the subagent snapshot

`refund-policy-expert` is declared once in the top-level `skills[]` section (create-or-update by
name via `skills-writer.ts`, `POST/PATCH /admin/skills`). The agent references it through
`model_config.subagents[].catalog_skill_id`, a `{ skillRef: refund-policy-expert }` symbolic ref
(`manual-loops/provisioning-manifest-gaps-3.md` T02) resolved to the real skill id at apply time —
after the skill is created, since `skill` ranks before `agent` in `RESOURCE_KIND_ORDER`.

The subagent entry **also** carries the full skill snapshot (`system_prompt`, `trigger_commands`,
`when_to_use`, `priority`, `mode`) in addition to `catalog_skill_id`. This is required, not
redundant: `agent-ai-service` reads those fields from the subagent entry itself at chat time and
never re-fetches the catalog skill by id (verified in
`chat.service.ts`/`skills/skill-mapper.ts`). Because it is a snapshot rather than a live reference,
editing the catalog `skills[]` entry means editing the matching subagent snapshot fields too — the
manifest declares both from the same values, so a normal edit + re-apply keeps them in sync.

## Document source (inline, not file/bundle)

The Acme Telco policy handbook (originally `policy/acme-telco-policy.md`) is embedded VERBATIM in
`manifest.yaml` via `type: inline` (~3.4 KiB, well under the 64 KiB cap). `type: file` (path +
sha256, resolved through an uploaded tar bundle) was considered and rejected: the `yoizen` CLI's
`manifests apply`/`plan`/`validate` commands have no `--bundle` flag today — only the SDK's
`client.manifests.apply(..., { bundle })` accepts one directly — so `type: file` would be
inexpressible through this README's CLI-only flow. `type: inline` is the faithful, fully
CLI-reachable choice.

**Limitation** (same as `../ai-knowledge-base-agent`): the schema's `documents[].name` is a slug
(lowercase alphanumeric + hyphens, no dots), and IS what gets uploaded as the document's
`original_filename` — so the `.md` extension cannot be preserved (`acme-telco-policy` instead of
`acme-telco-policy.md`). Ingestion is unaffected. The knowledge base's `description`/`project`/
`category`/`icon` (present on the old `CreateKnowledgeBaseInput`) have no `knowledgeBaseSchema`
field either, so they are dropped and left to the server-side defaults — same documented limitation
as the sibling sample.

## Secrets (LLM/embedding connector bearer auth)

| Binding name (= env var for `--secrets-from-env`) | Targets | Value |
| --- | --- | --- |
| `ai-skill-support-agent-openai-api-key` | `authConfig.bearerToken` | Your real `OPENAI_API_KEY` |

The binding NAME is what `--secrets-from-env` reads the VALUE from — so if your provider key lives
in `OPENAI_API_KEY`, remap it on the apply line
(`env "ai-skill-support-agent-openai-api-key=$OPENAI_API_KEY" ...`). No naming transform happens
automatically.

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

yoizen manifests validate -f ../integrations/ai/ai-skill-support-agent/manifest.yaml
yoizen manifests plan     -f ../integrations/ai/ai-skill-support-agent/manifest.yaml
env "ai-skill-support-agent-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f ../integrations/ai/ai-skill-support-agent/manifest.yaml --secrets-from-env
```

A second `apply` is a no-op once converged (the KB reconciler's checksum tracking skips
re-ingesting an unchanged document; the skill/connector/agent reconcile to a 0-create/0-update
verdict via name lookup).

## Run / verify

```bash
cd integrations/ai/ai-skill-support-agent
./run.sh
```

`run.sh` (`src/index.ts`) is **read-only**: it resolves the agent by name and submits three runtime
executions:

1. A refund-window question that **starts with** the skill trigger (`refund`) so the router
   activates `refund-policy-expert` (the router matches `userMessage.startsWith(trigger)`).
2. A shipping-SLA question grounded only in the KB document (should cite the express SLA and the
   `ACME-POLICY-V3-VERIFIED` phrase when the KB was retrieved).
3. An out-of-policy refund demand, to show the `rules` guardrail (a polite decline plus a Tier 2
   Billing escalation offer, no promised refund).

## Engine mapping

| Sample step | Platform feature | Contract source (verified in code) |
| --- | --- | --- |
| Skill create-or-update | AI > Skills catalog CRUD | `skills-writer.ts` -> `POST/PATCH /admin/skills`, `services/agent-admin-service/src/modules/skills/skills.dto.ts` |
| Skill fields | `name, description, system_prompt, icon, color, trigger_commands, when_to_use, priority, allowed_tools, mode, files[]` | `services/agent-admin-service/src/modules/skills/skills.service.ts` (`ISkill`) |
| Attach skill to agent | `model_config.subagents[]` with `catalog_skill_id: { skillRef }` | `services/admin-console/src/app/core/models/agent.model.ts` (`ISubagentConfig`) |
| Skill routing at runtime | trigger/name/semantic/priority resolution | `services/agent-ai-service/src/modules/skills/skill-router.service.ts` |
| Subagent -> skill definition | entries with `system_prompt` mapped as catalog skills | `services/agent-ai-service/src/modules/chat/chat.service.ts`, `.../skills/skill-mapper.ts` |
| KB + inline document + ingest | AI > Knowledge Bases | same contract as `../ai-knowledge-base-agent` |
| Agent create + KB links | AI > Agents | `agents-writer.ts` -> `POST /admin/agents`, `knowledgeBaseRefs` -> `knowledge_base_ids` |
| Ask questions | runtime executions | `services/api-gateway/src/modules/runtime/runtime.controller.ts` |

## Environment (run.sh overrides only — provisioning is manifest-driven)

| Var | Default | Notes |
| --- | --- | --- |
| `AI_AGENT_NAME` | `ai-sample-support` | Must match `manifest.yaml`'s agent name |
| `POLL_TIMEOUT_S` | `120` | Execution poll timeout |

## Troubleshooting

- **`run.sh` says agent not found** — apply `manifest.yaml` first (see Provision).
- **Refund answer ignores the skill** — the first question must start with a trigger word
  (`refund`); the router matches `userMessage.startsWith(trigger)`.
- **Shipping answer lacks `ACME-POLICY-V3-VERIFIED`** — the KB was not retrieved at runtime; check
  the document status is `ready` and that `agent-ai-service` has `OPENAI_API_KEY`.
- **Editing the skill** — change BOTH the `skills[]` entry and the agent's subagent snapshot fields,
  then re-apply (the subagent snapshot is not a live reference — see above).
