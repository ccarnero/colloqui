import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentsRepository, type Agent, type CreateAgentData } from './agents.repository';
import { NatsPublisher } from '../../providers/nats.provider';

describe('AgentsService', () => {
  let service: AgentsService;
  let mockRepository: AgentsRepository;
  let mockNatsPublisher: NatsPublisher;
  const TENANT_ID = 'tenant-123';

  beforeEach(async () => {
    mockRepository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      publish: vi.fn(),
      unpublish: vi.fn(),
    } as unknown as AgentsRepository;

    mockNatsPublisher = {
      publishAgentPublished: vi.fn(),
      publishAgentUnpublished: vi.fn(),
    } as unknown as NatsPublisher;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        {
          provide: AgentsRepository,
          useValue: mockRepository,
        },
        {
          provide: NatsPublisher,
          useValue: mockNatsPublisher,
        },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
  });

  describe('findAll', () => {
    it('should return agents with pagination', async () => {
      const mockAgents = [
        {
          id: 'agent-1',
          name: 'Test Agent',
          description: null,
          system_prompt: 'Prompt',
          model_config: {},
          tools: [],
          channels: [],
          status: 'draft',
          is_active: true,
          published_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ] as Agent[];

      vi.mocked(mockRepository.findAll).mockResolvedValue({
        agents: mockAgents,
        total: 1,
      });

      const result = await service.findAll(TENANT_ID, { limit: 10, offset: 0 });

      expect(result.agents).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        limit: 10,
        offset: 0,
      });
    });

    it('should pass filter options to repository', async () => {
      vi.mocked(mockRepository.findAll).mockResolvedValue({
        agents: [],
        total: 0,
      });

      await service.findAll(TENANT_ID, { status: 'published', is_active: true });

      expect(mockRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        status: 'published',
        is_active: true,
      });
    });
  });

  describe('findById', () => {
    it('should return agent by id', async () => {
      const mockAgent: Agent = {
        id: 'agent-1',
        name: 'Test Agent',
        description: null,
        system_prompt: 'Prompt',
        model_config: {},
        tools: [],
        channels: [],
        status: 'draft',
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.findById).mockResolvedValue(mockAgent);

      const result = await service.findById(TENANT_ID, 'agent-1');

      expect(result).toEqual(mockAgent);
    });

    it('should throw NotFoundException when agent not found', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(null);

      expect(service.findById(TENANT_ID, 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create a new agent', async () => {
      const createData: CreateAgentData = {
        name: 'New Agent',
        system_prompt: 'You are helpful',
        model_config: { model: 'gpt-4' },
      };

      const createdAgent: Agent = {
        id: 'new-id',
        ...createData,
        description: null,
        tools: [],
        channels: [],
        status: 'draft',
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.create).mockResolvedValue(createdAgent);

      const result = await service.create(TENANT_ID, createData);

      expect(result.name).toBe(createData.name);
      expect(result.system_prompt).toBe(createData.system_prompt);
      expect(mockRepository.create).toHaveBeenCalledWith(TENANT_ID, createData);
    });
  });

  describe('update', () => {
    it('should update agent', async () => {
      const updateData = { name: 'Updated Name' };
      const updatedAgent: Agent = {
        id: 'agent-1',
        name: 'Updated Name',
        description: null,
        system_prompt: 'Prompt',
        model_config: {},
        tools: [],
        channels: [],
        status: 'draft',
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.update).mockResolvedValue(updatedAgent);

      const result = await service.update(TENANT_ID, 'agent-1', updateData);

      expect(result.name).toBe('Updated Name');
      expect(mockRepository.update).toHaveBeenCalledWith(
        TENANT_ID,
        'agent-1',
        updateData,
      );
    });

    it('should throw NotFoundException when agent not found', async () => {
      vi.mocked(mockRepository.update).mockResolvedValue(null);

      expect(
        service.update(TENANT_ID, 'non-existent', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('should delete agent', async () => {
      vi.mocked(mockRepository.delete).mockResolvedValue(true);

      await service.delete(TENANT_ID, 'agent-1');

      expect(mockRepository.delete).toHaveBeenCalledWith(TENANT_ID, 'agent-1');
    });

    it('should throw NotFoundException when agent not found', async () => {
      vi.mocked(mockRepository.delete).mockResolvedValue(false);

      expect(service.delete(TENANT_ID, 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('publish', () => {
    it('should publish agent and emit event', async () => {
      const publishedAgent: Agent = {
        id: 'agent-1',
        name: 'Test Agent',
        description: null,
        system_prompt: 'Prompt',
        model_config: {},
        tools: [],
        channels: [],
        status: 'published',
        is_active: true,
        published_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.publish).mockResolvedValue(publishedAgent);
      vi.mocked(mockNatsPublisher.publishAgentPublished).mockResolvedValue(null);

      const result = await service.publish(TENANT_ID, 'agent-1');

      expect(result.status).toBe('published');
      expect(mockRepository.publish).toHaveBeenCalledWith(TENANT_ID, 'agent-1');
      expect(mockNatsPublisher.publishAgentPublished).toHaveBeenCalledWith(
        TENANT_ID,
        publishedAgent.id,
        publishedAgent.name,
      );
    });

    it('should throw NotFoundException when agent not found', async () => {
      vi.mocked(mockRepository.publish).mockResolvedValue(null);

      expect(service.publish(TENANT_ID, 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should not fail if event emission fails', async () => {
      const publishedAgent: Agent = {
        id: 'agent-1',
        name: 'Test Agent',
        description: null,
        system_prompt: 'Prompt',
        model_config: {},
        tools: [],
        channels: [],
        status: 'published',
        is_active: true,
        published_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.publish).mockResolvedValue(publishedAgent);
      vi.mocked(mockNatsPublisher.publishAgentPublished).mockRejectedValue(
        new Error('NATS error'),
      );

      // Should not throw even if NATS fails
      const result = await service.publish(TENANT_ID, 'agent-1');

      expect(result.status).toBe('published');
    });
  });

  describe('unpublish', () => {
    it('should unpublish agent and emit event', async () => {
      const unpublishedAgent: Agent = {
        id: 'agent-1',
        name: 'Test Agent',
        description: null,
        system_prompt: 'Prompt',
        model_config: {},
        tools: [],
        channels: [],
        status: 'draft',
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.unpublish).mockResolvedValue(unpublishedAgent);
      vi.mocked(mockNatsPublisher.publishAgentUnpublished).mockResolvedValue(null);

      const result = await service.unpublish(TENANT_ID, 'agent-1');

      expect(result.status).toBe('draft');
      expect(mockRepository.unpublish).toHaveBeenCalledWith(TENANT_ID, 'agent-1');
      expect(mockNatsPublisher.publishAgentUnpublished).toHaveBeenCalledWith(
        TENANT_ID,
        unpublishedAgent.id,
        unpublishedAgent.name,
      );
    });

    it('should throw NotFoundException when agent not found', async () => {
      vi.mocked(mockRepository.unpublish).mockResolvedValue(null);

      expect(service.unpublish(TENANT_ID, 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should not fail if event emission fails', async () => {
      const unpublishedAgent: Agent = {
        id: 'agent-1',
        name: 'Test Agent',
        description: null,
        system_prompt: 'Prompt',
        model_config: {},
        tools: [],
        channels: [],
        status: 'draft',
        is_active: true,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.unpublish).mockResolvedValue(unpublishedAgent);
      vi.mocked(mockNatsPublisher.publishAgentUnpublished).mockRejectedValue(
        new Error('NATS error'),
      );

      // Should not throw even if NATS fails
      const result = await service.unpublish(TENANT_ID, 'agent-1');

      expect(result.status).toBe('draft');
    });
  });
});
