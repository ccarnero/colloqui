import { beforeEach, describe, expect, it, vi } from "bun:test";
import { Test, type TestingModule } from "@nestjs/testing";
import { JobsMongoRepository } from "../../src/modules/jobs/jobs.mongo.repository";
import { YoizenclawTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { createMockDb, createMockTenantManager } from "../mongo-mock";

describe("JobsMongoRepository", () => {
  let repository: JobsMongoRepository;
  let jobsCollection: { deleteOne: ReturnType<typeof vi.fn> };
  let jobExecutionsCollection: { deleteMany: ReturnType<typeof vi.fn> };
  const TENANT_ID = "tenant-123";

  beforeEach(async () => {
    jobsCollection = {
      deleteOne: vi.fn(async () => ({ deletedCount: 1 })),
    };
    jobExecutionsCollection = {
      deleteMany: vi.fn(async () => ({ deletedCount: 2 })),
    };

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
        ...jobsCollection,
      },
      job_executions: {
        ...jobExecutionsCollection,
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

  describe("delete", () => {
    it("cascades: deletes job executions before deleting the job", async () => {
      const result = await repository.delete(TENANT_ID, "job-1");

      expect(result).toBe(true);
      expect(jobExecutionsCollection.deleteMany).toHaveBeenCalledWith({
        job_id: "job-1",
      });
      expect(jobsCollection.deleteOne).toHaveBeenCalledWith({ _id: "job-1" });
    });

    it("still succeeds when the job has no executions", async () => {
      jobExecutionsCollection.deleteMany.mockResolvedValueOnce({
        deletedCount: 0,
      });

      const result = await repository.delete(TENANT_ID, "job-1");

      expect(result).toBe(true);
    });

    it("returns false for a non-existent job", async () => {
      jobsCollection.deleteOne.mockResolvedValueOnce({ deletedCount: 0 });

      const result = await repository.delete(TENANT_ID, "non-existent");

      expect(result).toBe(false);
    });
  });
});
