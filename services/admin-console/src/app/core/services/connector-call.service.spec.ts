import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { environment } from "../../../environments/environment";
import { ConnectorCallService } from "./connector-call.service";

const AUDIT_URL = `${environment.apiUrl}/audit/events`;
const EVENT_TYPE = "connector.endpoint_call.completed.v1";

// payload arrives from the API as a JSON string (JSONB serialized by postgres.js)
function makeRow(
  adapterId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    payload: JSON.stringify({
      adapterId,
      endpointId: "ep-1",
      method: "GET",
      resolvedUrl: "https://api.example.com/data",
      status: 200,
      durationMs: 50,
      cacheResult: "hit",
    }),
    created_at: "2026-06-01T12:00:00.000Z",
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

  afterEach(() => httpMock.verify());

  it("requests the correct URL with required query params", () => {
    service.recentCalls("adp-1").subscribe();

    const req = httpMock.expectOne((r) => r.url === AUDIT_URL);
    expect(req.request.method).toBe("GET");
    expect(req.request.params.get("type")).toBe(EVENT_TYPE);
    expect(req.request.params.get("limit")).toBe("200");
    expect(req.request.params.get("from")).toBeTruthy();
    req.flush({ events: [] });
  });

  it("client-side filters by adapterId", () => {
    let result: unknown[] = [];
    service.recentCalls("adp-target").subscribe((rows) => (result = rows));

    const req = httpMock.expectOne((r) => r.url === AUDIT_URL);
    req.flush({
      events: [
        makeRow("adp-target"),
        makeRow("adp-other"),
        makeRow("adp-target"),
      ],
    });

    expect(result.length).toBe(2);
    expect(
      (result as Array<{ adapterId: string }>).every(
        (c) => c.adapterId === "adp-target"
      )
    ).toBe(true);
  });

  it("slices to the requested limit", () => {
    let result: unknown[] = [];
    service.recentCalls("adp-1", 60, 20).subscribe((rows) => (result = rows));

    const req = httpMock.expectOne((r) => r.url === AUDIT_URL);
    req.flush({
      events: Array.from({ length: 25 }, () => makeRow("adp-1")),
    });

    expect(result.length).toBe(20);
  });

  it("drops rows without payload.adapterId", () => {
    let result: unknown[] = [];
    service.recentCalls("adp-1").subscribe((rows) => (result = rows));

    const req = httpMock.expectOne((r) => r.url === AUDIT_URL);
    req.flush({
      events: [
        { payload: "{}", created_at: "2026-06-01T12:00:00.000Z" }, // no adapterId
        makeRow("adp-1"),
      ],
    });

    expect(result.length).toBe(1);
  });

  it("accepts createdAt (camelCase) as timestamp key", () => {
    let result: Array<{ timestamp: string }> = [];
    service.recentCalls("adp-1").subscribe((rows) => (result = rows));

    const req = httpMock.expectOne((r) => r.url === AUDIT_URL);
    req.flush({
      events: [
        {
          payload: JSON.stringify({
            adapterId: "adp-1",
            method: "GET",
            status: 200,
          }),
          createdAt: "2026-06-02T09:00:00.000Z",
        },
      ],
    });

    expect(result[0]?.timestamp).toBe("2026-06-02T09:00:00.000Z");
  });

  it("leaves correlationId undefined when absent (not empty string)", () => {
    let result: Array<{ correlationId?: string }> = [];
    service.recentCalls("adp-1").subscribe((rows) => (result = rows));

    const req = httpMock.expectOne((r) => r.url === AUDIT_URL);
    req.flush({ events: [makeRow("adp-1")] }); // no correlation_id field

    expect(result[0]?.correlationId).toBeUndefined();
  });
});
