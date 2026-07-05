import { describe, expect, test } from "bun:test";
import {
  buildRuntimeStreamSubject,
  buildRuntimeStreamWildcard,
  RUNTIME_CANCEL,
  RUNTIME_STREAM_SUBJECT_PREFIX,
  RUNTIME_TOKEN,
  RUNTIME_TOKEN_EVENT_TYPE,
  RUNTIME_TOOL_CALL,
  RUNTIME_TOOL_RESULT,
} from "../constants";
import { buildEventEnvelope, isCompliantEnvelope } from "../envelope.utils";
import type { RuntimeTokenPayload } from "../runtime-stream.interfaces";

describe("Runtime stream subjects (DOCS/architecture/runtime-streaming.md)", () => {
  describe("RUNTIME_STREAM_SUBJECT_PREFIX", () => {
    test("has the expected template", () => {
      expect(RUNTIME_STREAM_SUBJECT_PREFIX).toBe(
        "rt.{tenant}.exec.{executionId}"
      );
    });
  });

  describe("buildRuntimeStreamSubject", () => {
    test("builds a token subject", () => {
      expect(buildRuntimeStreamSubject("acme", "exec-1", RUNTIME_TOKEN)).toBe(
        "rt.acme.exec.exec-1.token"
      );
    });

    test("builds a tool_call subject", () => {
      expect(
        buildRuntimeStreamSubject("acme", "exec-1", RUNTIME_TOOL_CALL)
      ).toBe("rt.acme.exec.exec-1.tool_call");
    });

    test("builds a tool_result subject", () => {
      expect(
        buildRuntimeStreamSubject("acme", "exec-1", RUNTIME_TOOL_RESULT)
      ).toBe("rt.acme.exec.exec-1.tool_result");
    });

    test("builds a cancel subject", () => {
      expect(buildRuntimeStreamSubject("acme", "exec-1", RUNTIME_CANCEL)).toBe(
        "rt.acme.exec.exec-1.cancel"
      );
    });

    // Non-negotiable invariant (§1.1, §7 Risks #1): a runtime-stream subject
    // must NEVER start with "evt." — otherwise the per-tenant JetStream
    // stream (INGRESS-<tenant>, filter evt.<tenant>.>) would capture every
    // token delta, causing storage blowup and consumer poisoning.
    test("never produces a subject starting with 'evt.'", () => {
      const kinds = [
        RUNTIME_TOKEN,
        RUNTIME_TOOL_CALL,
        RUNTIME_TOOL_RESULT,
        RUNTIME_CANCEL,
      ] as const;
      const tenants = ["acme", "tenant-with-dashes", "t1"];
      for (const tenant of tenants) {
        for (const kind of kinds) {
          const subject = buildRuntimeStreamSubject(
            tenant,
            "some-exec-id",
            kind
          );
          expect(subject.startsWith("evt.")).toBe(false);
          expect(subject.startsWith("rt.")).toBe(true);
        }
      }
    });
  });

  describe("buildRuntimeStreamWildcard", () => {
    test("builds a wildcard subject covering every kind for one execution", () => {
      expect(buildRuntimeStreamWildcard("acme", "exec-1")).toBe(
        "rt.acme.exec.exec-1.*"
      );
    });

    test("never starts with 'evt.'", () => {
      expect(
        buildRuntimeStreamWildcard("acme", "exec-1").startsWith("evt.")
      ).toBe(false);
    });
  });

  describe("envelope compliance for token events", () => {
    test("a token envelope built with buildEventEnvelope passes isCompliantEnvelope even though its subject is outside evt.", () => {
      const payload: RuntimeTokenPayload = {
        executionId: "exec-1",
        agentId: "agent-1",
        seq: 0,
        delta: "Hello",
        done: false,
      };
      const envelope = buildEventEnvelope({
        type: RUNTIME_TOKEN_EVENT_TYPE,
        source: "agent-ai-service",
        resource: "execution/exec-1",
        tenant: "acme",
        producer: "agent-ai-service",
        domain: "automation",
        channel: "platform",
        provider: "internal",
        accountid: "ai-agent-gateway",
        payload: payload as unknown as Record<string, unknown>,
        correlationId: "exec-1",
      });

      expect(isCompliantEnvelope(envelope)).toBe(true);
      expect(envelope.type).toBe(RUNTIME_TOKEN_EVENT_TYPE);

      // The subject the envelope travels on is independent of envelope.type;
      // it must be the rt. namespace, not evt.<tenant>....
      const subject = buildRuntimeStreamSubject(
        "acme",
        "exec-1",
        RUNTIME_TOKEN
      );
      expect(subject.startsWith("evt.")).toBe(false);
    });
  });
});
