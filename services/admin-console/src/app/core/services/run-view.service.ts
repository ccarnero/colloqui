import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import type { Observable } from "rxjs";
import { environment } from "../../../environments/environment";
import {
  type IWorkflowDefinitionDto,
  WorkflowApiService,
} from "../../features/automation/workflows/services/workflow-api.service";
import type {
  ITrackedEvent,
  ITrackedEventSpan,
} from "./tracking-chain.service";

const TRACKING_RUNS = `${environment.apiUrl}/tracking/runs`;

/** Run status derived by the ingester (T01 of manual-loops/run-view.md). */
export type RunStatus = "running" | "completed" | "failed";

/**
 * A run's OWN event row, wire-faithful to
 * `tracking-ingester-service/src/lib/build-run-events-query.ts`'s
 * `RunEventRow` — `ITrackedEvent` (tracking-chain.service.ts) PLUS the
 * three step-event payload fields the run view needs
 * (`payload_connector_id`/`payload_agent_id`/`payload_step_status`) and
 * `payload_execution_id`, which chain events never carry (see that file's
 * header for why they're jsonb-path-extracted rather than dedicated
 * columns).
 */
export interface IRunEvent extends ITrackedEvent {
  readonly payload_connector_id: string | null;
  readonly payload_agent_id: string | null;
  readonly payload_step_status: string | null;
  readonly payload_execution_id: string | null;
}

/**
 * A run's OWN span row, wire-faithful to `build-spans-query.ts`'s
 * `ChainSpanRow` — `ITrackedEventSpan` (tracking-chain.service.ts) PLUS
 * `event_id`/`causation_id`, which the ingester's run-scoping needs to
 * attribute a span to this specific run (see that file's header).
 */
export interface IRunSpan extends ITrackedEventSpan {
  readonly event_id: string;
  readonly causation_id: string | null;
}

export interface IRunSummary {
  readonly status: RunStatus;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly total_ms: number;
  readonly steps_ok: number;
  readonly steps_failed: number;
}

export type RunCastKind = "connector" | "agent" | "channel" | "tool";

export interface IRunCastEntry {
  readonly kind: RunCastKind;
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

/** Wire-faithful to `to-run-response.ts`'s `RunResponse` (T01). */
export interface IRunResponse {
  readonly workflow_id: string;
  readonly run_id: string;
  readonly correlation_id: string;
  readonly tenant: string | null;
  readonly events: IRunEvent[];
  readonly spans: IRunSpan[];
  readonly summary: IRunSummary;
  readonly cast: IRunCastEntry[];
  readonly step_detail: boolean;
}

/**
 * Data service for the workflow run view (T02 of manual-loops/run-view.md).
 * `getRun` proxies the ingester's `GET /runs/:workflowId/:runId` (T01) via
 * the gateway's tracking module; `getDefinition` delegates to the existing
 * `WorkflowApiService` — no new HTTP call is introduced for definitions.
 */
@Injectable({ providedIn: "root" })
export class RunViewService {
  private readonly http = inject(HttpClient);
  private readonly workflowApi = inject(WorkflowApiService);

  /**
   * Fetches the run's own events/spans/summary/cast from the
   * tracking-ingester-service, proxied by the api-gateway. `workflowId` may
   * contain colons (composite ids like
   * `acme:e2e-http-log:sha256:...:id`) — `encodeURIComponent` percent-encodes
   * them for the outgoing request the same way `TrackingChainService`
   * encodes correlation/event ids; Angular's `HttpClient` does not
   * auto-encode template-literal URL segments.
   * @param workflowId  Workflow definition id owning the run.
   * @param runId       Run (execution) id to fetch.
   */
  getRun(workflowId: string, runId: string): Observable<IRunResponse> {
    return this.http.get<IRunResponse>(
      `${TRACKING_RUNS}/${encodeURIComponent(workflowId)}/${encodeURIComponent(runId)}`
    );
  }

  /**
   * Fetches the workflow definition a run belongs to, for the plan-vs-
   * executed merge (T03) and the popup's "workflow definition" peek (T05).
   * Delegates to the existing `WorkflowApiService.get` — no duplicate HTTP
   * call. `version` is accepted for API-shape parity with SPEC.md's
   * `getDefinition(workflowId, version)` but is currently unused: neither
   * `WorkflowApiService` nor workflow-service's `GET /workflows/:id` expose
   * version-scoped lookups today (definitions are mutated in place, not
   * versioned) — this is reported as a finding, not a workaround, should a
   * future task introduce definition versioning.
   * @param workflowId  Workflow definition id.
   * @param version     Reserved for future version-scoped lookups (unused).
   */
  getDefinition(
    workflowId: string,
    version?: string
  ): Observable<IWorkflowDefinitionDto> {
    void version;
    return this.workflowApi.get(workflowId);
  }
}
