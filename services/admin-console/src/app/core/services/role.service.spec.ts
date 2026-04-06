import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";

import { RoleService } from "./role.service";
import { environment } from "../../../environments/environment";
import type { ITenantRole } from "../models/user.model";

describe("RoleService", () => {
  let service: RoleService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [RoleService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(RoleService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it("loadRoles fetches tenant roles and updates signal", () => {
    const roles = [
      {
        id: "r1",
        tenant_id: "t1",
        name: "admin",
        description: "",
        permissions: [],
      },
    ];
    service.loadRoles();
    const req = httpMock.expectOne(`${environment.apiUrl}/auth/tenant-roles`);
    expect(req.request.method).toBe("GET");
    req.flush(roles);
    expect(service.roles()).toEqual(roles);
    expect(service.loading()).toBe(false);
    httpMock.verify();
  });

  it("getRole returns observable for single role", () => {
    let received = false;
    service.getRole("r1").subscribe(() => {
      received = true;
    });
    const req = httpMock.expectOne(`${environment.apiUrl}/auth/tenant-roles/r1`);
    req.flush({ id: "r1", tenant_id: "t", name: "n", description: "", permissions: [] });
    expect(received).toBe(true);
    httpMock.verify();
  });

  it("listRoles$ fetches without updating roles signal", async () => {
    service.roles.set([]);
    const promise = new Promise<ITenantRole[]>((resolve) => {
      service.listRoles$().subscribe(resolve);
    });
    const req = httpMock.expectOne(`${environment.apiUrl}/auth/tenant-roles`);
    req.flush([{ id: "x", name: "n", tenant_id: "t", description: "", permissions: [], is_system: false, is_active: true }]);
    const data = await promise;
    expect(data).toHaveLength(1);
    expect(service.roles()).toEqual([]);
    httpMock.verify();
  });
});
