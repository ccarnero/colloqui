# Platform documentation

Class: descriptive
Summary: Navigation to current contracts, delivery procedures, system documentation, and historical records.

## Start here

| Need | Source |
| --- | --- |
| Repository rules and document authority | [AGENTS.md](../AGENTS.md) |
| Bring-up, seeding, reset, and cluster checks | [Root README](../README.md) |
| Contributor setup and everyday tasks | [Onboarding](guides/onboarding.md) |
| Execute a feature or correction | [Manual-loop procedure](guides/manual-loop.md) |
| Principal, development, QA, architecture, and review duties | [Delivery roles](guides/agent-roles.md) |
| Write an approved SPEC | [Authoring templates](../manual-loops-templates/README.md) |
| Existing SPECs and recorded status | [Manual loops](../manual-loops/README.md) and [working register](../PENDIENTES/README.md) |
| Source-mounted iteration | [Dev mode](guides/dev-mode.md) |
| Guard commands and coverage limits | [Doc/code guards](guides/doc-code-guards.md) |

## Documentation ownership

`AGENTS.md` is the single normative repository contract. Each current procedure
or domain contract has one home; adapters and indexes link to it instead of
repeating rules. Tool configuration inherits the selected global tool/profile
settings by default and contains only intentional project tuning. Shared rules
and role packets never depend on personal filesystem paths.

| Location | Purpose |
| --- | --- |
| `services/*/README.md`, `packages/*/README.md` | Component purpose, interfaces, environment settings, and implementation evidence |
| [architecture/](architecture/) | Current system boundaries and the [decision register](architecture/decision-log.md) |
| [guides/](guides/) and [runbooks/](runbooks/) | Current contributor and operational procedures |
| [messaging/](messaging/), [workflows/](workflows/), [channels/](channels/), [agents/](agents/), [skb/](skb/) | Domain contracts and runtime behavior; `agents/` describes platform runtime agents, not coding assistants |
| [adr/](adr/) | Dated architecture decisions, preserved as records |
| [v_next/](v_next/) | Future proposals, not implemented behavior |
| [archive/](archive/) | Historical evidence; the [change register](archive/INDEX.md) provides delivery navigation |
| [manual-loops/](../manual-loops/) | One executable SPEC per feature or follow-up, with its approval, tasks, gates, and evidence |
| `.sdd/changes/` and [PENDIENTES/](../PENDIENTES/) | Existing design records and working navigation; link the executable SPEC rather than maintaining competing task state |

Document classes and their precedence are defined in AGENTS.md. Descriptive
content follows the code; a prescriptive contract/code divergence is a finding
to resolve, not permission to rewrite the contract. Dated records stay frozen;
corrections use linked follow-ups. Memories help retrieve repository decisions,
but do not replace them. Read the relevant domain material for a task rather than
loading every document into every agent's context.

## System navigation

- [Platform architecture](architecture/overview.md) and [infrastructure](architecture/infrastructure.md).
- [Service bus](messaging/service-bus.md), [envelope contract](messaging/envelope.md), [schema status](../SCHEMAS.md), and [taxonomy](../TAXONOMY.md).
- [Workflow engine](workflows/engine.md), [connector boundary](workflows/connector-vs-workflow.md), and [patterns](workflows/patterns.md).
- [Runtime agent execution](agents/execution.md), [long-running executions](agents/long-running-executions.md), [memory](agents/memory.md), and [scheduled jobs](agents/jobs.md).
- [Telegram sequence](channels/telegram-sequence.md) and [console flows](guides/ui-flows.md).
- [SKB architecture](skb/architecture.md), [API](skb/api.md), [runbook](skb/runbook.md), and [security](skb/security.md).
- [Temporal operations](runbooks/temporal.md) and [storage engines](runbooks/storage-engines.md).
- [Service inventory](../services.conf), [service directories](../services/), and [shared packages](../packages/).
- [SDK examples](../sdk/examples/README.md), [integration references](../integrations/README.md), and [demos](../demos/README.md).

The [pre-consolidation index snapshot](archive/documentation-index-2026-09-06.md)
preserves older embedded recipes and architecture prose for historical reference.
It is not a second quickstart or source of current execution instructions.
