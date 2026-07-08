import { describe, expect, it } from "bun:test";
import {
  EXECUTION_AUDIT_SELECT_PROJECTION,
  type IStoredExecutionEvent,
  mapExecutionAuditDoc,
} from "../../src/common/execution-audit-projection";

describe("execution-audit-projection", () => {
  describe("EXECUTION_AUDIT_SELECT_PROJECTION", () => {
    it("includes correlation_id, causation_id, depth, and usage/cost columns", () => {
      expect(EXECUTION_AUDIT_SELECT_PROJECTION).toContain(
        'correlation_id       AS "correlationId"'
      );
      expect(EXECUTION_AUDIT_SELECT_PROJECTION).toContain(
        'causation_id         AS "causationId"'
      );
      expect(EXECUTION_AUDIT_SELECT_PROJECTION).toContain("depth");
      expect(EXECUTION_AUDIT_SELECT_PROJECTION).toContain(
        'input_tokens         AS "inputTokens"'
      );
      expect(EXECUTION_AUDIT_SELECT_PROJECTION).toContain(
        'cost_usd             AS "costUsd"'
      );
    });
  });

  describe("mapExecutionAuditDoc", () => {
    it("maps a fully populated completed-event document", () => {
      const doc = {
        _id: "env-1",
        tenant_id: "t1",
        execution_id: "exec-1",
        event_kind: "completed",
        agent_id: "agent-1",
        conversation_id: "conv-1",
        model: "gpt-4o",
        provider: "openai",
        input_tokens: 120,
        output_tokens: 45,
        cached_input_tokens: 10,
        cost_usd: 0.0021,
        status: "completed",
        error: null,
        correlation_id: "conv-1",
        causation_id: "caus-1",
        depth: 1,
        occurred_at: new Date("2026-07-07T00:00:00Z"),
        created_at: new Date("2026-07-07T00:00:01Z"),
      };

      const result: IStoredExecutionEvent = mapExecutionAuditDoc(doc);

      expect(result.id).toBe("env-1");
      expect(result.executionId).toBe("exec-1");
      expect(result.eventKind).toBe("completed");
      expect(result.conversationId).toBe("conv-1");
      expect(result.inputTokens).toBe(120);
      expect(result.outputTokens).toBe(45);
      expect(result.cachedInputTokens).toBe(10);
      expect(result.costUsd).toBe(0.0021);
      expect(result.correlationId).toBe("conv-1");
      expect(result.causationId).toBe("caus-1");
      expect(result.depth).toBe(1);
    });

    it("maps nullable fields to null when absent (started event)", () => {
      const doc = {
        _id: "env-2",
        tenant_id: "t1",
        execution_id: "exec-2",
        event_kind: "started",
        agent_id: "agent-1",
        occurred_at: new Date("2026-07-07T00:00:00Z"),
        created_at: new Date("2026-07-07T00:00:00Z"),
      };

      const result = mapExecutionAuditDoc(doc);

      expect(result.conversationId).toBeNull();
      expect(result.model).toBeNull();
      expect(result.inputTokens).toBeNull();
      expect(result.outputTokens).toBeNull();
      expect(result.cachedInputTokens).toBeNull();
      expect(result.costUsd).toBeNull();
      expect(result.status).toBeNull();
      expect(result.error).toBeNull();
      expect(result.correlationId).toBeNull();
      expect(result.causationId).toBeNull();
      expect(result.depth).toBeNull();
    });

    it("maps depth to null when doc.depth is malformed", () => {
      const doc = {
        _id: "env-3",
        tenant_id: "t1",
        execution_id: "exec-3",
        event_kind: "failed",
        depth: "not-a-number",
        occurred_at: new Date("2026-07-07T00:00:00Z"),
        created_at: new Date("2026-07-07T00:00:00Z"),
      };

      const result = mapExecutionAuditDoc(doc);
      expect(result.depth).toBeNull();
    });
  });
});
