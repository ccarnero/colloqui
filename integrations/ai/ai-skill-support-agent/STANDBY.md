# STAND-BY — not manifest-migrated (manifest v1 gap)

This sample keeps its imperative setup scripts (`setup.sh`, `src/setup.ts`) UNTOUCHED. It is
**not** migrated to a declarative `manifest.yaml` because its provisioned end-state cannot be
expressed in the `IntegrationManifest` v1 schema
(`packages/shared/src/provisioning/manifest.schema.ts`).

## Update (2026-07-17, `manual-loops/provisioning-manifest-gaps-2.md` T07 batch B)

The ORIGINAL gap below (connector `authConfig`/`secretRef`) is **RESOLVED** —
`manual-loops/provisioning-manifest-gaps.md` T01 shipped nested-secretRef connector auth, and this
batch verified the sibling samples `ai-agent-playground`/`ai-agent-triage`/
`ai-call-center-supervisor`/`ai-knowledge-base-agent`/`ai-system-variables` all migrate cleanly on
that foundation plus this SPEC's gaps 1-5.

**NEW gap found, STOP-AND-ESCALATED per decision 10** (do not approximate, do not invent a further
gap kind without a new human decision round): this sample creates a **catalog Skill** resource —
`client.skills.create()`/`client.skills.update()` (`src/setup.ts:394-411`), a standalone
admin-console "AI > Skills" entity with its own id, later referenced by the agent's
`model_config.subagents[].catalog_skill_id` (`src/setup.ts:566`, alongside a full snapshot of the
skill's fields per the runtime contract documented in `src/setup.ts:550-558`).

`packages/shared/src/provisioning/manifest.schema.ts`'s `manifestSpecSchema` has NO `skills`
section — the schema's resource kinds are exactly `channels`/`connectors`/`mcpServers`/`agents`/
`knowledgeBases`/`services`/`systemVariables`/`workflows`/`secrets`. This is a **fifth resource
kind** beyond the four gaps `manual-loops/provisioning-manifest-gaps-2.md`'s Goal enumerates
(library manifests, LLM/KB connector refs, agent per-tool MCP fields, service env vars) — squarely
the SPEC's own "Out of scope" boundary: *"Any NEW resource kind beyond the four gaps enumerated in
the Goal — a sample needing a fifth kind is a stop-and-escalate item (T07), not an invitation to
extend scope inline."*

Approximating by DROPPING the catalog-skill creation and only inlining the subagent snapshot
(without a real `catalog_skill_id`) would change the sample's end-state (no separate, reusable
catalog entry — exactly what this sample exists to demonstrate) and was rejected as an
approximation, not a faithful migration.

## Why (original gap, now resolved — kept for history)

**Connector `authConfig` is unreachable through manifest v1.** The connector + knowledge base +
agent shapes fit the schema sections individually, but the LLM connector carries the provider API
key as auth material — `src/setup.ts:292` sets `authConfig: { bearerToken: apiKey }` — and the
agent references that connector by id (`provider_connector_id`, `src/setup.ts:437`).

The apply engine's connectors-writer cannot carry that credential: a `secretRef` **fails loud**
with `secret_not_resolvable`, and without one any `authConfig`/`authType` key is silently dropped —
only `config.baseUrl`/`config.context` are read
(`services/provisioning-service/src/modules/apply/infrastructure/connectors-writer.ts:41-73`). A
migrated connector would have no credentials, so the skill/KB-backed agent could not reach its
provider.

## When it migrates

When manifest v1 adds a `skills` catalog resource section (schema + resolver/planner + apply
engine writer + SDK/CLI sweep) — a new human decision round, not part of this SPEC's four gaps. See
[`manual-loops/provisioning-manifest-gaps-2.md`](../../../manual-loops/provisioning-manifest-gaps-2.md).
