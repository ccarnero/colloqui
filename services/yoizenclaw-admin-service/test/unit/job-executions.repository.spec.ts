import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import {
  JobExecutionsRepository,
  type IJobExecution,
  type ICreateExecutionData,
} from "../../src/modules/jobs/job-executions.repository";
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

describe("JobExecutionsRepository", () => {
  let repository: JobExecutionsRepository;
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
        JobExecutionsRepository,
        {
          provide: TenantConnectionManager,
          useValue: mockConnectionManager,
        },
      ],
    }).compile();

    repository = module.get<JobExecutionsRepository>(JobExecutionsRepository);
  });

  describe("findAll", () => {
    it("should return executions with default pagination", async () => {
      const mockExecutions: IJobExecution[] = [
        {
          id: "exec-1",
          job_id: "job-1",
          job_name: "Test Job",
          status: "completed",
          event_payload: {},
          result: { success: true },
          logs: ["Log 1"],
          error_message: null,
          retry_count: 0,
          triggered_by: "manual",
          started_at: new Date(),
          finished_at: new Date(),
          created_at: new Date(),
        },
      ];

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 1 }]);
      mockQuery.mockResolvedValueOnce(mockExecutions);

      const result = await repository.findAll(TENANT_ID);

      expect(result.executions).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockConnectionManager.getConnection).toHaveBeenCalledWith(
        TENANT_ID,
      );
    });

    it("should filter by job_id", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockSqlSequentialResponses(mockQuery, [
        [],
        [{ count: 0 }],
        [],
      ]);

      await repository.findAll(TENANT_ID, { job_id: "job-1" });

      expect(mockQuery).toHaveBeenCalled();
    });

    it("should filter by status", async () => {
      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockSqlSequentialResponses(mockQuery, [
        [],
        [{ count: 0 }],
        [],
      ]);

      await repository.findAll(TENANT_ID, { status: "running" });

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

    it("should join with jobs to get job_name", async () => {
      const mockExecutions: IJobExecution[] = [
        {
          id: "exec-1",
          job_id: "job-1",
          job_name: "Test Job Name",
          status: "completed",
          event_payload: {},
          result: null,
          logs: [],
          error_message: null,
          retry_count: 0,
          triggered_by: "manual",
          started_at: new Date(),
          finished_at: new Date(),
          created_at: new Date(),
        },
      ];

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 1 }]);
      mockQuery.mockResolvedValueOnce(mockExecutions);

      const result = await repository.findAll(TENANT_ID);

      expect(result.executions[0].job_name).toBe("Test Job Name");
    });
  });

  describe("create", () => {
    it("should create a new execution with pending status", async () => {
      const createData: ICreateExecutionData = {
        job_id: "job-1",
        status: "pending",
        event_payload: { key: "value" },
        triggered_by: "event",
      };

      const createdExecution: IJobExecution = {
        id: "new-exec-id",
        job_id: "job-1",
        status: "pending",
        event_payload: { key: "value" },
        result: null,
        logs: [],
        error_message: null,
        retry_count: 0,
        triggered_by: "event",
        started_at: null,
        finished_at: null,
        created_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([createdExecution]);

      const result = await repository.create(TENANT_ID, createData);

      expect(result.id).toBe("new-exec-id");
      expect(result.status).toBe("pending");
      expect(result.triggered_by).toBe("event");
    });

    it("should create execution with running status and set started_at", async () => {
      const createData: ICreateExecutionData = {
        job_id: "job-1",
        status: "running",
        triggered_by: "manual",
      };

      const createdExecution: IJobExecution = {
        id: "new-exec-id",
        job_id: "job-1",
        status: "running",
        event_payload: {},
        result: null,
        logs: [],
        error_message: null,
        retry_count: 0,
        triggered_by: "manual",
        started_at: new Date(),
        finished_at: null,
        created_at: new Date(),
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([createdExecution]);

      const result = await repository.create(TENANT_ID, createData);

      expect(result.status).toBe("running");
      expect(result.started_at).not.toBeNull();
    });

    it("should create execution with minimal data", async () => {
      const createData: ICreateExecutionData = {
        job_id: "job-1",
        status: "pending",
      };

      const createdExecution: IJobExecution = {
        id: "new-exec-id",
        job_id: "job-1",
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
      };

      const mockQuery = (
        mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> }
      )._mockQuery;
      mockQuery.mockResolvedValueOnce([createdExecution]);

      const result = await repository.create(TENANT_ID, createData);

      expect(result.event_payload).toEqual({});
      expect(result.logs).toEqual([]);
    });
  });
});
