# agent-ai-service

AI-powered conversational agent service for the YoizenClaw platform. Handles LLM orchestration, tool execution, agent lifecycle, skill management, memory, and multi-agent coordination.

## Tech Stack

- **Runtime**: Bun 1.3
- **Framework**: NestJS 11 + Fastify
- **Language**: TypeScript 5.7 (strict)
- **Messaging**: NATS JetStream (consumer)
- **LLM**: Vercel AI SDK (OpenAI, Anthropic, Google)
- **Shared**: @yoizen/shared, @yoizen/observability, @yoizen/database

## Architecture

The service consumes CloudEvents from per-tenant NATS JetStream ingress streams and dispatches them to domain modules based on action type. It acts as the AI brain of the YoizenClaw platform — processing chat messages, executing tools, managing agent configurations, and coordinating multi-agent workflows.

## Development

```bash
pnpm install
bun run start:dev
```

Requires local NATS, Redis, and per-tenant database instances.

## Event Publishing — standalone LLM calls (`ai.llm_call.completed.v1`)

`manual-loops/connectors/connection-call-inspector.md` T04 closes a capture
gap: LLM calls made OUTSIDE a chat/agent execution — today just the
job-executor's `llm_call` action (`src/modules/job-executor/actions/llm-action.service.ts`
calling `src/modules/llm/llm-executor.service.ts`) — previously recorded
only cost (`cost-tracker.service.ts`), with no per-call request/response
capture. `LlmCallEventPublisherService`
(`src/modules/llm/llm-call-event-publisher.service.ts`) fills that gap by
publishing `ai.llm_call.completed.v1` after every standalone LLM call.

**Payload**: `model`, `provider`, `prompt` (truncated to 8192 chars via
`truncateText`, `src/modules/llm/truncate-text.ts`), `completion` (same
truncation), `inputTokens`, `outputTokens`, `cachedInputTokens`, `costUsd`,
`durationMs`. Resource: `execution/<executionId>`.

**Execution-path exclusion (do not double-capture)**: chat executions
already carry their own full payload (message, reply text,
toolCalls/toolResults, usage, cost) in `execution_completed`
(`src/nats-handlers/execution.handler.ts`) — they route through
`SessionChatService`/`execution.handler.ts`, which never depends on
`LlmCallEventPublisherService`. `LlmActionService.execute` is the ONLY
call site that publishes `ai.llm_call.completed.v1`, so the two payloads
never overlap for the same call.

**Causal contract**: when the job-executor has an incoming envelope for
the event that triggered the job (`job-executor.service.ts`'s `executeJob`
threading it down as `envelope`), the publisher calls `deriveEnvelope`
so the event joins that run's causal chain; otherwise it calls
`buildEventEnvelope` and the event is a causal root. A
`DepthExceededError` from either factory falls back to a root event
(warn-logged) — same fallback contract as
`services/connector-runtime/README.md`'s `event-publisher.ts` (the prior
art this publisher mirrors).

**Fire-and-forget**: `publish()` never throws synchronously; `emit()`'s
failures are caught and logged as warnings. `LlmActionService.execute`
additionally wraps the call site in try/catch so a misbehaving injected
publisher can never fail or delay the LLM action's result (SPEC
constraint) — capture is a pure observability side effect, not part of
the LLM call's critical path.
