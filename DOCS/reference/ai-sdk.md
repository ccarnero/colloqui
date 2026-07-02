# Vercel AI SDK v6 — Technical Reference for NestJS Agent Services

> SDK version: **6.0.197** (`ai: ^6.0.197`) | Provider packages: `@ai-sdk/openai ^3.0.68`, `@ai-sdk/anthropic ^3.0.81` | Verified against `services/agent-ai-service/package.json`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Text Generation: generateText / streamText](#2-text-generation-generatetext--streamtext)
3. [Structured Data: Output API](#3-structured-data-output-api)
4. [Tool Calling & Multi-Step Agents](#4-tool-calling--multi-step-agents)
5. [ToolLoopAgent Class](#5-toolloopagent-class)
6. [Embeddings](#6-embeddings)
7. [Streaming Patterns](#7-streaming-patterns)
8. [Language Model Middleware](#8-language-model-middleware)
9. [Telemetry (OpenTelemetry)](#9-telemetry-opentelemetry)
10. [MCP Integration](#10-mcp-integration)
11. [Chatbot UI Patterns (useChat)](#11-chatbot-ui-patterns-usechat)
12. [NestJS Agent Service Architecture](#12-nestjs-agent-service-architecture)
13. [v5 → v6 Migration Notes](#13-v5--v6-migration-notes)

---

## 1. Architecture Overview

The AI SDK has two main layers:

- **AI SDK Core** (`ai` package): Unified API for generating text, structured objects, tool calls, embeddings, and building agents. Framework-agnostic, works in any Node.js environment.
- **AI SDK UI** (`@ai-sdk/react`): Framework-agnostic hooks (`useChat`, `useObject`, `useCompletion`) for building chat UIs in React/Next.js/Svelte/Vue.

**Provider model**: Providers are separate packages that implement a standard interface:

```ts
import { generateText } from 'ai';

// Gateway string syntax (v6):
const { text } = await generateText({
  model: "anthropic/claude-sonnet-4.5",
  prompt: "What is love?",
});

// Or explicit provider instances:
import { openai } from '@ai-sdk/openai';
const { text } = await generateText({
  model: openai('gpt-4o'),
  prompt: "What is love?",
});
```

**Supported providers**: OpenAI, Anthropic, Google Generative AI, Azure, Amazon Bedrock, Groq, Mistral, xAI Grok, DeepSeek, Together.ai, Cohere, Fireworks, Perplexity, Cerebras, and more.

---

## 2. Text Generation: generateText / streamText

### `generateText` — One-shot text generation

```ts
import { generateText } from 'ai';

const result = await generateText({
  model: "anthropic/claude-sonnet-4.5",
  system: "You are a professional writer.",
  prompt: `Summarize this article: ${article}`,
});

// Result properties:
result.text;           // string — generated text
result.reasoning;      // reasoning content (if model supports it)
result.toolCalls;      // tool calls from last step
result.toolResults;    // tool results from last step
result.finishReason;   // 'stop' | 'length' | 'tool-calls' | 'content-filter' | ...
result.usage;          // { promptTokens, completionTokens, totalTokens }
result.totalUsage;     // total usage across all steps
result.steps;          // StepResult[] — all intermediate steps
result.response;       // { messages, headers, body, id, modelId, timestamp }
result.providerMetadata; // provider-specific metadata
```

**With callbacks:**

```ts
const result = await generateText({
  model: "anthropic/claude-sonnet-4.5",
  prompt: "...",
  onFinish({ text, finishReason, usage, response, steps, totalUsage }) {
    // called when all steps are complete
  },
  // Experimental lifecycle callbacks:
  experimental_onStart({ model, settings, functionId }) {},
  experimental_onStepStart({ stepNumber, model, promptMessages }) {},
  experimental_onToolCallStart({ toolName, toolCallId, input }) {},
  experimental_onToolCallFinish({ toolName, durationMs, error }) {},
  onStepFinish({ stepNumber, text, toolCalls, toolResults, finishReason, usage }) {},
});
```

### `streamText` — Streaming text generation

```ts
import { streamText } from 'ai';

const result = streamText({
  model: "anthropic/claude-sonnet-4.5",
  prompt: "Invent a new holiday.",
});

// Consume as async iterable:
for await (const textPart of result.textStream) {
  process.stdout.write(textPart);
}

// All result properties are promises that resolve when stream finishes:
await result.text;          // final text
await result.usage;         // token usage
await result.steps;         // all steps
await result.finishReason;  // finish reason
```

**Stream response helpers:**

```ts
// UI Message stream (for useChat on frontend):
return result.toUIMessageStreamResponse();

// Plain text stream:
return result.toTextStreamResponse();

// Pipe to Node.js response:
result.pipeUIMessageStreamToResponse(res);
result.pipeTextStreamToResponse(res);
```

**Stream callbacks:**

```ts
const result = streamText({
  model: "anthropic/claude-sonnet-4.5",
  prompt: "...",
  onError({ error }) { console.error(error); },
  onChunk({ chunk }) {
    // chunk.type: 'text' | 'reasoning' | 'source' | 'tool-call' | 'tool-result' | ...
  },
  onFinish({ text, finishReason, usage, response, steps, totalUsage }) {},
});
```

**Full stream (all event types):**

```ts
for await (const part of result.fullStream) {
  switch (part.type) {
    case 'text-delta':       // text chunk
    case 'reasoning-delta':  // reasoning chunk
    case 'source':           // citation source
    case 'tool-call':        // tool invocation
    case 'tool-result':      // tool execution result
    case 'tool-error':       // tool execution error
    case 'finish-step':      // step completed
    case 'finish':           // all steps completed
    case 'error':            // stream error
  }
}
```

---

## 3. Structured Data: Output API

v6 deprecates `generateObject`/`streamObject` in favour of the `Output` property on `generateText`/`streamText`.

> **Project status**: `agent-ai-service` and `agent-admin-service` (SKB module) still call `generateObject` directly from `ai` v6. The functions remain available but are deprecated. Migration to the `Output` API is pending.

### v6 preferred API

### `Output.object()` — Generate typed objects

```ts
import { generateText, Output } from 'ai';
import { z } from 'zod';

const { output } = await generateText({
  model: "anthropic/claude-sonnet-4.5",
  output: Output.object({
    name: 'Recipe',                    // optional, for LLM guidance
    description: 'A recipe object.',   // optional
    schema: z.object({
      name: z.string(),
      ingredients: z.array(z.object({
        name: z.string(),
        amount: z.string().describe('grams or ml'),
      })),
      steps: z.array(z.string()),
    }),
  }),
  prompt: 'Generate a lasagna recipe.',
});
// output is fully typed!
```

### `Output.array()` — Generate arrays of typed objects

```ts
const { output } = await generateText({
  model: "anthropic/claude-sonnet-4.5",
  output: Output.array({
    element: z.object({
      location: z.string(),
      temperature: z.number(),
      condition: z.string(),
    }),
  }),
  prompt: 'List weather for SF and Paris.',
});
// output: Array<{ location: string; temperature: number; condition: string }>
```

### `Output.choice()` — Classification / enum output

```ts
const { output } = await generateText({
  model: "anthropic/claude-sonnet-4.5",
  output: Output.choice({
    options: ['positive', 'neutral', 'negative'],
  }),
  prompt: 'Classify: "The product is amazing!"',
});
// output: 'positive'
```

### `Output.json()` — Unstructured JSON

```ts
const { output } = await generateText({
  model: "anthropic/claude-sonnet-4.5",
  output: Output.json(),
  prompt: 'Return city temperatures as JSON.',
});
// output: any valid JSON
```

### Stream structured output

```ts
import { streamText, Output } from 'ai';

const { partialOutputStream } = streamText({
  model: "anthropic/claude-sonnet-4.5",
  output: Output.object({ schema: mySchema }),
  prompt: 'Generate a recipe.',
});

for await (const partialObject of partialOutputStream) {
  console.log(partialObject); // partial, progressively filled object
}

// For arrays, stream individual elements:
const { elementStream } = streamText({
  model: "anthropic/claude-sonnet-4.5",
  output: Output.array({ element: heroSchema }),
  prompt: 'Generate 3 heroes.',
});

for await (const hero of elementStream) {
  console.log(hero); // each hero is complete and validated
}
```

### Combined with tools

```ts
const { output } = await generateText({
  model: "anthropic/claude-sonnet-4.5",
  tools: { weather: weatherTool },
  output: Output.object({
    schema: z.object({ summary: z.string(), recommendation: z.string() }),
  }),
  stopWhen: stepCountIs(5), // must account for tool steps + output step
  prompt: 'What should I wear in SF today?',
});
```

### Error handling

```ts
import { NoObjectGeneratedError } from 'ai';

try {
  await generateText({ model, output: Output.object({ schema }), prompt });
} catch (error) {
  if (NoObjectGeneratedError.isInstance(error)) {
    console.log('Cause:', error.cause);
    console.log('Text:', error.text);
    console.log('Response:', error.response);
    console.log('Usage:', error.usage);
  }
}
```

---

## 4. Tool Calling & Multi-Step Agents

### Defining tools

```ts
import { tool } from 'ai';
import { z } from 'zod';

const weatherTool = tool({
  description: 'Get the weather in a location',
  inputSchema: z.object({
    location: z.string().describe('The location to get the weather for'),
  }),
  execute: async ({ location }) => ({
    location,
    temperature: 72 + Math.floor(Math.random() * 21) - 10,
  }),
});
```

**Tool properties:**

| Property | Type | Description |
|---|---|---|
| `description` | `string` | Helps model decide when to use the tool |
| `inputSchema` | `ZodSchema` or `JSONSchema` | Input parameter validation |
| `execute` | `(input, options) => Promise<RESULT>` | Async execution function |
| `strict` | `boolean` | Enable strict tool calling (provider-dependent) |
| `needsApproval` | `boolean \| (input) => Promise<boolean>` | Require user approval before execution |
| `inputExamples` | `{ input: ARGS }[]` | Guide model input structure (Anthropic only) |

### Multi-step execution with `stopWhen`

```ts
import { generateText, tool, stepCountIs } from 'ai';

const { text, steps } = await generateText({
  model: "anthropic/claude-sonnet-4.5",
  tools: { weather: weatherTool },
  stopWhen: stepCountIs(5), // continue for up to 5 steps
  prompt: 'What is the weather in SF?',
});
```

**Built-in stop conditions:**

| Condition | Behavior |
|---|---|
| `stepCountIs(n)` | Stop after `n` steps (default: 20) |
| `hasToolCall(name)` | Stop when a specific tool is called |
| `isLoopFinished()` | Never triggers; run until natural finish |

**Combining conditions:**

```ts
stopWhen: [stepCountIs(20), hasToolCall('finalAnswer')]
```

**Custom conditions:**

```ts
import { StopCondition } from 'ai';

const budgetExceeded: StopCondition<typeof tools> = ({ steps }) => {
  const cost = steps.reduce((acc, s) =>
    acc + (s.usage?.inputTokens ?? 0) * 0.01 + (s.usage?.outputTokens ?? 0) * 0.03, 0) / 1000;
  return cost > 0.5;
};
```

### `prepareStep` — Dynamic per-step configuration

```ts
const result = await generateText({
  model: "anthropic/claude-sonnet-4.5",
  tools: { search: searchTool, analyze: analyzeTool },
  stopWhen: stepCountIs(10),
  prepareStep: async ({ stepNumber, steps, messages }) => {
    if (stepNumber <= 2) {
      return { activeTools: ['search'], toolChoice: 'required' };
    }
    if (stepNumber <= 5) {
      return { activeTools: ['analyze'] };
    }
    return {};
  },
  prompt: '...',
});
```

### Tool execution options (second parameter)

```ts
execute: async (input, { toolCallId, messages, abortSignal, experimental_context }) => {
  // toolCallId: string — unique ID for this tool call
  // messages: ModelMessage[] — full conversation history
  // abortSignal: AbortSignal — forwarded from generateText/streamText
  // experimental_context: unknown — custom context from parent call
}
```

### Tool choice

```ts
toolChoice: 'auto'                                    // default
toolChoice: 'required'                                // force tool call
toolChoice: 'none'                                    // disable tools
toolChoice: { type: 'tool', toolName: 'weather' }    // force specific tool
```

### Tool approval flow

```ts
const dangerousTool = tool({
  description: 'Run a shell command',
  inputSchema: z.object({ command: z.string() }),
  needsApproval: true, // or async ({ amount }) => amount > 1000
  execute: async ({ command }) => { /* ... */ },
});

// First call returns tool-approval-request parts
const result = await generateText({ model, tools: { dangerousTool }, messages });
for (const part of result.content) {
  if (part.type === 'tool-approval-request') {
    // Show UI, get user approval
  }
}

// Second call with approval response
messages.push({
  role: 'tool',
  content: [{
    type: 'tool-approval-response',
    approvalId: part.approvalId,
    approved: true,
    reason: 'User confirmed',
  }],
});
const result2 = await generateText({ model, tools: { dangerousTool }, messages });
```

### Preliminary tool results (streaming status)

```ts
tool({
  description: 'Get the current weather.',
  inputSchema: z.object({ location: z.string() }),
  async *execute({ location }) {
    yield { status: 'loading' as const, text: `Getting weather for ${location}` };
    await new Promise(resolve => setTimeout(resolve, 3000));
    yield { status: 'success' as const, text: `Weather: 72°F`, temperature: 72 };
  },
}),
```

### Dynamic tools

```ts
import { dynamicTool } from 'ai';

const customTool = dynamicTool({
  description: 'Execute a custom function',
  inputSchema: z.object({}),
  execute: async (input) => {
    const { action, parameters } = input as any;
    return { result: `Executed ${action}` };
  },
});
```

### Tool call repair

```ts
const result = await generateText({
  model,
  tools,
  prompt,
  experimental_repairToolCall: async ({ toolCall, tools, inputSchema, error }) => {
    if (NoSuchToolError.isInstance(error)) return null;
    const { output: repairedArgs } = await generateText({
      model: "anthropic/claude-sonnet-4.5",
      output: Output.object({ schema: tools[toolCall.toolName].inputSchema }),
      prompt: `Fix the inputs for tool "${toolCall.toolName}": ${JSON.stringify(toolCall.input)}`,
    });
    return { ...toolCall, input: JSON.stringify(repairedArgs) };
  },
});
```

---

## 5. ToolLoopAgent Class

The `ToolLoopAgent` encapsulates model, tools, instructions, and loop behavior into a reusable component.

### Creating and using an agent

```ts
import { ToolLoopAgent, tool, Output } from 'ai';
import { z } from 'zod';

const agent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-4.5",
  instructions: 'You are a helpful assistant.',
  tools: {
    weather: tool({
      description: 'Get weather',
      inputSchema: z.object({ location: z.string() }),
      execute: async ({ location }) => ({ temperature: 72 }),
    }),
  },
  stopWhen: stepCountIs(20),
  toolChoice: 'auto',
  output: Output.object({ schema: z.object({ answer: z.string() }) }),
});

// Generate (one-shot)
const result = await agent.generate({ prompt: 'Weather in SF?' });
console.log(result.text);

// Stream
const streamResult = await agent.stream({ prompt: 'Tell me a story' });
for await (const chunk of streamResult.textStream) {
  process.stdout.write(chunk);
}

// API route response
return createAgentUIStreamResponse({ agent, uiMessages: messages });
```

### Agent with step tracking

```ts
const agent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-4.5",
  instructions: 'You are an analyst.',
  tools: { search: searchTool, analyze: analyzeTool },
  onStepFinish: async ({ stepNumber, usage }) => {
    console.log(`Step ${stepNumber}: ${usage.totalTokens} tokens`);
  },
});
```

### Type inference

```ts
import { InferAgentUIMessage } from 'ai';

type MyAgentUIMessage = InferAgentUIMessage<typeof agent>;
// Use in client: useChat<MyAgentUIMessage>()
```

---

## 6. Embeddings

### Single value

```ts
import { embed } from 'ai';

const { embedding, usage } = await embed({
  model: 'openai/text-embedding-3-small',
  value: 'sunny day at the beach',
});
// embedding: number[], usage: { tokens: 10 }
```

### Batch embedding

```ts
import { embedMany } from 'ai';

const { embeddings, usage } = await embedMany({
  model: 'openai/text-embedding-3-small',
  values: ['sunny day', 'rainy afternoon', 'snowy night'],
  maxParallelCalls: 2,     // limit concurrent requests
});
```

### Cosine similarity

```ts
import { cosineSimilarity, embedMany } from 'ai';

const { embeddings } = await embedMany({
  model: 'openai/text-embedding-3-small',
  values: ['sunny day at the beach', 'rainy afternoon in the city'],
});
console.log(cosineSimilarity(embeddings[0], embeddings[1]));
```

### Configuration

```ts
await embed({
  model: 'openai/text-embedding-3-small',
  value: 'text',
  providerOptions: { openai: { dimensions: 512 } },
  maxRetries: 2,             // default: 2 (3 attempts total)
  abortSignal: AbortSignal.timeout(1000),
  headers: { 'X-Custom-Header': 'value' },
});
```

### Embedding middleware

```ts
import { wrapEmbeddingModel, defaultEmbeddingSettingsMiddleware } from 'ai';

const model = wrapEmbeddingModel({
  model: gateway.embeddingModel('google/gemini-embedding-001'),
  middleware: defaultEmbeddingSettingsMiddleware({
    settings: {
      providerOptions: { google: { outputDimensionality: 256 } },
    },
  }),
});
```

---

## 7. Streaming Patterns

### Stream transformation

```ts
import { smoothStream, streamText } from 'ai';

const result = streamText({
  model,
  prompt,
  experimental_transform: smoothStream(), // smooth out text streaming
});
```

### Custom transformations

```ts
import { streamText, type TextStreamPart, type ToolSet } from 'ai';

const upperCaseTransform = <TOOLS extends ToolSet>() =>
  (options: { tools: TOOLS; stopStream: () => void }) =>
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        controller.enqueue(
          chunk.type === 'text-delta'
            ? { ...chunk, text: chunk.text.toUpperCase() }
            : chunk,
        );
      },
    });

// Usage:
const result = streamText({
  model,
  prompt,
  experimental_transform: [upperCaseTransform(), smoothStream()],
});
```

### Stopping streams

```ts
const stopWordTransform = <TOOLS extends ToolSet>() =>
  ({ stopStream }: { stopStream: () => void }) =>
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (chunk.type === 'text-delta' && chunk.text.includes('STOP')) {
          stopStream();
          // Must simulate finish-step and finish events
          controller.enqueue({ type: 'finish-step', /* ... */ });
          controller.enqueue({ type: 'finish', /* ... */ });
          return;
        }
        controller.enqueue(chunk);
      },
    });
```

---

## 8. Language Model Middleware

Middleware intercepts and modifies calls to language models. Useful for guardrails, RAG, caching, logging.

### Usage

```ts
import { wrapLanguageModel } from 'ai';

const wrappedModel = wrapLanguageModel({
  model: yourModel,
  middleware: yourMiddleware,
});

// Multiple middlewares (applied in order):
const wrappedModel = wrapLanguageModel({
  model: yourModel,
  middleware: [firstMiddleware, secondMiddleware],
});
```

### Built-in middleware

| Middleware | Purpose |
|---|---|
| `extractReasoningMiddleware({ tagName })` | Extract `<think/>` tags as `reasoning` property |
| `extractJsonMiddleware()` | Strip markdown code fences from JSON responses |
| `simulateStreamingMiddleware()` | Convert non-streaming responses to streaming |
| `defaultSettingsMiddleware({ settings })` | Apply default temperature, maxTokens, etc. |
| `addToolInputExamplesMiddleware()` | Serialize `inputExamples` into tool descriptions |

```ts
import { wrapLanguageModel, extractReasoningMiddleware, defaultSettingsMiddleware } from 'ai';

const model = wrapLanguageModel({
  model: yourModel,
  middleware: [
    extractReasoningMiddleware({ tagName: 'think' }),
    defaultSettingsMiddleware({
      settings: { temperature: 0.5, maxOutputTokens: 800 },
    }),
  ],
});
```

### Custom middleware implementation

```ts
import type { LanguageModelV3Middleware } from '@ai-sdk/provider';

export const loggingMiddleware: LanguageModelV3Middleware = {
  wrapGenerate: async ({ doGenerate, params }) => {
    console.log('Generating with params:', JSON.stringify(params, null, 2));
    const result = await doGenerate();
    console.log('Generated text:', result.text);
    return result;
  },
  wrapStream: async ({ doStream, params }) => {
    const { stream, ...rest } = await doStream();
    // Wrap stream to log chunks...
    return { stream: stream.pipeThrough(transformStream), ...rest };
  },
  transformParams: async ({ params }) => {
    // Modify params before they reach the model
    return params;
  },
};
```

### RAG as middleware

```ts
export const ragMiddleware: LanguageModelV3Middleware = {
  transformParams: async ({ params }) => {
    const lastUserMessage = getLastUserMessageText({ prompt: params.prompt });
    if (lastUserMessage == null) return params;
    const sources = findSources({ text: lastUserMessage });
    const instruction = 'Use this information:\n' + sources.map(JSON.stringify).join('\n');
    return addToLastUserMessage({ params, text: instruction });
  },
};
```

### Guardrails as middleware

```ts
export const guardrailMiddleware: LanguageModelV3Middleware = {
  wrapGenerate: async ({ doGenerate }) => {
    const { text, ...rest } = await doGenerate();
    const cleanedText = text?.replace(/badword/g, '<REDACTED>');
    return { text: cleanedText, ...rest };
  },
};
```

### Per-request metadata via `providerOptions`

```ts
await generateText({
  model: wrapLanguageModel({ model: "anthropic/claude-sonnet-4.5", middleware: logMiddleware }),
  prompt: '...',
  providerOptions: {
    yourLogMiddleware: { hello: 'world' },
  },
});
// In middleware: params?.providerMetadata?.yourLogMiddleware
```

---

## 9. Telemetry (OpenTelemetry)

> Experimental — API may change.

### Enabling

```ts
import { generateText } from 'ai';

const result = await generateText({
  model: "anthropic/claude-sonnet-4.5",
  prompt: 'Write a short story about a cat.',
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'my-awesome-function',
    metadata: { something: 'custom' },
    recordInputs: true,    // default: true
    recordOutputs: true,   // default: true
    tracer: customTracer,  // optional OpenTelemetry Tracer
  },
});
```

### Telemetry integrations

```ts
import type { TelemetryIntegration } from 'ai';
import { bindTelemetryIntegration } from 'ai';

class MyIntegration implements TelemetryIntegration {
  async onStart(event) { /* model, prompt, settings */ }
  async onStepStart(event) { /* stepNumber, model, messages */ }
  async onToolCallStart(event) { /* toolCall */ }
  async onToolCallFinish(event) { /* toolCall, durationMs, success/error */ }
  async onStepFinish(event) { /* stepNumber, usage */ }
  async onFinish(event) { /* totalUsage */ }
}

experimental_telemetry: {
  isEnabled: true,
  integrations: [bindTelemetryIntegration(new MyIntegration())],
}
```

### Spans recorded

| Function | Spans |
|---|---|
| `generateText` | `ai.generateText` → `ai.generateText.doGenerate` → `ai.toolCall` |
| `streamText` | `ai.streamText` → `ai.streamText.doStream` → `ai.toolCall` + `ai.stream.firstChunk` event |
| `embed` | `ai.embed` → `ai.embed.doEmbed` |
| `embedMany` | `ai.embedMany` → `ai.embedMany.doEmbed` |

**Key span attributes**: `ai.model.id`, `ai.model.provider`, `ai.usage.promptTokens`, `ai.usage.completionTokens`, `gen_ai.system`, `gen_ai.request.model`, `gen_ai.response.finish_reasons`, etc.

---

## 10. MCP Integration

### Initializing an MCP client

```ts
import { createMCPClient } from '@ai-sdk/mcp';

// HTTP transport (recommended for production):
const mcpClient = await createMCPClient({
  transport: {
    type: 'http',
    url: 'https://your-server.com/mcp',
    headers: { Authorization: 'Bearer my-api-key' },
  },
});

// SSE transport:
const mcpClient = await createMCPClient({
  transport: { type: 'sse', url: 'https://your-server.com/sse' },
});

// Stdio transport (local only):
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const mcpClient = await createMCPClient({
  transport: new StdioClientTransport({
    command: 'node',
    args: ['src/server.js'],
  }),
});
```

### Using MCP tools

```ts
// Auto-discover all tools from server:
const tools = await mcpClient.tools();

// Or define schemas explicitly (type-safe):
const tools = await mcpClient.tools({
  schemas: {
    'get-weather': {
      inputSchema: z.object({ location: z.string() }),
      outputSchema: z.object({ temperature: z.number(), conditions: z.string() }),
    },
  },
});
```

### Using MCP tools in generateText

```ts
const mcpClient = await createMCPClient({
  transport: { type: 'http', url: 'https://mcp-server.com/mcp' },
});

const tools = await mcpClient.tools();

const result = await streamText({
  model: "anthropic/claude-sonnet-4.5",
  tools,
  prompt: 'What is the weather?',
  onFinish: async () => {
    await mcpClient.close();
  },
});
```

### MCP Resources

```ts
const resources = await mcpClient.listResources();
const data = await mcpClient.readResource({ uri: 'file:///example/doc.txt' });
const templates = await mcpClient.listResourceTemplates();
```

### MCP Prompts (experimental)

```ts
const prompts = await mcpClient.experimental_listPrompts();
const prompt = await mcpClient.experimental_getPrompt({
  name: 'code_review',
  arguments: { code: 'function add(a, b) { return a + b; }' },
});
```

### Elicitation

```ts
const mcpClient = await createMCPClient({
  transport: { type: 'sse', url: 'https://server.com/sse' },
  capabilities: { elicitation: {} },
});

mcpClient.onElicitationRequest(ElicitationRequestSchema, async request => {
  return { action: 'accept', content: userInput };
});
```

---

## 11. Chatbot UI Patterns (useChat)

### Server-side (NestJS API route equivalent)

```ts
import { convertToModelMessages, streamText, UIMessage } from 'ai';

// POST handler
async function handleChat(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: "anthropic/claude-sonnet-4.5",
    system: 'You are a helpful assistant.',
    messages: await convertToModelMessages(messages),
    tools: { /* ... */ },
  });

  return result.toUIMessageStreamResponse();
}
```

### Client-side (React)

```tsx
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

function Chat() {
  const { messages, sendMessage, status, stop, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });

  return (
    <>
      {messages.map(m => (
        <div key={m.id}>
          {m.role}: {m.parts.map((p, i) =>
            p.type === 'text' ? <span key={i}>{p.text}</span> : null
          )}
        </div>
      ))}
      <form onSubmit={e => {
        e.preventDefault();
        sendMessage({ text: input });
      }}>
        <input disabled={status !== 'ready'} />
        <button type="submit">Send</button>
      </form>
    </>
  );
}
```

### Message metadata (usage tracking)

```ts
// Server:
return result.toUIMessageStreamResponse({
  messageMetadata: ({ part }) => {
    if (part.type === 'finish') return { totalUsage: part.totalUsage };
  },
});

// Client:
message.metadata?.totalUsage?.totalTokens
```

### Direct Agent Transport (no HTTP)

```tsx
import { DirectChatTransport, ToolLoopAgent } from 'ai';

const agent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-4.5",
  instructions: 'You are a helpful assistant.',
});

const { messages, sendMessage } = useChat({
  transport: new DirectChatTransport({ agent }),
});
```

---

## 12. NestJS Agent Service Architecture

### Recommended module structure

```
src/
  llm/
    llm.module.ts               # NestJS module
    llm-executor.service.ts      # Core AI SDK wrapper
    providers/
      provider.factory.ts        # Dynamic provider selection
    tools/
      weather.tool.ts
      search.tool.ts
      database.tool.ts
    agents/
      base.agent.ts              # ToolLoopAgent configurations
      research.agent.ts
      analysis.agent.ts
    middleware/
      rag.middleware.ts
      guardrails.middleware.ts
      logging.middleware.ts
    telemetry/
      telemetry.integration.ts   # Custom TelemetryIntegration
```

### LlmExecutorService — Core wrapper

```ts
import { Injectable, Logger } from '@nestjs/common';
import { generateText, streamText, tool, stepCountIs, wrapLanguageModel } from 'ai';
import type { ModelMessage, ToolSet } from 'ai';

@Injectable()
export class LlmExecutorService {
  private readonly logger = new Logger(LlmExecutorService.name);

  async generateText(options: {
    model: string;
    system?: string;
    prompt?: string;
    messages?: ModelMessage[];
    tools?: ToolSet;
    maxSteps?: number;
    output?: any;
    abortSignal?: AbortSignal;
  }) {
    const wrappedModel = wrapLanguageModel({
      model: resolveModel(options.model),
      middleware: [loggingMiddleware, ragMiddleware],
    });

    return generateText({
      model: wrappedModel,
      system: options.system,
      prompt: options.prompt,
      messages: options.messages,
      tools: options.tools,
      stopWhen: stepCountIs(options.maxSteps ?? 20),
      output: options.output,
      abortSignal: options.abortSignal,
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'llm-executor',
      },
      onStepFinish: ({ stepNumber, usage, finishReason }) => {
        this.logger.log(`Step ${stepNumber}: ${finishReason}, ${usage.totalTokens} tokens`);
      },
    });
  }

  async streamText(options: {
    model: string;
    messages: ModelMessage[];
    tools?: ToolSet;
    maxSteps?: number;
    abortSignal?: AbortSignal;
  }) {
    return streamText({
      model: resolveModel(options.model),
      messages: options.messages,
      tools: options.tools,
      stopWhen: stepCountIs(options.maxSteps ?? 20),
      abortSignal: options.abortSignal,
      onStepFinish: ({ stepNumber, usage }) => {
        this.logger.log(`Step ${stepNumber}: ${usage.totalTokens} tokens`);
      },
    });
  }
}
```

### Provider factory

```ts
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';

export function resolveModel(modelString: string) {
  // Gateway string format: "provider/model-name"
  if (modelString.includes('/')) {
    return modelString; // AI SDK v6 gateway resolves it
  }

  // Explicit provider instances:
  if (modelString.startsWith('gpt')) return openai(modelString);
  if (modelString.startsWith('claude')) return anthropic(modelString);
  if (modelString.startsWith('gemini')) return google(modelString);

  throw new Error(`Unknown model: ${modelString}`);
}
```

### Extracted tool pattern

```ts
// tools/weather.tool.ts
import { tool } from 'ai';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { WeatherApiService } from '../../integrations/weather-api.service';

@Injectable()
export class WeatherTool {
  constructor(private readonly weatherApi: WeatherApiService) {}

  asTool() {
    return tool({
      description: 'Get the weather in a location',
      inputSchema: z.object({
        location: z.string().describe('City name or coordinates'),
      }),
      execute: async ({ location }) => {
        return this.weatherApi.getCurrentWeather(location);
      },
    });
  }
}

// Registration:
const tools = {
  weather: this.weatherTool.asTool(),
  search: this.searchTool.asTool(),
};
```

### Agent definition

```ts
// agents/research.agent.ts
import { ToolLoopAgent, tool, stepCountIs, Output } from 'ai';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ResearchAgent {
  private readonly agent = new ToolLoopAgent({
    model: "anthropic/claude-sonnet-4.5",
    instructions: `You are a research assistant. Always cite sources.`,
    tools: {
      search: this.searchTool.asTool(),
      analyze: this.analyzeTool.asTool(),
    },
    stopWhen: stepCountIs(10),
    onStepFinish: async ({ stepNumber, usage }) => {
      this.logger.log(`Research step ${stepNumber}: ${usage.totalTokens} tokens`);
    },
  });

  async research(prompt: string) {
    const result = await this.agent.generate({ prompt });
    return result.text;
  }

  async streamResearch(prompt: string) {
    return this.agent.stream({ prompt });
  }
}
```

### MCP integration in NestJS

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createMCPClient, MCPClient } from '@ai-sdk/mcp';

@Injectable()
export class McpService implements OnModuleDestroy {
  private clients: MCPClient[] = [];

  async createClient(config: { url: string; headers?: Record<string, string> }) {
    const client = await createMCPClient({
      transport: { type: 'http', url: config.url, headers: config.headers },
    });
    this.clients.push(client);
    return client;
  }

  async getTools(client: MCPClient) {
    return client.tools();
  }

  async onModuleDestroy() {
    await Promise.all(this.clients.map(c => c.close()));
  }
}
```

### RAG pattern via middleware

```ts
import type { LanguageModelV3Middleware } from '@ai-sdk/provider';
import { Injectable } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';

@Injectable()
export class RagMiddleware {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStore: VectorStoreService,
  ) {}

  create(): LanguageModelV3Middleware {
    return {
      transformParams: async ({ params }) => {
        const lastUserMessage = this.extractLastUserMessage(params.prompt);
        if (!lastUserMessage) return params;

        const { embedding } = await this.embeddingService.embed(lastUserMessage);
        const sources = await this.vectorStore.search(embedding, { topK: 5 });

        const ragContext = sources
          .map(s => `[${s.metadata.source}]: ${s.content}`)
          .join('\n\n');

        return this.appendToLastUserMessage(params, `\n\nContext:\n${ragContext}`);
      },
    };
  }
}
```

---

## 13. v5 → v6 Migration Notes

| v5 (old) | v6 (new / preferred) | Project status |
|---|---|---|
| `generateObject({ model, schema, prompt })` | `generateText({ model, output: Output.object({ schema }), prompt })` | **Still using v5 form** in `agent-ai-service` and `agent-admin-service` (SKB). Migration pending. |
| `streamObject({ model, schema, prompt })` | `streamText({ model, output: Output.object({ schema }), prompt })` | **Still using v5 form** in `agent-ai-service` (`llm-executor.service.ts` `streamStructuredOutput`). Migration pending, same as `generateObject`. |
| `maxSteps: 5` | `stopWhen: stepCountIs(5)` | `agent-ai-service` uses `stopWhen` correctly |
| `tools: { name: { description, parameters, execute } }` | `tools: { name: tool({ description, inputSchema, execute }) }` | `agent-ai-service` uses `tool()` correctly |
| `parameters` (JSON schema) | `inputSchema` (Zod schema) | Migrated |
| `maxTokens` | `maxOutputTokens` | Migrated (see comment in `llm-executor.service.ts`) |
| `system` remains `system` | No change | — |
| Provider instances only | Gateway string syntax: `"anthropic/claude-sonnet-4.5"` | Project uses provider-instance factories only (`createOpenAI`, `createAnthropic`, `createGoogleGenerativeAI` in `provider-registry.service.ts`) — no gateway string usage found in `agent-ai-service`/`agent-admin-service` |
| `jsonSchema()` helper | Still available for JSON schema input | — |
| Telemetry span: `ai.generateObject` | Telemetry span: `ai.generateText` (with output) | N/A until generateObject migrated |

---

## Quick Reference: Key Imports

```ts
// Core functions
import { generateText, streamText, embed, embedMany, cosineSimilarity } from 'ai';

// Output types
import { Output } from 'ai';

// Tools
import { tool, dynamicTool } from 'ai';

// Agent
import { ToolLoopAgent, createAgentUIStreamResponse, InferAgentUIMessage } from 'ai';

// Loop control
import { stepCountIs, hasToolCall, isLoopFinished } from 'ai';
import type { StopCondition, ToolSet } from 'ai';

// Middleware
import {
  wrapLanguageModel,
  extractReasoningMiddleware,
  extractJsonMiddleware,
  simulateStreamingMiddleware,
  defaultSettingsMiddleware,
} from 'ai';

// Streaming
import { smoothStream } from 'ai';

// Messages
import type { ModelMessage, UIMessage } from 'ai';
import { convertToModelMessages } from 'ai';

// Telemetry
import type { TelemetryIntegration } from 'ai';
import { bindTelemetryIntegration } from 'ai';

// Errors
import { NoObjectGeneratedError, NoSuchToolError, InvalidToolInputError } from 'ai';

// MCP
import { createMCPClient } from '@ai-sdk/mcp';
import type { MCPClient } from '@ai-sdk/mcp';

// Providers
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';

// UI (React frontend)
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, DirectChatTransport } from 'ai';
```
