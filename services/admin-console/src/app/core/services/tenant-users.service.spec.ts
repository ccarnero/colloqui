import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";
import { firstValueFrom } from "rxjs";

import { TenantUsersService } from "./tenant-users.service";
import { environment } from "../../../environments/environment";

describe("TenantUsersService", () => {
  let service: TenantUsersService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TenantUsersService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(TenantUsersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it("listUsers GETs tenant-users collection", async () => {
    const promise = firstValueFrom(service.listUsers());
    const req = httpMock.expectOne(
      `${environment.apiUrl}/auth/tenant-users`,
    );
    expect(req.request.method).toBe("GET");
    req.flush([]);
    await promise;
    httpMock.verify();
  });

  it("createUser POSTs body", () => {
    service
      .createUser({
        tenant_id: "t1",
        email: "a@b.com",
        password: "secret",
        role_id: "r1",
      })
      .subscribe();
    const req = httpMock.expectOne(
      `${environment.apiUrl}/auth/tenant-users`,
    );
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toMatchObject({ email: "a@b.com" });
    req.flush({});
    httpMock.verify();
  });
});
