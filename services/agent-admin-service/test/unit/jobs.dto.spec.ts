import "../setup-env";
import "reflect-metadata";
import { describe, it, expect } from "bun:test";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateJobDto, UpdateJobDto } from "../../src/modules/jobs/jobs.dto";

// ---------------------------------------------------------------------------
// class-validator integration tests for CreateJobDto and UpdateJobDto.
// Verifies that @IsOptional skips @IsSchedule when schedule is absent, and
// that invalid/valid schedule values are accepted/rejected as expected.
// ---------------------------------------------------------------------------

describe("UpdateJobDto — class-validator integration", () => {
  it("passes validation when schedule is omitted (@IsOptional must skip @IsSchedule)", async () => {
    const dto = plainToInstance(UpdateJobDto, { name: "My Job" });
    const errors = await validate(dto);
    const scheduleErrors = errors.filter((e) => e.property === "schedule");
    expect(scheduleErrors).toHaveLength(0);
  });

  it("fails validation when schedule is 'interval:abc' (malformed interval)", async () => {
    const dto = plainToInstance(UpdateJobDto, { schedule: "interval:abc" });
    const errors = await validate(dto);
    const scheduleErrors = errors.filter((e) => e.property === "schedule");
    expect(scheduleErrors.length).toBeGreaterThan(0);
  });
});

describe("CreateJobDto — class-validator integration", () => {
  it("passes validation with a valid cron schedule '*/5 * * * *' plus required fields", async () => {
    const dto = plainToInstance(CreateJobDto, {
      name: "Cron Job",
      agent_id: "550e8400-e29b-41d4-a716-446655440000",
      schedule: "*/5 * * * *",
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("passes validation with a valid interval schedule 'interval:60' plus required fields", async () => {
    const dto = plainToInstance(CreateJobDto, {
      name: "Interval Job",
      agent_id: "550e8400-e29b-41d4-a716-446655440001",
      schedule: "interval:60",
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
