import "@angular/compiler";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { environment } from "../../../../../environments/environment";
import { AuthService } from "../../../../core/services/auth.service";
import type {
  ITrackedEvent,
  ITrackingChainResponse,
} from "../../../../core/services/tracking-chain.service";
import { CausalGraphComponent } from "./causal-graph.component";

const PAYLOAD_URL = (correlationId: string, eventId: string) =>
  `${environment.apiUrl}/tracking/chains/${correlationId}/events/${eventId}/payload`;

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
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CausalGraphComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { hasPermission: () => true } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CausalGraphComponent);
    fixture.componentRef.setInput("chain", fixtureChain);
    fixture.detectChanges();
    httpMock = TestBed.inject(HttpTestingController);
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

  describe("payload viewer (admin permission granted)", () => {
    function selectFirstNode(): HTMLElement {
      const el = fixture.nativeElement as HTMLElement;
      const node = el.querySelectorAll(".cg-node")[0] as HTMLElement;
      node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      fixture.detectChanges();
      return el;
    }

    it("shows the 'View payload' action in the detail card", () => {
      const el = selectFirstNode();
      expect(el.querySelector(".cg-payload-btn")).toBeTruthy();
    });

    it("does not fetch the payload until the action is clicked (on-demand, never pre-fetched)", () => {
      selectFirstNode();
      httpMock.expectNone(PAYLOAD_URL("corr-1", "evt-1"));
    });

    it("fetches on click and renders the pretty-printed JSON collapsed by default", () => {
      const el = selectFirstNode();
      (el.querySelector(".cg-payload-btn") as HTMLElement).click();
      fixture.detectChanges();
      expect(el.textContent).toContain("Loading payload");

      const req = httpMock.expectOne(PAYLOAD_URL("corr-1", "evt-1"));
      expect(req.request.method).toBe("GET");
      req.flush({ payload: { foo: "bar" }, payload_status: "inline" });
      fixture.detectChanges();

      const details = el.querySelector(
        ".cg-payload-details"
      ) as HTMLDetailsElement;
      expect(details).toBeTruthy();
      expect(details.open).toBe(false);
      expect(details.textContent).toContain('"foo": "bar"');
      expect(details.textContent).toContain("inline");
    });

    it("shows 'Payload expired' for a 410 scrubbed response", () => {
      const el = selectFirstNode();
      (el.querySelector(".cg-payload-btn") as HTMLElement).click();
      fixture.detectChanges();

      const req = httpMock.expectOne(PAYLOAD_URL("corr-1", "evt-1"));
      req.flush(
        { error: "payload for event evt-1 was scrubbed per retention policy" },
        { status: 410, statusText: "Gone" }
      );
      fixture.detectChanges();

      expect(el.textContent).toContain("Payload expired (30-day retention)");
    });

    it("shows a claim-check message for a 404 unresolved response", () => {
      const el = selectFirstNode();
      (el.querySelector(".cg-payload-btn") as HTMLElement).click();
      fixture.detectChanges();

      const req = httpMock.expectOne(PAYLOAD_URL("corr-1", "evt-1"));
      req.flush(
        {
          error:
            "payload capture failed to resolve for event evt-1 (payload_status=unresolved — claim-check expired or cache unreachable)",
        },
        { status: 404, statusText: "Not Found" }
      );
      fixture.detectChanges();

      expect(el.textContent).toContain(
        "Payload was not captured (claim-check expired)"
      );
    });

    it("shows a generic not-captured message for a 404 none response", () => {
      const el = selectFirstNode();
      (el.querySelector(".cg-payload-btn") as HTMLElement).click();
      fixture.detectChanges();

      const req = httpMock.expectOne(PAYLOAD_URL("corr-1", "evt-1"));
      req.flush(
        {
          error:
            "payload was never captured for event evt-1 (payload_status=none)",
        },
        { status: 404, statusText: "Not Found" }
      );
      fixture.detectChanges();

      expect(el.textContent).toContain("Payload was not captured");
    });

    it("shows a generic error message for other failures", () => {
      const el = selectFirstNode();
      (el.querySelector(".cg-payload-btn") as HTMLElement).click();
      fixture.detectChanges();

      const req = httpMock.expectOne(PAYLOAD_URL("corr-1", "evt-1"));
      req.flush({ error: "boom" }, { status: 500, statusText: "Server Error" });
      fixture.detectChanges();

      expect(el.textContent).toContain("Failed to load payload.");
    });

    it("resets the payload state when selecting a different event", () => {
      const el = selectFirstNode();
      (el.querySelector(".cg-payload-btn") as HTMLElement).click();
      fixture.detectChanges();

      const req = httpMock.expectOne(PAYLOAD_URL("corr-1", "evt-1"));
      req.flush({ payload: { a: 1 }, payload_status: "inline" });
      fixture.detectChanges();
      expect(el.querySelector(".cg-payload-details")).toBeTruthy();

      // Close then reopen a different node — payload state must not leak.
      const nodes = el.querySelectorAll(".cg-node");
      (nodes[0] as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      fixture.detectChanges();
      (nodes[1] as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      fixture.detectChanges();

      expect(el.querySelector(".cg-payload-details")).toBeFalsy();
      expect(el.querySelector(".cg-payload-status")).toBeFalsy();
    });
  });
});

describe("CausalGraphComponent (no admin permission)", () => {
  let fixture: ComponentFixture<CausalGraphComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CausalGraphComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { hasPermission: () => false } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CausalGraphComponent);
    fixture.componentRef.setInput("chain", fixtureChain);
    fixture.detectChanges();
  });

  it("does not render the 'View payload' action in the detail card", () => {
    const el = fixture.nativeElement as HTMLElement;
    const node = el.querySelectorAll(".cg-node")[0] as HTMLElement;
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fixture.detectChanges();

    expect(el.querySelector(".cg-detail")).toBeTruthy();
    expect(el.querySelector(".cg-payload-btn")).toBeFalsy();
  });
});
