import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import { JobsMongoRepository } from "../../src/modules/jobs/jobs.mongo.repository";
import { YoizenclawTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { createMockDb, createMockTenantManager } from "../mongo-mock";

describe("JobsMongoRepository", () => {
  let repository: JobsMongoRepository;
  const TENANT_ID = "tenant-123";

  beforeEach(async () => {
    const db = createMockDb({
      jobs: {
        countDocuments: vi.fn(async () => 1),
        find: vi.fn(() => ({
          sort: vi.fn(() => ({
            skip: vi.fn(() => ({
              limit: vi.fn(() => ({
                toArray: vi.fn(async () => [
                  {
                    _id: "job-1",
                    name: "Test Job",
                    agent_id: "agent-1",
                    schedule: "interval:60",
                    payload: {},
                    is_active: true,
                    last_run: null,
                    next_run: new Date(),
                    created_at: new Date(),
                    updated_at: new Date(),
                  },
                ]),
              })),
            })),
          })),
        })),
        findOne: vi.fn(async () => null),
        insertOne: vi.fn(async () => ({ acknowledged: true })),
        findOneAndUpdate: vi.fn(async () => null),
        deleteOne: vi.fn(async () => ({ deletedCount: 1 })),
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsMongoRepository,
        {
          provide: YoizenclawTenantConnectionManager,
          useValue: createMockTenantManager(db),
        },
      ],
    }).compile();

    repository = module.get<JobsMongoRepository>(JobsMongoRepository);
  });

  it("findAll returns jobs with total", async () => {
    const result = await repository.findAll(TENANT_ID);
    expect(result.total).toBe(1);
    expect(result.jobs).toHaveLength(1);
  });

  it("create inserts a job", async () => {
    const job = await repository.create(TENANT_ID, {
      name: "job",
      agent_id: "agent-1",
      schedule: "interval:30",
    });
    expect(job.name).toBe("job");
  });
});
