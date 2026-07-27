import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { firstValueFrom } from "rxjs";
import { environment } from "../../../../../environments/environment";
import { WorkflowApiService } from "./workflow-api.service";

describe("WorkflowApiService", () => {
  let service: WorkflowApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        WorkflowApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(WorkflowApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it("setStatus PATCHes /workflows/:id/status with the status body", async () => {
    const promise = firstValueFrom(service.setStatus("wf-1", "disabled"));

    const req = httpMock.expectOne(
      `${environment.apiUrl}/workflows/wf-1/status`
    );
    expect(req.request.method).toBe("PATCH");
    expect(req.request.body).toEqual({ status: "disabled" });

    req.flush({
      id: "wf-1",
      name: "Sample workflow",
      application: "app",
      tenantId: "acme",
      actions: [],
      trigger: null,
      status: "disabled",
      createdAt: "2020-01-01T00:00:00.000Z",
      terminated: 3,
    });

    const response = await promise;
    expect(response.status).toBe("disabled");
    expect(response.terminated).toBe(3);
    httpMock.verify();
  });

  it("setStatus enables a workflow with zero terminated executions", async () => {
    const promise = firstValueFrom(service.setStatus("wf-2", "enabled"));

    const req = httpMock.expectOne(
      `${environment.apiUrl}/workflows/wf-2/status`
    );
    expect(req.request.method).toBe("PATCH");
    expect(req.request.body).toEqual({ status: "enabled" });

    req.flush({
      id: "wf-2",
      name: "Another workflow",
      application: "app",
      tenantId: "acme",
      actions: [],
      trigger: null,
      status: "enabled",
      createdAt: "2020-01-01T00:00:00.000Z",
      terminated: 0,
    });

    const response = await promise;
    expect(response.status).toBe("enabled");
    expect(response.terminated).toBe(0);
    httpMock.verify();
  });

  it("getSummary GETs /workflows/summary and returns the tenant-wide summary", async () => {
    const promise = firstValueFrom(service.getSummary());

    const req = httpMock.expectOne(`${environment.apiUrl}/workflows/summary`);
    expect(req.request.method).toBe("GET");

    req.flush({
      activeDefinitions: 5,
      definitionsFailingNow: 1,
      definitionsWithFailuresLast7d: 2,
      executionsCompletedLast7d: 42,
      executionsFailedLast7d: 3,
      executionsRunningLast7d: 1,
      executionsCompletedLast24h: 10,
      topByExecutionCountLast7d: [
        {
          definition_id: "wf1",
          name: "Top Workflow",
          application: "app1",
          count: 1842,
        },
      ],
    });

    const response = await promise;
    expect(response.executionsCompletedLast7d).toBe(42);
    expect(response.executionsFailedLast7d).toBe(3);
    expect(response.topByExecutionCountLast7d).toEqual([
      {
        definition_id: "wf1",
        name: "Top Workflow",
        application: "app1",
        count: 1842,
      },
    ]);
    httpMock.verify();
  });

  // T07 of console-redesign-builder-v2.md.
  describe("getNodeStatsForDefinition", () => {
    it("resolves correlation ids then aggregates node stats over them (both hops)", async () => {
      const promise = firstValueFrom(service.getNodeStatsForDefinition("wf-1"));

      const correlationReq = httpMock.expectOne(
        `${environment.apiUrl}/workflows/wf-1/correlation-ids`
      );
      expect(correlationReq.request.method).toBe("GET");
      correlationReq.flush({ correlationIds: ["corr-1", "corr-2"] });

      const nodeStatsReq = httpMock.expectOne(
        (req) => req.url === `${environment.apiUrl}/tracking/node-stats`
      );
      expect(nodeStatsReq.request.method).toBe("GET");
      expect(nodeStatsReq.request.params.get("correlationIds")).toBe(
        "corr-1,corr-2"
      );
      nodeStatsReq.flush({
        tenant: "acme",
        correlationIdCount: 2,
        rowCount: 1,
        rows: [
          {
            action_name: "Fetch user",
            branch: null,
            runs: 12,
            p95_ms: 620,
            ok_ratio: 0.98,
          },
        ],
      });

      const rows = await promise;
      expect(rows).toEqual([
        {
          action_name: "Fetch user",
          branch: null,
          runs: 12,
          p95_ms: 620,
          ok_ratio: 0.98,
        },
      ]);
      httpMock.verify();
    });

    it("short-circuits to [] without a second HTTP call when correlationIds is empty (zero-runs workflow)", async () => {
      const promise = firstValueFrom(
        service.getNodeStatsForDefinition("wf-empty")
      );

      const correlationReq = httpMock.expectOne(
        `${environment.apiUrl}/workflows/wf-empty/correlation-ids`
      );
      correlationReq.flush({ correlationIds: [] });

      const rows = await promise;
      expect(rows).toEqual([]);
      httpMock.verify();
    });
  });

  // NOTE (shape-scoped inspector correction): `getNodeRunsForNode` and its
  // spec coverage were removed here — nothing in admin-console calls the
  // method anymore. The backend endpoint it hit
  // (tracking-ingester-service's `GET /tracking/node-runs`, proxied by
  // api-gateway) is KEPT and still covered by ITS OWN tests; only this
  // now-unconsumed client method was deleted.
});
