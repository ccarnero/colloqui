import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { createQueuedSql } from "@yoizen/testing";
import type { Sql } from "postgres";
import { SchedulesRepository } from "../../src/modules/schedules/schedules.repository";
import { SchedulesService } from "../../src/modules/schedules/schedules.service";
import {
  ScheduleType,
  ExecMode,
} from "../../src/modules/schedules/schedules.dto";
import { TenantConnectionManager } from "../../src/providers/tenant-connection-manager";

function sampleSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "job",
    description: "",
    type: ScheduleType.CRON,
    expression: "0 0 * * *",
    exec_mode: ExecMode.JS_INLINE,
    config: { script: "return 1" },
    enabled: true,
    next_run_at: "2020-01-02T00:00:00.000Z",
    last_run_at: null,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("SchedulesService", () => {
  let service: SchedulesService;
  let sqlQueue: unknown[][];
  let mockSql: Sql;

  beforeEach(async () => {
    sqlQueue = [];
    mockSql = createQueuedSql(sqlQueue, mock);
    const tenantConnections = {
      ensureSchema: mock(() => Promise.resolve(mockSql)),
    };

    const module = await Test.createTestingModule({
      providers: [
        SchedulesRepository,
        SchedulesService,
        { provide: TenantConnectionManager, useValue: tenantConnections },
      ],
    }).compile();

    service = module.get(SchedulesService);
  });

  describe("create", () => {
    it("inserts schedule and returns row", async () => {
      sqlQueue.push([sampleSchedule()]);
      const row = await service.create(
        {
          name: "job",
          type: ScheduleType.CRON,
          expression: "0 0 * * *",
          exec_mode: ExecMode.JS_INLINE,
          config: { script: "return 1" },
        },
        "tenant-a",
      );
      expect(row.name).toBe("job");
      expect(row.type).toBe(ScheduleType.CRON);
    });

    it("throws BadRequestException when js-inline config missing script", async () => {
      await expect(
        service.create(
          {
            name: "bad",
            type: ScheduleType.CRON,
            expression: "0 0 * * *",
            exec_mode: ExecMode.JS_INLINE,
            config: {},
          },
          "tenant-a",
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("findAll", () => {
    it("returns schedules with pagination fields", async () => {
      // Nested empty sql`` fragments run before the outer SELECT (postgres.js).
      sqlQueue.push(
        [],
        [],
        [sampleSchedule(), sampleSchedule({ id: "2", name: "b" })],
      );
      const result = await service.findAll(
        { limit: 10, offset: 0 },
        "tenant-a",
      );
      expect(result.schedules).toHaveLength(2);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });
  });

  describe("findById", () => {
    it("throws NotFoundException when missing", async () => {
      sqlQueue.push([]);
      await expect(
        service.findById("missing-id", "tenant-a"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns schedule when found", async () => {
      sqlQueue.push([sampleSchedule()]);
      const row = await service.findById(
        "550e8400-e29b-41d4-a716-446655440000",
        "tenant-a",
      );
      expect(row.name).toBe("job");
    });
  });

  describe("update", () => {
    it("updates fields after findById", async () => {
      const existing = sampleSchedule();
      sqlQueue.push(
        [existing],
        [
          {
            ...existing,
            name: "renamed",
            updated_at: "2020-02-01T00:00:00.000Z",
          },
        ],
      );
      const row = await service.update(
        "550e8400-e29b-41d4-a716-446655440000",
        { name: "renamed" },
        "tenant-a",
      );
      expect(row.name).toBe("renamed");
    });
  });

  describe("remove", () => {
    it("throws NotFoundException when delete returns no rows", async () => {
      sqlQueue.push([]);
      await expect(
        service.remove("550e8400-e29b-41d4-a716-446655440000", "tenant-a"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("completes when row deleted", async () => {
      sqlQueue.push([[{ id: "550e8400-e29b-41d4-a716-446655440000" }]]);
      await expect(
        service.remove("550e8400-e29b-41d4-a716-446655440000", "tenant-a"),
      ).resolves.toBeUndefined();
    });
  });

  describe("computeNextRunAt", () => {
    it("throws BadRequestException for invalid interval expression", () => {
      expect(() =>
        service.computeNextRunAt(ScheduleType.INTERVAL, "0"),
      ).toThrow(BadRequestException);
    });
  });
});
