import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import { mockFn } from "../mock-utils";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { JobsService } from "../../src/modules/jobs/jobs.service";
import {
  JobsRepository,
  type IJob,
  type ICreateJobData,
} from "../../src/modules/jobs/jobs.repository";
import {
  JobExecutionsRepository,
  type IJobExecution,
  type ICreateExecutionData,
} from "../../src/modules/jobs/job-executions.repository";
import { NatsPublisher } from "../../src/providers/nats.provider";

describe("JobsService", () => {
  let service: JobsService;
  let mockJobsRepository: JobsRepository;
  let mockExecutionsRepository: JobExecutionsRepository;
  let mockNatsPublisher: NatsPublisher;
  const TENANT_ID = "tenant-123";

  beforeEach(async () => {
    mockJobsRepository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      updateLastRun: vi.fn(),
    } as unknown as JobsRepository;

    mockExecutionsRepository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
    } as unknown as JobExecutionsRepository;

    mockNatsPublisher = {
      publishJobTrigger: vi.fn(),
    } as unknown as NatsPublisher;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        {
          provide: JobsRepository,
          useValue: mockJobsRepository,
        },
        {
          provide: JobExecutionsRepository,
          useValue: mockExecutionsRepository,
        },
        {
          provide: NatsPublisher,
          useValue: mockNatsPublisher,
        },
      ],
    }).compile();

    service = module.get<JobsService>(JobsService);
  });

  describe("findAll", () => {
    it("should return jobs with pagination", async () => {
      const mockJobs = [
        {
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
        },
      ] as IJob[];

      mockFn(mockJobsRepository.findAll).mockResolvedValue({
        jobs: mockJobs,
        total: 1,
      });

      const result = await service.findAll(TENANT_ID, { limit: 10, offset: 0 });

      expect(result.jobs).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockJobsRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        limit: 10,
        offset: 0,
      });
    });

    it("should pass filter options to repository", async () => {
      mockFn(mockJobsRepository.findAll).mockResolvedValue({
        jobs: [],
        total: 0,
      });

      await service.findAll(TENANT_ID, {
        agent_id: "agent-1",
        is_active: true,
      });

      expect(mockJobsRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        agent_id: "agent-1",
        is_active: true,
      });
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

      mockFn(mockJobsRepository.findById).mockResolvedValue(mockJob);

      const result = await service.findById(TENANT_ID, "job-1");

      expect(result).toEqual(mockJob);
    });

    it("should throw NotFoundException when job not found", async () => {
      mockFn(mockJobsRepository.findById).mockResolvedValue(null);

      expect(service.findById(TENANT_ID, "non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("should create a new job", async () => {
      const createData: ICreateJobData = {
        name: "New Job",
        agent_id: "agent-1",
        schedule: "0 */6 * * *",
        payload: { key: "value" },
      };

      const createdJob: IJob = {
        id: "new-id",
        ...createData,
        is_active: true,
        last_run: null,
        next_run: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockFn(mockJobsRepository.create).mockResolvedValue(createdJob);

      const result = await service.create(TENANT_ID, createData);

      expect(result.name).toBe(createData.name);
      expect(result.agent_id).toBe(createData.agent_id);
      expect(mockJobsRepository.create).toHaveBeenCalledWith(
        TENANT_ID,
        createData,
      );
    });
  });

  describe("update", () => {
    it("should update job", async () => {
      const updateData = { name: "Updated Name" };
      const updatedJob: IJob = {
        id: "job-1",
        name: "Updated Name",
        agent_id: "agent-1",
        schedule: "0 */6 * * *",
        payload: {},
        is_active: true,
        last_run: null,
        next_run: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockFn(mockJobsRepository.update).mockResolvedValue(updatedJob);

      const result = await service.update(TENANT_ID, "job-1", updateData);

      expect(result.name).toBe("Updated Name");
      expect(mockJobsRepository.update).toHaveBeenCalledWith(
        TENANT_ID,
        "job-1",
        updateData,
      );
    });

    it("should throw NotFoundException when job not found", async () => {
      mockFn(mockJobsRepository.update).mockResolvedValue(null);

      expect(
        service.update(TENANT_ID, "non-existent", { name: "New Name" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("delete", () => {
    it("should delete job", async () => {
      mockFn(mockJobsRepository.delete).mockResolvedValue(true);

      await service.delete(TENANT_ID, "job-1");

      expect(mockJobsRepository.delete).toHaveBeenCalledWith(
        TENANT_ID,
        "job-1",
      );
    });

    it("should throw NotFoundException when job not found", async () => {
      mockFn(mockJobsRepository.delete).mockResolvedValue(false);

      expect(service.delete(TENANT_ID, "non-existent")).rejects.toThrow(
        NotFoundException,
      );
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

      mockFn(mockJobsRepository.enable).mockResolvedValue(enabledJob);

      const result = await service.enable(TENANT_ID, "job-1");

      expect(result.is_active).toBe(true);
      expect(mockJobsRepository.enable).toHaveBeenCalledWith(
        TENANT_ID,
        "job-1",
      );
    });

    it("should throw NotFoundException when job not found", async () => {
      mockFn(mockJobsRepository.enable).mockResolvedValue(null);

      expect(service.enable(TENANT_ID, "non-existent")).rejects.toThrow(
        NotFoundException,
      );
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

      mockFn(mockJobsRepository.disable).mockResolvedValue(disabledJob);

      const result = await service.disable(TENANT_ID, "job-1");

      expect(result.is_active).toBe(false);
      expect(mockJobsRepository.disable).toHaveBeenCalledWith(
        TENANT_ID,
        "job-1",
      );
    });

    it("should throw NotFoundException when job not found", async () => {
      mockFn(mockJobsRepository.disable).mockResolvedValue(null);

      expect(service.disable(TENANT_ID, "non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("run", () => {
    it("should run job manually and create execution", async () => {
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

      const mockExecution: IJobExecution = {
        id: "exec-1",
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

      mockFn(mockJobsRepository.findById).mockResolvedValue(mockJob);
      mockFn(mockExecutionsRepository.create).mockResolvedValue(
        mockExecution,
      );
      mockFn(mockJobsRepository.updateLastRun).mockResolvedValue({
        ...mockJob,
        last_run: new Date(),
      });

      const result = await service.run(TENANT_ID, "job-1");

      expect(result.status).toBe("running");
      expect(result.triggered_by).toBe("manual");
      expect(mockExecutionsRepository.create).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          job_id: "job-1",
          status: "running",
          triggered_by: "manual",
        }),
      );
    });

    it("should throw NotFoundException when job not found", async () => {
      mockFn(mockJobsRepository.findById).mockResolvedValue(null);

      expect(service.run(TENANT_ID, "non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequestException when job is not active", async () => {
      const inactiveJob: IJob = {
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

      mockFn(mockJobsRepository.findById).mockResolvedValue(inactiveJob);

      expect(service.run(TENANT_ID, "job-1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("trigger", () => {
    it("should trigger job with payload and emit event", async () => {
      const mockJob: IJob = {
        id: "job-1",
        name: "Test Job",
        agent_id: "agent-1",
        schedule: "0 */6 * * *",
        payload: { defaultKey: "defaultValue" },
        is_active: true,
        last_run: null,
        next_run: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockExecution: IJobExecution = {
        id: "exec-1",
        job_id: "job-1",
        status: "pending",
        event_payload: { customKey: "customValue" },
        result: null,
        logs: [],
        error_message: null,
        retry_count: 0,
        triggered_by: "event",
        started_at: null,
        finished_at: null,
        created_at: new Date(),
      };

      mockFn(mockJobsRepository.findById).mockResolvedValue(mockJob);
      mockFn(mockExecutionsRepository.create).mockResolvedValue(
        mockExecution,
      );
      mockFn(mockNatsPublisher.publishJobTrigger).mockResolvedValue(null);

      const eventPayload = { customKey: "customValue" };
      const result = await service.trigger(TENANT_ID, "job-1", eventPayload);

      expect(result.status).toBe("pending");
      expect(result.triggered_by).toBe("event");
      expect(mockNatsPublisher.publishJobTrigger).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        jobId: "job-1",
        executionId: "exec-1",
        eventPayload: {
          defaultKey: "defaultValue",
          customKey: "customValue",
        },
      });
    });

    it("should throw NotFoundException when job not found", async () => {
      mockFn(mockJobsRepository.findById).mockResolvedValue(null);

      expect(service.trigger(TENANT_ID, "non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequestException when job is not active", async () => {
      const inactiveJob: IJob = {
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

      mockFn(mockJobsRepository.findById).mockResolvedValue(inactiveJob);

      expect(service.trigger(TENANT_ID, "job-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should not fail if event emission fails", async () => {
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

      const mockExecution: IJobExecution = {
        id: "exec-1",
        job_id: "job-1",
        status: "pending",
        event_payload: {},
        result: null,
        logs: [],
        error_message: null,
        retry_count: 0,
        triggered_by: "event",
        started_at: null,
        finished_at: null,
        created_at: new Date(),
      };

      mockFn(mockJobsRepository.findById).mockResolvedValue(mockJob);
      mockFn(mockExecutionsRepository.create).mockResolvedValue(
        mockExecution,
      );
      mockFn(mockNatsPublisher.publishJobTrigger).mockRejectedValue(
        new Error("NATS error"),
      );

      // Should not throw even if NATS fails
      const result = await service.trigger(TENANT_ID, "job-1");

      expect(result.status).toBe("pending");
    });
  });

  describe("findAllExecutions", () => {
    it("should return executions with pagination", async () => {
      const mockExecutions = [
        {
          id: "exec-1",
          job_id: "job-1",
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
      ] as IJobExecution[];

      mockFn(mockExecutionsRepository.findAll).mockResolvedValue({
        executions: mockExecutions,
        total: 1,
      });

      const result = await service.findAllExecutions(TENANT_ID, {
        limit: 10,
        offset: 0,
      });

      expect(result.executions).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockExecutionsRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        limit: 10,
        offset: 0,
      });
    });

    it("should filter by job_id and status", async () => {
      mockFn(mockExecutionsRepository.findAll).mockResolvedValue({
        executions: [],
        total: 0,
      });

      await service.findAllExecutions(TENANT_ID, {
        job_id: "job-1",
        status: "running",
      });

      expect(mockExecutionsRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        job_id: "job-1",
        status: "running",
      });
    });
  });
});
