import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { environment } from "../../../environments/environment";
import { Observable } from "rxjs";
import type { IYoizenclawChatRequest } from "../models/yoizenclaw.model";

export interface IYoizenclawExecutionResult {
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
    tool_calls?: unknown[];
    errorCode?: string;
    errorMessage?: string;
  };
}

@Injectable({ providedIn: "root" })
export class YoizenclawRuntimeService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/runtime/executions`;

  createExecution(
    request: IYoizenclawChatRequest & { agentId: string },
  ): Observable<{ executionId: string; status: string }> {
    return this.http.post<{ executionId: string; status: string }>(
      this.baseUrl,
      request,
    );
  }

  getExecution(executionId: string): Observable<IYoizenclawExecutionResult> {
    return this.http.get<IYoizenclawExecutionResult>(
      `${this.baseUrl}/${executionId}`,
    );
  }
}
