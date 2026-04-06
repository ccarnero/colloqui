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
  type IYoizenclawChatRequest,
  type IYoizenclawChatResponse,
  type IYoizenclawCreateCredentialPayload,
  type IYoizenclawCredentialListQuery,
  type IYoizenclawCredentialListResponse,
  type IYoizenclawCredentialProfile,
  type IYoizenclawMemoryProposalActionResponse,
  type IYoizenclawMemoryProposalListResponse,
  type IYoizenclawRotateCredentialPayload,
  type IYoizenclawTemplate,
  type IYoizenclawUpdateCredentialPayload,
  type IYoizenclawCredentialSyncResponse,
  type IYoizenclawProvidersResponse,
  type YoizenclawCredentialProvider,
  type YoizenclawCredentialSyncStatus,
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

  // Provider-aware query params
  if ("provider" in query && query.provider !== undefined) {
    params["provider"] = query.provider;
  }

  if ("sync_status" in query && query.sync_status !== undefined) {
    params["sync_status"] = query.sync_status;
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
    return this.http.get<IYoizenclawAgentListResponse>(
      `${BASE_URL}/agents`,
      { params: buildQueryParams(query) },
    );
  }

  // ============================================================================
  // Provider-Aware Credential APIs
  // ============================================================================

  /**
   * Retrieves available credential providers with their schemas.
   *
   * @returns A stream with provider schemas for UI form rendering.
   */
  listCredentialProviders(): Observable<IYoizenclawProvidersResponse> {
    return this.http.get<IYoizenclawProvidersResponse>(
      `${BASE_URL}/credentials/providers`,
    );
  }

  /**
   * Retrieves credential profiles for the active tenant.
   *
   * @param query - Optional filter and pagination parameters (provider-aware).
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
   * Creates a new provider-aware credential profile.
   *
   * @param payload - Credential data (name, provider, payload, etc.).
   * @returns A stream with the created credential.
   */
  createCredentialProfile(
    payload: IYoizenclawCreateCredentialPayload,
  ): Observable<IYoizenclawCredentialProfile> {
    return this.http.post<IYoizenclawCredentialProfile>(
      `${BASE_URL}/credentials`,
      payload,
    );
  }

  /**
   * Updates an existing credential profile.
   *
   * @param id - Credential ID.
   * @param payload - Fields to update (all optional).
   * @returns A stream with the updated credential.
   */
  updateCredentialProfile(
    id: string,
    payload: IYoizenclawUpdateCredentialPayload,
  ): Observable<IYoizenclawCredentialProfile> {
    return this.http.put<IYoizenclawCredentialProfile>(
      `${BASE_URL}/credentials/${id}`,
      payload,
    );
  }

  /**
   * Deletes a credential profile.
   *
   * @param id - Credential ID.
   * @returns An empty stream (HTTP 204).
   */
  deleteCredentialProfile(id: string): Observable<void> {
    return this.http.delete<void>(`${BASE_URL}/credentials/${id}`);
  }

  /**
   * Rotates the secrets of a credential profile.
   *
   * @param id - Credential ID.
   * @param payload - New payload with replacement secrets.
   * @returns A stream with the rotated credential.
   */
  rotateCredentialProfile(
    id: string,
    payload: IYoizenclawRotateCredentialPayload,
  ): Observable<IYoizenclawCredentialProfile> {
    return this.http.put<IYoizenclawCredentialProfile>(
      `${BASE_URL}/credentials/${id}/rotate`,
      payload,
    );
  }

  /**
   * Triggers manual sync of credentials to runtime.
   *
   * @param failedOnly - If true, only sync credentials with failed status.
   * @returns A stream with sync results.
   */
  syncCredentials(failedOnly?: boolean): Observable<IYoizenclawCredentialSyncResponse> {
    return this.http.post<IYoizenclawCredentialSyncResponse>(
      `${BASE_URL}/credentials/sync`,
      { failed_only: failedOnly },
    );
  }

  // ============================================================================
  // Agent APIs
  // ============================================================================

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
    return this.http.post<IYoizenclawAgent>(`${BASE_URL}/agents/${agentId}/publish`, {});
  }

  /**
   * Unpublishes a YoizenClaw agent (reverts to draft status).
   *
   * @param agentId - The agent to unpublish.
   * @returns A stream with the unpublished agent record.
   */
  unpublishAgent(agentId: string): Observable<IYoizenclawAgent> {
    return this.http.post<IYoizenclawAgent>(`${BASE_URL}/agents/${agentId}/unpublish`, {});
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
  updateAgent(agentId: string, draft: IYoizenclawAgentDraft): Observable<IYoizenclawAgent> {
    const payload = buildYoizenclawCreateAgentPayload(draft);
    return this.http.put<IYoizenclawAgent>(`${BASE_URL}/agents/${agentId}`, payload);
  }

  /**
   * Retrieves available agent templates.
   *
   * @returns A stream with the list of templates.
   */
  listTemplates(): Observable<{ templates: IYoizenclawTemplate[] }> {
    return this.http.get<{ templates: IYoizenclawTemplate[] }>(`${BASE_URL}/templates`);
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
    request: IYoizenclawChatRequest,
  ): Observable<IYoizenclawChatResponse> {
    return this.http.post<IYoizenclawChatResponse>(
      `${BASE_URL}/agents/${agentId}/chat`,
      request,
    );
  }

  /**
   * Retrieves tenant memory proposals pending human review.
   *
   * @returns A stream with the pending proposal list.
   */
  listMemoryProposals(): Observable<IYoizenclawMemoryProposalListResponse> {
    return this.http.get<IYoizenclawMemoryProposalListResponse>(
      `${BASE_URL}/memories/proposals`,
    );
  }

  /**
   * Approves a tenant memory proposal.
   *
   * @param proposalId - Proposal identifier.
   * @returns A stream with the review result.
   */
  approveMemoryProposal(
    proposalId: string,
  ): Observable<IYoizenclawMemoryProposalActionResponse> {
    return this.http.post<IYoizenclawMemoryProposalActionResponse>(
      `${BASE_URL}/memories/proposals/${proposalId}/approve`,
      {},
    );
  }

  /**
   * Rejects a tenant memory proposal.
   *
   * @param proposalId - Proposal identifier.
   * @returns A stream with the review result.
   */
  rejectMemoryProposal(
    proposalId: string,
  ): Observable<IYoizenclawMemoryProposalActionResponse> {
    return this.http.post<IYoizenclawMemoryProposalActionResponse>(
      `${BASE_URL}/memories/proposals/${proposalId}/reject`,
      {},
    );
  }
}
