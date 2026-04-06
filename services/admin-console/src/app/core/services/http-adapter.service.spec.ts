import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";

import { HttpAdapterService } from "./http-adapter.service";
import { environment } from "../../../environments/environment";

describe("HttpAdapterService", () => {
  let service: HttpAdapterService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [HttpAdapterService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HttpAdapterService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it("lists adapters at base URL", () => {
    service.list().subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/adapters`);
    expect(req.request.method).toBe("GET");
    req.flush([]);
    httpMock.verify();
  });

  it("lists adapters with context query", () => {
    service.list("internal").subscribe();
    const req = httpMock.expectOne(
      `${environment.apiUrl}/adapters?context=internal`,
    );
    expect(req.request.method).toBe("GET");
    req.flush([]);
    httpMock.verify();
  });

  it("gets adapter by id", () => {
    service.get("a1").subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/adapters/a1`);
    expect(req.request.method).toBe("GET");
    req.flush({} as never);
    httpMock.verify();
  });
});
