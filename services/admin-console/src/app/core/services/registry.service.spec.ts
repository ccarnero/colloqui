import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { environment } from "../../../environments/environment";
import { RegistryService } from "./registry.service";

describe("RegistryService", () => {
  let service: RegistryService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        RegistryService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
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
    const req = httpMock.expectOne(
      `${environment.apiUrl}/registry/services/s1`
    );
    expect(req.request.method).toBe("GET");
    req.flush({} as never);
    httpMock.verify();
  });

  // T11 of manual-loops/connectors/connection-call-inspector.md:
  // observable list variant used for the hosted service detail page's
  // name -> id fallback resolution.
  it("listServices requests the collection endpoint without mutating the services signal", () => {
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
    let result: unknown[] = [];
    service.listServices().subscribe((res) => (result = res));
    const req = httpMock.expectOne(`${environment.apiUrl}/registry/services`);
    expect(req.request.method).toBe("GET");
    req.flush(list);
    expect(result).toEqual(list);
    expect(service.services()).toEqual([]);
    httpMock.verify();
  });
});
