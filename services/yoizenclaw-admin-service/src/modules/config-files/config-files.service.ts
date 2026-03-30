import { Injectable, NotFoundException, Logger, ConflictException } from '@nestjs/common';
import { ConfigFilesRepository, type ConfigFile, type CreateConfigFileData, type UpdateConfigFileData } from './config-files.repository';
import { NatsPublisher } from '../../providers/nats.provider';

export interface FindAllOptions {
  limit?: number;
  offset?: number;
}

@Injectable()
export class ConfigFilesService {
  private readonly logger = new Logger(ConfigFilesService.name);

  constructor(
    private readonly repository: ConfigFilesRepository,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  /**
   * Lista todos los config files con paginación.
   */
  async findAll(
    tenantId: string,
    options: FindAllOptions = {},
  ): Promise<{ files: ConfigFile[]; total: number }> {
    return this.repository.findAll(tenantId, options);
  }

  /**
   * Obtiene un config file por su path.
   */
  async findByPath(tenantId: string, path: string): Promise<ConfigFile> {
    const file = await this.repository.findByPath(tenantId, path);
    if (!file) {
      throw new NotFoundException(`Config file with path '${path}' not found`);
    }
    return file;
  }

  /**
   * Crea un nuevo config file.
   * Si ya existe un archivo con el mismo path, actualiza el existente.
   */
  async createOrUpdate(tenantId: string, data: CreateConfigFileData): Promise<ConfigFile> {
    // Check if file already exists
    const existingFile = await this.repository.findByPath(tenantId, data.path);
    
    if (existingFile) {
      // Update existing file
      this.logger.log(`Updating existing config file: ${data.path}`);
      const updated = await this.repository.update(tenantId, data.path, {
        name: data.name,
        content: data.content,
      });
      if (!updated) {
        throw new NotFoundException(`Config file with path '${data.path}' not found during update`);
      }
      return updated;
    }

    // Create new file
    this.logger.log(`Creating new config file: ${data.path}`);
    return this.repository.create(tenantId, data);
  }

  /**
   * Actualiza un config file existente (incrementa versión automáticamente).
   */
  async update(
    tenantId: string,
    path: string,
    data: UpdateConfigFileData,
  ): Promise<ConfigFile> {
    const file = await this.repository.update(tenantId, path, data);
    if (!file) {
      throw new NotFoundException(`Config file with path '${path}' not found`);
    }
    this.logger.log(`Config file '${path}' updated to version ${file.version}`);
    return file;
  }

  /**
   * Elimina (soft delete) un config file.
   */
  async delete(tenantId: string, path: string): Promise<void> {
    const deleted = await this.repository.delete(tenantId, path);
    if (!deleted) {
      throw new NotFoundException(`Config file with path '${path}' not found`);
    }
    this.logger.log(`Config file '${path}' deleted`);
  }

  /**
   * Deploy: obtiene todos los config files activos y emite evento NATS.
   */
  async deploy(
    tenantId: string,
    deletePaths: string[] = [],
  ): Promise<{ files: ConfigFile[]; eventEmitted: boolean }> {
    // Obtener todos los config files activos
    const files = await this.repository.findAllActive(tenantId);

    // Emitir evento NATS
    let eventEmitted = false;
    try {
      const filesForEvent = files.map(file => ({
        path: file.path,
        content: file.content,
        format: file.format,
      }));

      await this.natsPublisher.publishRuntimeConfigSync(
        tenantId,
        filesForEvent,
        deletePaths,
      );
      eventEmitted = true;
      this.logger.log(`Runtime config sync event emitted with ${files.length} files`);
    } catch (error) {
      this.logger.error(
        `Failed to emit runtime.config.sync event`,
        error,
      );
      // No lanzamos error para no fallar la operación de deploy
    }

    return { files, eventEmitted };
  }
}
