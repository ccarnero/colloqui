import "@angular/compiler";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ITrackedEvent,
  ITrackingChainResponse,
} from "../../../../core/services/tracking-chain.service";
import { CausalGraphComponent } from "./causal-graph.component";

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
    ...overrides,
  };
}

const evt1 = event({
  event_id: "evt-1",
  kind: "webhook_received",
  business_fn: "ingress",
  tech: "telegram",
  causation_depth: 0,
  occurred_at: "2026-01-01T00:00:00.000Z",
});
const evt2 = event({
  event_id: "evt-2",
  kind: "execution_started",
  business_fn: "workflow-execution",
  causation_depth: 1,
  causation_id: "evt-1",
  occurred_at: "2026-01-01T00:00:00.100Z",
});
const evt3 = event({
  event_id: "evt-3",
  kind: "dlq_replayed",
  business_fn: "dlq",
  causation_depth: 2,
  causation_id: "evt-missing",
  tenant: null,
  compliance: "none",
  occurred_at: "2026-01-01T00:00:00.900Z",
});

const fixtureChain: ITrackingChainResponse = {
  correlation_id: "corr-1",
  tenant: "acme",
  events: [evt1, evt2, evt3],
  spans: [
    {
      kind_prefix: "execution",
      entity_id: null,
      started_at: "2026-01-01T00:00:00.100Z",
      completed_at: "2026-01-01T00:00:00.350Z",
      duration_ms: 250,
    },
  ],
  summary: {
    count: 3,
    first_at: "2026-01-01T00:00:00.000Z",
    last_at: "2026-01-01T00:00:00.900Z",
    total_ms: 900,
    orphan_count: 1,
  },
};

describe("CausalGraphComponent", () => {
  let fixture: ComponentFixture<CausalGraphComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CausalGraphComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(CausalGraphComponent);
    fixture.componentRef.setInput("chain", fixtureChain);
    fixture.detectChanges();
  });

  it("renders header chips: correlation id, channel, event count, duration, completeness badge", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("corr-1");
    expect(el.textContent).toContain("telegram");
    expect(el.textContent).toContain("3");
    expect(el.textContent).toContain("900 ms");
    expect(el.textContent).toContain("spans closed 1/3");
  });

  it("renders one node per event", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll(".cg-node").length).toBe(3);
  });

  it("renders a solid edge for a resolved causation_id and a dashed edge for the solo-correlation case", () => {
    const el = fixture.nativeElement as HTMLElement;
    const edges = el.querySelectorAll(".cg-edge");
    expect(edges.length).toBe(2);
    expect(el.querySelectorAll(".cg-edge:not(.cg-edge-dashed)").length).toBe(1);
    expect(el.querySelectorAll(".cg-edge.cg-edge-dashed").length).toBe(1);
  });

  it("shows no detail card before any node is clicked", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(".cg-detail")).toBeFalsy();
  });

  it("clicking a node opens the detail card with its fields, flagging a null-tenant row", () => {
    const el = fixture.nativeElement as HTMLElement;
    const nodes = el.querySelectorAll(".cg-node");
    (nodes[2] as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    fixture.detectChanges();

    const detail = el.querySelector(".cg-detail");
    expect(detail).toBeTruthy();
    expect(detail?.textContent).toContain("evt-3");
    expect(detail?.textContent).toContain("evt-missing");
    expect(detail?.textContent).toContain("dlq");
    expect(detail?.textContent).toContain("none");
    expect(detail?.textContent).toContain("null tenant");
  });

  it("clicking the same node again closes the detail card", () => {
    const el = fixture.nativeElement as HTMLElement;
    const node = el.querySelectorAll(".cg-node")[0] as HTMLElement;
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector(".cg-detail")).toBeTruthy();

    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector(".cg-detail")).toBeFalsy();
  });
});
