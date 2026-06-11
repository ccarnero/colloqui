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
