import { Injectable, Logger } from "@nestjs/common";
import { agentAiServiceConfig } from "../../config";

export interface MemoryItem {
  id: string;
  title: string;
  content: string;
  scope: string;
  kind: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MemorySearchResult {
  items: MemoryItem[];
  total: number;
}

export interface CreateMemoryInput {
  scope: string;
  kind: string;
  title: string;
  content: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  topicKey?: string;
  ttl?: number;
}

@Injectable()
export class MemoryClientService {
  private readonly logger = new Logger(MemoryClientService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = agentAiServiceConfig.memoryServiceUrl.replace(/\/+$/, "");
  }

  async create(tenantId: string, input: CreateMemoryInput): Promise<MemoryItem> {
    const url = `${this.baseUrl}/admin/memories`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-yoizen-tenant": tenantId,
      },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(
        `Memory create failed: status=${res.status} tenant=${tenantId} body=${body.slice(0, 200)}`,
      );
      throw new Error(`Memory create failed: ${res.status}`);
    }

    return (await res.json()) as MemoryItem;
  }

  async list(
    tenantId: string,
    query: {
      scope?: string;
      kind?: string;
      status?: string;
      search?: string;
      limit?: number;
      offset?: number;
      includeExpired?: boolean;
      sessionId?: string;
      userId?: string;
      context?: string;
    } = {},
  ): Promise<MemorySearchResult> {
    const params = new URLSearchParams();
    if (query.scope) params.set("scope", query.scope);
    if (query.kind) params.set("kind", query.kind);
    if (query.status) params.set("status", query.status);
    if (query.search) params.set("search", query.search);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.offset !== undefined) params.set("offset", String(query.offset));
    if (query.includeExpired !== undefined) params.set("includeExpired", String(query.includeExpired));
    if (query.sessionId) params.set("sessionId", query.sessionId);
    if (query.userId) params.set("userId", query.userId);
    if (query.context) params.set("context", query.context);

    const qs = params.toString();
    const url = `${this.baseUrl}/admin/memories${qs ? `?${qs}` : ""}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-yoizen-tenant": tenantId },
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(
        `Memory list failed: status=${res.status} tenant=${tenantId} body=${body.slice(0, 200)}`,
      );
      throw new Error(`Memory list failed: ${res.status}`);
    }

    const data = (await res.json()) as MemorySearchResult;
    return data;
  }

  async update(
    tenantId: string,
    id: string,
    patch: { title?: string; content?: string; metadata?: Record<string, unknown>; topicKey?: string },
  ): Promise<MemoryItem> {
    const url = `${this.baseUrl}/admin/memories/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-yoizen-tenant": tenantId,
      },
      body: JSON.stringify(patch),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(
        `Memory update failed: status=${res.status} tenant=${tenantId} id=${id} body=${body.slice(0, 200)}`,
      );
      throw new Error(`Memory update failed: ${res.status}`);
    }

    return (await res.json()) as MemoryItem;
  }

  async approve(tenantId: string, id: string): Promise<MemoryItem> {
    const url = `${this.baseUrl}/admin/memories/${encodeURIComponent(id)}/approve`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "x-yoizen-tenant": tenantId },
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(
        `Memory approve failed: status=${res.status} tenant=${tenantId} id=${id} body=${body.slice(0, 200)}`,
      );
      throw new Error(`Memory approve failed: ${res.status}`);
    }

    return (await res.json()) as MemoryItem;
  }

  async reject(tenantId: string, id: string): Promise<MemoryItem> {
    const url = `${this.baseUrl}/admin/memories/${encodeURIComponent(id)}/reject`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "x-yoizen-tenant": tenantId },
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(
        `Memory reject failed: status=${res.status} tenant=${tenantId} id=${id} body=${body.slice(0, 200)}`,
      );
      throw new Error(`Memory reject failed: ${res.status}`);
    }

    return (await res.json()) as MemoryItem;
  }

  async search(
    tenantId: string,
    query: string,
    limit = 10,
  ): Promise<MemorySearchResult> {
    const params = new URLSearchParams({
      search: query,
      limit: String(limit),
      status: "ACTIVE",
    });
    const url = `${this.baseUrl}/admin/memories?${params.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-yoizen-tenant": tenantId,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(
        `Memory search failed: status=${res.status} tenant=${tenantId} body=${body.slice(0, 200)}`,
      );
      throw new Error(`Memory search failed: ${res.status}`);
    }

    const data = await res.json();
    if (Array.isArray(data)) {
      return { items: data as MemoryItem[], total: data.length };
    }
    return data as MemorySearchResult;
  }

  async load(tenantId: string, id: string): Promise<MemoryItem | null> {
    const url = `${this.baseUrl}/admin/memories/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-yoizen-tenant": tenantId,
      },
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(
        `Memory load failed: status=${res.status} tenant=${tenantId} id=${id} body=${body.slice(0, 200)}`,
      );
      throw new Error(`Memory load failed: ${res.status}`);
    }

    return (await res.json()) as MemoryItem;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const url = `${this.baseUrl}/admin/memories/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        "x-yoizen-tenant": tenantId,
      },
    });

    if (!res.ok && res.status !== 204) {
      const body = await res.text();
      this.logger.error(
        `Memory delete failed: status=${res.status} tenant=${tenantId} id=${id} body=${body.slice(0, 200)}`,
      );
      throw new Error(`Memory delete failed: ${res.status}`);
    }
  }
}
