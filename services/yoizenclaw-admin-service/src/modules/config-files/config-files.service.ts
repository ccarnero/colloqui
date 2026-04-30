import { Injectable, NotFoundException } from "@nestjs/common";
import {
  ConfigFilesRepository,
  type IConfigFile,
  type ICreateConfigFileData,
  type IFindAllConfigFilesOptions,
} from "./config-files.repository";
import { NatsPublisher } from "../../providers/nats.provider";
import { PinoLoggerService } from "@yoizen/observability";

@Injectable()
export class ConfigFilesService {
  private readonly logger = new PinoLoggerService(ConfigFilesService.name);

  constructor(
    private readonly repository: ConfigFilesRepository,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  /**
   * Lists all config files with pagination.
   */
  async findAll(
    tenantId: string,
    options: IFindAllConfigFilesOptions = {},
  ): Promise<{ files: IConfigFile[]; total: number }> {
    return this.repository.findAll(tenantId, options);
  }

  /**
   * Returns a config file by path.
   */
  async findByPath(tenantId: string, path: string): Promise<IConfigFile> {
    const file = await this.repository.findByPath(tenantId, path);
    if (!file) {
      throw new NotFoundException(`Config file with path '${path}' not found`);
    }
    return file;
  }

  /**
   * Creates a new config file, or updates an existing one at the same path.
   */
  async createOrUpdate(
    tenantId: string,
    data: ICreateConfigFileData,
  ): Promise<IConfigFile> {
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
        throw new NotFoundException(
          `Config file with path '${data.path}' not found during update`,
        );
      }
      return updated;
    }

    // Create new file
    this.logger.log(`Creating new config file: ${data.path}`);
    return this.repository.create(tenantId, data);
  }

  /**
   * Deploy: loads all active config files and emits a NATS sync event.
   */
  async deploy(
    tenantId: string,
    deletePaths: string[] = [],
  ): Promise<{ files: IConfigFile[]; eventEmitted: boolean }> {
    const files = await this.repository.findAllActive(tenantId);

    // Emit NATS event
    let eventEmitted = false;
    try {
      const filesForEvent = files.map((file) => ({
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
      this.logger.log(
        `Runtime config sync event emitted with ${files.length} files`,
      );
    } catch (error) {
      this.logger.error(`Failed to emit runtime.config.sync event`, error);
      // Do not fail the deploy operation if the event fails
    }

    return { files, eventEmitted };
  }
}
