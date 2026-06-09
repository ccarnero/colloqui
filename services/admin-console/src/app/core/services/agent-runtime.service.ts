import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { environment } from "../../../environments/environment";
import { Observable } from "rxjs";
import type { IChatRequest } from "../models/agent.model";

export interface IExecutionResult {
  executionId: string;
  tenantId: string;
  type: "chat";
  state: "pending" | "running" | "completed" | "failed";
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  agentId: string;
  result?: {
    reply?: string;
    response?: string;
    toolCalls?: Array<{ type: string; toolName: string; args?: Record<string, unknown> }>;
    toolResults?: Array<{ toolName: string; args?: Record<string, unknown>; result: unknown; success?: boolean }>;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedInputTokens?: number };
    costUsd?: number;
    model?: string;
    provider?: string;
    skills?: string[];
    mcpTools?: string[];
    errorCode?: string;
    errorMessage?: string;
  };
}

@Injectable({ providedIn: "root" })
export class AgentRuntimeService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/runtime/executions`;

  createExecution(
    request: IChatRequest & { agentId: string },
  ): Observable<{ executionId: string; status: string }> {
    return this.http.post<{ executionId: string; status: string }>(
      this.baseUrl,
      request,
    );
  }

  getExecution(executionId: string): Observable<IExecutionResult> {
    return this.http.get<IExecutionResult>(
      `${this.baseUrl}/${executionId}`,
    );
  }

  checkRuntimeHealth(): Observable<{
    status: string;
    nats: string;
    redis: string;
  }> {
    return this.http.get<{
      status: string;
      nats: string;
      redis: string;
    }>(`${environment.apiUrl}/runtime/health`);
  }
}
