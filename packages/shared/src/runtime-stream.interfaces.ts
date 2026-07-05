/**
 * Runtime execution token streaming — event payloads and typed event union.
 * See DOCS/architecture/runtime-streaming.md §1.3 and §4.1.
 *
 * These are the `data.payload` shapes carried inside a compliant
 * `EventEnvelope` published on the ephemeral `rt.<tenant>.exec.<executionId>.*`
 * subjects (see `buildRuntimeStreamSubject` in `./constants`). They are
 * distinct from the SDK-facing `RuntimeStreamEvent` union (defined in the SDK
 * package), which is the flattened SSE-wire shape.
 */

export interface RuntimeTokenPayload {
  executionId: string;
  agentId: string;
  seq: number;
  delta: string;
  done: boolean;
}

export interface RuntimeToolCallPayload {
  executionId: string;
  agentId: string;
  seq: number;
  toolName: string;
  args: Record<string, unknown>;
}

export interface RuntimeToolResultPayload {
  executionId: string;
  agentId: string;
  seq: number;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface RuntimeCancelPayload {
  executionId: string;
}

export type RuntimeStreamEventPayload =
  | RuntimeTokenPayload
  | RuntimeToolCallPayload
  | RuntimeToolResultPayload
  | RuntimeCancelPayload;
