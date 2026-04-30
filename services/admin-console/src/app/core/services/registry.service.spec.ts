import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";

import { RegistryService } from "./registry.service";
import { environment } from "../../../environments/environment";

describe("RegistryService", () => {
  let service: RegistryService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [RegistryService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(RegistryService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it("loadServices fetches and stores registered services", () => {
    const list = [
      {
        id: "s1",
        tenant_id: "t1",
        name: "svc",
        image: "img:v1",
        port: 8080,
        status: "active",
      },
    ];
    service.loadServices();
    const req = httpMock.expectOne(`${environment.apiUrl}/registry/services`);
    expect(req.request.method).toBe("GET");
    req.flush(list);
    expect(service.services()).toEqual(list);
    expect(service.loading()).toBe(false);
    httpMock.verify();
  });

  it("getService requests detail endpoint", () => {
    service.getService("s1").subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/registry/services/s1`);
    expect(req.request.method).toBe("GET");
    req.flush({} as never);
    httpMock.verify();
  });
});
