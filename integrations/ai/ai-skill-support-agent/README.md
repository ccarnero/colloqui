# AI skill + knowledge-base support agent sample

A call-center support agent that combines the two AI catalog features: a custom **skill**
from AI > Skills (`refund-policy-expert`, attached via `model_config.subagents` with
`catalog_skill_id`) and a **knowledge base** from AI > Knowledge Bases
(`ai-sample-callcenter-kb`, the fictional Acme Telco policy handbook, attached via
`knowledge_base_ids`). The run script asks three questions that exercise the skill trigger,
the KB grounding, and the policy guardrail.

## Quick path

```bash
cd integrations/ai/ai-skill-support-agent
cp .env.example .env
# set OPENAI_API_KEY or the provider key you use for the agent LLM
./setup.sh
./run.sh
```

Expected result: three completed executions — a refund answer citing the 30-day window and
restocking fee, a shipping answer citing the express SLA and the $10 credit (with the phrase
`ACME-POLICY-V3-VERIFIED` when the KB was retrieved), and a polite decline with a Tier 2
Billing escalation offer for the out-of-policy demand.

## How the pieces feed the agent

```
  AI > Skills catalog                    AI > Knowledge Bases
  +---------------------------+         +----------------------------+
  | refund-policy-expert      |         | ai-sample-callcenter-kb    |
  |  system_prompt            |         |  acme-telco-policy.md      |
  |  trigger_commands:        |         |  (refunds, shipping SLAs,  |
  |    refund, reembolso      |         |   escalation, plan tiers)  |
  |  when_to_use, priority    |         |  -> chunked + embedded     |
  |  files: cheat-sheet (ref) |         +-------------+--------------+
  +------------+--------------+                       |
               | snapshot copied into                 | knowledge_base_ids
               | model_config.subagents               | (RAG at reply time)
               | (+ catalog_skill_id link)            |
               v                                      v
        +---------------------------------------------------+
        | agent: ai-sample-support (published)              |
        |  soul: empathetic, professional                   |
        |  rules: no refunds outside policy, cite sections  |
        +-------------------------+-------------------------+
                                  |
                     POST /api/runtime/executions
                                  |
              refund Q        shipping Q       out-of-policy Q
            (skill trigger)  (KB grounded)      (guardrail)
```

## Engine mapping

| Sample step | Platform feature | Contract source (verified in code) |
| --- | --- | --- |
| Ensure skill | AI > Skills catalog CRUD | `services/api-gateway/src/modules/admin/admin-skills.controller.ts`, `services/agent-admin-service/src/modules/skills/skills.dto.ts` |
| Skill fields | `name, system_prompt, trigger_commands, when_to_use, priority, allowed_tools, mode, files[]` | `services/agent-admin-service/src/modules/skills/skills.service.ts` (`ISkill`) |
| Attach skill to agent | `model_config.subagents[]` with `catalog_skill_id` | `services/admin-console/src/app/core/models/agent.model.ts` (`ISubagentConfig`) |
| Skill routing at runtime | trigger/name/semantic/priority resolution | `services/agent-ai-service/src/modules/skills/skill-router.service.ts` |
| Subagent -> skill definition | entries with `system_prompt` mapped as catalog skills | `services/agent-ai-service/src/modules/chat/chat.service.ts`, `.../skills/skill-mapper.ts` |
| Ensure KB + upload + ingest poll | AI > Knowledge Bases | same contract as `../ai-knowledge-base-agent/setup.sh` |
| Agent upsert + publish | AI > Agents | `services/api-gateway/src/modules/admin/admin-agents.controller.ts` |
| Ask questions | runtime executions | `services/api-gateway/src/modules/runtime/runtime.controller.ts` |

## How `catalog_skill_id` really behaves at runtime

Verified in `agent-ai-service`: the runtime reads `model_config.subagents` directly
(`agent-config.postgres.repository.ts` maps it to `agent.skills`) and converts each entry that
has a `system_prompt` into a skill definition — it does **not** re-fetch the catalog skill by
`catalog_skill_id`. The admin console copies the catalog snapshot into the subagent entry and
keeps `catalog_skill_id` as the link back; this sample does the same, and additionally embeds
`trigger_commands`, `when_to_use`, `priority` and `mode` in the subagent so the skill router
actually has them at runtime.

Also note: the skill's `files[]` (the refund cheat-sheet) are stored in the catalog, but the
runtime `loadSkill` builtin tool reads `SKILL.md` packages from the service filesystem
(`skill-file.service.ts`), not from the skills table — so the reference file demonstrates the
catalog contract, while the operative instructions travel in the skill `system_prompt`.

## What gets created

| Artifact | Purpose |
| --- | --- |
| LLM connector | Enabled connector tagged `llm` (reuses `sample-openai-llm` if present) |
| Skill | `refund-policy-expert` with triggers `refund` / `reembolso` and a reference cheat-sheet file |
| Knowledge base | `ai-sample-callcenter-kb` with recursive chunking and OpenAI embeddings |
| Document | `policy/acme-telco-policy.md`, uploaded and embedded into chunks |
| Agent | `ai-sample-support`, published, with the skill subagent and `knowledge_base_ids` |
| Runtime executions | Three `/api/runtime/executions` requests (skill trigger, KB grounding, guardrail) |

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `AI_SKILL_NAME` | `refund-policy-expert` | Catalog skill name |
| `KB_NAME` | `ai-sample-callcenter-kb` | Knowledge base name |
| `KB_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model stored with chunks |
| `AI_AGENT_NAME` | `ai-sample-support` | Agent name |
| `AI_AGENT_PROVIDER` | `openai` | Agent LLM provider |
| `AI_AGENT_MODEL` | `gpt-4o-mini` | Agent LLM model |
| `AI_CREDENTIAL_MODE` | `connector` | `connector` or `env` |
| `AI_LLM_CONNECTOR_NAME` | `sample-<provider>-llm` | Connector name in connector mode |
| `RECREATE` | `0` | `1` recreates skill, KB, document and agent |
| `DOC_TIMEOUT_S` | `120` | Document ingestion timeout |
| `POLL_TIMEOUT_S` | `120` | Runtime execution timeout |

## Prerequisites

- A running dev cluster reachable through `api-gateway` (see `../lib/resolve-env.sh`).
- One LLM provider key (default OpenAI) in `.env`. No Telegram or channel setup is needed —
  the run script talks to the agent through the runtime executions API.
- Runtime KB search in `agent-ai-service` uses OpenAI embeddings, so that service also needs
  `OPENAI_API_KEY` in its own environment (same caveat as `../ai-knowledge-base-agent`).

## Troubleshooting

- **`run.sh` says agent not found** — run `./setup.sh` first.
- **Refund answer ignores the skill** — the first question must start with a trigger word
  (`refund`); the router matches `userMessage.startsWith(trigger)`.
- **Shipping answer lacks `ACME-POLICY-V3-VERIFIED`** — the KB was not retrieved at runtime;
  check the document status is `ready` and that `agent-ai-service` has `OPENAI_API_KEY`.
- **Connector errors** — run with `RECREATE=1` or rename `AI_LLM_CONNECTOR_NAME`; see
  `../ai-agent-playground` for the LLM credential model.
