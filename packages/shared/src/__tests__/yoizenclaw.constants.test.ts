import { describe, test, expect } from "bun:test";
import {
  YOIZENCLAW_SUBJECT_PREFIX,
  YOIZENCLAW_CONFIG_SYNC,
  YOIZENCLAW_JOBS_SYNC,
  YOIZENCLAW_JOB_TRIGGER,
  YOIZENCLAW_CHAT_RESPOND,
  YOIZENCLAW_ONLINE,
  YOIZENCLAW_AGENT_OUTBOUND,
  YOIZENCLAW_EXECUTION_STATUS,
  YOIZENCLAW_EVENT,
  buildYoizenClawSubject,
} from "../constants";

describe("YoizenClaw NATS Subjects", () => {
  describe("constants", () => {
    test("YOIZENCLAW_SUBJECT_PREFIX has correct format", () => {
      expect(YOIZENCLAW_SUBJECT_PREFIX).toBe(
        "evt.{tenant}.yoizenclaw-admin-service.automation.yoizenclaw.internal",
      );
    });

    test("YOIZENCLAW_CONFIG_SYNC follows wdocs convention", () => {
      expect(YOIZENCLAW_CONFIG_SYNC).toBe(
        "evt.{tenant}.yoizenclaw-admin-service.automation.yoizenclaw.internal.config_sync.v1",
      );
    });

    test("YOIZENCLAW_JOBS_SYNC follows wdocs convention", () => {
      expect(YOIZENCLAW_JOBS_SYNC).toBe(
        "evt.{tenant}.yoizenclaw-admin-service.automation.yoizenclaw.internal.jobs_sync.v1",
      );
    });

    test("YOIZENCLAW_JOB_TRIGGER follows wdocs convention", () => {
      expect(YOIZENCLAW_JOB_TRIGGER).toBe(
        "evt.{tenant}.yoizenclaw-admin-service.automation.yoizenclaw.internal.job_trigger.v1",
      );
    });

    test("YOIZENCLAW_CHAT_RESPOND follows wdocs convention", () => {
      expect(YOIZENCLAW_CHAT_RESPOND).toBe(
        "evt.{tenant}.yoizenclaw-admin-service.automation.yoizenclaw.internal.chat_respond.v1",
      );
    });

    test("YOIZENCLAW_ONLINE follows wdocs convention", () => {
      expect(YOIZENCLAW_ONLINE).toBe(
        "evt.{tenant}.yoizenclaw-admin-service.automation.yoizenclaw.internal.online.v1",
      );
    });

    test("YOIZENCLAW_AGENT_OUTBOUND follows wdocs convention", () => {
      expect(YOIZENCLAW_AGENT_OUTBOUND).toBe(
        "evt.{tenant}.yoizenclaw-admin-service.automation.yoizenclaw.internal.agent_outbound.v1",
      );
    });

    test("YOIZENCLAW_EXECUTION_STATUS follows wdocs convention", () => {
      expect(YOIZENCLAW_EXECUTION_STATUS).toBe(
        "evt.{tenant}.yoizenclaw-admin-service.automation.yoizenclaw.internal.execution_status.v1",
      );
    });

    test("YOIZENCLAW_EVENT follows wdocs convention", () => {
      expect(YOIZENCLAW_EVENT).toBe(
        "evt.{tenant}.yoizenclaw-admin-service.automation.yoizenclaw.internal.event.v1",
      );
    });
  });

  describe("buildYoizenClawSubject", () => {
    test("replaces {tenant} placeholder with tenantId", () => {
      const result = buildYoizenClawSubject(
        YOIZENCLAW_CONFIG_SYNC,
        "acme",
      );
      expect(result).toBe(
        "evt.acme.yoizenclaw-admin-service.automation.yoizenclaw.internal.config_sync.v1",
      );
    });

    test("works with JOBS_SYNC subject", () => {
      const result = buildYoizenClawSubject(
        YOIZENCLAW_JOBS_SYNC,
        "tenant-42",
      );
      expect(result).toBe(
        "evt.tenant-42.yoizenclaw-admin-service.automation.yoizenclaw.internal.jobs_sync.v1",
      );
    });

    test("works with AGENT_OUTBOUND subject (nested action)", () => {
      const result = buildYoizenClawSubject(
        YOIZENCLAW_AGENT_OUTBOUND,
        "my-tenant",
      );
      expect(result).toBe(
        "evt.my-tenant.yoizenclaw-admin-service.automation.yoizenclaw.internal.agent_outbound.v1",
      );
    });

    test("works with EXECUTION_STATUS subject (nested action)", () => {
      const result = buildYoizenClawSubject(
        YOIZENCLAW_EXECUTION_STATUS,
        "prod",
      );
      expect(result).toBe(
        "evt.prod.yoizenclaw-admin-service.automation.yoizenclaw.internal.execution_status.v1",
      );
    });

    test("works with SUBJECT_PREFIX as template", () => {
      const result = buildYoizenClawSubject(
        YOIZENCLAW_SUBJECT_PREFIX,
        "acme",
      );
      expect(result).toBe(
        "evt.acme.yoizenclaw-admin-service.automation.yoizenclaw.internal",
      );
    });

    test("handles single-char tenantId", () => {
      const result = buildYoizenClawSubject(YOIZENCLAW_ONLINE, "a");
      expect(result).toBe(
        "evt.a.yoizenclaw-admin-service.automation.yoizenclaw.internal.online.v1",
      );
    });

    test("replaces all {tenant} occurrences", () => {
      const template =
        "evt.{tenant}.yoizenclaw-admin-service.automation.yoizenclaw.internal.test.{tenant}.v1";
      const result = buildYoizenClawSubject(template, "acme");
      expect(result).toBe(
        "evt.acme.yoizenclaw-admin-service.automation.yoizenclaw.internal.test.acme.v1",
      );
    });
  });
});
