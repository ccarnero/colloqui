import "@angular/compiler";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ITrackedEvent,
  ITrackingChainResponse,
} from "../../../../../core/services/tracking-chain.service";
import { TraceSummaryStripComponent } from "../trace-summary-strip.component";

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
    business_fn: "ingress",
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

const evt1 = event({
  event_id: "evt-1",
  kind: "received",
  business_fn: "ingress",
  tech: "telegram",
  occurred_at: "2026-01-01T00:00:00.000Z",
});
const evt2 = event({
  event_id: "evt-2",
  kind: "send",
  business_fn: "egress",
  occurred_at: "2026-01-01T00:00:00.500Z",
});
const evt3 = event({
  event_id: "evt-3",
  kind: "sent",
  business_fn: "egress",
  occurred_at: "2026-01-01T00:00:01.000Z",
});

const fixtureChain: ITrackingChainResponse = {
  correlation_id: "corr-1",
  tenant: "acme",
  events: [evt1, evt2, evt3],
  spans: [
    {
      kind_prefix: "received",
      entity_id: null,
      started_at: "2026-01-01T00:00:00.000Z",
      completed_at: "2026-01-01T00:00:00.250Z",
      duration_ms: 250,
    },
  ],
  summary: {
    count: 3,
    first_at: evt1.occurred_at,
    last_at: evt3.occurred_at,
    total_ms: 1000,
    orphan_count: 0,
  },
};

describe("TraceSummaryStripComponent", () => {
  let fixture: ComponentFixture<TraceSummaryStripComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TraceSummaryStripComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(TraceSummaryStripComponent);
    fixture.componentRef.setInput("chain", fixtureChain);
    fixture.detectChanges();
  });

  it("renders all 5 cells: verdict, total, eventos, canal, bottleneck", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Verdict");
    expect(el.textContent).toContain("replied");
    expect(el.textContent).toContain("Total");
    expect(el.textContent).toContain("1000 ms");
    expect(el.textContent).toContain("Eventos");
    expect(el.textContent).toContain("3 · spans 1/3");
    expect(el.textContent).toContain("Canal");
    expect(el.textContent).toContain("telegram");
    expect(el.textContent).toContain("Bottleneck");
  });

  it("shows 'no verdict data' and 'none' bottleneck when the chain has no delivery kinds or durations", () => {
    fixture.componentRef.setInput("chain", {
      correlation_id: "corr-2",
      tenant: null,
      events: [
        event({
          event_id: "e1",
          kind: "execution_started",
          business_fn: "workflow",
          tech: "http-generic",
        }),
      ],
      spans: [],
      summary: {
        count: 1,
        first_at: null,
        last_at: null,
        total_ms: 0,
        orphan_count: 0,
      },
    } satisfies ITrackingChainResponse);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("no verdict data");
    expect(el.textContent).toContain("none");
  });
});
