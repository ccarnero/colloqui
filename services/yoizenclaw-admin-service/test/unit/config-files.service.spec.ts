import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigFilesService } from '../../src/modules/config-files/config-files.service';
import { ConfigFilesRepository, type ConfigFile, type CreateConfigFileData } from '../../src/modules/config-files/config-files.repository';
import { NatsPublisher } from '../../src/providers/nats.provider';

describe('ConfigFilesService', () => {
  let service: ConfigFilesService;
  let mockRepository: ConfigFilesRepository;
  let mockNatsPublisher: NatsPublisher;
  const TENANT_ID = 'tenant-123';

  beforeEach(async () => {
    mockRepository = {
      findAll: vi.fn(),
      findByPath: vi.fn(),
      findAllActive: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as ConfigFilesRepository;

    mockNatsPublisher = {
      publishRuntimeConfigSync: vi.fn(),
    } as unknown as NatsPublisher;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigFilesService,
        {
          provide: ConfigFilesRepository,
          useValue: mockRepository,
        },
        {
          provide: NatsPublisher,
          useValue: mockNatsPublisher,
        },
      ],
    }).compile();

    service = module.get<ConfigFilesService>(ConfigFilesService);
  });

  describe('findAll', () => {
    it('should return files with pagination', async () => {
      const mockFiles = [
        {
          id: 'file-1',
          name: 'Test Config',
          path: '/config/app.yaml',
          content: 'key: value',
          format: 'yaml',
          version: 1,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ] as ConfigFile[];

      (mockRepository.findAll as ReturnType<typeof vi.fn>).mockResolvedValue({
        files: mockFiles,
        total: 1,
      });

      const result = await service.findAll(TENANT_ID, { limit: 10, offset: 0 });

      expect(result.files).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        limit: 10,
        offset: 0,
      });
    });
  });

  describe('findByPath', () => {
    it('should return file by path', async () => {
      const mockFile: ConfigFile = {
        id: 'file-1',
        name: 'Test Config',
        path: '/config/app.yaml',
        content: 'key: value',
        format: 'yaml',
        version: 1,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockRepository.findByPath as ReturnType<typeof vi.fn>).mockResolvedValue(mockFile);

      const result = await service.findByPath(TENANT_ID, '/config/app.yaml');

      expect(result).toEqual(mockFile);
    });

    it('should throw NotFoundException when file not found', async () => {
      (mockRepository.findByPath as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      expect(service.findByPath(TENANT_ID, '/config/nonexistent.yaml')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createOrUpdate', () => {
    it('should create new file when path does not exist', async () => {
      const createData: CreateConfigFileData = {
        name: 'New Config',
        path: '/config/new.yaml',
        content: 'key: value',
        format: 'yaml',
      };

      const createdFile: ConfigFile = {
        id: 'new-id',
        ...createData,
        version: 1,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockRepository.findByPath as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue(createdFile);

      const result = await service.createOrUpdate(TENANT_ID, createData);

      expect(result.path).toBe(createData.path);
      expect(result.version).toBe(1);
      expect(mockRepository.create).toHaveBeenCalledWith(TENANT_ID, createData);
    });

    it('should update existing file when path exists', async () => {
      const existingFile: ConfigFile = {
        id: 'existing-id',
        name: 'Old Config',
        path: '/config/existing.yaml',
        content: 'old: value',
        format: 'yaml',
        version: 1,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const updateData: CreateConfigFileData = {
        name: 'Updated Config',
        path: '/config/existing.yaml',
        content: 'new: value',
        format: 'yaml',
      };

      const updatedFile: ConfigFile = {
        ...existingFile,
        name: updateData.name,
        content: updateData.content,
        version: 2,
      };

      (mockRepository.findByPath as ReturnType<typeof vi.fn>).mockResolvedValue(existingFile);
      (mockRepository.update as ReturnType<typeof vi.fn>).mockResolvedValue(updatedFile);

      const result = await service.createOrUpdate(TENANT_ID, updateData);

      expect(result.path).toBe(updateData.path);
      expect(result.version).toBe(2);
      expect(mockRepository.update).toHaveBeenCalledWith(TENANT_ID, updateData.path, {
        name: updateData.name,
        content: updateData.content,
      });
    });
  });

  describe('update', () => {
    it('should update file and increment version', async () => {
      const updateData = { name: 'Updated Name' };
      const updatedFile: ConfigFile = {
        id: 'file-1',
        name: 'Updated Name',
        path: '/config/app.yaml',
        content: 'key: value',
        format: 'yaml',
        version: 2,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockRepository.update as ReturnType<typeof vi.fn>).mockResolvedValue(updatedFile);

      const result = await service.update(TENANT_ID, '/config/app.yaml', updateData);

      expect(result.name).toBe('Updated Name');
      expect(result.version).toBe(2);
      expect(mockRepository.update).toHaveBeenCalledWith(
        TENANT_ID,
        '/config/app.yaml',
        updateData,
      );
    });

    it('should throw NotFoundException when file not found', async () => {
      (mockRepository.update as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      expect(
        service.update(TENANT_ID, '/config/nonexistent.yaml', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('should delete file', async () => {
      (mockRepository.delete as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      await service.delete(TENANT_ID, '/config/app.yaml');

      expect(mockRepository.delete).toHaveBeenCalledWith(TENANT_ID, '/config/app.yaml');
    });

    it('should throw NotFoundException when file not found', async () => {
      (mockRepository.delete as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      expect(service.delete(TENANT_ID, '/config/nonexistent.yaml')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deploy', () => {
    it('should emit event with all active files', async () => {
      const mockFiles: ConfigFile[] = [
        {
          id: 'file-1',
          name: 'App Config',
          path: '/config/app.yaml',
          content: 'key: value',
          format: 'yaml',
          version: 1,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'file-2',
          name: 'Routes Config',
          path: '/config/routes.json',
          content: '{"routes": []}',
          format: 'json',
          version: 3,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      (mockRepository.findAllActive as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles);
      (mockNatsPublisher.publishRuntimeConfigSync as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await service.deploy(TENANT_ID);

      expect(result.files).toHaveLength(2);
      expect(result.eventEmitted).toBe(true);
      expect(mockNatsPublisher.publishRuntimeConfigSync).toHaveBeenCalledWith(
        TENANT_ID,
        [
          { path: '/config/app.yaml', content: 'key: value', format: 'yaml' },
          { path: '/config/routes.json', content: '{"routes": []}', format: 'json' },
        ],
        [],
      );
    });

    it('should include deletePaths in event', async () => {
      const mockFiles: ConfigFile[] = [];
      const deletePaths = ['/config/old.yaml', '/config/deprecated.json'];

      (mockRepository.findAllActive as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles);
      (mockNatsPublisher.publishRuntimeConfigSync as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await service.deploy(TENANT_ID, deletePaths);

      expect(result.eventEmitted).toBe(true);
      expect(mockNatsPublisher.publishRuntimeConfigSync).toHaveBeenCalledWith(
        TENANT_ID,
        [],
        deletePaths,
      );
    });

    it('should not fail if event emission fails', async () => {
      const mockFiles: ConfigFile[] = [
        {
          id: 'file-1',
          name: 'App Config',
          path: '/config/app.yaml',
          content: 'key: value',
          format: 'yaml',
          version: 1,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      (mockRepository.findAllActive as ReturnType<typeof vi.fn>).mockResolvedValue(mockFiles);
      (mockNatsPublisher.publishRuntimeConfigSync as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('NATS error'),
      );

      const result = await service.deploy(TENANT_ID);

      expect(result.files).toHaveLength(1);
      expect(result.eventEmitted).toBe(false);
    });
  });
});
