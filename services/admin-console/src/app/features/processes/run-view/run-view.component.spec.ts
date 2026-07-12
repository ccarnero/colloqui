import "@angular/compiler";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { beforeEach, describe, expect, it } from "vitest";
import { environment } from "../../../../environments/environment";
import { AuthService } from "../../../core/services/auth.service";
import type {
  IRunEvent,
  IRunResponse,
  IRunSpan,
} from "../../../core/services/run-view.service";
import { RunViewService } from "../../../core/services/run-view.service";
import type { IWorkflowDefinitionDto } from "../../automation/workflows/services/workflow-api.service";
import { WorkflowApiService } from "../../automation/workflows/services/workflow-api.service";
import type { ILayoutNode } from "./domain/run-view.model";
import { RunViewComponent } from "./run-view.component";

const TRACKING_RUNS_URL = `${environment.apiUrl}/tracking/runs`;
const WORKFLOWS_URL = `${environment.apiUrl}/workflows`;

function event(overrides: Partial<IRunEvent>): IRunEvent {
  return {
    event_id: "evt-x",
    subject: "workflow.action.started.v1",
    tenant: "acme",
    producer: "workflow-service",
    domain: "workflow",
    kind: "action_started",
    version: "v1",
    correlation_id: "corr-1",
    causation_id: null,
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
    payload_connector_id: null,
    payload_agent_id: null,
    payload_step_status: null,
    payload_execution_id: "exec-1",
    payload_action_index: null,
    payload_action_type: null,
    payload_action_name: null,
    payload_branch: null,
    payload_expression: null,
    payload_evaluated_value: null,
    payload_branch_taken: null,
    payload_cases: null,
    ...overrides,
  };
}

function span(overrides: Partial<IRunSpan>): IRunSpan {
  return {
    event_id: "evt-x",
    causation_id: null,
    kind_prefix: "workflow.action",
    entity_id: "exec-1",
    started_at: "2026-07-11T10:00:00.000Z",
    completed_at: "2026-07-11T10:00:00.100Z",
    duration_ms: 100,
    ...overrides,
  };
}

function definition(
  actions: unknown[],
  overrides: Partial<IWorkflowDefinitionDto> = {}
): IWorkflowDefinitionDto {
  return {
    id: "wf-1",
    name: "order-workflow",
    application: "acme",
    tenantId: "tenant-a",
    actions,
    trigger: null,
    createdAt: "2026-07-11T09:00:00.000Z",
    ...overrides,
  };
}

function runResponse(overrides: Partial<IRunResponse> = {}): IRunResponse {
  return {
    workflow_id: "wf-1",
    run_id: "run-1",
    correlation_id: "corr-1",
    tenant: "acme",
    events: [],
    spans: [],
    summary: {
      status: "completed",
      started_at: "2026-07-11T10:00:00.000Z",
      completed_at: "2026-07-11T10:00:00.500Z",
      total_ms: 500,
      steps_ok: 0,
      steps_failed: 0,
    },
    cast: [],
    step_detail: true,
    ...overrides,
  };
}

describe("RunViewComponent", () => {
  let fixture: ComponentFixture<RunViewComponent>;
  let httpMock: HttpTestingController;

  function setup(definitionId?: string): void {
    TestBed.configureTestingModule({
      imports: [RunViewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        WorkflowApiService,
        RunViewService,
        // T05's popup (hosted by RunViewComponent) injects AuthService to
        // gate its payload viewer — same mock precedent
        // `causal-graph.component.spec.ts` uses (real `AuthService` needs
        // `localStorage`, unavailable in this suite's jsdom setup).
        { provide: AuthService, useValue: { hasPermission: () => true } },
      ],
    });
    fixture = TestBed.createComponent(RunViewComponent);
    fixture.componentRef.setInput("workflowId", "wf-1");
    fixture.componentRef.setInput("runId", "run-1");
    // T06 finding fix: `workflowId` is the TEMPORAL id — `getDefinition`
    // must be called with the DEFINITION id instead, passed explicitly via
    // this input (see RunViewComponent's `definitionId` doc). Tests default
    // to the same string as `workflowId` purely to keep existing fixtures'
    // `${WORKFLOWS_URL}/wf-1` expectation unchanged; a dedicated test below
    // proves the two ids are NOT the same lookup.
    fixture.componentRef.setInput("definitionId", definitionId ?? "wf-1");
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  }

  function flush(run: IRunResponse, def: IWorkflowDefinitionDto): void {
    httpMock.expectOne(`${TRACKING_RUNS_URL}/wf-1/run-1`).flush(run);
    httpMock.expectOne(`${WORKFLOWS_URL}/wf-1`).flush(def);
    fixture.detectChanges();
  }

  it("shows a loading status before the run resolves", () => {
    setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="status"]')?.textContent).toContain(
      "Loading run"
    );
  });

  it("shows an error status when the run fetch fails", () => {
    setup();
    httpMock
      .expectOne(`${TRACKING_RUNS_URL}/wf-1/run-1`)
      .flush("boom", { status: 500, statusText: "Server Error" });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      "Failed to load run"
    );
  });

  it("falls back workflowName() to the raw workflow id before the definition loads", () => {
    setup();
    expect(fixture.componentInstance.workflowName()).toBe("wf-1");
  });

  it("fetches the definition by the DEFINITION id, not the Temporal workflowId (T06 finding fix)", () => {
    TestBed.configureTestingModule({
      imports: [RunViewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        WorkflowApiService,
        RunViewService,
        { provide: AuthService, useValue: { hasPermission: () => true } },
      ],
    });
    fixture = TestBed.createComponent(RunViewComponent);
    // A composite Temporal id distinct from the definition id — reproduces
    // production ids like `{tenantId}:{name}:{nanoid}`.
    fixture.componentRef.setInput("workflowId", "acme:order-workflow:abc123");
    fixture.componentRef.setInput("runId", "run-1");
    fixture.componentRef.setInput("definitionId", "def-42");
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    httpMock
      .expectOne(`${TRACKING_RUNS_URL}/acme%3Aorder-workflow%3Aabc123/run-1`)
      .flush(runResponse({ workflow_id: "acme:order-workflow:abc123" }));
    fixture.detectChanges();

    // Only `def-42` should be requested — never the Temporal id.
    httpMock.expectOne(`${WORKFLOWS_URL}/def-42`).flush(definition([]));
    fixture.detectChanges();

    expect(
      httpMock.match(`${WORKFLOWS_URL}/acme%3Aorder-workflow%3Aabc123`)
    ).toHaveLength(0);
  });

  it("skips the definition fetch entirely when no definitionId is provided, degrading gracefully", () => {
    TestBed.configureTestingModule({
      imports: [RunViewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        WorkflowApiService,
        RunViewService,
        { provide: AuthService, useValue: { hasPermission: () => true } },
      ],
    });
    fixture = TestBed.createComponent(RunViewComponent);
    fixture.componentRef.setInput("workflowId", "wf-1");
    fixture.componentRef.setInput("runId", "run-1");
    // `definitionId` left unset — e.g. the trace "Run view" tab entry,
    // which only has Temporal ids from the chain.
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    httpMock.expectOne(`${TRACKING_RUNS_URL}/wf-1/run-1`).flush(runResponse());
    fixture.detectChanges();

    // No 404 spam: no request to WorkflowApiService at all.
    httpMock.verify();

    const el = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.workflowName()).toBe("wf-1");
    // Loaded, not stuck loading/errored — the empty-events fixture still
    // triggers the (unrelated) degraded-banner path since it has no
    // executed step events, but no alert/error state from the skipped
    // definition fetch.
    expect(el.querySelector('[role="alert"]')).toBeFalsy();
    expect(el.textContent).toContain("wf-1");
  });

  describe("linear run", () => {
    const linearDefinition = definition([
      { activity: "endpointCall", name: "callOrderApi" },
      { activity: "agentCall", name: "summarize" },
    ]);

    const linearRun = runResponse({
      events: [
        event({
          event_id: "evt-1",
          kind: "action_started",
          payload_action_index: 0,
          payload_action_type: "endpointCall",
          payload_connector_id: "order-api",
        }),
        event({
          event_id: "evt-2",
          kind: "action_completed",
          payload_action_index: 0,
          payload_action_type: "endpointCall",
          payload_connector_id: "order-api",
          payload_step_status: "ok",
        }),
        event({
          event_id: "evt-3",
          kind: "action_started",
          payload_action_index: 1,
          payload_action_type: "agentCall",
          payload_agent_id: "agent-1",
        }),
        event({
          event_id: "evt-4",
          kind: "action_completed",
          payload_action_index: 1,
          payload_action_type: "agentCall",
          payload_agent_id: "agent-1",
          payload_step_status: "ok",
        }),
      ],
      spans: [
        span({ event_id: "evt-1", duration_ms: 120 }),
        span({ event_id: "evt-3", duration_ms: 200 }),
      ],
      summary: {
        status: "completed",
        started_at: "2026-07-11T10:00:00.000Z",
        completed_at: "2026-07-11T10:00:00.500Z",
        total_ms: 500,
        steps_ok: 2,
        steps_failed: 0,
      },
      cast: [
        { kind: "connector", id: "order-api", name: "Order API", count: 1 },
        { kind: "agent", id: "agent-1", name: "Summarizer", count: 1 },
      ],
    });

    beforeEach(() => {
      setup();
      flush(linearRun, linearDefinition);
    });

    it("renders header chips: workflow name, run id, status, duration, correlation link", () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("order-workflow");
      expect(el.textContent).toContain("run-1");
      expect(el.textContent).toContain("completed · 2/2 · 0 not executed");
      expect(el.textContent).toContain("500 ms");
      const link = el.querySelector('a[href*="processes/trace"]');
      expect(link?.textContent).toContain("corr-1");
    });

    it("renders one cast chip per instance with kind and count", () => {
      const el = fixture.nativeElement as HTMLElement;
      const chips = el.querySelectorAll(".rv-cast-chip");
      expect(chips.length).toBe(2);
      expect(chips[0]?.textContent).toContain("Order API");
      expect(chips[0]?.textContent).toContain("×1");
    });

    it("renders one node per executed step and one linear edge between them", () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll(".rv-node").length).toBe(2);
      const edges = el.querySelectorAll(".rv-edge");
      expect(edges.length).toBe(1);
      expect(el.querySelector(".rv-edge-dashed")).toBeFalsy();
    });

    it("does not show the degraded banner for a run with step events", () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector(".rv-degraded-banner")).toBeFalsy();
    });

    it("toggles node highlight when its cast chip is clicked, and clears it on a second click", () => {
      const el = fixture.nativeElement as HTMLElement;
      const chip = el.querySelectorAll(".rv-cast-chip")[0] as HTMLElement;

      expect(el.querySelectorAll(".rv-node-highlighted").length).toBe(0);

      chip.click();
      fixture.detectChanges();
      expect(el.querySelectorAll(".rv-node-highlighted").length).toBe(1);

      chip.click();
      fixture.detectChanges();
      expect(el.querySelectorAll(".rv-node-highlighted").length).toBe(0);
    });

    it("emits the clicked layout node via nodeSelected", () => {
      let emitted: ILayoutNode | undefined;
      fixture.componentInstance.nodeSelected.subscribe((n) => (emitted = n));

      const el = fixture.nativeElement as HTMLElement;
      (el.querySelector(".rv-node") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      fixture.detectChanges();

      expect(emitted).toBeTruthy();
      expect(emitted?.kind).toBe("action");
    });
  });

  describe("3-case condition", () => {
    const conditionalDefinition = definition([
      {
        activity: "conditional",
        name: "checkTotal",
        branches: [
          {
            label: "<100",
            condition: {
              variable: "{{total}}",
              comparator: "lt",
              value: "100",
            },
            actions: [{ activity: "channelSend", name: "notifyLow" }],
          },
          {
            label: "100-500",
            condition: {
              variable: "{{total}}",
              comparator: "between",
              value: "100-500",
            },
            actions: [{ activity: "channelSend", name: "notify" }],
          },
          {
            label: ">500",
            condition: {
              variable: "{{total}}",
              comparator: "gt",
              value: "500",
            },
            actions: [{ activity: "channelSend", name: "notifyHigh" }],
          },
        ],
      },
    ]);

    const conditionalRun = runResponse({
      events: [
        event({
          event_id: "evt-1",
          kind: "condition_evaluated",
          payload_action_index: 0,
          payload_expression: "{{total}}",
          payload_evaluated_value: "320",
          payload_branch_taken: "100-500",
          payload_cases: ["<100", "100-500", ">500"],
        }),
        event({
          event_id: "evt-2",
          kind: "action_started",
          payload_action_index: 0,
          payload_branch: "100-500",
          payload_action_type: "channelSend",
        }),
        event({
          event_id: "evt-3",
          kind: "action_completed",
          payload_action_index: 0,
          payload_branch: "100-500",
          payload_action_type: "channelSend",
          payload_step_status: "ok",
        }),
      ],
      summary: {
        status: "completed",
        started_at: "2026-07-11T10:00:00.000Z",
        completed_at: "2026-07-11T10:00:00.200Z",
        total_ms: 200,
        steps_ok: 1,
        steps_failed: 0,
      },
      cast: [{ kind: "channel", id: "telegram", name: "Telegram", count: 1 }],
    });

    beforeEach(() => {
      setup();
      flush(conditionalRun, conditionalDefinition);
    });

    it("renders the amber decision node with the evaluated chip", () => {
      const el = fixture.nativeElement as HTMLElement;
      const decision = el.querySelector('.rv-node[data-color="decision"]');
      expect(decision).toBeTruthy();
      expect(decision?.textContent).toContain(
        'evaluated: 320 → case "100-500" ✓'
      );
    });

    it("renders the not-taken branches dashed, labeled not executed", () => {
      const el = fixture.nativeElement as HTMLElement;
      const dashedEdges = el.querySelectorAll(".rv-edge-dashed");
      // two not-taken branches (<100, >500)
      expect(dashedEdges.length).toBeGreaterThanOrEqual(2);
      expect(el.textContent).toContain("not executed");
    });

    it("shows the entry/channel header chip from the channel cast entry", () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("Telegram");
    });
  });

  describe("degraded run (no step events)", () => {
    const degradedDefinition = definition([
      { activity: "endpointCall", name: "callOrderApi" },
    ]);
    const degradedRun = runResponse({ events: [], spans: [], cast: [] });

    beforeEach(() => {
      setup();
      flush(degradedRun, degradedDefinition);
    });

    it("shows the degraded banner", () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector(".rv-degraded-banner")?.textContent).toContain(
        "Step detail unavailable for this run"
      );
    });

    it("still renders the definition-only spine, dashed", () => {
      const el = fixture.nativeElement as HTMLElement;
      const nodes = el.querySelectorAll(".rv-node");
      expect(nodes.length).toBe(1);
      expect(el.querySelector(".rv-node-dashed")).toBeTruthy();
    });
  });
});
