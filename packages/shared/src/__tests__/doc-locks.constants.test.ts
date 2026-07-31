import { describe, expect, test } from "bun:test";
import {
  CLAIM_CHECK_THRESHOLD_BYTES,
  WEBHOOK_FORWARDED_HEADERS,
} from "../channel.constants";
import {
  RUNTIME_STREAM_SUBJECT_PREFIX,
  TENANT_HEADER,
  WORKFLOW_DEFAULT_TIMEOUT_MS,
  WORKFLOW_TASK_TIMEOUT_MS,
} from "../constants";

/**
 * Lock K5 (see cowork/DOC-VS-CODE-AUDIT.md): constants snapshot.
 *
 * These literals are documented in DOCS/ (workflow-service README, ADRs,
 * architecture overview) and quoted directly by the doc-vs-code audit. This
 * test pins the actual source-of-truth values so that changing any of them
 * without updating the docs fails loudly here first.
 *
 * Discrepancies found while writing this lock against the audit's assumed
 * values:
 * - `RUNTIME_STREAM_SUBJECT_PREFIX` is `"rt.{tenant}.exec.{executionId}"`,
 *   NOT the bare `"rt."` prefix the audit shorthand suggested. The literal
 *   template (verified at packages/shared/src/constants.ts:198) is asserted
 *   below, and it does start with `"rt."` (checked separately, since that's
 *   the invariant the audit actually cares about — never `"evt."`).
 * - All other values (`WORKFLOW_DEFAULT_TIMEOUT_MS`, `WORKFLOW_TASK_TIMEOUT_MS`,
 *   `CLAIM_CHECK_THRESHOLD_BYTES`, `TENANT_HEADER`, `WEBHOOK_FORWARDED_HEADERS`)
 *   matched exactly what the audit/task described.
 */
describe("Doc-pinned constants (DOCS/ literals)", () => {
  test("WORKFLOW_DEFAULT_TIMEOUT_MS is 600_000 (10 minutes)", () => {
    expect(WORKFLOW_DEFAULT_TIMEOUT_MS).toBe(600_000);
  });

  test("WORKFLOW_TASK_TIMEOUT_MS is 30_000", () => {
    expect(WORKFLOW_TASK_TIMEOUT_MS).toBe(30_000);
  });

  test("CLAIM_CHECK_THRESHOLD_BYTES is 262_144 (256 KiB)", () => {
    expect(CLAIM_CHECK_THRESHOLD_BYTES).toBe(262_144);
  });

  test("TENANT_HEADER is 'x-yoizen-tenant'", () => {
    expect(TENANT_HEADER).toBe("x-yoizen-tenant");
  });

  test("WEBHOOK_FORWARDED_HEADERS has exactly its current 7 entries", () => {
    expect(WEBHOOK_FORWARDED_HEADERS.length).toBe(7);
    expect([...WEBHOOK_FORWARDED_HEADERS]).toEqual([
      "content-type",
      "x-hub-signature-256",
      "x-hub-signature",
      "x-telegram-bot-api-secret-token",
      "x-http-channel-token",
      "x-request-id",
      "user-agent",
    ]);
  });

  test("RUNTIME_STREAM_SUBJECT_PREFIX matches the documented template and starts with 'rt.'", () => {
    expect(RUNTIME_STREAM_SUBJECT_PREFIX).toBe(
      "rt.{tenant}.exec.{executionId}"
    );
    expect(RUNTIME_STREAM_SUBJECT_PREFIX.startsWith("rt.")).toBe(true);
  });
});
