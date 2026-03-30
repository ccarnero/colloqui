import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { JobExecutionsRepository, type JobExecution, type CreateExecutionData } from './job-executions.repository';
import { TenantConnectionManager, type Sql } from '../../providers/tenant-connection-manager';

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
    }
  ) as unknown as Sql;

  (sql as unknown as { _mockQuery: typeof mockQuery })._mockQuery = mockQuery;
  
  return sql;
};

describe('JobExecutionsRepository', () => {
  let repository: JobExecutionsRepository;
  let mockConnectionManager: TenantConnectionManager;
  let mockSql: Sql;
  const TENANT_ID = 'tenant-123';

  beforeEach(async () => {
    mockSql = createMockSql();
    
    mockConnectionManager = {
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

  describe('findAll', () => {
    it('should return executions with default pagination', async () => {
      const mockExecutions: JobExecution[] = [
        {
          id: 'exec-1',
          job_id: 'job-1',
          job_name: 'Test Job',
          status: 'completed',
          event_payload: {},
          result: { success: true },
          logs: ['Log 1'],
          error_message: null,
          retry_count: 0,
          triggered_by: 'manual',
          started_at: new Date(),
          finished_at: new Date(),
          created_at: new Date(),
        },
      ];

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 1 }]);
      mockQuery.mockResolvedValueOnce(mockExecutions);

      const result = await repository.findAll(TENANT_ID);

      expect(result.executions).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockConnectionManager.getConnection).toHaveBeenCalledWith(TENANT_ID);
    });

    it('should filter by job_id', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 0 }]);
      mockQuery.mockResolvedValueOnce([]);

      await repository.findAll(TENANT_ID, { job_id: 'job-1' });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should filter by status', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 0 }]);
      mockQuery.mockResolvedValueOnce([]);

      await repository.findAll(TENANT_ID, { status: 'running' });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should use custom limit and offset', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 100 }]);
      mockQuery.mockResolvedValueOnce([]);

      await repository.findAll(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should join with jobs to get job_name', async () => {
      const mockExecutions: JobExecution[] = [
        {
          id: 'exec-1',
          job_id: 'job-1',
          job_name: 'Test Job Name',
          status: 'completed',
          event_payload: {},
          result: null,
          logs: [],
          error_message: null,
          retry_count: 0,
          triggered_by: 'manual',
          started_at: new Date(),
          finished_at: new Date(),
          created_at: new Date(),
        },
      ];

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 1 }]);
      mockQuery.mockResolvedValueOnce(mockExecutions);

      const result = await repository.findAll(TENANT_ID);

      expect(result.executions[0].job_name).toBe('Test Job Name');
    });
  });

  describe('findById', () => {
    it('should return execution by id', async () => {
      const mockExecution: JobExecution = {
        id: 'exec-1',
        job_id: 'job-1',
        job_name: 'Test Job',
        status: 'completed',
        event_payload: {},
        result: { success: true },
        logs: [],
        error_message: null,
        retry_count: 0,
        triggered_by: 'manual',
        started_at: new Date(),
        finished_at: new Date(),
        created_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([mockExecution]);

      const result = await repository.findById(TENANT_ID, 'exec-1');

      expect(result).toEqual(mockExecution);
    });

    it('should return null when execution not found', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.findById(TENANT_ID, 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new execution with pending status', async () => {
      const createData: CreateExecutionData = {
        job_id: 'job-1',
        status: 'pending',
        event_payload: { key: 'value' },
        triggered_by: 'event',
      };

      const createdExecution: JobExecution = {
        id: 'new-exec-id',
        job_id: 'job-1',
        status: 'pending',
        event_payload: { key: 'value' },
        result: null,
        logs: [],
        error_message: null,
        retry_count: 0,
        triggered_by: 'event',
        started_at: null,
        finished_at: null,
        created_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([createdExecution]);

      const result = await repository.create(TENANT_ID, createData);

      expect(result.id).toBe('new-exec-id');
      expect(result.status).toBe('pending');
      expect(result.triggered_by).toBe('event');
    });

    it('should create execution with running status and set started_at', async () => {
      const createData: CreateExecutionData = {
        job_id: 'job-1',
        status: 'running',
        triggered_by: 'manual',
      };

      const createdExecution: JobExecution = {
        id: 'new-exec-id',
        job_id: 'job-1',
        status: 'running',
        event_payload: {},
        result: null,
        logs: [],
        error_message: null,
        retry_count: 0,
        triggered_by: 'manual',
        started_at: new Date(),
        finished_at: null,
        created_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([createdExecution]);

      const result = await repository.create(TENANT_ID, createData);

      expect(result.status).toBe('running');
      expect(result.started_at).not.toBeNull();
    });

    it('should create execution with minimal data', async () => {
      const createData: CreateExecutionData = {
        job_id: 'job-1',
        status: 'pending',
      };

      const createdExecution: JobExecution = {
        id: 'new-exec-id',
        job_id: 'job-1',
        status: 'pending',
        event_payload: {},
        result: null,
        logs: [],
        error_message: null,
        retry_count: 0,
        triggered_by: 'manual',
        started_at: null,
        finished_at: null,
        created_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([createdExecution]);

      const result = await repository.create(TENANT_ID, createData);

      expect(result.event_payload).toEqual({});
      expect(result.logs).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update execution status to completed', async () => {
      const updatedExecution: JobExecution = {
        id: 'exec-1',
        job_id: 'job-1',
        status: 'completed',
        event_payload: {},
        result: { success: true },
        logs: ['Execution completed'],
        error_message: null,
        retry_count: 0,
        triggered_by: 'manual',
        started_at: new Date(),
        finished_at: new Date(),
        created_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([updatedExecution]);

      const result = await repository.update(TENANT_ID, 'exec-1', {
        status: 'completed',
        result: { success: true },
        logs: ['Execution completed'],
      });

      expect(result?.status).toBe('completed');
      expect(result?.finished_at).not.toBeNull();
    });

    it('should update execution status to failed with error message', async () => {
      const updatedExecution: JobExecution = {
        id: 'exec-1',
        job_id: 'job-1',
        status: 'failed',
        event_payload: {},
        result: null,
        logs: ['Error occurred'],
        error_message: 'Connection timeout',
        retry_count: 1,
        triggered_by: 'manual',
        started_at: new Date(),
        finished_at: new Date(),
        created_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([updatedExecution]);

      const result = await repository.update(TENANT_ID, 'exec-1', {
        status: 'failed',
        error_message: 'Connection timeout',
        retry_count: 1,
      });

      expect(result?.status).toBe('failed');
      expect(result?.error_message).toBe('Connection timeout');
    });

    it('should return null when execution not found', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.update(TENANT_ID, 'non-existent', {
        status: 'completed',
      });

      expect(result).toBeNull();
    });

    it('should return execution unchanged when no updates provided', async () => {
      const mockExecution: JobExecution = {
        id: 'exec-1',
        job_id: 'job-1',
        status: 'pending',
        event_payload: {},
        result: null,
        logs: [],
        error_message: null,
        retry_count: 0,
        triggered_by: 'manual',
        started_at: null,
        finished_at: null,
        created_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([mockExecution]);

      const result = await repository.update(TENANT_ID, 'exec-1', {});

      expect(result?.status).toBe('pending');
    });
  });

  describe('delete', () => {
    it('should delete execution', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([{ id: 'exec-1' }]);

      const result = await repository.delete(TENANT_ID, 'exec-1');

      expect(result).toBe(true);
    });

    it('should return false when execution not found', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.delete(TENANT_ID, 'non-existent');

      expect(result).toBe(false);
    });
  });

  describe('findByJobId', () => {
    it('should return executions for specific job', async () => {
      const mockExecutions: JobExecution[] = [
        {
          id: 'exec-1',
          job_id: 'job-1',
          job_name: 'Test Job',
          status: 'completed',
          event_payload: {},
          result: null,
          logs: [],
          error_message: null,
          retry_count: 0,
          triggered_by: 'manual',
          started_at: new Date(),
          finished_at: new Date(),
          created_at: new Date(),
        },
      ];

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 1 }]);
      mockQuery.mockResolvedValueOnce(mockExecutions);

      const result = await repository.findByJobId(TENANT_ID, 'job-1', 10, 0);

      expect(result.executions).toHaveLength(1);
      expect(result.executions[0].job_id).toBe('job-1');
    });
  });
});
