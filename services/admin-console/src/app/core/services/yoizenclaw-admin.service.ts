import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { environment } from "../../../environments/environment";
import type { Observable } from "rxjs";
import {
  buildYoizenclawCreateAgentPayload,
  type IYoizenclawAgent,
  type IYoizenclawAgentDraft,
  type IYoizenclawAgentListQuery,
  type IYoizenclawAgentListResponse,
  type IYoizenclawCredentialListQuery,
  type IYoizenclawCredentialListResponse,
  type IYoizenclawTemplate,
} from "../models/yoizenclaw.model";

type QueryValue = string | number | boolean;

const BASE_URL = `${environment.apiUrl}/admin`;

function buildQueryParams(
  query?: IYoizenclawAgentListQuery | IYoizenclawCredentialListQuery,
): Record<string, QueryValue> {
  const params: Record<string, QueryValue> = {};

  if (!query) {
    return params;
  }

  if (query.limit !== undefined) {
    params["limit"] = query.limit;
  }

  if (query.offset !== undefined) {
    params["offset"] = query.offset;
  }

  if ("status" in query && query.status !== undefined) {
    params["status"] = query.status;
  }

  if ("is_active" in query && query.is_active !== undefined) {
    params["is_active"] = query.is_active;
  }

  if ("type" in query && query.type !== undefined) {
    params["type"] = query.type;
  }

  return params;
}

@Injectable({ providedIn: "root" })
export class YoizenclawAdminService {
  private readonly http = inject(HttpClient);

  /**
   * Retrieves the current agent catalog for the active tenant.
   *
   * @param query - Optional filter and pagination parameters.
   * @returns A stream of paginated agent data.
   */
  listAgents(
    query?: IYoizenclawAgentListQuery,
  ): Observable<IYoizenclawAgentListResponse> {
    return this.http.get<IYoizenclawAgentListResponse>(`${BASE_URL}/agents`, {
      params: buildQueryParams(query),
    });
  }

  /**
   * Retrieves credential profiles for the active tenant.
   *
   * @param query - Optional filter and pagination parameters.
   * @returns A stream of credential profile data.
   */
  listCredentialProfiles(
    query?: IYoizenclawCredentialListQuery,
  ): Observable<IYoizenclawCredentialListResponse> {
    return this.http.get<IYoizenclawCredentialListResponse>(
      `${BASE_URL}/credentials`,
      { params: buildQueryParams(query) },
    );
  }

  /**
   * Creates a YoizenClaw agent using the MVP form contract.
   *
   * @param draft - UI form data for the new agent.
   * @returns A stream with the created agent record.
   */
  createAgent(draft: IYoizenclawAgentDraft): Observable<IYoizenclawAgent> {
    const payload = buildYoizenclawCreateAgentPayload(draft);
    return this.http.post<IYoizenclawAgent>(`${BASE_URL}/agents`, payload);
  }

  publishAgent(agentId: string): Observable<IYoizenclawAgent> {
    return this.http.post<IYoizenclawAgent>(
      `${BASE_URL}/agents/${agentId}/publish`,
      {},
    );
  }

  /**
   * Unpublishes a YoizenClaw agent (reverts to draft status).
   *
   * @param agentId - The agent to unpublish.
   * @returns A stream with the unpublished agent record.
   */
  unpublishAgent(agentId: string): Observable<IYoizenclawAgent> {
    return this.http.post<IYoizenclawAgent>(
      `${BASE_URL}/agents/${agentId}/unpublish`,
      {},
    );
  }

  /**
   * Retrieves a specific agent by ID.
   *
   * @param agentId - The agent ID to retrieve.
   * @returns A stream with the agent record.
   */
  getAgent(agentId: string): Observable<IYoizenclawAgent> {
    return this.http.get<IYoizenclawAgent>(`${BASE_URL}/agents/${agentId}`);
  }

  /**
   * Updates an existing YoizenClaw agent.
   *
   * @param agentId - The agent to update.
   * @param draft - UI form data with updates.
   * @returns A stream with the updated agent record.
   */
  updateAgent(
    agentId: string,
    draft: IYoizenclawAgentDraft,
  ): Observable<IYoizenclawAgent> {
    const payload = buildYoizenclawCreateAgentPayload(draft);
    return this.http.put<IYoizenclawAgent>(
      `${BASE_URL}/agents/${agentId}`,
      payload,
    );
  }

  /**
   * Retrieves available agent templates.
   *
   * @returns A stream with the list of templates.
   */
  listTemplates(): Observable<{ templates: IYoizenclawTemplate[] }> {
    return this.http.get<{ templates: IYoizenclawTemplate[] }>(
      `${BASE_URL}/templates`,
    );
  }

  /**
   * Sends a chat message to an agent and returns the response.
   *
   * @param agentId - The agent to chat with.
   * @param request - Chat request with message and context.
   * @returns A stream with the agent's reply.
   */
  chatWithAgent(
    agentId: string,
    request: {
      message: string;
      conversationId: string;
      channel: string;
      customerName: string;
      context: Array<{ sender: "customer" | "agent"; content: string }>;
    },
  ): Observable<{ reply: string; tool_calls: unknown[] }> {
    return this.http.post<{ reply: string; tool_calls: unknown[] }>(
      `${BASE_URL}/agents/${agentId}/chat`,
      request,
    );
  }
}
