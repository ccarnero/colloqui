import type { MemoryScope, MemoryKind, MemoryStatus } from "./enums";

export interface IMemory {
  id: string;
  tenantId: string;
  userId?: string;
  sessionId?: string;
  scope: MemoryScope;
  kind: MemoryKind;
  status: MemoryStatus;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  topicKey?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
