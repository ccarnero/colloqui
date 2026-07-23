import "@angular/compiler";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ITrackedEvent,
  ITrackedEventSpan,
  ITrackingChainResponse,
} from "../../../../core/services/tracking-chain.service";
import { TraceSelectionService } from "../trace-selection.service";
import { StepLogComponent } from "./step-log.component";

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
  kind: "trigger.matched",
  occurred_at: "2026-01-01T00:00:00.000Z",
});
const evt2 = event({
  event_id: "evt-2",
  kind: "router.evaluate",
  causation_id: "evt-1",
  run_id: "run-1",
  occurred_at: "2026-01-01T00:00:00.100Z",
});

const fixtureChain: ITrackingChainResponse = {
  correlation_id: "corr-1",
  tenant: "acme",
  events: [evt2, evt1], // deliberately out of chronological order
  spans: [
    span({ kind_prefix: "trigger.matched", entity_id: null }),
    span({
      kind_prefix: "router.evaluate",
      entity_id: "run-1",
      duration_ms: 400,
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

describe("StepLogComponent", () => {
  let fixture: ComponentFixture<StepLogComponent>;
  let selection: TraceSelectionService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StepLogComponent],
      // Component-provided at the ancestor TraceDetailComponent in the real
      // app; the test provides its own instance at module level so DI
      // resolves it here too (same pattern as trace-waterfall.component.spec.ts).
      providers: [TraceSelectionService],
    }).compileComponents();
    fixture = TestBed.createComponent(StepLogComponent);
    fixture.componentRef.setInput("chain", fixtureChain);
    selection = TestBed.inject(TraceSelectionService);
    fixture.detectChanges();
  });

  it("renders one entry per event, in chronological order regardless of the chain's array order", () => {
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll(".sl-entry");

    expect(rows.length).toBe(2);
    expect(rows[0]?.textContent).toContain("trigger.matched");
    expect(rows[1]?.textContent).toContain("router.evaluate");
  });

  it("renders the empty state for a chain with no events", () => {
    fixture.componentRef.setInput("chain", { ...fixtureChain, events: [] });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector(".sl-empty")?.textContent).toContain(
      "No steps in this chain."
    );
  });

  describe("selection sync (T04)", () => {
    it("selects the entry's event on click, via the shared TraceSelectionService, sourced as 'run'", () => {
      const el = fixture.nativeElement as HTMLElement;
      const firstEntry = el.querySelector<HTMLElement>(".sl-entry");

      firstEntry?.click();
      fixture.detectChanges();

      expect(selection.selectedEventId()).toBe("evt-1");
      expect(selection.sourceView()).toBe("run");
    });

    it("highlights the entry matching the service's selectedEventId, and only that entry", () => {
      selection.select("evt-2", "run");
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const rows = el.querySelectorAll<HTMLElement>(".sl-entry");

      expect(rows[0]?.classList.contains("sl-entry-selected")).toBe(false);
      expect(rows[1]?.classList.contains("sl-entry-selected")).toBe(true);
    });

    it("has no entry highlighted when nothing is selected", () => {
      const el = fixture.nativeElement as HTMLElement;
      const rows = el.querySelectorAll<HTMLElement>(".sl-entry");

      for (const row of Array.from(rows)) {
        expect(row.classList.contains("sl-entry-selected")).toBe(false);
      }
    });

    it("does NOT hold any view-local selection state — selecting via the service from outside the component still drives the highlight", () => {
      selection.select("evt-1", "causal");
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      expect(
        el
          .querySelectorAll(".sl-entry")[0]
          ?.classList.contains("sl-entry-selected")
      ).toBe(true);
    });
  });
});
