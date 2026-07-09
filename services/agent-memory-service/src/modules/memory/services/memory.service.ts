import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  MemoryKind,
  MemoryScope,
  MemoryStatus,
  MergeStrategy,
} from "../domain/enums";
import type { IMemory } from "../domain/memory.entity";
import type { IMemoryRepository } from "../domain/memory.repository.interface";
import { MEMORY_REPOSITORY } from "../domain/memory.repository.interface";
import type { MemoryQueryDto } from "../dto/memory-query.dto";
import type { UpdateMemoryDto } from "../dto/update-memory.dto";

const MERGE_STRATEGY_BY_KIND: Record<MemoryKind, MergeStrategy> = {
  [MemoryKind.PREFERENCE]: MergeStrategy.REPLACE,
  [MemoryKind.FACT]: MergeStrategy.REPLACE,
  [MemoryKind.NOTICE]: MergeStrategy.REPLACE,
  [MemoryKind.INCIDENT]: MergeStrategy.KEEP_BOTH,
  [MemoryKind.PROMO]: MergeStrategy.KEEP_BOTH,
};

/**
 * Causal-chain context for lifecycle events derived from a
 * memory_proposed event (DOCS/messaging/envelope.md §6). Structurally
 * compatible with the provider-side ICausalContext; declared here to
 * avoid a module cycle (nats.provider imports INatsPublisher from this
 * file).
 */
export interface IMemoryCausalContext {
  readonly causationId?: string | null;
  readonly correlationId?: string;
}

export interface INatsPublisher {
  /** Returns the published memory_proposed envelope id (causation anchor). */
  publishMemoryProposed(tenantId: string, memory: IMemory): Promise<string>;
  publishMemoryApproved(
    tenantId: string,
    memory: IMemory,
    causal?: IMemoryCausalContext
  ): Promise<void>;
  publishMemoryRejected(
    tenantId: string,
    memory: IMemory,
    causal?: IMemoryCausalContext
  ): Promise<void>;
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
    skipApproval = false
  ): MemoryStatus {
    if (skipApproval) {
      return MemoryStatus.ACTIVE;
    }
    if (scope === MemoryScope.TENANT) {
      return MemoryStatus.PROPOSED;
    }
    return MemoryStatus.ACTIVE;
  }

  /**
   * Publishes memory_proposed and persists the returned envelope id in
   * `metadata.proposedEventId` — the causation anchor for the later
   * memory_published/memory_rejected events (DOCS/messaging/envelope.md
   * §6). Publish failures keep the memory unchanged (best-effort, as
   * before the correlation-chain fix).
   */
  private async publishProposedAndPersist(
    tenantId: string,
    memory: IMemory,
    natsPublisher: INatsPublisher
  ): Promise<IMemory> {
    const proposedEventId = await natsPublisher
      .publishMemoryProposed(tenantId, memory)
      .catch((err: unknown) => {
        this.logger.log(`Failed to publish memory.proposed event: ${err}`);
        return undefined;
      });
    if (!proposedEventId) {
      return memory;
    }

    const enriched = await this.repo.update(tenantId, memory.id, {
      metadata: { ...memory.metadata, proposedEventId },
    });
    return enriched ?? memory;
  }

  private causalFrom(memory: IMemory): IMemoryCausalContext {
    const proposedEventId = (
      memory.metadata as Record<string, unknown> | undefined
    )?.proposedEventId;
    return {
      // Memories proposed before proposedEventId existed have no
      // causation anchor: fall back to null (root) instead of failing.
      causationId: typeof proposedEventId === "string" ? proposedEventId : null,
      correlationId: `memory:${memory.id}`,
    };
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
    skipApproval = false
  ): Promise<IMemory> {
    const initialStatus = this.resolveInitialStatus(data.scope, skipApproval);
    const mergeStrategy = MERGE_STRATEGY_BY_KIND[data.kind];

    this.logger.log(
      `Proposing memory: scope=${data.scope}, kind=${data.kind}, ` +
        `status=${initialStatus}, merge=${mergeStrategy}`
    );

    if (mergeStrategy === MergeStrategy.REPLACE && data.topicKey) {
      const existing = await this.repo.findByTopicKey(
        tenantId,
        data.topicKey,
        data.scope
      );
      if (existing) {
        const updated = await this.repo.update(tenantId, existing.id, {
          title: data.title,
          content: data.content,
          metadata: {
            ...existing.metadata,
            ...data.metadata,
            revisionCount:
              ((existing.metadata as Record<string, number>)?.revisionCount ||
                0) + 1,
          },
        });
        if (updated) {
          if (natsPublisher) {
            return this.publishProposedAndPersist(
              tenantId,
              updated,
              natsPublisher
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
      return this.publishProposedAndPersist(tenantId, memory, natsPublisher);
    }

    return memory;
  }

  async getMemories(
    tenantId: string,
    query: MemoryQueryDto
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
    natsPublisher?: INatsPublisher
  ): Promise<IMemory> {
    const memory = await this.repo.findById(tenantId, id);
    if (!memory) {
      throw new NotFoundException(`Memory ${id} not found`);
    }

    if (memory.status !== MemoryStatus.PROPOSED) {
      throw new NotFoundException(
        `Memory ${id} is not in PROPOSED status (current: ${memory.status})`
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
        .publishMemoryApproved(tenantId, updated, this.causalFrom(updated))
        .catch((err: unknown) =>
          this.logger.log(`Failed to publish memory.approved event: ${err}`)
        );
    }

    return updated;
  }

  async rejectMemory(
    tenantId: string,
    id: string,
    natsPublisher?: INatsPublisher
  ): Promise<IMemory> {
    const memory = await this.repo.findById(tenantId, id);
    if (!memory) {
      throw new NotFoundException(`Memory ${id} not found`);
    }

    if (memory.status !== MemoryStatus.PROPOSED) {
      throw new NotFoundException(
        `Memory ${id} is not in PROPOSED status (current: ${memory.status})`
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
        .publishMemoryRejected(tenantId, updated, this.causalFrom(updated))
        .catch((err: unknown) =>
          this.logger.log(`Failed to publish memory.rejected event: ${err}`)
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
    dto: UpdateMemoryDto
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
    }
  ): Promise<IMemory[]> {
    return this.repo.findTimeline(tenantId, filters);
  }
}
