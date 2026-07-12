import "@angular/compiler";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { environment } from "../../../environments/environment";
import type { IWorkflowDefinitionDto } from "../../features/automation/workflows/services/workflow-api.service";
import { WorkflowApiService } from "../../features/automation/workflows/services/workflow-api.service";
import { type IRunResponse, RunViewService } from "./run-view.service";

const TRACKING_RUNS_URL = `${environment.apiUrl}/tracking/runs`;
const WORKFLOWS_URL = `${environment.apiUrl}/workflows`;

function makeRunResponse(overrides: Partial<IRunResponse> = {}): IRunResponse {
  return {
    workflow_id: "wf-1",
    run_id: "run-1",
    correlation_id: "corr-1",
    tenant: "tenant-a",
    events: [
      {
        event_id: "evt-1",
        subject: "workflow.action.completed.v1",
        tenant: "tenant-a",
        producer: "workflow-service",
        domain: "workflow",
        kind: "action_completed",
        version: "v1",
        correlation_id: "corr-1",
        causation_id: "evt-0",
        causation_depth: 1,
        occurred_at: "2026-07-11T10:00:00.000Z",
        tech: "temporal",
        business_fn: "workflow-execution",
        rule: 19,
        consumed_by: [],
        is_claim_check: false,
        compliance: "full",
        workflow_id: "wf-1",
        run_id: "run-1",
        connector_id: null,
        cache_status: null,
        has_envelope: true,
        payload_connector_id: "conn-1",
        payload_agent_id: null,
        payload_step_status: "ok",
        payload_execution_id: "exec-1",
        payload_action_index: 0,
        payload_action_type: "endpointCall",
        payload_action_name: "callOrderApi",
        payload_branch: null,
        payload_expression: null,
        payload_evaluated_value: null,
        payload_branch_taken: null,
        payload_cases: null,
      },
    ],
    spans: [
      {
        event_id: "evt-1",
        causation_id: "evt-0",
        kind_prefix: "workflow.action",
        entity_id: "exec-1",
        started_at: "2026-07-11T10:00:00.000Z",
        completed_at: "2026-07-11T10:00:00.500Z",
        duration_ms: 500,
      },
    ],
    summary: {
      status: "completed",
      started_at: "2026-07-11T10:00:00.000Z",
      completed_at: "2026-07-11T10:00:00.500Z",
      total_ms: 500,
      steps_ok: 1,
      steps_failed: 0,
    },
    cast: [{ kind: "connector", id: "conn-1", name: "conn-1", count: 1 }],
    step_detail: true,
    ...overrides,
  };
}

function makeDefinition(
  overrides: Partial<IWorkflowDefinitionDto> = {}
): IWorkflowDefinitionDto {
  return {
    id: "wf-1",
    name: "e2e-http-log",
    application: "acme",
    tenantId: "tenant-a",
    actions: [],
    trigger: null,
    createdAt: "2026-07-11T09:00:00.000Z",
    ...overrides,
  };
}

describe("RunViewService", () => {
  let service: RunViewService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        RunViewService,
        WorkflowApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(RunViewService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock?.verify();
    TestBed.resetTestingModule();
  });

  describe("getRun", () => {
    it("requests the correct URL for a plain workflowId/runId pair", () => {
      service.getRun("wf-1", "run-1").subscribe();

      const req = httpMock.expectOne(`${TRACKING_RUNS_URL}/wf-1/run-1`);
      expect(req.request.method).toBe("GET");
      req.flush(makeRunResponse());
    });

    it("passes through the response shape unchanged, including run-only payload fields", () => {
      let result: IRunResponse | undefined;
      service.getRun("wf-1", "run-1").subscribe((res) => (result = res));

      const req = httpMock.expectOne(`${TRACKING_RUNS_URL}/wf-1/run-1`);
      const response = makeRunResponse();
      req.flush(response);

      expect(result).toEqual(response);
      expect(result?.events[0]?.payload_connector_id).toBe("conn-1");
      expect(result?.events[0]?.payload_execution_id).toBe("exec-1");
      expect(result?.events[0]?.payload_action_index).toBe(0);
      expect(result?.events[0]?.payload_action_type).toBe("endpointCall");
      expect(result?.events[0]?.payload_action_name).toBe("callOrderApi");
      expect(result?.spans[0]?.causation_id).toBe("evt-0");
      expect(result?.summary.status).toBe("completed");
      expect(result?.cast[0]?.kind).toBe("connector");
    });

    it("encodes colons in a composite workflowId (acme:name:sha256:...:id)", () => {
      const workflowId = "acme:e2e-http-log:sha256:deadbeef:id";
      service.getRun(workflowId, "run-1").subscribe();

      const req = httpMock.expectOne(
        `${TRACKING_RUNS_URL}/acme%3Ae2e-http-log%3Asha256%3Adeadbeef%3Aid/run-1`
      );
      expect(req.request.method).toBe("GET");
      req.flush(makeRunResponse({ workflow_id: workflowId }));
    });

    it("encodes special characters in both ids", () => {
      service.getRun("wf/1 x", "run/1 x").subscribe();

      const req = httpMock.expectOne(
        `${TRACKING_RUNS_URL}/wf%2F1%20x/run%2F1%20x`
      );
      expect(req.request.method).toBe("GET");
      req.flush(makeRunResponse());
    });

    it("propagates null tenant and step_detail: false for degraded runs", () => {
      let result: IRunResponse | undefined;
      service.getRun("wf-1", "run-1").subscribe((res) => (result = res));

      const req = httpMock.expectOne(`${TRACKING_RUNS_URL}/wf-1/run-1`);
      req.flush(
        makeRunResponse({
          tenant: null,
          events: [],
          spans: [],
          cast: [],
          step_detail: false,
        })
      );

      expect(result?.tenant).toBeNull();
      expect(result?.step_detail).toBe(false);
    });
  });

  describe("getDefinition", () => {
    it("delegates to WorkflowApiService.get — no duplicate HTTP call is made", () => {
      let result: IWorkflowDefinitionDto | undefined;
      service.getDefinition("wf-1").subscribe((res) => (result = res));

      const req = httpMock.expectOne(`${WORKFLOWS_URL}/wf-1`);
      expect(req.request.method).toBe("GET");
      const definition = makeDefinition();
      req.flush(definition);

      expect(result).toEqual(definition);
    });

    it("accepts an optional version argument without changing the requested URL", () => {
      service.getDefinition("wf-1", "v2").subscribe();

      const req = httpMock.expectOne(`${WORKFLOWS_URL}/wf-1`);
      expect(req.request.method).toBe("GET");
      req.flush(makeDefinition());
    });
  });
});
