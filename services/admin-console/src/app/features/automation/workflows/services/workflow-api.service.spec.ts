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
});
