import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import {
  JobsRepository,
  type IJob,
  type ICreateJobData,
} from "../../src/modules/jobs/jobs.repository";
import {
  TenantConnectionManager,
  type Sql,
} from "@yoizen/database";
import { mockSqlSequentialResponses } from "../mock-utils";

const createMockSql = (): Sql => {
  const mockQuery = vi.fn();

  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      return mockQuery(strings, ...values);
    },
    {
      unsafe: vi.fn((value: string) => value),
      json: vi.fn((value: unknown) => JSON.stringify(value)),
      begin: vi.fn(),
      end: vi.fn(),
    },
  ) as unknown as Sql;

  (sql as unknown as { _mockQuery: typeof mockQuery })._mockQuery = mockQuery;

  return sql;
};

describe("JobsRepository", () => {
  let repository: JobsRepository;
  let mockConnectionManager: TenantConnectionManager;
  let mockSql: Sql;
  const TENANT_ID = "tenant-123";

  beforeEach(async () => {
    mockSql = createMockSql();

    mockConnectionManager = {
      ensureSchema: vi.fn(() => Promise.resolve()),
      getConnection: vi.fn().mockReturnValue(mockSql),
    } as unknown as TenantConnectionManager;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsRepository,
        {
          provide: TenantConnectionManager,
          useValue: mockConnectionManager,
        },
      ],
    }).compile();

    repository = module.get<JobsRepository>(JobsRepository);
  });

  describe("findAll", () => {
    it("should return jobs with default pagination", async () => {
      const mockJobs: IJob[] = [
        {
          id: "job-1",
          name: "Test Job 1",
          agent_id: "agent-1",
          schedule: "0 */6 * * *",
          payload: {},
          is_active: true,
          last_run: null,
          next_run: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 1 }]);
      mockQuery.mockResolvedValueOnce(mockJobs);

      const result = await repository.findAll(TENANT_ID);

      expect(result.jobs).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockConnectionManager.getConnection).toHaveBeenCalledWith(
        TENANT_ID,
      );
    });

    it("should filter by agent_id", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockSqlSequentialResponses(mockQuery, [
        [],
        [{ count: 0 }],
        [],
      ]);

      await repository.findAll(TENANT_ID, { agent_id: "agent-1" });

      expect(mockQuery).toHaveBeenCalled();
    });

    it("should filter by is_active", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockSqlSequentialResponses(mockQuery, [
        [],
        [{ count: 0 }],
        [],
      ]);

      await repository.findAll(TENANT_ID, { is_active: true });

      expect(mockQuery).toHaveBeenCalled();
    });

    it("should use custom limit and offset", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 100 }]);
      mockQuery.mockResolvedValueOnce([]);

      await repository.findAll(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe("findById", () => {
    it("should return job by id", async () => {
      const mockJob: IJob = {
        id: "job-1",
        name: "Test Job",
        agent_id: "agent-1",
        schedule: "0 */6 * * *",
        payload: {},
        is_active: true,
        last_run: null,
        next_run: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([mockJob]);

      const result = await repository.findById(TENANT_ID, "job-1");

      expect(result).toEqual(mockJob);
    });

    it("should return null when job not found", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.findById(TENANT_ID, "non-existent");

      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("should create a new job with calculated next_run", async () => {
      const createData: ICreateJobData = {
        name: "New Job",
        agent_id: "agent-1",
        schedule: "0 */6 * * *",
        payload: { key: "value" },
      };

      const createdJob: IJob = {
        id: "new-job-id",
        name: createData.name,
        agent_id: createData.agent_id,
        schedule: createData.schedule,
        payload: createData.payload!,
        is_active: true,
        last_run: null,
        next_run: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([createdJob]);

      const result = await repository.create(TENANT_ID, createData);

      expect(result.id).toBe("new-job-id");
      expect(result.is_active).toBe(true);
      expect(result.next_run).not.toBeNull();
    });

    it("should create job with interval schedule", async () => {
      const createData: ICreateJobData = {
        name: "Interval Job",
        agent_id: "agent-1",
        schedule: "interval:30",
      };

      const createdJob: IJob = {
        id: "interval-job-id",
        name: createData.name,
        agent_id: createData.agent_id,
        schedule: createData.schedule,
        payload: {},
        is_active: true,
        last_run: null,
        next_run: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([createdJob]);

      const result = await repository.create(TENANT_ID, createData);

      expect(result.schedule).toBe("interval:30");
    });

    it("should create job with once schedule (no next_run)", async () => {
      const createData: ICreateJobData = {
        name: "Once Job",
        agent_id: "agent-1",
        schedule: "once",
      };

      const createdJob: IJob = {
        id: "once-job-id",
        name: createData.name,
        agent_id: createData.agent_id,
        schedule: createData.schedule,
        payload: {},
        is_active: true,
        last_run: null,
        next_run: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([createdJob]);

      const result = await repository.create(TENANT_ID, createData);

      expect(result.schedule).toBe("once");
      expect(result.next_run).toBeNull();
    });
  });

  describe("update", () => {
    it("should update job fields", async () => {
      const updatedJob: IJob = {
        id: "job-1",
        name: "Updated Name",
        agent_id: "agent-1",
        schedule: "0 */12 * * *",
        payload: { updated: true },
        is_active: true,
        last_run: null,
        next_run: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockSqlSequentialResponses(mockQuery, [
        [],
        [],
        [],
        [],
        [updatedJob],
      ]);

      const result = await repository.update(TENANT_ID, "job-1", {
        name: "Updated Name",
        schedule: "0 */12 * * *",
        payload: { updated: true },
      });

      expect(result).toEqual(updatedJob);
    });

    it("should recalculate next_run when schedule changes", async () => {
      const updatedJob: IJob = {
        id: "job-1",
        name: "Test Job",
        agent_id: "agent-1",
        schedule: "interval:15",
        payload: {},
        is_active: true,
        last_run: null,
        next_run: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockSqlSequentialResponses(mockQuery, [[], [], [updatedJob]]);

      const result = await repository.update(TENANT_ID, "job-1", {
        schedule: "interval:15",
      });

      expect(result?.schedule).toBe("interval:15");
    });

    it("should return null when job not found", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockSqlSequentialResponses(mockQuery, [[], []]);

      const result = await repository.update(TENANT_ID, "non-existent", {
        name: "New Name",
      });

      expect(result).toBeNull();
    });

    it("should update is_active field", async () => {
      const updatedJob: IJob = {
        id: "job-1",
        name: "Test Job",
        agent_id: "agent-1",
        schedule: "0 */6 * * *",
        payload: {},
        is_active: false,
        last_run: null,
        next_run: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockSqlSequentialResponses(mockQuery, [[], [updatedJob]]);

      const result = await repository.update(TENANT_ID, "job-1", {
        is_active: false,
      });

      expect(result?.is_active).toBe(false);
    });
  });

  describe("delete", () => {
    it("should delete job", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([{ id: "job-1" }]);

      const result = await repository.delete(TENANT_ID, "job-1");

      expect(result).toBe(true);
    });

    it("should return false when job not found", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.delete(TENANT_ID, "non-existent");

      expect(result).toBe(false);
    });
  });

  describe("enable", () => {
    it("should enable job", async () => {
      const enabledJob: IJob = {
        id: "job-1",
        name: "Test Job",
        agent_id: "agent-1",
        schedule: "0 */6 * * *",
        payload: {},
        is_active: true,
        last_run: null,
        next_run: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([enabledJob]);

      const result = await repository.enable(TENANT_ID, "job-1");

      expect(result?.is_active).toBe(true);
    });

    it("should return null when job not found", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.enable(TENANT_ID, "non-existent");

      expect(result).toBeNull();
    });
  });

  describe("disable", () => {
    it("should disable job", async () => {
      const disabledJob: IJob = {
        id: "job-1",
        name: "Test Job",
        agent_id: "agent-1",
        schedule: "0 */6 * * *",
        payload: {},
        is_active: false,
        last_run: null,
        next_run: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([disabledJob]);

      const result = await repository.disable(TENANT_ID, "job-1");

      expect(result?.is_active).toBe(false);
    });

    it("should return null when job not found", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.disable(TENANT_ID, "non-existent");

      expect(result).toBeNull();
    });
  });

  describe("updateLastRun", () => {
    it("should update last_run and recalculate next_run", async () => {
      const updatedJob: IJob = {
        id: "job-1",
        name: "Test Job",
        agent_id: "agent-1",
        schedule: "0 */6 * * *",
        payload: {},
        is_active: true,
        last_run: new Date(),
        next_run: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([updatedJob]);

      const result = await repository.updateLastRun(
        TENANT_ID,
        "job-1",
        "0 */6 * * *",
      );

      expect(result?.last_run).not.toBeNull();
      expect(result?.next_run).not.toBeNull();
    });

    it("should return null when job not found", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.updateLastRun(
        TENANT_ID,
        "non-existent",
        "0 */6 * * *",
      );

      expect(result).toBeNull();
    });
  });
});
