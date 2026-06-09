import type { IMemory } from "./memory.entity";
import type { MemoryScope, MemoryKind, MemoryStatus } from "./enums";

export type { IMemory } from "./memory.entity";
export const MEMORY_REPOSITORY = Symbol("MEMORY_REPOSITORY");

export interface ICreateMemoryData {
  scope: MemoryScope;
  kind: MemoryKind;
  status?: MemoryStatus;
  title?: string;
  content: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  topicKey?: string;
  ttl?: number;
}

export interface IUpdateMemoryData {
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  status?: MemoryStatus;
  topicKey?: string;
}

export interface IMemoryQueryOptions {
  scope?: MemoryScope;
  kind?: MemoryKind;
  status?: MemoryStatus;
  search?: string;
  limit?: number;
  offset?: number;
  includeExpired?: boolean;
  sessionId?: string;
  userId?: string;
}

export interface IMemoryRepository {
  create(tenantId: string, data: ICreateMemoryData): Promise<IMemory>;
  findById(tenantId: string, id: string): Promise<IMemory | null>;
  findByTopicKey(
    tenantId: string,
    topicKey: string,
    scope?: MemoryScope,
  ): Promise<IMemory | null>;
  findAll(
    tenantId: string,
    options?: IMemoryQueryOptions,
  ): Promise<{ items: IMemory[]; total: number }>;
  update(
    tenantId: string,
    id: string,
    data: IUpdateMemoryData,
  ): Promise<IMemory | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
  findTimeline(
    tenantId: string,
    filters: {
      sessionId?: string;
      userId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<IMemory[]>;
}
