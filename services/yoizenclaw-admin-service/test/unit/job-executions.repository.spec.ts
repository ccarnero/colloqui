import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import { JobExecutionsMongoRepository } from "../../src/modules/jobs/job-executions.mongo.repository";
import { YoizenclawTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { createMockDb, createMockTenantManager } from "../mongo-mock";

describe("JobExecutionsMongoRepository", () => {
  let repository: JobExecutionsMongoRepository;
  const TENANT_ID = "tenant-123";

  beforeEach(async () => {
    const db = createMockDb({
      job_executions: {
        aggregate: vi.fn(() => ({
          toArray: vi.fn(async () => [
            {
              total: [{ count: 1 }],
              rows: [
                {
                  _id: "exec-1",
                  job_id: "job-1",
                  job_name: "job",
                  status: "pending",
                  event_payload: {},
                  result: null,
                  logs: [],
                  error_message: null,
                  retry_count: 0,
                  triggered_by: "manual",
                  started_at: null,
                  finished_at: null,
                  created_at: new Date(),
                },
              ],
            },
          ]),
        })),
        insertOne: vi.fn(async () => ({ acknowledged: true })),
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobExecutionsMongoRepository,
        {
          provide: YoizenclawTenantConnectionManager,
          useValue: createMockTenantManager(db),
        },
      ],
    }).compile();

    repository = module.get<JobExecutionsMongoRepository>(
      JobExecutionsMongoRepository,
    );
  });

  it("findAll returns executions with total", async () => {
    const result = await repository.findAll(TENANT_ID);
    expect(result.total).toBe(1);
    expect(result.executions).toHaveLength(1);
  });

  it("create inserts execution", async () => {
    const row = await repository.create(TENANT_ID, {
      job_id: "job-1",
      status: "pending",
    });
    expect(row.job_id).toBe("job-1");
  });
});
