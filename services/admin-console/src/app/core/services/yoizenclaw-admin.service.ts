import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { environment } from "../../../environments/environment";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { ResourceMutationsService } from "./metrics/resource-mutations.service";
import {
  buildYoizenclawCreateAgentPayload,
  type IYoizenclawAgent,
  type IYoizenclawAgentDraft,
  type IYoizenclawAgentListQuery,
  type IYoizenclawAgentListResponse,
  type IYoizenclawMemoryProposalActionResponse,
  type IYoizenclawMemoryProposalListResponse,
  type IYoizenclawTemplate,
} from "../models/yoizenclaw.model";

type QueryValue = string | number | boolean;

const BASE_URL = `${environment.apiUrl}/admin`;

function buildQueryParams(
  query?: IYoizenclawAgentListQuery,
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

  if (query.status !== undefined) {
    params["status"] = query.status;
  }

  if (query.is_active !== undefined) {
    params["is_active"] = query.is_active;
  }

  return params;
}

@Injectable({ providedIn: "root" })
export class YoizenclawAdminService {
  private readonly http = inject(HttpClient);
  private readonly mutations = inject(ResourceMutationsService);

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
    return this.http
      .post<IYoizenclawAgent>(`${BASE_URL}/agents`, payload)
      .pipe(tap(() => this.mutations.notify("ai")));
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
  updateAgent(
    agentId: string,
    draft: IYoizenclawAgentDraft,
  ): Observable<IYoizenclawAgent> {
    const payload = buildYoizenclawCreateAgentPayload(draft);
    return this.http.put<IYoizenclawAgent>(`${BASE_URL}/agents/${agentId}`, payload);
  }

  /**
   * Soft-deletes an agent.
   *
   * @param agentId - The agent to delete.
   * @returns A completion stream (HTTP 204).
   */
  deleteAgent(agentId: string): Observable<void> {
    return this.http
      .delete<void>(`${BASE_URL}/agents/${agentId}`)
      .pipe(tap(() => this.mutations.notify("ai")));
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
    return this.http
      .post<IYoizenclawMemoryProposalActionResponse>(
        `${BASE_URL}/memories/proposals/${proposalId}/approve`,
        {},
      )
      .pipe(tap(() => this.mutations.notify("ai")));
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
    return this.http
      .post<IYoizenclawMemoryProposalActionResponse>(
        `${BASE_URL}/memories/proposals/${proposalId}/reject`,
        {},
      )
      .pipe(tap(() => this.mutations.notify("ai")));
  }
}
