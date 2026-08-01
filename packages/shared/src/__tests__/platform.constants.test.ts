import { describe, expect, test } from "bun:test";
import {
  AGENT_ADMIN_AGENT_OUTBOUND,
  AGENT_ADMIN_CHAT_RESPOND,
  AGENT_ADMIN_CONFIG_SYNC,
  AGENT_ADMIN_EVENT,
  AGENT_ADMIN_EXECUTION_STATUS,
  AGENT_ADMIN_JOB_TRIGGER,
  AGENT_ADMIN_JOBS_SYNC,
  AGENT_ADMIN_SUBJECT_PREFIX,
  buildPlatformSubject,
} from "../constants";

describe("Platform NATS Subjects", () => {
  describe("constants", () => {
    test("AGENT_ADMIN_SUBJECT_PREFIX has correct format", () => {
      expect(AGENT_ADMIN_SUBJECT_PREFIX).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal"
      );
    });

    test("AGENT_ADMIN_CONFIG_SYNC follows subject convention (DOCS/messaging/service-bus.md)", () => {
      expect(AGENT_ADMIN_CONFIG_SYNC).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.config_sync.v1"
      );
    });

    test("AGENT_ADMIN_JOBS_SYNC follows subject convention (DOCS/messaging/service-bus.md)", () => {
      expect(AGENT_ADMIN_JOBS_SYNC).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.jobs_sync.v1"
      );
    });

    test("AGENT_ADMIN_JOB_TRIGGER follows subject convention (DOCS/messaging/service-bus.md)", () => {
      expect(AGENT_ADMIN_JOB_TRIGGER).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.job_trigger.v1"
      );
    });

    test("AGENT_ADMIN_CHAT_RESPOND follows subject convention (DOCS/messaging/service-bus.md)", () => {
      expect(AGENT_ADMIN_CHAT_RESPOND).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.chat_respond.v1"
      );
    });

    test("AGENT_ADMIN_AGENT_OUTBOUND follows subject convention (DOCS/messaging/service-bus.md)", () => {
      expect(AGENT_ADMIN_AGENT_OUTBOUND).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.agent_outbound.v1"
      );
    });

    test("AGENT_ADMIN_EXECUTION_STATUS follows subject convention (DOCS/messaging/service-bus.md)", () => {
      expect(AGENT_ADMIN_EXECUTION_STATUS).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.execution_status.v1"
      );
    });

    test("AGENT_ADMIN_EVENT follows subject convention (DOCS/messaging/service-bus.md)", () => {
      expect(AGENT_ADMIN_EVENT).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.event.v1"
      );
    });
  });

  describe("buildPlatformSubject", () => {
    test("replaces {tenant} placeholder with tenantId", () => {
      const result = buildPlatformSubject(AGENT_ADMIN_CONFIG_SYNC, "acme");
      expect(result).toBe(
        "evt.acme.agent-admin-service.automation.platform.internal.config_sync.v1"
      );
    });

    test("works with JOBS_SYNC subject", () => {
      const result = buildPlatformSubject(AGENT_ADMIN_JOBS_SYNC, "tenant-42");
      expect(result).toBe(
        "evt.tenant-42.agent-admin-service.automation.platform.internal.jobs_sync.v1"
      );
    });

    test("works with AGENT_OUTBOUND subject (nested action)", () => {
      const result = buildPlatformSubject(
        AGENT_ADMIN_AGENT_OUTBOUND,
        "my-tenant"
      );
      expect(result).toBe(
        "evt.my-tenant.agent-admin-service.automation.platform.internal.agent_outbound.v1"
      );
    });

    test("works with EXECUTION_STATUS subject (nested action)", () => {
      const result = buildPlatformSubject(AGENT_ADMIN_EXECUTION_STATUS, "prod");
      expect(result).toBe(
        "evt.prod.agent-admin-service.automation.platform.internal.execution_status.v1"
      );
    });

    test("works with SUBJECT_PREFIX as template", () => {
      const result = buildPlatformSubject(AGENT_ADMIN_SUBJECT_PREFIX, "acme");
      expect(result).toBe(
        "evt.acme.agent-admin-service.automation.platform.internal"
      );
    });

    test("handles single-char tenantId", () => {
      const result = buildPlatformSubject(AGENT_ADMIN_CONFIG_SYNC, "a");
      expect(result).toBe(
        "evt.a.agent-admin-service.automation.platform.internal.config_sync.v1"
      );
    });

    test("replaces all {tenant} occurrences", () => {
      const template =
        "evt.{tenant}.agent-admin-service.automation.platform.internal.test.{tenant}.v1";
      const result = buildPlatformSubject(template, "acme");
      expect(result).toBe(
        "evt.acme.agent-admin-service.automation.platform.internal.test.acme.v1"
      );
    });
  });
});
