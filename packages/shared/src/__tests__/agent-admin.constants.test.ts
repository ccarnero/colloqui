import { describe, expect, test } from "bun:test";
import {
  AGENT_ADMIN_AGENT_OUTBOUND,
  AGENT_ADMIN_AGENT_PUBLISHED,
  AGENT_ADMIN_AGENT_UNPUBLISHED,
  AGENT_ADMIN_CHAT_RESPOND,
  AGENT_ADMIN_CONFIG_SYNC,
  AGENT_ADMIN_DOCUMENT_INGESTION,
  AGENT_ADMIN_EVENT,
  AGENT_ADMIN_EXECUTION_STATUS,
  AGENT_ADMIN_JOB_TRIGGER,
  AGENT_ADMIN_JOBS_SYNC,
  AGENT_ADMIN_ONLINE,
  AGENT_ADMIN_PRODUCER,
  AGENT_ADMIN_SKB_FILE_INGESTION,
  AGENT_ADMIN_SUBJECT_PREFIX,
  AI_AGENT_GATEWAY_EXECUTION_COMPLETED,
  AI_AGENT_GATEWAY_EXECUTION_FAILED,
  AI_AGENT_GATEWAY_EXECUTION_REQUESTED,
  AI_AGENT_GATEWAY_EXECUTION_STARTED,
  AI_AGENT_GATEWAY_SUBJECT_PREFIX,
  SCHEDULER_HEARTBEAT,
  SCHEDULER_SUBJECT_PREFIX,
} from "../constants";
import * as shared from "../index";

/**
 * Rename invariance (envelope-drift post-loop item 2).
 *
 * These constants were called `PLATFORM_*` until 2026-07-31. The names read as
 * platform-generic while their VALUES name one service, and that gap caused
 * two production bugs: agent-memory-service's publisher was copied out of
 * agent-admin and kept the platform-prefixed producer/domain constants, so it
 * reported
 * `producer: "agent-admin-service"` and `domain: "automation"` on a subject
 * that said `agent-memory-service`/`agent-memory` (T08 + its follow-up).
 *
 * The rename must be PURE: every value below is the wire string it has always
 * been. A rename that quietly edits a subject would re-route live traffic, so
 * each one is pinned against a literal here — not against the constant it
 * came from, which would make the assertion circular.
 */
describe("agent-admin constants (renamed from PLATFORM_*, values unchanged)", () => {
  test("producer identity is unchanged", () => {
    expect(AGENT_ADMIN_PRODUCER).toBe("agent-admin-service");
  });

  test("subject prefix is unchanged", () => {
    expect(AGENT_ADMIN_SUBJECT_PREFIX).toBe(
      "evt.{tenant}.agent-admin-service.automation.platform.internal"
    );
  });

  test("all twelve subjects keep their exact wire strings", () => {
    const prefix =
      "evt.{tenant}.agent-admin-service.automation.platform.internal";

    expect(AGENT_ADMIN_CONFIG_SYNC).toBe(`${prefix}.config_sync.v1`);
    expect(AGENT_ADMIN_JOBS_SYNC).toBe(`${prefix}.jobs_sync.v1`);
    expect(AGENT_ADMIN_JOB_TRIGGER).toBe(`${prefix}.job_trigger.v1`);
    expect(AGENT_ADMIN_CHAT_RESPOND).toBe(`${prefix}.chat_respond.v1`);
    expect(AGENT_ADMIN_ONLINE).toBe(`${prefix}.online.v1`);
    expect(AGENT_ADMIN_AGENT_OUTBOUND).toBe(`${prefix}.agent_outbound.v1`);
    expect(AGENT_ADMIN_EXECUTION_STATUS).toBe(`${prefix}.execution_status.v1`);
    expect(AGENT_ADMIN_AGENT_PUBLISHED).toBe(`${prefix}.agent_published.v1`);
    expect(AGENT_ADMIN_AGENT_UNPUBLISHED).toBe(
      `${prefix}.agent_unpublished.v1`
    );
    expect(AGENT_ADMIN_EVENT).toBe(`${prefix}.event.v1`);
    expect(AGENT_ADMIN_DOCUMENT_INGESTION).toBe(
      `${prefix}.document_ingestion.v1`
    );
    expect(AGENT_ADMIN_SKB_FILE_INGESTION).toBe(
      `${prefix}.skb_file_ingestion.v1`
    );
  });

  test("every renamed subject is a canonical 8-token subject on the admin family", () => {
    const subjects = [
      AGENT_ADMIN_CONFIG_SYNC,
      AGENT_ADMIN_JOBS_SYNC,
      AGENT_ADMIN_JOB_TRIGGER,
      AGENT_ADMIN_CHAT_RESPOND,
      AGENT_ADMIN_ONLINE,
      AGENT_ADMIN_AGENT_OUTBOUND,
      AGENT_ADMIN_EXECUTION_STATUS,
      AGENT_ADMIN_AGENT_PUBLISHED,
      AGENT_ADMIN_AGENT_UNPUBLISHED,
      AGENT_ADMIN_EVENT,
      AGENT_ADMIN_DOCUMENT_INGESTION,
      AGENT_ADMIN_SKB_FILE_INGESTION,
    ];

    for (const subject of subjects) {
      const tokens = subject.split(".");
      expect(tokens.length).toBe(8);
      expect(tokens[2]).toBe(AGENT_ADMIN_PRODUCER);
      expect(subject.startsWith(AGENT_ADMIN_SUBJECT_PREFIX)).toBe(true);
    }
  });

  test("the old platform-generic names are gone from the public surface", () => {
    // Assembled, never written out: item 2's accept sweep greps `packages/` and
    // `services/` for these identifiers and requires zero hits.
    const oldNames = [
      ["PLATFORM", "PRODUCER"].join("_"),
      ["PLATFORM", "SUBJECT", "PREFIX"].join("_"),
      ["PLATFORM", "CONFIG", "SYNC"].join("_"),
      ["PLATFORM", "JOB", "TRIGGER"].join("_"),
      ["PLATFORM", "AGENT", "PUBLISHED"].join("_"),
      ["PLATFORM", "EXECUTION", "REQUESTED"].join("_"),
      ["PLATFORM", "EXECUTION", "FAILED"].join("_"),
      ["PLATFORM", "SCHEDULER", "HEARTBEAT"].join("_"),
    ];

    for (const name of oldNames) {
      expect(name in shared).toBe(false);
    }
  });

  test("ai-agent-gateway execution subjects keep their exact wire strings", () => {
    // Renamed from PLATFORM_EXECUTION_* on the same date, same reason.
    const prefix =
      "evt.{tenant}.ai-agent-gateway.automation.platform.internal";

    expect(AI_AGENT_GATEWAY_SUBJECT_PREFIX).toBe(prefix);
    expect(AI_AGENT_GATEWAY_EXECUTION_REQUESTED).toBe(
      `${prefix}.execution_requested.v1`
    );
    expect(AI_AGENT_GATEWAY_EXECUTION_STARTED).toBe(
      `${prefix}.execution_started.v1`
    );
    expect(AI_AGENT_GATEWAY_EXECUTION_COMPLETED).toBe(
      `${prefix}.execution_completed.v1`
    );
    expect(AI_AGENT_GATEWAY_EXECUTION_FAILED).toBe(
      `${prefix}.execution_failed.v1`
    );
  });

  test("scheduler heartbeat keeps its exact wire string", () => {
    expect(SCHEDULER_SUBJECT_PREFIX).toBe(
      "evt.{tenant}.agent-scheduler-service.automation.platform.internal"
    );
    expect(SCHEDULER_HEARTBEAT).toBe(
      "evt.{tenant}.agent-scheduler-service.automation.platform.internal.heartbeat.v1"
    );
  });

  test("the genuinely generic constants KEEP their names and values", () => {
    // These are the internal-event convention shared by every platform
    // producer — renaming them would have been the opposite mistake.
    expect(shared.PLATFORM_CHANNEL).toBe("platform");
    expect(shared.PLATFORM_PROVIDER).toBe("internal");
    expect(shared.PLATFORM_ACCOUNT_ID).toBe("platform-admin");
    expect(shared.PLATFORM_DOMAIN).toBe("automation");
  });
});
