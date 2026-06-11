import { describe, test, expect } from "bun:test";
import {
  PLATFORM_SUBJECT_PREFIX,
  PLATFORM_CONFIG_SYNC,
  PLATFORM_JOBS_SYNC,
  PLATFORM_JOB_TRIGGER,
  PLATFORM_CHAT_RESPOND,
  PLATFORM_ONLINE,
  PLATFORM_AGENT_OUTBOUND,
  PLATFORM_EXECUTION_STATUS,
  PLATFORM_EVENT,
  buildPlatformSubject,
} from "../constants";

describe("Platform NATS Subjects", () => {
  describe("constants", () => {
    test("PLATFORM_SUBJECT_PREFIX has correct format", () => {
      expect(PLATFORM_SUBJECT_PREFIX).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal",
      );
    });

    test("PLATFORM_CONFIG_SYNC follows subject convention (DOCS/arquitectura/01-service-bus.md)", () => {
      expect(PLATFORM_CONFIG_SYNC).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.config_sync.v1",
      );
    });

    test("PLATFORM_JOBS_SYNC follows subject convention (DOCS/arquitectura/01-service-bus.md)", () => {
      expect(PLATFORM_JOBS_SYNC).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.jobs_sync.v1",
      );
    });

    test("PLATFORM_JOB_TRIGGER follows subject convention (DOCS/arquitectura/01-service-bus.md)", () => {
      expect(PLATFORM_JOB_TRIGGER).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.job_trigger.v1",
      );
    });

    test("PLATFORM_CHAT_RESPOND follows subject convention (DOCS/arquitectura/01-service-bus.md)", () => {
      expect(PLATFORM_CHAT_RESPOND).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.chat_respond.v1",
      );
    });

    test("PLATFORM_ONLINE follows subject convention (DOCS/arquitectura/01-service-bus.md)", () => {
      expect(PLATFORM_ONLINE).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.online.v1",
      );
    });

    test("PLATFORM_AGENT_OUTBOUND follows subject convention (DOCS/arquitectura/01-service-bus.md)", () => {
      expect(PLATFORM_AGENT_OUTBOUND).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.agent_outbound.v1",
      );
    });

    test("PLATFORM_EXECUTION_STATUS follows subject convention (DOCS/arquitectura/01-service-bus.md)", () => {
      expect(PLATFORM_EXECUTION_STATUS).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.execution_status.v1",
      );
    });

    test("PLATFORM_EVENT follows subject convention (DOCS/arquitectura/01-service-bus.md)", () => {
      expect(PLATFORM_EVENT).toBe(
        "evt.{tenant}.agent-admin-service.automation.platform.internal.event.v1",
      );
    });
  });

  describe("buildPlatformSubject", () => {
    test("replaces {tenant} placeholder with tenantId", () => {
      const result = buildPlatformSubject(
        PLATFORM_CONFIG_SYNC,
        "acme",
      );
      expect(result).toBe(
        "evt.acme.agent-admin-service.automation.platform.internal.config_sync.v1",
      );
    });

    test("works with JOBS_SYNC subject", () => {
      const result = buildPlatformSubject(
        PLATFORM_JOBS_SYNC,
        "tenant-42",
      );
      expect(result).toBe(
        "evt.tenant-42.agent-admin-service.automation.platform.internal.jobs_sync.v1",
      );
    });

    test("works with AGENT_OUTBOUND subject (nested action)", () => {
      const result = buildPlatformSubject(
        PLATFORM_AGENT_OUTBOUND,
        "my-tenant",
      );
      expect(result).toBe(
        "evt.my-tenant.agent-admin-service.automation.platform.internal.agent_outbound.v1",
      );
    });

    test("works with EXECUTION_STATUS subject (nested action)", () => {
      const result = buildPlatformSubject(
        PLATFORM_EXECUTION_STATUS,
        "prod",
      );
      expect(result).toBe(
        "evt.prod.agent-admin-service.automation.platform.internal.execution_status.v1",
      );
    });

    test("works with SUBJECT_PREFIX as template", () => {
      const result = buildPlatformSubject(
        PLATFORM_SUBJECT_PREFIX,
        "acme",
      );
      expect(result).toBe(
        "evt.acme.agent-admin-service.automation.platform.internal",
      );
    });

    test("handles single-char tenantId", () => {
      const result = buildPlatformSubject(PLATFORM_ONLINE, "a");
      expect(result).toBe(
        "evt.a.agent-admin-service.automation.platform.internal.online.v1",
      );
    });

    test("replaces all {tenant} occurrences", () => {
      const template =
        "evt.{tenant}.agent-admin-service.automation.platform.internal.test.{tenant}.v1";
      const result = buildPlatformSubject(template, "acme");
      expect(result).toBe(
        "evt.acme.agent-admin-service.automation.platform.internal.test.acme.v1",
      );
    });
  });
});
