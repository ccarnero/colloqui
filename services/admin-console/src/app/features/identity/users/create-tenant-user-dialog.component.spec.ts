import { ComponentFixture, TestBed } from "@angular/core/testing";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { vi } from "vitest";
import { of } from "rxjs";
import { CreateTenantUserDialogComponent } from "./create-tenant-user-dialog.component";
import { RoleService } from "../../../core/services/role.service";
import { TenantUsersService } from "../../../core/services/tenant-users.service";

describe("CreateTenantUserDialogComponent", () => {
  let fixture: ComponentFixture<CreateTenantUserDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateTenantUserDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { tenantId: "t1" } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        {
          provide: RoleService,
          useValue: {
            listRoles$: vi.fn().mockReturnValue(of([])),
          },
        },
        {
          provide: TenantUsersService,
          useValue: {
            createUser: vi.fn().mockReturnValue(of({})),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateTenantUserDialogComponent);
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
