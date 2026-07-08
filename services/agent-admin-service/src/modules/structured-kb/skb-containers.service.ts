import { Injectable, NotFoundException } from "@nestjs/common";
import type { UpdateSKBDto } from "./dto/update-skb.dto";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { SKBContainersRepository } from "./skb-containers.repository";
import type {
  FileRow,
  SKBContainerRow,
  SKBFileStatus,
} from "./types/skb.types";

export interface SKBContainerFileInfo {
  /** skb_files primary key — the value skb_rows.file_id references. */
  id: string;
  file_id: string;
  container_id: string;
  tenant_id: string;
  status: string;
  error?: string;
  updated_at?: Date;
}

@Injectable()
export class SKBContainersService {
  constructor(private readonly repository: SKBContainersRepository) {}

  async createContainer(
    tenantId: string,
    name: string,
    description?: string
  ): Promise<SKBContainerRow> {
    return this.repository.create(tenantId, { name, description });
  }

  async getContainer(tenantId: string, id: string): Promise<SKBContainerRow> {
    const container = await this.repository.findById(tenantId, id);
    if (!container) {
      throw new NotFoundException(`SKB container with ID '${id}' not found`);
    }
    return container;
  }

  async findById(
    tenantId: string,
    id: string
  ): Promise<SKBContainerRow | null> {
    return this.repository.findById(tenantId, id);
  }

  async listContainers(tenantId: string): Promise<SKBContainerRow[]> {
    return this.repository.findAll(tenantId);
  }

  async updateContainer(
    tenantId: string,
    id: string,
    data: UpdateSKBDto
  ): Promise<SKBContainerRow> {
    const container = await this.repository.update(tenantId, id, data);
    if (!container) {
      throw new NotFoundException(`SKB container with ID '${id}' not found`);
    }
    return container;
  }

  async deleteContainer(
    tenantId: string,
    id: string
  ): Promise<SKBContainerRow> {
    const container = await this.repository.delete(tenantId, id);
    if (!container) {
      throw new NotFoundException(`SKB container with ID '${id}' not found`);
    }
    return container;
  }

  async containerExists(tenantId: string, id: string): Promise<boolean> {
    return this.repository.exists(tenantId, id);
  }

  async findFile(
    tenantId: string,
    containerId: string,
    fileId: string
  ): Promise<SKBContainerFileInfo | null> {
    return this.repository.findFile(tenantId, containerId, fileId);
  }

  async updateFileStatus(
    tenantId: string,
    containerId: string,
    fileId: string,
    status: SKBFileStatus | string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.repository.updateFileStatus(
      tenantId,
      containerId,
      fileId,
      status,
      metadata
    );
  }

  async updateStatus(
    tenantId: string,
    containerId: string,
    status?: string
  ): Promise<void> {
    await this.repository.updateContainerStatus(tenantId, containerId, status);
  }

  async findAllContainersWithProcessingFiles(
    thresholdMinutes: number
  ): Promise<SKBContainerFileInfo[]> {
    return this.repository.findProcessingFilesOlderThan(thresholdMinutes);
  }

  /**
   * Creates the `skb_files` row for an uploaded file, status 'pending'.
   * Called by the upload endpoint before publishing the ingestion event
   * the worker (skb-ingestion-worker.service.ts) consumes.
   */
  async createFile(
    tenantId: string,
    containerId: string,
    data: { fileId: string; originalName: string; categories: string[] }
  ): Promise<FileRow> {
    return this.repository.createFile(tenantId, containerId, data);
  }
}
