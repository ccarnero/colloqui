import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";
import { firstValueFrom } from "rxjs";

import { AdaptersService } from "./adapters.service";
import { HttpAdapterService } from "./http-adapter.service";
import { environment } from "../../../environments/environment";

describe("AdaptersService", () => {
  let service: AdaptersService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AdaptersService,
        HttpAdapterService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(AdaptersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it("listAdapters maps DTOs to summaries", async () => {
    const dto = {
      id: "x",
      tenantId: "t1",
      name: "n",
      context: "internal",
      baseUrl: "https://api.example.com",
      authType: "none",
      authConfig: {},
      headers: [] as Array<{ key: string; value: string }>,
      timeoutMs: 5000,
      maxRetries: 3,
      retryBackoffMs: 1000,
      healthCheckPath: "/health",
      status: "enabled" as const,
      createdAt: "c",
      updatedAt: "u",
      endpoints: [],
    };
    const promise = firstValueFrom(service.listAdapters());
    const req = httpMock.expectOne(`${environment.apiUrl}/connectors`);
    req.flush([dto]);
    const res = await promise;
    expect(res.adapters).toEqual([
      {
        id: "x",
        name: "n",
        status: "enabled",
        baseUrl: "https://api.example.com",
        authType: "none",
        hasAuth: false,
        endpoints: [],
      },
    ]);
    httpMock.verify();
  });

  it("getAdapter requests detail URL and maps DTO", () => {
    service.getAdapter("id-1").subscribe((detail) => {
      expect(detail.id).toBe("x");
      expect(detail.hasAuth).toBe(false);
    });
    const req = httpMock.expectOne(`${environment.apiUrl}/connectors/id-1`);
    expect(req.request.method).toBe("GET");
    req.flush({
      id: "x",
      tenantId: "t1",
      name: "n",
      context: "internal",
      baseUrl: "https://api.example.com",
      authType: "none",
      authConfig: {},
      headers: [],
      timeoutMs: 5000,
      maxRetries: 3,
      retryBackoffMs: 1000,
      healthCheckPath: "/health",
      status: "enabled",
      createdAt: "c",
      updatedAt: "u",
      endpoints: [],
    });
    httpMock.verify();
  });
});
