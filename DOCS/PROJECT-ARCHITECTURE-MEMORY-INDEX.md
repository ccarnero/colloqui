# Persistent architecture navigation

Class: descriptive
Summary: Repository entry points for architecture discussions, current engineering workflow and historical evidence.

This file is navigation, not a second constitution or evidence of an Engram save.

## Current workflow

- [AGENTS.md](../AGENTS.md): normative engineering contract.
- [Repository README](../README.md): environment setup and working entry points.
- [Documentation index](README.md): architecture and operational guides.
- [Loop index](../manual-loops/README.md): scoped historical inventory and usage.
- [Working register](../PENDIENTES/README.md): additional work items and SPECs.
- [Template guide](../manual-loops-templates/README.md): authoring and context contract.
- [Manual-loop engine](../.claude/commands/manual-loop.md): execution and evidence.
- [Guard guide](guides/doc-code-guards.md): KISS default, full audit and coverage limits.

## Architecture and contracts

- [Overview](architecture/overview.md), [infrastructure](architecture/infrastructure.md),
  [security](architecture/security.md), [tenancy](architecture/multi-tenancy.md),
  [observability](architecture/observability.md).
- [Runtime streaming](architecture/runtime-streaming.md) and [MCP connections](architecture/mcp-connections.md).
- [Decision log](architecture/decision-log.md), [schemas](../SCHEMAS.md), [taxonomy](../TAXONOMY.md).
- [Envelope](messaging/envelope.md), [service bus](messaging/service-bus.md),
  [workflow engine](workflows/engine.md), [connector versus workflow](workflows/connector-vs-workflow.md).
- [Temporal and NATS ADR](adr/temporal-and-nats.md) and [connector runtime ADR](adr/connector-runtime-separation.md).

## Component descriptions

Use each component's README for its as-built behavior, not for an independent
copy of workflow policy: [API gateway](../services/api-gateway/README.md),
[agent administration](../services/agent-admin-service/README.md),
[agent execution](../services/agent-ai-service/README.md),
[workflows](../services/workflow-service/README.md),
[connectors](../services/connector-runtime/README.md), and
[console](../services/admin-console/README.md).

## Evidence and continuity

[Uniform engineering contract](../manual-loops/architecture/uniform-engineering-contract.md),
[existing-loop alignment](../manual-loops/architecture/existing-loops-alignment.md), and
[operating-document alignment](../manual-loops/architecture/operating-docs-alignment.md)
record this workflow's changes and verification limits. Earlier audits remain
accessible through the loop index and [change register](archive/INDEX.md).
Persist decisions in the repository and the declared memory topic when available;
report unavailable memory rather than claiming a successful save.
