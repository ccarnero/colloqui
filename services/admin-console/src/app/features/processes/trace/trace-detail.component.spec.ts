import "@angular/compiler";
import type { HttpErrorResponse } from "@angular/common/http";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap } from "@angular/router";
import { NEVER, of, throwError } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../../../core/services/auth.service";
import type {
  IRunEvent,
  IRunResponse,
} from "../../../core/services/run-view.service";
import { RunViewService } from "../../../core/services/run-view.service";
import {
  type ITrackedEvent,
  type ITrackedEventSpan,
  type ITrackingChainResponse,
  TrackingChainService,
} from "../../../core/services/tracking-chain.service";
import { WorkflowApiService } from "../../automation/workflows/services/workflow-api.service";
import { TraceDetailComponent } from "./trace-detail.component";
import { TraceSelectionService } from "./trace-selection.service";

function runEvent(overrides: Partial<IRunEvent>): IRunEvent {
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
    workflow_id: "acme:order-workflow:abc123",
    run_id: "run-9",
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

function runResponse(overrides: Partial<IRunResponse> = {}): IRunResponse {
  return {
    workflow_id: "acme:order-workflow:abc123",
    run_id: "run-9",
    correlation_id: "corr-1",
    tenant: "acme",
    events: [],
    spans: [],
    summary: {
      status: "completed",
      started_at: "2026-07-11T10:00:00.000Z",
      completed_at: "2026-07-11T10:00:00.500Z",
      total_ms: 500,
      steps_ok: 1,
      steps_failed: 0,
    },
    cast: [],
    step_detail: true,
    ...overrides,
  };
}

function event(overrides: Partial<ITrackedEvent>): ITrackedEvent {
  return {
    event_id: "evt-x",
    subject: "evt.acme.channel-service.messaging.telegram.telegram.received.v1",
    tenant: "acme",
    producer: "channel-service",
    domain: "channel",
    kind: "received",
    version: "v1",
    correlation_id: "corr-1",
    causation_id: null,
    causation_depth: 0,
    occurred_at: "2026-01-01T00:00:00.000Z",
    tech: "telegram",
    business_fn: "channel-processing",
    rule: 3,
    consumed_by: [],
    is_claim_check: false,
    compliance: "full",
    workflow_id: null,
    run_id: null,
    connector_id: null,
    cache_status: null,
    has_envelope: true,
    payload_action_name: null,
    ...overrides,
  };
}

function span(overrides: Partial<ITrackedEventSpan>): ITrackedEventSpan {
  return {
    kind_prefix: "received",
    entity_id: null,
    started_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:00:00.000Z",
    duration_ms: 0,
    ...overrides,
  };
}

const fixtureChain: ITrackingChainResponse = {
  correlation_id: "corr-1",
  tenant: "acme",
  events: [event({ event_id: "evt-1" })],
  spans: [span({})],
  summary: {
    count: 1,
    first_at: "2026-01-01T00:00:00.000Z",
    last_at: "2026-01-01T00:00:00.000Z",
    total_ms: 900,
    orphan_count: 0,
  },
};

describe("TraceDetailComponent", () => {
  let fixture: ComponentFixture<TraceDetailComponent>;
  let getChain: ReturnType<typeof vi.fn>;
  let getEventPayload: ReturnType<typeof vi.fn>;

  function setup(cid = "corr-1"): void {
    fixture = TestBed.createComponent(TraceDetailComponent);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    getChain = vi.fn().mockReturnValue(of(fixtureChain));
    getEventPayload = vi
      .fn()
      .mockReturnValue(
        of({ payload: { foo: "bar" }, payload_status: "inline" })
      );
    await TestBed.configureTestingModule({
      imports: [TraceDetailComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ correlationId: "corr-1" }),
            },
          },
        },
        {
          provide: TrackingChainService,
          useValue: { getChain, getEventPayload },
        },
        { provide: AuthService, useValue: { hasPermission: () => false } },
        // RunViewComponent (embedded by the "Run view" tab) fetches on its
        // own — NEVER keeps it parked in "Loading…" so these tests assert
        // only tab presence/embedding, not RunViewComponent's own behavior
        // (covered by run-view.component.spec.ts).
        {
          provide: RunViewService,
          useValue: { getRun: () => NEVER, getDefinition: () => NEVER },
        },
      ],
    }).compileComponents();
  });

  it("fetches the chain once and defaults to the waterfall view", () => {
    setup();
    const el = fixture.nativeElement as HTMLElement;

    expect(getChain).toHaveBeenCalledTimes(1);
    expect(getChain).toHaveBeenCalledWith("corr-1");
    expect(el.querySelector("app-trace-waterfall")).toBeTruthy();
    expect(el.querySelector("app-causal-graph")).toBeFalsy();
  });

  it("switches to the causal graph view without re-fetching the chain", () => {
    setup();
    const el = fixture.nativeElement as HTMLElement;
    const tabs = Array.from(el.querySelectorAll<HTMLButtonElement>(".td-tab"));
    const causalTab = tabs.find(
      (b) => b.textContent?.trim() === "Causal graph"
    );

    causalTab?.click();
    fixture.detectChanges();

    expect(el.querySelector("app-causal-graph")).toBeTruthy();
    expect(el.querySelector("app-trace-waterfall")).toBeFalsy();
    expect(getChain).toHaveBeenCalledTimes(1);
  });

  it("switches to the legacy tab", () => {
    setup();
    const el = fixture.nativeElement as HTMLElement;
    const tabs = Array.from(el.querySelectorAll<HTMLButtonElement>(".td-tab"));
    const legacyTab = tabs.find((b) => b.textContent?.trim() === "Legacy");

    legacyTab?.click();
    fixture.detectChanges();

    expect(el.querySelector("app-message-trace")).toBeTruthy();
    expect(el.querySelector("app-trace-waterfall")).toBeFalsy();
  });

  it("shows a not-found message on a 404 chain response", () => {
    getChain.mockReturnValue(throwError(() => ({ status: 404 })));
    setup();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain(
      "No tracking chain found for this correlation."
    );
  });

  it("shows a generic error message on other failures", () => {
    getChain.mockReturnValue(throwError(() => ({ status: 500 })));
    setup();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain("Failed to load tracking chain.");
  });

  describe("Run view tab (T06, entry b)", () => {
    it("does NOT show a Run view tab when the chain has no workflow run", () => {
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const tabs = Array.from(
        el.querySelectorAll<HTMLButtonElement>(".td-tab")
      );

      expect(
        tabs.find((b) => b.textContent?.trim() === "Run view")
      ).toBeFalsy();
    });

    it("shows a Run view tab when the chain contains an execution_started event with both ids", () => {
      getChain.mockReturnValue(
        of({
          ...fixtureChain,
          events: [
            ...fixtureChain.events,
            event({
              event_id: "evt-run",
              producer: "workflow-service",
              domain: "workflow",
              kind: "execution_started",
              rule: 19,
              workflow_id: "acme:order-workflow:abc123",
              run_id: "run-9",
            }),
          ],
        })
      );
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const tabs = Array.from(
        el.querySelectorAll<HTMLButtonElement>(".td-tab")
      );
      const runTab = tabs.find((b) => b.textContent?.trim() === "Run view");

      expect(runTab).toBeTruthy();

      runTab?.click();
      fixture.detectChanges();

      const runView = el.querySelector("app-run-view");
      expect(runView).toBeTruthy();
    });

    it("resolves the FIRST run when the chain fans out to multiple workflow runs", () => {
      getChain.mockReturnValue(
        of({
          ...fixtureChain,
          events: [
            ...fixtureChain.events,
            event({
              event_id: "evt-run-a",
              producer: "workflow-service",
              domain: "workflow",
              kind: "execution_started",
              rule: 19,
              workflow_id: "wf-a",
              run_id: "run-a",
            }),
            event({
              event_id: "evt-run-b",
              producer: "workflow-service",
              domain: "workflow",
              kind: "execution_started",
              rule: 19,
              workflow_id: "wf-b",
              run_id: "run-b",
            }),
          ],
        })
      );
      setup();

      expect(fixture.componentInstance.workflowRun()).toEqual({
        workflowId: "wf-a",
        runId: "run-a",
      });
    });
  });

  describe("Tab bar (T02)", () => {
    it("renders the four tabs waterfall/causal/legacy/run, per the ORCHESTRATOR RULING under decision 5(a)", () => {
      getChain.mockReturnValue(
        of({
          ...fixtureChain,
          events: [
            ...fixtureChain.events,
            event({
              event_id: "evt-run",
              producer: "workflow-service",
              domain: "workflow",
              kind: "execution_started",
              rule: 19,
              workflow_id: "acme:order-workflow:abc123",
              run_id: "run-9",
            }),
          ],
        })
      );
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const labels = Array.from(
        el.querySelectorAll<HTMLButtonElement>(".td-tab")
      ).map((b) => b.textContent?.trim());

      expect(labels).toEqual([
        "Waterfall",
        "Causal graph",
        "Legacy",
        "Run view",
      ]);
    });
  });

  describe("Event inspector shell (T02)", () => {
    it("shows the empty state and no close button when nothing is selected", () => {
      setup();
      const el = fixture.nativeElement as HTMLElement;

      expect(el.querySelector(".td-inspector-empty")?.textContent).toContain(
        "Select an event…"
      );
      expect(el.querySelector(".td-inspector-close")).toBeFalsy();
    });

    it("opens (shows the event id + close button) once TraceSelectionService.select() is called", () => {
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const selection = fixture.debugElement.injector.get(
        TraceSelectionService
      );

      selection.select("evt-42", "waterfall");
      fixture.detectChanges();

      expect(el.querySelector(".td-inspector-title")?.textContent).toContain(
        "evt-42"
      );
      expect(el.querySelector(".td-inspector-source")?.textContent).toBe(
        "waterfall"
      );
      expect(el.querySelector(".td-inspector-close")).toBeTruthy();
      expect(el.querySelector(".td-inspector-empty")).toBeFalsy();
    });

    it("closes (back to the empty state) when TraceSelectionService.clear() is called", () => {
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const selection = fixture.debugElement.injector.get(
        TraceSelectionService
      );
      selection.select("evt-42", "waterfall");
      fixture.detectChanges();

      selection.clear();
      fixture.detectChanges();

      expect(el.querySelector(".td-inspector-empty")?.textContent).toContain(
        "Select an event…"
      );
    });

    it("closes on clicking the × button", () => {
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const selection = fixture.debugElement.injector.get(
        TraceSelectionService
      );
      selection.select("evt-42", "waterfall");
      fixture.detectChanges();

      el.querySelector<HTMLButtonElement>(".td-inspector-close")?.click();
      fixture.detectChanges();

      expect(selection.selectedEventId()).toBeNull();
      expect(el.querySelector(".td-inspector-empty")).toBeTruthy();
    });

    it("closes on Esc", () => {
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const selection = fixture.debugElement.injector.get(
        TraceSelectionService
      );
      selection.select("evt-42", "waterfall");
      fixture.detectChanges();

      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      fixture.detectChanges();

      expect(selection.selectedEventId()).toBeNull();
      expect(el.querySelector(".td-inspector-empty")).toBeTruthy();
    });

    it("Esc is a no-op when nothing is selected (no spurious clear/log)", () => {
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const selection = fixture.debugElement.injector.get(
        TraceSelectionService
      );

      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      fixture.detectChanges();

      expect(selection.selectedEventId()).toBeNull();
      expect(el.querySelector(".td-inspector-empty")).toBeTruthy();
    });

    it("selection is provided per trace-screen instance, not shared globally (component-level provider)", () => {
      setup();
      const first = fixture.debugElement.injector.get(TraceSelectionService);

      const secondFixture = TestBed.createComponent(TraceDetailComponent);
      secondFixture.detectChanges();
      const second = secondFixture.debugElement.injector.get(
        TraceSelectionService
      );

      expect(first).not.toBe(second);
    });
  });

  describe("Inspector waterfall-mode content (T03)", () => {
    const barChain: ITrackingChainResponse = {
      correlation_id: "corr-1",
      tenant: "acme",
      events: [
        event({ event_id: "evt-1", causation_depth: 0 }),
        event({
          event_id: "evt-2",
          kind: "execution_started",
          causation_id: "evt-1",
          causation_depth: 1,
          run_id: "run-1",
          business_fn: "workflow-execution",
        }),
      ],
      spans: [
        span({ kind_prefix: "received", entity_id: null }),
        span({
          kind_prefix: "execution",
          entity_id: "run-1",
          duration_ms: 800,
        }),
      ],
      summary: {
        count: 2,
        first_at: "2026-01-01T00:00:00.000Z",
        last_at: "2026-01-01T00:00:00.900Z",
        total_ms: 900,
        orphan_count: 0,
      },
    };

    it("shows base event fields + timing % when a waterfall selection has a matched span", () => {
      getChain.mockReturnValue(of(barChain));
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const selection = fixture.debugElement.injector.get(
        TraceSelectionService
      );

      selection.select("evt-2", "waterfall");
      fixture.detectChanges();

      const timing = el.querySelector(".td-timing-value")?.textContent ?? "";
      expect(timing).toContain("88.9% of total");
      const base = el.querySelector(".td-base")?.textContent ?? "";
      expect(base).toContain("evt-2");
      expect(base).toContain("execution_started");
      expect(base).toContain("evt-1");
      expect(base).toContain("workflow-execution");
    });

    it("shows 'no duration data' instead of a percentage when the waterfall selection has no matched span", () => {
      getChain.mockReturnValue(of(barChain));
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const selection = fixture.debugElement.injector.get(
        TraceSelectionService
      );

      selection.select("evt-1", "waterfall");
      fixture.detectChanges();

      expect(el.querySelector(".td-timing--none")).toBeTruthy();
      expect(el.querySelector(".td-timing-value")?.textContent).toContain(
        "no duration data"
      );
    });

    it("does NOT show waterfall-mode content (timing) for a non-waterfall selection", () => {
      getChain.mockReturnValue(of(barChain));
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const selection = fixture.debugElement.injector.get(
        TraceSelectionService
      );

      selection.select("evt-2", "legacy");
      fixture.detectChanges();

      expect(el.querySelector(".td-timing")).toBeFalsy();
      expect(el.querySelector(".td-base")).toBeFalsy();
      // T06 added the "everywhere" deep-links block — it still renders for
      // an unrecognized/non-mode source view (mode-specific content above
      // stays empty), showing the "no links" fallback since evt-2 carries
      // no workflow_id/run_id pair or connector/agent id.
      expect(el.querySelector(".td-deep-links")).toBeTruthy();
      expect(el.querySelector(".td-muted")?.textContent).toContain(
        "No deep links available"
      );
    });
  });

  describe("Inspector causal-mode content (T04)", () => {
    const causalChain: ITrackingChainResponse = {
      correlation_id: "corr-1",
      tenant: "acme",
      events: [
        event({
          event_id: "evt-a",
          kind: "webhook_received",
          business_fn: "ingress",
          causation_depth: 0,
          occurred_at: "2026-01-01T00:00:00.000Z",
        }),
        event({
          event_id: "evt-b",
          kind: "execution_started",
          causation_id: "evt-a",
          causation_depth: 1,
          business_fn: "workflow-execution",
          occurred_at: "2026-01-01T00:00:00.100Z",
        }),
        event({
          event_id: "evt-orphan",
          kind: "dlq_replayed",
          business_fn: "dlq",
          causation_id: "evt-missing",
          causation_depth: 2,
          tenant: null,
          compliance: "none",
          occurred_at: "2026-01-01T00:00:00.900Z",
        }),
        event({
          event_id: "evt-connector",
          kind: "endpoint_call_completed",
          business_fn: "connector-invocation",
          connector_id: "adapter-9",
          occurred_at: "2026-01-01T00:00:01.000Z",
        }),
        event({
          event_id: "evt-temporal",
          kind: "execution_started",
          business_fn: "workflow-execution",
          workflow_id: "acme:order-workflow:abc123",
          run_id: "run-9",
          occurred_at: "2026-01-01T00:00:01.100Z",
        }),
        event({
          event_id: "evt-half-temporal",
          kind: "execution_started",
          business_fn: "workflow-execution",
          workflow_id: "acme:order-workflow:abc123",
          run_id: null,
          occurred_at: "2026-01-01T00:00:01.200Z",
        }),
      ],
      spans: [span({})],
      summary: {
        count: 6,
        first_at: "2026-01-01T00:00:00.000Z",
        last_at: "2026-01-01T00:00:01.200Z",
        total_ms: 1200,
        orphan_count: 1,
      },
    };

    function selectEvent(eventId: string): {
      el: HTMLElement;
      selection: TraceSelectionService;
    } {
      const el = fixture.nativeElement as HTMLElement;
      const selection = fixture.debugElement.injector.get(
        TraceSelectionService
      );
      selection.select(eventId, "causal");
      fixture.detectChanges();
      return { el, selection };
    }

    it("shows base event fields (same 'everywhere' dl as waterfall-mode), flagging a null-tenant row", () => {
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el } = selectEvent("evt-orphan");

      const base = el.querySelector(".td-base")?.textContent ?? "";
      expect(base).toContain("evt-orphan");
      expect(base).toContain("dlq_replayed");
      expect(base).toContain("evt-missing");
      expect(base).toContain("none");
      expect(base).toContain("null tenant");
    });

    it("renders the linear causal chain root-first, marking the selected entry", () => {
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el } = selectEvent("evt-b");

      const entries = Array.from(el.querySelectorAll(".td-causal-chain-entry"));
      expect(
        entries.map(
          (e) => e.querySelector(".td-causal-chain-kind")?.textContent
        )
      ).toEqual(["webhook_received", "execution_started"]);
      expect(
        entries[1]?.classList.contains("td-causal-chain-entry--current")
      ).toBe(true);
      expect(el.querySelector(".td-causal-chain-orphan")).toBeFalsy();
    });

    it("surfaces the missing-parent id for an orphan event's causal chain", () => {
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el } = selectEvent("evt-orphan");

      expect(
        el.querySelector(".td-causal-chain-orphan")?.textContent
      ).toContain("evt-missing");
      const entries = el.querySelectorAll(".td-causal-chain-entry");
      expect(entries.length).toBe(1);
    });

    it("shows the 'View payload' action when the user has the permission", () => {
      TestBed.overrideProvider(AuthService, {
        useValue: { hasPermission: () => true },
      });
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el } = selectEvent("evt-a");

      expect(el.querySelector(".td-payload-btn")).toBeTruthy();
    });

    it("does NOT show the 'View payload' action without the permission", () => {
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el } = selectEvent("evt-a");

      expect(el.querySelector(".td-payload-btn")).toBeFalsy();
    });

    it("fetches the payload on demand via TrackingChainService.getEventPayload and renders the pretty-printed JSON collapsed by default", () => {
      TestBed.overrideProvider(AuthService, {
        useValue: { hasPermission: () => true },
      });
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el } = selectEvent("evt-a");

      expect(getEventPayload).not.toHaveBeenCalled();
      (el.querySelector(".td-payload-btn") as HTMLElement).click();
      fixture.detectChanges();

      expect(getEventPayload).toHaveBeenCalledWith("corr-1", "evt-a");
      const details = el.querySelector(
        ".td-payload-details"
      ) as HTMLDetailsElement;
      expect(details).toBeTruthy();
      expect(details.open).toBe(false);
      expect(details.textContent).toContain('"foo": "bar"');
      expect(details.textContent).toContain("inline");
    });

    it("shows 'Payload expired' for a 410 scrubbed response", () => {
      TestBed.overrideProvider(AuthService, {
        useValue: { hasPermission: () => true },
      });
      getEventPayload.mockReturnValue(
        throwError(
          () =>
            ({ status: 410, error: { error: "scrubbed" } }) as HttpErrorResponse
        )
      );
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el } = selectEvent("evt-a");

      (el.querySelector(".td-payload-btn") as HTMLElement).click();
      fixture.detectChanges();

      expect(el.querySelector(".td-payload-status")?.textContent).toContain(
        "Payload expired (30-day retention)"
      );
    });

    it("shows a claim-check message for a 404 unresolved response", () => {
      TestBed.overrideProvider(AuthService, {
        useValue: { hasPermission: () => true },
      });
      getEventPayload.mockReturnValue(
        throwError(
          () =>
            ({
              status: 404,
              error: {
                error:
                  "payload capture failed to resolve for event evt-a (payload_status=unresolved — claim-check expired or cache unreachable)",
              },
            }) as HttpErrorResponse
        )
      );
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el } = selectEvent("evt-a");

      (el.querySelector(".td-payload-btn") as HTMLElement).click();
      fixture.detectChanges();

      expect(el.querySelector(".td-payload-status")?.textContent).toContain(
        "Payload was not captured (claim-check expired)"
      );
    });

    it("shows a generic not-captured message for a 404 none response", () => {
      TestBed.overrideProvider(AuthService, {
        useValue: { hasPermission: () => true },
      });
      getEventPayload.mockReturnValue(
        throwError(
          () =>
            ({
              status: 404,
              error: {
                error:
                  "payload was never captured for event evt-a (payload_status=none)",
              },
            }) as HttpErrorResponse
        )
      );
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el } = selectEvent("evt-a");

      (el.querySelector(".td-payload-btn") as HTMLElement).click();
      fixture.detectChanges();

      expect(el.querySelector(".td-payload-status")?.textContent).toContain(
        "Payload was not captured"
      );
    });

    it("shows a generic error message for other failures", () => {
      TestBed.overrideProvider(AuthService, {
        useValue: { hasPermission: () => true },
      });
      getEventPayload.mockReturnValue(
        throwError(
          () => ({ status: 500, error: { error: "boom" } }) as HttpErrorResponse
        )
      );
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el } = selectEvent("evt-a");

      (el.querySelector(".td-payload-btn") as HTMLElement).click();
      fixture.detectChanges();

      expect(el.querySelector(".td-payload-status")?.textContent).toContain(
        "Failed to load payload."
      );
    });

    it("resets the payload state when the selection changes", () => {
      TestBed.overrideProvider(AuthService, {
        useValue: { hasPermission: () => true },
      });
      getEventPayload.mockReturnValue(NEVER); // stays "loading" so the reset is observable
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el, selection } = selectEvent("evt-a");

      (el.querySelector(".td-payload-btn") as HTMLElement).click();
      fixture.detectChanges();
      expect(el.querySelector(".td-payload-status")?.textContent).toContain(
        "Loading"
      );

      selection.select("evt-b", "causal");
      fixture.detectChanges();

      expect(el.querySelector(".td-payload-status")).toBeFalsy();
      expect(el.querySelector(".td-payload-details")).toBeFalsy();
    });

    it("renders the 'Open connector' deep link for a resolvable event, and none for one that doesn't resolve", () => {
      getChain.mockReturnValue(of(causalChain));
      setup();

      const connector = selectEvent("evt-connector");
      expect(
        connector.el.querySelector(".td-deep-link-btn")?.textContent?.trim()
      ).toBe("Open connector");

      const noLink = selectEvent("evt-a");
      expect(noLink.el.querySelector(".td-deep-link-btn")).toBeFalsy();
    });
  });

  describe("Inspector deep links (T06)", () => {
    const causalChain: ITrackingChainResponse = {
      correlation_id: "corr-1",
      tenant: "acme",
      events: [
        event({
          event_id: "evt-a",
          kind: "webhook_received",
          business_fn: "ingress",
          causation_depth: 0,
        }),
        event({
          event_id: "evt-connector",
          kind: "endpoint_call_completed",
          business_fn: "connector-invocation",
          connector_id: "adapter-9",
        }),
        event({
          event_id: "evt-temporal",
          kind: "execution_started",
          business_fn: "workflow-execution",
          workflow_id: "acme:order-workflow:abc123",
          run_id: "run-9",
        }),
        event({
          event_id: "evt-half-temporal",
          kind: "execution_started",
          business_fn: "workflow-execution",
          workflow_id: "acme:order-workflow:abc123",
          run_id: null,
        }),
      ],
      spans: [span({})],
      summary: {
        count: 4,
        first_at: "2026-01-01T00:00:00.000Z",
        last_at: "2026-01-01T00:00:01.200Z",
        total_ms: 1200,
        orphan_count: 0,
      },
    };

    function selectEvent(eventId: string): {
      el: HTMLElement;
      selection: TraceSelectionService;
    } {
      const el = fixture.nativeElement as HTMLElement;
      const selection = fixture.debugElement.injector.get(
        TraceSelectionService
      );
      selection.select(eventId, "causal");
      fixture.detectChanges();
      return { el, selection };
    }

    it("renders 'Open in Temporal' with the same URL shape as the legacy tab, for an event carrying workflow_id/run_id", () => {
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el } = selectEvent("evt-temporal");

      const link = el.querySelector(
        ".td-deep-links a[href]"
      ) as HTMLAnchorElement | null;
      expect(link?.textContent?.trim()).toBe("Open in Temporal");
      expect(link?.getAttribute("href")).toBe(
        "http://localhost:8233/namespaces/default/workflows/acme%3Aorder-workflow%3Aabc123"
      );
      expect(link?.getAttribute("target")).toBe("_blank");
    });

    it("hides the Temporal link when the event carries only ONE of workflow_id/run_id (T01 finding 4: the pair is only populated together)", () => {
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el } = selectEvent("evt-half-temporal");

      const links = Array.from(
        el.querySelectorAll(".td-deep-links a")
      ) as HTMLAnchorElement[];
      expect(
        links.some((a) => a.textContent?.trim() === "Open in Temporal")
      ).toBe(false);
    });

    it("logs a console.debug when the Temporal link is hidden due to missing ids", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      getChain.mockReturnValue(of(causalChain));
      setup();
      selectEvent("evt-a");

      expect(debugSpy).toHaveBeenCalledWith(
        "[TraceDetailComponent] Temporal deep link hidden — event is missing workflow_id/run_id",
        expect.objectContaining({ eventId: "evt-a" })
      );
      debugSpy.mockRestore();
    });

    it("hides the Temporal link when no event is selected (nothing rendered, no crash)", () => {
      getChain.mockReturnValue(of(causalChain));
      setup();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector(".td-deep-links")).toBeFalsy();
    });

    it("never renders a builder link — resolveBuilderDeepLink is unconditionally null today (no id bridge, T01 finding 4)", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      getChain.mockReturnValue(of(causalChain));
      setup();
      const { el } = selectEvent("evt-temporal");

      const links = Array.from(
        el.querySelectorAll(".td-deep-link-btn")
      ) as HTMLAnchorElement[];
      expect(links.map((a) => a.textContent?.trim())).not.toContain(
        "Open in builder"
      );
      expect(debugSpy).toHaveBeenCalledWith(
        "[TraceDetailComponent] Builder deep link hidden — no trace-event -> builder-node id bridge exists (T01 finding 4)",
        expect.objectContaining({ eventId: "evt-temporal" })
      );
      debugSpy.mockRestore();
    });

    it("never produces a deep-link href/routerLink containing the literal 'undefined' or 'null'", () => {
      getChain.mockReturnValue(of(causalChain));
      setup();

      for (const id of [
        "evt-a",
        "evt-connector",
        "evt-temporal",
        "evt-half-temporal",
      ]) {
        const { el } = selectEvent(id);
        const anchors = Array.from(
          el.querySelectorAll(".td-deep-links a")
        ) as HTMLAnchorElement[];
        for (const a of anchors) {
          expect(a.getAttribute("href") ?? "").not.toContain("undefined");
          expect(a.getAttribute("href") ?? "").not.toContain("null");
        }
      }
    });

    it("shows both an entity link and a Temporal link when the event resolves to both (no mutual exclusion)", () => {
      const bothChain: ITrackingChainResponse = {
        ...causalChain,
        events: [
          ...causalChain.events,
          event({
            event_id: "evt-both",
            kind: "endpoint_call_completed",
            business_fn: "connector-invocation",
            connector_id: "adapter-42",
            workflow_id: "acme:order-workflow:abc123",
            run_id: "run-9",
          }),
        ],
      };
      getChain.mockReturnValue(of(bothChain));
      setup();
      const { el } = selectEvent("evt-both");

      const labels = Array.from(el.querySelectorAll(".td-deep-link-btn")).map(
        (a) => a.textContent?.trim()
      );
      expect(labels).toContain("Open in Temporal");
      expect(labels).toContain("Open connector");
    });
  });

  describe("Step log panel (T04)", () => {
    it("embeds the step log inside the run tab, fed by the already-loaded chain", () => {
      getChain.mockReturnValue(
        of({
          ...fixtureChain,
          events: [
            ...fixtureChain.events,
            event({
              event_id: "evt-run",
              producer: "workflow-service",
              domain: "workflow",
              kind: "execution_started",
              rule: 19,
              workflow_id: "acme:order-workflow:abc123",
              run_id: "run-9",
            }),
          ],
        })
      );
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const tabs = Array.from(
        el.querySelectorAll<HTMLButtonElement>(".td-tab")
      );
      const runTab = tabs.find((b) => b.textContent?.trim() === "Run view");

      runTab?.click();
      fixture.detectChanges();

      expect(el.querySelector("app-step-log")).toBeTruthy();
      // Same chain fetch as the other tabs — no new fetch for the step log.
      expect(getChain).toHaveBeenCalledTimes(1);
    });
  });

  describe("Run canvas selection + run-mode inspector content (T05)", () => {
    // A run whose chain (fetched via TrackingChainService) ALSO carries the
    // run's own action_started/completed events by the SAME event_id —
    // mirrors a real correlation chain, which includes every tracked event
    // for that correlation, workflow-execution ones included (T01 finding:
    // the chain and the run endpoint are separately fetched but overlap on
    // the same underlying tracked events). This lets `selectedEvent()`
    // (chain-sourced) resolve the base dl fields for a run-tab selection.
    const runChain: ITrackingChainResponse = {
      ...fixtureChain,
      events: [
        ...fixtureChain.events,
        event({
          event_id: "evt-execution-started",
          producer: "workflow-service",
          domain: "workflow",
          kind: "execution_started",
          rule: 19,
          workflow_id: "acme:order-workflow:abc123",
          run_id: "run-9",
        }),
        event({
          event_id: "evt-step-started",
          producer: "workflow-service",
          domain: "workflow",
          kind: "action_started",
          rule: 19,
        }),
        event({
          event_id: "evt-step-completed",
          producer: "workflow-service",
          domain: "workflow",
          kind: "action_completed",
          rule: 19,
        }),
      ],
    };

    const linearRun = runResponse({
      events: [
        runEvent({
          event_id: "evt-step-started",
          kind: "action_started",
          payload_action_index: 0,
          payload_action_type: "endpointCall",
          payload_action_name: "callOrderApi",
          payload_connector_id: "order-api",
        }),
        runEvent({
          event_id: "evt-step-completed",
          kind: "action_completed",
          payload_action_index: 0,
          payload_action_type: "endpointCall",
          payload_action_name: "callOrderApi",
          payload_connector_id: "order-api",
          payload_step_status: "ok",
        }),
      ],
      cast: [
        { kind: "connector", id: "order-api", name: "Order API", count: 1 },
      ],
    });

    function setupRunTab(): {
      readonly el: HTMLElement;
      readonly selection: TraceSelectionService;
    } {
      TestBed.overrideProvider(RunViewService, {
        useValue: {
          getRun: () => of(linearRun),
          getDefinition: () => NEVER,
        },
      });
      // No definitionId is passed to `<app-run-view>` on the trace "run"
      // tab (T06 finding fix) — RunViewComponent resolves the definition
      // by NAME via `WorkflowApiService.list()`. Zero matches -> the
      // documented events-only-spine fallback (`run-view.component.ts`),
      // which still produces one clickable node per executed step.
      TestBed.overrideProvider(WorkflowApiService, {
        useValue: { list: () => of([]) },
      });
      getChain.mockReturnValue(of(runChain));
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const tabs = Array.from(
        el.querySelectorAll<HTMLButtonElement>(".td-tab")
      );
      const runTab = tabs.find((b) => b.textContent?.trim() === "Run view");
      runTab?.click();
      fixture.detectChanges();
      const selection = fixture.debugElement.injector.get(
        TraceSelectionService
      );
      return { el, selection };
    }

    it("node click -> shared TraceSelectionService, sourced as 'run', preferring the COMPLETED event", () => {
      const { el, selection } = setupRunTab();
      const node = el.querySelector<HTMLElement>(
        '.rv-node[data-kind="action"]'
      );
      expect(node).toBeTruthy();

      node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      fixture.detectChanges();

      expect(selection.selectedEventId()).toBe("evt-step-completed");
      expect(selection.sourceView()).toBe("run");
    });

    it("does NOT open the run-view's own popup in trace-hosted mode (decision 2: popup REPLACED by inspector selection)", () => {
      const { el } = setupRunTab();
      const node = el.querySelector<HTMLElement>(
        '.rv-node[data-kind="action"]'
      );

      node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      fixture.detectChanges();

      expect(el.querySelector("app-run-view-popup")).toBeFalsy();
    });

    it("highlights the clicked node with .rv-node-trace-selected, driven purely by the shared service", () => {
      const { el } = setupRunTab();
      const node = el.querySelector<HTMLElement>(
        '.rv-node[data-kind="action"]'
      );

      expect(node?.classList.contains("rv-node-trace-selected")).toBe(false);
      node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      fixture.detectChanges();

      expect(node?.classList.contains("rv-node-trace-selected")).toBe(true);
    });

    it("selecting the mapped event from ANOTHER view (service-driven) also highlights the run node (sync back INTO the canvas)", () => {
      const { el, selection } = setupRunTab();
      const node = el.querySelector<HTMLElement>(
        '.rv-node[data-kind="action"]'
      );
      expect(node?.classList.contains("rv-node-trace-selected")).toBe(false);

      selection.select("evt-step-completed", "run");
      fixture.detectChanges();

      expect(node?.classList.contains("rv-node-trace-selected")).toBe(true);
    });

    it("shows base fields + a Step result block (name/kind/status/duration/instance) for the run-tab selection", () => {
      const { el, selection } = setupRunTab();

      selection.select("evt-step-completed", "run");
      fixture.detectChanges();

      const body = el.querySelector(".td-inspector-body") as HTMLElement;
      expect(body.querySelector(".td-base")).toBeTruthy();
      expect(body.textContent).toContain("evt-step-completed");

      const stepResult = body.querySelector(".td-step-result") as HTMLElement;
      expect(stepResult).toBeTruthy();
      expect(stepResult.textContent).toContain("callOrderApi");
      expect(stepResult.textContent).toContain("endpointCall");
      expect(stepResult.textContent).toContain("ok");
      expect(stepResult.textContent).toContain("order-api");
    });

    it("shows the base dl but NO Step result block when the run-sourced selection is not one of this run's own mapped events", () => {
      const { el, selection } = setupRunTab();

      // "evt-1" exists on the chain (fixtureChain's own event) but is not
      // one of linearRun's action events — resolveSelectedStepResult
      // returns null, the inspector shows the graceful fallback message
      // rather than inventing a step result.
      selection.select("evt-1", "run");
      fixture.detectChanges();

      const body = el.querySelector(".td-inspector-body") as HTMLElement;
      expect(body.querySelector(".td-base")).toBeTruthy();
      expect(body.querySelector(".td-step-result")).toBeFalsy();
      expect(body.textContent).toContain("No step result available");
    });

    it("T06: resolves the entity deep link via the run's OWN payload_connector_id (the chain-level ITrackedEvent.connector_id is null for run steps)", () => {
      const { el, selection } = setupRunTab();

      selection.select("evt-step-completed", "run");
      fixture.detectChanges();

      const link = el.querySelector(".td-deep-link-btn") as HTMLAnchorElement;
      expect(link?.textContent?.trim()).toBe("Open connector");
    });

    it("T06: hides the Temporal link for a run-tab step selection (the step's OWN chain event carries no workflow_id/run_id)", () => {
      const { el, selection } = setupRunTab();

      selection.select("evt-step-completed", "run");
      fixture.detectChanges();

      const labels = Array.from(el.querySelectorAll(".td-deep-link-btn")).map(
        (a) => a.textContent?.trim()
      );
      expect(labels).not.toContain("Open in Temporal");
    });

    it("T06: no entity link for a run-tab selection outside this run's own mapped step events", () => {
      const { el, selection } = setupRunTab();

      selection.select("evt-1", "run");
      fixture.detectChanges();

      expect(el.querySelector(".td-deep-link-btn")).toBeFalsy();
      expect(
        el.querySelector(".td-deep-links .td-muted")?.textContent
      ).toContain("No deep links available");
    });
  });
});
