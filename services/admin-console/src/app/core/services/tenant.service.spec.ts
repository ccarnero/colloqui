import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";

import { TenantService } from "./tenant.service";
import { AuthService } from "./auth.service";
import { environment } from "../../../environments/environment";

describe("TenantService", () => {
  it("loads tenant details when tenant id is set", () => {
    TestBed.configureTestingModule({
      providers: [
        TenantService,
        {
          provide: AuthService,
          useValue: {
            tenantId: () => "acme",
          },
        },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });

    const service = TestBed.inject(TenantService);
    const httpMock = TestBed.inject(HttpTestingController);

    service.loadTenantDetails();

    const req = httpMock.expectOne(
      `${environment.apiUrl}/tenants/acme`,
    );
    expect(req.request.method).toBe("GET");
    req.flush({
      name: "acme",
      configuration: {},
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });

    expect(service.currentTenant().name).toBe("acme");
    httpMock.verify();
  });

  it("does not request when tenant id is missing", () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        TenantService,
        {
          provide: AuthService,
          useValue: {
            tenantId: () => null,
          },
        },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });

    const service = TestBed.inject(TenantService);
    const httpMock = TestBed.inject(HttpTestingController);

    service.loadTenantDetails();

    expect(httpMock.match(() => true)).toEqual([]);
    httpMock.verify();
  });
});
