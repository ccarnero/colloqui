import "@angular/compiler";
import { HttpErrorResponse, provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { environment } from "../../../environments/environment";
import {
  type IEventPayloadResponse,
  type ITrackingChainResponse,
  TrackingChainService,
} from "./tracking-chain.service";

const TRACKING_URL = `${environment.apiUrl}/tracking/chains`;

function makeResponse(
  overrides: Partial<ITrackingChainResponse> = {}
): ITrackingChainResponse {
  return {
    correlation_id: "corr-1",
    tenant: "tenant-a",
    events: [
      {
        event_id: "evt-1",
        subject: "channel.message.received.v1",
        tenant: "tenant-a",
        producer: "channel-service",
        domain: "channel",
        kind: "message.received",
        version: "v1",
        correlation_id: "corr-1",
        causation_id: null,
        causation_depth: 0,
        occurred_at: "2026-07-11T10:00:00.000Z",
        tech: "nats",
        business_fn: "message-ingest",
        rule: 12,
        consumed_by: ["router-service"],
        is_claim_check: false,
        compliance: "full",
        workflow_id: null,
        run_id: null,
        connector_id: null,
        cache_status: null,
        has_envelope: true,
        payload_action_name: null,
      },
    ],
    spans: [
      {
        kind_prefix: "channel.message",
        entity_id: "msg-1",
        started_at: "2026-07-11T10:00:00.000Z",
        completed_at: "2026-07-11T10:00:00.500Z",
        duration_ms: 500,
      },
    ],
    summary: {
      count: 1,
      first_at: "2026-07-11T10:00:00.000Z",
      last_at: "2026-07-11T10:00:00.500Z",
      total_ms: 500,
      orphan_count: 0,
    },
    ...overrides,
  };
}

describe("TrackingChainService", () => {
  let service: TrackingChainService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TrackingChainService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(TrackingChainService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock?.verify();
    TestBed.resetTestingModule();
  });

  it("requests the correct URL for a given correlation id", () => {
    service.getChain("corr-1").subscribe();

    const req = httpMock.expectOne(`${TRACKING_URL}/corr-1`);
    expect(req.request.method).toBe("GET");
    req.flush(makeResponse());
  });

  it("passes through the response shape unchanged", () => {
    let result: ITrackingChainResponse | undefined;
    service.getChain("corr-1").subscribe((res) => (result = res));

    const req = httpMock.expectOne(`${TRACKING_URL}/corr-1`);
    const response = makeResponse();
    req.flush(response);

    expect(result).toEqual(response);
    expect(result?.summary.orphan_count).toBe(0);
    expect(result?.events[0]?.has_envelope).toBe(true);
  });

  it("propagates null tenant and null-valued fields as-is", () => {
    let result: ITrackingChainResponse | undefined;
    service.getChain("corr-2").subscribe((res) => (result = res));

    const req = httpMock.expectOne(`${TRACKING_URL}/corr-2`);
    req.flush(
      makeResponse({
        correlation_id: "corr-2",
        tenant: null,
        summary: {
          count: 1,
          first_at: null,
          last_at: null,
          total_ms: 0,
          orphan_count: 1,
        },
      })
    );

    expect(result?.tenant).toBeNull();
    expect(result?.summary.first_at).toBeNull();
    expect(result?.summary.orphan_count).toBe(1);
  });

  it("encodes special characters in the correlation id path segment", () => {
    service.getChain("corr with space").subscribe();

    const req = httpMock.expectOne(
      (r) => r.url === `${TRACKING_URL}/corr with space`
    );
    expect(req.request.method).toBe("GET");
    req.flush(makeResponse({ correlation_id: "corr with space" }));
  });

  it("requests the correct URL for an event payload", () => {
    service.getEventPayload("corr-1", "evt-1").subscribe();

    const req = httpMock.expectOne(
      `${TRACKING_URL}/corr-1/events/evt-1/payload`
    );
    expect(req.request.method).toBe("GET");
    req.flush({ payload: { hello: "world" }, payload_status: "inline" });
  });

  it("passes through the payload response shape unchanged", () => {
    let result: IEventPayloadResponse | undefined;
    service
      .getEventPayload("corr-1", "evt-1")
      .subscribe((res) => (result = res));

    const req = httpMock.expectOne(
      `${TRACKING_URL}/corr-1/events/evt-1/payload`
    );
    req.flush({ payload: { hello: "world" }, payload_status: "resolved" });

    expect(result).toEqual({
      payload: { hello: "world" },
      payload_status: "resolved",
    });
  });

  it("propagates HTTP errors (e.g. 410 scrubbed) to the caller", () => {
    let error: HttpErrorResponse | undefined;
    service.getEventPayload("corr-1", "evt-1").subscribe({
      error: (err: HttpErrorResponse) => (error = err),
    });

    const req = httpMock.expectOne(
      `${TRACKING_URL}/corr-1/events/evt-1/payload`
    );
    req.flush(
      { error: "payload for event evt-1 was scrubbed per retention policy" },
      { status: 410, statusText: "Gone" }
    );

    expect(error?.status).toBe(410);
  });
});
