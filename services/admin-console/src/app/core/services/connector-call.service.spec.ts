import "@angular/compiler";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { environment } from "../../../environments/environment";
import { ConnectorCallService } from "./connector-call.service";

const TRACKING_EVENTS_URL = `${environment.apiUrl}/tracking/events`;
const EVENT_TYPE = "connector.endpoint_call.completed.v1";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function makeRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    event_id: "evt-1",
    correlation_id: "corr-1",
    connector_id: "adp-target",
    occurred_at: "2026-06-01T12:00:00.000Z",
    payload_method: "GET",
    payload_resolved_url: "https://api.example.com/data",
    payload_http_status: 200,
    payload_duration_ms: 50,
    payload_cache_result: "hit",
    ...overrides,
  };
}

describe("ConnectorCallService", () => {
  let service: ConnectorCallService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ConnectorCallService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(ConnectorCallService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock?.verify();
    TestBed.resetTestingModule();
  });

  it("requests the tracking/events route with required query params", () => {
    service.recentCalls("adp-target").subscribe();

    const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
    expect(req.request.method).toBe("GET");
    expect(req.request.params.get("type")).toBe(EVENT_TYPE);
    expect(req.request.params.get("resource")).toBe("adapter/adp-target");
    expect(req.request.params.get("limit")).toBe("20");
    expect(req.request.params.get("from")).toBeTruthy();
    req.flush({ events: [] });
  });

  it("defaults the lookback window to 7 days", () => {
    const before = Date.now();
    service.recentCalls("adp-target").subscribe();

    const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
    const from = new Date(req.request.params.get("from") ?? "").getTime();
    expect(before - from).toBeGreaterThanOrEqual(SEVEN_DAYS_MS - 5000);
    expect(before - from).toBeLessThanOrEqual(SEVEN_DAYS_MS + 5000);
    req.flush({ events: [] });
  });

  it("maps tracking-event rows into IConnectorCall", () => {
    let result: unknown[] = [];
    service.recentCalls("adp-target").subscribe((rows) => (result = rows));

    const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
    req.flush({ events: [makeRow()] });

    expect(result).toEqual([
      {
        adapterId: "adp-target",
        endpointId: null,
        method: "GET",
        resolvedUrl: "https://api.example.com/data",
        status: 200,
        durationMs: 50,
        cacheResult: "hit",
        timestamp: "2026-06-01T12:00:00.000Z",
        correlationId: "corr-1",
        eventId: "evt-1",
      },
    ]);
  });

  it("respects a custom limit", () => {
    service.recentCalls("adp-1", 60, 5).subscribe();

    const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
    expect(req.request.params.get("limit")).toBe("5");
    req.flush({ events: [] });
  });

  it("normalizes uppercase cache results", () => {
    let result: Array<{ cacheResult: string | null }> = [];
    service.recentCalls("adp-1").subscribe((rows) => (result = rows));

    const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
    req.flush({
      events: [makeRow({ payload_cache_result: "HIT" })],
    });

    expect(result[0]?.cacheResult).toBe("hit");
  });

  it("leaves correlationId undefined when absent (not null)", () => {
    let result: Array<{ correlationId?: string }> = [];
    service.recentCalls("adp-1").subscribe((rows) => (result = rows));

    const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
    req.flush({
      events: [makeRow({ correlation_id: null })],
    });

    expect(result[0]?.correlationId).toBeUndefined();
  });

  it("falls back to the requested adapterId when connector_id is absent", () => {
    let result: Array<{ adapterId: string }> = [];
    service.recentCalls("adp-fallback").subscribe((rows) => (result = rows));

    const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
    req.flush({
      events: [makeRow({ connector_id: null })],
    });

    expect(result[0]?.adapterId).toBe("adp-fallback");
  });

  it("never attempts to read a request/response body (payload viewing stays in the trace console)", () => {
    let result: Array<{ requestBody?: unknown; responseBody?: unknown }> = [];
    service.recentCalls("adp-1").subscribe((rows) => (result = rows));

    const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
    req.flush({ events: [makeRow()] });

    expect(result[0]?.requestBody).toBeUndefined();
    expect(result[0]?.responseBody).toBeUndefined();
  });

  // T10 of manual-loops/connectors/connection-call-inspector.md: agent
  // detail's "Recent executions" feed.
  describe("recentAgentExecutions", () => {
    const AGENT_EVENT_TYPE =
      "io.yoizen.platform.runtime.execution_completed.v1";

    function makeExecutionRow(
      overrides: Record<string, unknown> = {}
    ): Record<string, unknown> {
      return {
        event_id: "evt-exec-1",
        correlation_id: "corr-exec-1",
        occurred_at: "2026-06-01T12:00:00.000Z",
        payload_state: "completed",
        payload_model: "gpt-5.4-nano",
        payload_duration_ms: 1200,
        payload_cost_usd: 0.0042,
        ...overrides,
      };
    }

    it("requests the tracking/events route with the agent-execution type and resource=agent/<id>", () => {
      service.recentAgentExecutions("agent-1").subscribe();

      const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
      expect(req.request.method).toBe("GET");
      expect(req.request.params.get("type")).toBe(AGENT_EVENT_TYPE);
      expect(req.request.params.get("resource")).toBe("agent/agent-1");
      expect(req.request.params.get("limit")).toBe("20");
      expect(req.request.params.get("from")).toBeTruthy();
      req.flush({ events: [] });
    });

    it("defaults the lookback window to 7 days", () => {
      const before = Date.now();
      service.recentAgentExecutions("agent-1").subscribe();

      const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
      const from = new Date(req.request.params.get("from") ?? "").getTime();
      expect(before - from).toBeGreaterThanOrEqual(SEVEN_DAYS_MS - 5000);
      expect(before - from).toBeLessThanOrEqual(SEVEN_DAYS_MS + 5000);
      req.flush({ events: [] });
    });

    it("maps tracking-event rows into IAgentExecutionCall", () => {
      let result: unknown[] = [];
      service
        .recentAgentExecutions("agent-1")
        .subscribe((rows) => (result = rows));

      const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
      req.flush({ events: [makeExecutionRow()] });

      expect(result).toEqual([
        {
          agentId: "agent-1",
          state: "completed",
          model: "gpt-5.4-nano",
          durationMs: 1200,
          costUsd: 0.0042,
          timestamp: "2026-06-01T12:00:00.000Z",
          correlationId: "corr-exec-1",
          eventId: "evt-exec-1",
        },
      ]);
    });

    it("respects a custom limit", () => {
      service.recentAgentExecutions("agent-1", 60, 5).subscribe();

      const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
      expect(req.request.params.get("limit")).toBe("5");
      req.flush({ events: [] });
    });

    it("nulls out state/model/duration/cost when the payload scalars are absent", () => {
      let result: unknown[] = [];
      service
        .recentAgentExecutions("agent-1")
        .subscribe((rows) => (result = rows));

      const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
      req.flush({
        events: [
          makeExecutionRow({
            payload_state: null,
            payload_model: null,
            payload_duration_ms: null,
            payload_cost_usd: null,
          }),
        ],
      });

      expect(result[0]).toMatchObject({
        state: null,
        model: null,
        durationMs: null,
        costUsd: null,
      });
    });

    it("leaves correlationId/eventId undefined when absent (not null)", () => {
      let result: Array<{ correlationId?: string; eventId?: string }> = [];
      service
        .recentAgentExecutions("agent-1")
        .subscribe((rows) => (result = rows));

      const req = httpMock.expectOne((r) => r.url === TRACKING_EVENTS_URL);
      req.flush({
        events: [makeExecutionRow({ correlation_id: null, event_id: null })],
      });

      expect(result[0]?.correlationId).toBeUndefined();
      expect(result[0]?.eventId).toBeUndefined();
    });
  });
});
