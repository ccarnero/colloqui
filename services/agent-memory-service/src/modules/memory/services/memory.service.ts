import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { MEMORY_REPOSITORY } from "../domain/memory.repository.interface";
import type { IMemoryRepository } from "../domain/memory.repository.interface";
import {
  MemoryScope,
  MemoryKind,
  MemoryStatus,
  MergeStrategy,
} from "../domain/enums";
import type { IMemory } from "../domain/memory.entity";
import type { MemoryQueryDto } from "../dto/memory-query.dto";
import type { UpdateMemoryDto } from "../dto/update-memory.dto";

const MERGE_STRATEGY_BY_KIND: Record<MemoryKind, MergeStrategy> = {
  [MemoryKind.PREFERENCE]: MergeStrategy.REPLACE,
  [MemoryKind.FACT]: MergeStrategy.REPLACE,
  [MemoryKind.NOTICE]: MergeStrategy.REPLACE,
  [MemoryKind.INCIDENT]: MergeStrategy.KEEP_BOTH,
  [MemoryKind.PROMO]: MergeStrategy.KEEP_BOTH,
};

export interface INatsPublisher {
  publishMemoryProposed(tenantId: string, memory: IMemory): Promise<void>;
  publishMemoryApproved(tenantId: string, memory: IMemory): Promise<void>;
  publishMemoryRejected(tenantId: string, memory: IMemory): Promise<void>;
}

@Injectable()
export class MemoryService {
  private readonly logger = new PinoLoggerService(MemoryService.name);

  constructor(
    @Inject(MEMORY_REPOSITORY)
    private readonly repo: IMemoryRepository,
  ) {}

  private resolveInitialStatus(
    scope: MemoryScope,
    skipApproval = false,
  ): MemoryStatus {
    if (skipApproval) return MemoryStatus.ACTIVE;
    if (scope === MemoryScope.TENANT) return MemoryStatus.PROPOSED;
    return MemoryStatus.ACTIVE;
  }

  async proposeMemory(
    tenantId: string,
    data: {
      scope: MemoryScope;
      kind: MemoryKind;
      title: string;
      content: string;
      userId?: string;
      sessionId?: string;
      metadata?: Record<string, unknown>;
      topicKey?: string;
      ttl?: number;
    },
    natsPublisher?: INatsPublisher,
    skipApproval = false,
  ): Promise<IMemory> {
    const initialStatus = this.resolveInitialStatus(data.scope, skipApproval);
    const mergeStrategy = MERGE_STRATEGY_BY_KIND[data.kind];

    this.logger.log(
      `Proposing memory: scope=${data.scope}, kind=${data.kind}, ` +
        `status=${initialStatus}, merge=${mergeStrategy}`,
    );

    if (mergeStrategy === MergeStrategy.REPLACE && data.topicKey) {
      const existing = await this.repo.findByTopicKey(
        tenantId,
        data.topicKey,
        data.scope,
      );
      if (existing) {
        const updated = await this.repo.update(tenantId, existing.id, {
          title: data.title,
          content: data.content,
          metadata: {
            ...existing.metadata,
            ...data.metadata,
            revisionCount:
              ((existing.metadata as Record<string, number>)?.revisionCount || 0) + 1,
          },
        });
        if (updated) {
          if (natsPublisher) {
            await natsPublisher
              .publishMemoryProposed(tenantId, updated)
              .catch((err: unknown) =>
                this.logger.log(
                  `Failed to publish memory.proposed event: ${err}`,
                ),
              );
          }
          return updated;
        }
      }
    }

    const memory = await this.repo.create(tenantId, {
      scope: data.scope,
      kind: data.kind,
      status: initialStatus,
      title: data.title,
      content: data.content,
      userId: data.userId,
      sessionId: data.sessionId,
      metadata: data.metadata,
      topicKey: data.topicKey,
      ttl: data.ttl,
    });

    if (natsPublisher) {
      await natsPublisher
        .publishMemoryProposed(tenantId, memory)
        .catch((err: unknown) =>
          this.logger.log(
            `Failed to publish memory.proposed event: ${err}`,
          ),
        );
    }

    return memory;
  }

  async getMemories(
    tenantId: string,
    query: MemoryQueryDto,
  ): Promise<{ items: IMemory[]; total: number }> {
    return this.repo.findAll(tenantId, {
      scope: query.scope,
      kind: query.kind,
      status: query.status,
      includeExpired: query.includeExpired,
      sessionId: query.sessionId,
      userId: query.userId,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async approveMemory(
    tenantId: string,
    id: string,
    natsPublisher?: INatsPublisher,
  ): Promise<IMemory> {
    const memory = await this.repo.findById(tenantId, id);
    if (!memory) {
      throw new NotFoundException(`Memory ${id} not found`);
    }

    if (memory.status !== MemoryStatus.PROPOSED) {
      throw new NotFoundException(
        `Memory ${id} is not in PROPOSED status (current: ${memory.status})`,
      );
    }

    const updated = await this.repo.update(tenantId, id, {
      status: MemoryStatus.ACTIVE,
    });

    if (!updated) {
      throw new NotFoundException(`Memory ${id} not found after update`);
    }

    if (natsPublisher) {
      await natsPublisher
        .publishMemoryApproved(tenantId, updated)
        .catch((err: unknown) =>
          this.logger.log(
            `Failed to publish memory.approved event: ${err}`,
          ),
        );
    }

    return updated;
  }

  async rejectMemory(
    tenantId: string,
    id: string,
    natsPublisher?: INatsPublisher,
  ): Promise<IMemory> {
    const memory = await this.repo.findById(tenantId, id);
    if (!memory) {
      throw new NotFoundException(`Memory ${id} not found`);
    }

    if (memory.status !== MemoryStatus.PROPOSED) {
      throw new NotFoundException(
        `Memory ${id} is not in PROPOSED status (current: ${memory.status})`,
      );
    }

    const updated = await this.repo.update(tenantId, id, {
      status: MemoryStatus.REJECTED,
    });

    if (!updated) {
      throw new NotFoundException(`Memory ${id} not found after update`);
    }

    if (natsPublisher) {
      await natsPublisher
        .publishMemoryRejected(tenantId, updated)
        .catch((err: unknown) =>
          this.logger.log(
            `Failed to publish memory.rejected event: ${err}`,
          ),
        );
    }

    return updated;
  }

  async getMemory(tenantId: string, id: string): Promise<IMemory> {
    const memory = await this.repo.findById(tenantId, id);
    if (!memory) {
      throw new NotFoundException(`Memory ${id} not found`);
    }
    return memory;
  }

  async updateMemory(
    tenantId: string,
    id: string,
    dto: UpdateMemoryDto,
  ): Promise<IMemory> {
    const existing = await this.repo.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException(`Memory ${id} not found`);
    }

    const updated = await this.repo.update(tenantId, id, {
      title: dto.title,
      content: dto.content,
      metadata: dto.metadata,
    });

    if (!updated) {
      throw new NotFoundException(`Memory ${id} not found after update`);
    }

    return updated;
  }

  async deleteMemory(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repo.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundException(`Memory ${id} not found`);
    }
  }

  async getTimeline(
    tenantId: string,
    filters: {
      sessionId?: string;
      userId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<IMemory[]> {
    return this.repo.findTimeline(tenantId, filters);
  }
}
