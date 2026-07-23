import "@angular/compiler";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ITrackedEvent,
  ITrackedEventSpan,
  ITrackingChainResponse,
} from "../../../../core/services/tracking-chain.service";
import { TraceSelectionService } from "../trace-selection.service";
import { TraceWaterfallComponent } from "./trace-waterfall.component";

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

const evt1 = event({
  event_id: "evt-1",
  kind: "webhook_received",
  business_fn: "ingress",
  causation_depth: 0,
  occurred_at: "2026-01-01T00:00:00.000Z",
});
const evt2 = event({
  event_id: "evt-2",
  kind: "execution_started",
  business_fn: "workflow-execution",
  causation_depth: 1,
  causation_id: "evt-1",
  run_id: "run-1",
  occurred_at: "2026-01-01T00:00:00.100Z",
});

const fixtureChain: ITrackingChainResponse = {
  correlation_id: "corr-1",
  tenant: "acme",
  events: [evt1, evt2],
  spans: [
    span({ kind_prefix: "webhook_received", entity_id: null }),
    span({ kind_prefix: "execution", entity_id: "run-1", duration_ms: 800 }),
  ],
  summary: {
    count: 2,
    first_at: "2026-01-01T00:00:00.000Z",
    last_at: "2026-01-01T00:00:00.900Z",
    total_ms: 900,
    orphan_count: 0,
  },
};

describe("TraceWaterfallComponent", () => {
  let fixture: ComponentFixture<TraceWaterfallComponent>;
  let selection: TraceSelectionService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TraceWaterfallComponent],
      // Component-provided at the ancestor TraceDetailComponent in the real
      // app (see TraceSelectionService's header comment); the test provides
      // its own instance at the module level so DI resolves it here too.
      providers: [TraceSelectionService],
    }).compileComponents();
    fixture = TestBed.createComponent(TraceWaterfallComponent);
    fixture.componentRef.setInput("chain", fixtureChain);
    selection = TestBed.inject(TraceSelectionService);
    fixture.detectChanges();
  });

  it("renders header chips with correlation id and total duration", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("corr-1");
    expect(el.textContent).toContain("900 ms");
  });

  it("renders the bottleneck chip with the longest span and its percentage", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("800 ms");
    expect(el.textContent).toContain("88.9%");
  });

  it("renders one grid row per event", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll(".wf-row").length).toBe(2);
  });

  it("renders a diamond (rotated square) for the unmatched point event", () => {
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll(".wf-row");
    const firstTrack = rows[0]?.querySelector(".wf-track");
    expect(firstTrack?.querySelector("svg.wf-point")).toBeTruthy();
    expect(firstTrack?.querySelector("svg.wf-bar")).toBeFalsy();
  });

  it("renders a bar for the matched-span event", () => {
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll(".wf-row");
    const secondTrack = rows[1]?.querySelector(".wf-track");
    expect(secondTrack?.querySelector("svg.wf-bar")).toBeTruthy();
  });

  it("renders the legend with channel/platform/agent/other entries", () => {
    const el = fixture.nativeElement as HTMLElement;
    const legendText = el.querySelector(".wf-legend")?.textContent ?? "";
    expect(legendText).toContain("Channel");
    expect(legendText).toContain("Platform");
    expect(legendText).toContain("Agent");
    expect(legendText).toContain("Other");
  });

  describe("row selection (T03)", () => {
    it("selects the row's event on click, via the shared TraceSelectionService, sourced as 'waterfall'", () => {
      const el = fixture.nativeElement as HTMLElement;
      const firstRow = el.querySelector<HTMLElement>(".wf-row");

      firstRow?.click();
      fixture.detectChanges();

      expect(selection.selectedEventId()).toBe("evt-1");
      expect(selection.sourceView()).toBe("waterfall");
    });

    it("highlights the row matching the service's selectedEventId, and only that row", () => {
      selection.select("evt-2", "waterfall");
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const rows = el.querySelectorAll<HTMLElement>(".wf-row");

      expect(rows[0]?.classList.contains("wf-row-selected")).toBe(false);
      expect(rows[1]?.classList.contains("wf-row-selected")).toBe(true);
    });

    it("has no row highlighted when nothing is selected", () => {
      const el = fixture.nativeElement as HTMLElement;
      const rows = el.querySelectorAll<HTMLElement>(".wf-row");

      for (const row of Array.from(rows)) {
        expect(row.classList.contains("wf-row-selected")).toBe(false);
      }
    });

    it("does NOT hold any view-local selection state — re-selecting via the service from outside the component still drives the highlight", () => {
      const el = fixture.nativeElement as HTMLElement;
      selection.select("evt-1", "causal");
      fixture.detectChanges();

      expect(
        el.querySelectorAll(".wf-row")[0]?.classList.contains("wf-row-selected")
      ).toBe(true);
    });
  });
});
