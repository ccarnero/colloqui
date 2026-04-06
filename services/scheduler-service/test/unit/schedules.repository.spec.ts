import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createQueuedSql } from "@yoizen/testing";
import type { Sql } from "postgres";
import {
  SchedulesRepository,
  type ISchedule,
} from "../../src/modules/schedules/schedules.repository";
import {
  CreateScheduleDto,
  ExecMode,
  ScheduleType,
  UpdateScheduleDto,
} from "../../src/modules/schedules/schedules.dto";
import { TenantConnectionManager } from "../../src/providers/tenant-connection-manager";

function scheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    name: "job",
    description: "",
    type: ScheduleType.CRON,
    expression: "* * * * *",
    exec_mode: ExecMode.JS_INLINE,
    config: {},
    enabled: true,
    next_run_at: null,
    last_run_at: null,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("SchedulesRepository", () => {
  async function compileWithSql(sql: Sql) {
    const tenantConnections = {
      ensureSchema: mock(() => Promise.resolve(sql)),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SchedulesRepository,
        {
          provide: TenantConnectionManager,
          useValue: tenantConnections,
        },
      ],
    }).compile();
    return moduleRef.get(SchedulesRepository);
  }

  it("create inserts schedule and returns row", async () => {
    const sql = createQueuedSql([[scheduleRow()]], mock);
    const repo = await compileWithSql(sql);
    const dto = new CreateScheduleDto();
    dto.name = "job";
    dto.type = ScheduleType.CRON;
    dto.expression = "* * * * *";
    dto.exec_mode = ExecMode.JS_INLINE;
    dto.config = {};

    const row = await repo.create(dto, "tenant-a", null);
    expect(row.id).toBe("s1");
    expect(sql).toHaveBeenCalled();
  });

  it("findById returns first row", async () => {
    const sql = createQueuedSql([[scheduleRow()]], mock);
    const repo = await compileWithSql(sql);
    const row = await repo.findById("s1", "tenant-a");
    expect(row?.id).toBe("s1");
    expect(sql).toHaveBeenCalled();
  });

  it("updateSchedule merges dto with existing", async () => {
    const sql = createQueuedSql([[scheduleRow({ name: "updated" })]], mock);
    const repo = await compileWithSql(sql);
    const existing = scheduleRow() as ISchedule;
    const dto = new UpdateScheduleDto();
    dto.name = "updated";

    const row = await repo.updateSchedule({
      id: "s1",
      tenantId: "tenant-a",
      dto,
      existing,
      nextRunAt: null,
    });
    expect(row.name).toBe("updated");
    expect(sql).toHaveBeenCalled();
  });
});
