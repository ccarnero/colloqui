import "@angular/compiler";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap } from "@angular/router";
import { NEVER, of, throwError } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../../../core/services/auth.service";
import { RunViewService } from "../../../core/services/run-view.service";
import {
  type ITrackedEvent,
  type ITrackedEventSpan,
  type ITrackingChainResponse,
  TrackingChainService,
} from "../../../core/services/tracking-chain.service";
import { TraceDetailComponent } from "./trace-detail.component";
import { TraceSelectionService } from "./trace-selection.service";

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

  function setup(cid = "corr-1"): void {
    fixture = TestBed.createComponent(TraceDetailComponent);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    getChain = vi.fn().mockReturnValue(of(fixtureChain));
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
        { provide: TrackingChainService, useValue: { getChain } },
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

    it("does NOT show waterfall-mode content (base fields/timing) for a non-waterfall selection", () => {
      getChain.mockReturnValue(of(barChain));
      setup();
      const el = fixture.nativeElement as HTMLElement;
      const selection = fixture.debugElement.injector.get(
        TraceSelectionService
      );

      selection.select("evt-2", "causal");
      fixture.detectChanges();

      expect(el.querySelector(".td-timing")).toBeFalsy();
      expect(el.querySelector(".td-base")).toBeFalsy();
      expect(el.querySelector(".td-muted")?.textContent).toContain("T04-T06");
    });
  });
});
