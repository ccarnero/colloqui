---
status: proposed
date: 2026-06-11
decision-makers: Architect
consulted: ""
informed: ""
---

Class: future
Summary: A 2026-06-11 proposal for a context pipeline and related agent-architecture changes; verified unimplemented (no context module, no USE_CONTEXT_PIPELINE, no ContextPipeline) and still relevant.

# Unify Agent Context Pipeline and Improve Skill Routing

## Context and Problem Statement

The agent platform (`agent-ai-service`, `agent-memory-service`) has a solid microservice foundation but the agent runtime architecture has accumulated design debts that compound as features are added:

1. **No unified Context Pipeline.** Context injection (memory, knowledge bases, skills, tools) is scattered across `MemoryContextBuilderService`, `KnowledgeBaseSearchService`, `SkillRouterService`, `ChatService`, and `RagMiddleware` with no coordination. Adding a new context source requires modifying 3-5 files with no single entry point.

2. **Skill Router uses token-based matching.** `SkillRouterService.resolveBySemantics()` tokenizes messages and scores by keyword overlap. This produces false positives at scale — "precio de soporte" matches a "pricing" skill when the user wants support pricing info. No semantic understanding, only keyword overlap.

3. **Memory Context Builder produces unstructured text dumps.** `MemoryContextBuilderService.formatForPrompt()` joins items with newlines (`- title: content`). This wastes prompt tokens and gives the LLM unrelated facts instead of coherent context.

4. **RAG middleware silently degrades on failure.** Both `createRagMiddleware` and `createKnowledgeBaseRagMiddleware` catch errors and return params unchanged. A broken RAG pipeline is invisible — no metrics or logs indicate degradation.

5. **Tool throttling uses a fragile global counter.** `LlmExecutorService.generateTextWithTools()` reimplements `stepCountIs()` (already imported) with a manual `stopWhenToolLimit` function that breaks when a step has zero tool calls.

### Why now

- Every new context source (conversation history, external APIs, user preferences) multiplies the maintenance burden.
- Token-based skill routing produces wrong selections as the skill catalog grows past 10 items.
- Silent RAG failures are discovered by customer complaints, not monitoring.
- The manual tool throttling is a maintenance risk that reimplements AI SDK behavior.

## Decision Drivers

* Maintainability: new context sources should require one file change, not five
* Accuracy: skill routing must understand intent, not just keywords
* Observability: RAG failures must be logged and metricated
* Reliability: tool throttling must use native AI SDK mechanisms
* Backward compatibility: no external API changes, feature-flagged migration

## Considered Options

* **Option A: Unified Context Pipeline with embedding-based skill routing (CHOSEN)**
* **Option B: Keep scattered architecture, fix individual issues**
* **Option C: Full agent framework rewrite (LangGraph, CrewAI)**

## Decision Outcome

Chosen option: "Option A — Unified Context Pipeline", because it addresses all five problems with a single architectural pattern while preserving the existing microservice boundaries and multi-tenant model.

### Consequences

* Good, because adding a new context source becomes a single `CollectorService` implementation
* Good, because skill routing accuracy improves from token overlap to semantic similarity
* Good, because RAG failures become visible via metrics and logging
* Good, because tool throttling uses native `stepCountIs()` instead of manual counters
* Bad, because adds ~500 lines of new code in Phase 1 before behavior changes
* Bad, because LLM memory summarization adds ~200ms latency and ~$0.0001 per call
* Neutral, because existing external APIs are unchanged — this is an internal refactor

## Architecture Overview

### Current state: scattered context injection

```
ChatService
  ├── MemoryContextBuilderService → memory context (raw text dump)
  ├── SkillRouterService → resolved skill (token matching)
  ├── LlmExecutorService
  │     ├── KnowledgeBaseSearchService → KB search (silent failure)
  │     └── RagMiddleware → context injection (no metrics)
  └── System prompt assembly (scattered)
```

### Proposed state: Context Pipeline

```
ChatService
  └── ContextPipeline.execute(request)
        ├── MemoryCollectorService → compressed, ranked memory context
        ├── KnowledgeBaseCollectorService → KB search results
        ├── SkillCollectorService → embedding-based skill resolution
        ├── ConversationCollectorService → conversation summary
        └── ContextMetricsService → observability
  └── PromptComposerService → assembled system prompt
  └── LlmExecutorService → LLM call with composed prompt
```

## Data Model Changes

No new database tables. Changes are internal to `agent-ai-service`.

### New internal interfaces

```typescript
// services/agent-ai-service/src/modules/context/context.types.ts

export interface ContextRequest {
  readonly tenantId: string;
  readonly agentId: string;
  readonly executionId: string;
  readonly userMessage: string;
  readonly conversationHistory?: ModelMessage[];
  readonly knowledgeBaseIds?: readonly string[];
  readonly skillOverride?: string;
}

export interface ContextResult {
  readonly memory: MemoryContext;
  readonly knowledgeBases: KbContext;
  readonly skill: SkillContext;
  readonly conversation: ConversationContext;
  readonly warnings: string[];
  readonly metrics: ContextMetrics;
}

export interface ContextMetrics {
  readonly memoryItemsCount: number;
  readonly kbChunksCount: number;
  readonly skillName: string | null;
  readonly totalContextChars: number;
  readonly collectionTimeMs: number;
}
```

## Implementation Plan

### Phase 1: Context Pipeline Foundation (MVP)

**Goal**: Unified context collection with observability. No behavior changes — just restructuring.

* **Affected paths**:
  - `services/agent-ai-service/src/modules/context/` — **NEW** directory
  - `services/agent-ai-service/src/modules/chat/chat.service.ts` — replace scattered calls
  - `services/agent-ai-service/src/modules/llm/rag-middleware.ts` — add logging
  - `services/agent-ai-service/src/modules/memory/memory-context-builder.service.ts` — extract to collector
  - `services/agent-ai-service/src/modules/skills/skill-router.service.ts` — wrap in collector
  - `services/agent-ai-service/src/modules/knowledge-bases/knowledge-base-search.service.ts` — extract to collector

* **Dependencies**: None — reuses existing `ai`, `@ai-sdk/openai`, NestJS

* **Patterns to follow**:
  - Collector pattern: each `*CollectorService` implements `collect(request: ContextRequest): Promise<*Context>` — modeled after `MemoryContextBuilderService.buildContext()` at `services/agent-ai-service/src/modules/memory/memory-context-builder.service.ts:21`
  - NestJS module pattern: follow `SkillsModule` at `services/agent-ai-service/src/modules/skills/skills.module.ts` for DI wiring
  - Service injection pattern: follow `KnowledgeBaseSearchService` constructor at `services/agent-ai-service/src/modules/knowledge-bases/knowledge-base-search.service.ts:18` for `@Inject()` with custom tokens
  - Middleware pattern: follow `createKnowledgeBaseRagMiddleware()` at `services/agent-ai-service/src/modules/llm/rag-middleware.ts:139` for `LanguageModelMiddleware` shape
  - Metrics pattern: follow `CostTrackerService.recordCost()` at `services/agent-ai-service/src/modules/llm/cost-tracker.service.ts` for async metric recording

* **Patterns to avoid**:
  - Do NOT create a new microservice — this is an in-process refactor
  - Do NOT change external API contracts
  - Do NOT modify the `LlmExecutorService` public interface in Phase 1
  - Do NOT use `console.log` — use NestJS `Logger` class as in `MemoryContextBuilderService`
  - Do NOT add synchronous metric recording in the hot path — always `await` async writes

* **Dependencies**:
  - No new packages required — reuses existing `ai@6.x`, `@ai-sdk/openai@3.x`, `@nestjs/common@11.x`
  - `EmbeddingService` already exists at `services/agent-ai-service/src/modules/llm/embedding.service.ts` — reuse for skill embeddings
  - `LlmExecutorService.generateText()` already exists — reuse for memory summarization

* **Configuration**: Feature flag `USE_CONTEXT_PIPELINE=true` in `agent-ai-service` config (add to `services/agent-ai-service/src/config.ts`)

* **Migration steps**: Run both old and new paths in parallel, compare outputs, feature-flag toggle

#### Tasks

| # | Task | Lines |
|---|------|-------|
| 1.1 | Create `context.types.ts` with all context interfaces | ~50 |
| 1.2 | Create `MemoryCollectorService` (extract from `MemoryContextBuilderService`) | ~100 |
| 1.3 | Create `KnowledgeBaseCollectorService` (extract from `KnowledgeBaseSearchService`) | ~80 |
| 1.4 | Create `SkillCollectorService` (wrap existing `SkillRouterService`) | ~60 |
| 1.5 | Create `ConversationCollectorService` (new) | ~80 |
| 1.6 | Create `ContextPipeline` orchestrator | ~150 |
| 1.7 | Create `ContextMetricsService` for observability | ~80 |
| 1.8 | Integrate pipeline into `ChatService` (replaces scattered calls) | ~50 |
| 1.9 | Add logging to RAG middleware (both variants) | ~30 |
| 1.10 | Tests | ~300 |

### Phase 2: Memory Summarization + Skill Embeddings

**Goal**: Improve memory context quality and skill routing accuracy.

* **Affected paths**:
  - `services/agent-ai-service/src/modules/context/collectors/memory-collector.service.ts` — add LLM summarization
  - `services/agent-ai-service/src/modules/skills/skill-router.service.ts` — add embedding matching
  - `services/agent-ai-service/src/modules/context/prompt-composer.service.ts` — **NEW**

* **Dependencies**: None additional — uses existing `EmbeddingService` and `LlmExecutorService`

* **Patterns to follow**:
  - Embedding pre-computation at startup, cached in memory
  - Cosine similarity with threshold (0.65) for skill matching
  - LLM summarization via `gpt-4o-mini` (cheap model, ~$0.0001/call)

* **Patterns to avoid**:
  - Do NOT use LLM for skill routing (adds latency, circular dependency)
  - Do NOT cache embeddings in Redis (overkill for in-process skill routing)

#### Tasks

| # | Task | Lines |
|---|------|-------|
| 2.1 | Add LLM summarization to `MemoryCollectorService` | ~100 |
| 2.2 | Add relevance ranking to memory items | ~50 |
| 2.3 | Add embedding pre-computation to `SkillRouterService` | ~80 |
| 2.4 | Implement `resolveByEmbedding()` with cosine similarity | ~60 |
| 2.5 | Add similarity threshold configuration | ~20 |
| 2.6 | Create `PromptComposerService` | ~120 |
| 2.7 | Integrate composer into pipeline | ~40 |
| 2.8 | Tests | ~250 |

### Phase 3: Tool Throttling Fix + Advanced Observability

**Goal**: Fix fragile tool throttling, add metrics dashboard.

* **Affected paths**:
  - `services/agent-ai-service/src/modules/llm/llm-executor.service.ts` — replace manual throttling
  - `services/agent-ai-service/src/modules/context/context-metrics.service.ts` — add dashboard endpoint

* **Dependencies**: None

* **Patterns to follow**:
  - Use `stepCountIs(maxSteps)` from `ai` SDK (already imported)
  - Use `onStepFinish` callback for per-step tracking

* **Patterns to avoid**:
  - Do NOT reimplement step counting manually
  - Do NOT add synchronous metric recording in the hot path

#### Tasks

| # | Task | Lines |
|---|------|-------|
| 3.1 | Replace manual `stopWhenToolLimit` with `stepCountIs()` | ~30 |
| 3.2 | Add per-step tool call tracking via `onStepFinish` | ~50 |
| 3.3 | Create metrics dashboard endpoint | ~100 |
| 3.4 | Add alerting for RAG failure rate | ~40 |
| 3.5 | Add token budget tracking per context source | ~60 |
| 3.6 | Tests | ~150 |

### Verification

- [ ] `ContextPipeline.execute()` collects from all collectors and returns `ContextResult`
- [ ] `MemoryCollectorService` produces LLM-summarized summary (not raw text dump)
- [ ] `SkillRouterService` resolves skills by embedding similarity with fallback to token matching
- [ ] RAG middleware logs warnings on failure and records metrics
- [ ] `LlmExecutorService.generateTextWithTools()` uses `stepCountIs()` not manual counter
- [ ] Feature flag `USE_CONTEXT_PIPELINE=false` uses old scattered path (behavior identical to current)
- [ ] Feature flag `USE_CONTEXT_PIPELINE=true` uses new pipeline path (same output, different internals)
- [ ] All existing tests pass with both flag values
- [ ] Context pipeline metrics are queryable (memory items, KB chunks, skill name, latency)
- [ ] No external API changes — all endpoints return identical responses
- [ ] Token estimate stays under agent's configured `maxOutputTokens`
- [ ] `grep -r "ContextPipeline" services/agent-ai-service/src/` shows pipeline is the only entry point
- [ ] `grep -r "MemoryContextBuilderService" services/agent-ai-service/src/modules/chat/` returns no results (old path removed from ChatService)

## Pros and Cons of the Options

### Option A: Unified Context Pipeline with embedding-based skill routing

* Good, because single entry point for all context sources
* Good, because skill routing understands semantic intent
* Good, because RAG failures are observable
* Good, because tool throttling uses native AI SDK mechanisms
* Neutral, because internal refactor with no API changes
* Bad, because ~500 lines new code before behavior changes
* Bad, because LLM summarization adds ~200ms latency

### Option B: Keep scattered architecture, fix individual issues

* Good, because minimal code changes
* Good, because no new abstractions to learn
* Neutral, because preserves existing patterns
* Bad, because every new context source requires 3-5 file changes
* Bad, because skill routing stays token-based
* Bad, because no unified observability

### Option C: Full agent framework rewrite (LangGraph, CrewAI)

* Good, because mature agent orchestration patterns
* Good, because built-in state management and tool routing
* Bad, because massive rewrite — months of work
* Bad, because adds heavy dependencies (LangChain ecosystem)
* Bad, because loses existing multi-tenant architecture
* Bad, because team must learn new framework

## Alternatives Considered

* **Event-driven context via NATS**: Fully decoupled but overkill for in-process context. Adds latency (~100ms per hop) for minimal benefit.
* **LLM-based skill routing**: Most accurate but expensive (~$0.001/call) and adds latency. Embeddings provide semantic understanding at zero runtime cost after pre-computation.
* **Redis-cached skill embeddings**: Adds infrastructure complexity for in-process data. Skill catalog is small enough for memory caching.

## More Information

### Related ADRs

- `DOCS/adr/rag-system.md` — KB and RAG system design (Phase 1-2 already implemented)
- `DOCS/adr/variable-system.md` — Variable system for agent I/O (complements context pipeline)

### Revisit Triggers

- If skill catalog exceeds 50 items, consider LLM-based routing
- If memory summarization latency exceeds 500ms, switch to extractive summarization
- If context pipeline metrics show >5% RAG failure rate, investigate root cause before adding features

### Files Affected Summary

| Phase | New Files | Modified Files |
|-------|-----------|----------------|
| 1 | 8 files in `modules/context/` | 4 files (chat, rag-middleware, memory, skills) |
| 2 | 1 file (prompt-composer) | 3 files (memory-collector, skill-router, context module) |
| 3 | 0 files | 2 files (llm-executor, context-metrics) |
