import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { vi } from "vitest";
import { of } from "rxjs";
import { MatDialog } from "@angular/material/dialog";
import { UsersComponent } from "./users.component";
import { AuthService } from "../../../core/services/auth.service";
import { TenantService } from "../../../core/services/tenant.service";
import { TenantUsersService } from "../../../core/services/tenant-users.service";

describe("UsersComponent", () => {
  let fixture: ComponentFixture<UsersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UsersComponent],
      providers: [
        {
          provide: AuthService,
          useValue: {
            hasPermission: vi.fn().mockReturnValue(true),
            tenantId: signal("t1"),
          },
        },
        {
          provide: TenantService,
          useValue: {
            currentTenant: signal({
              id: "t1",
              name: "Test",
              configuration: {},
            }),
          },
        },
        {
          provide: TenantUsersService,
          useValue: {
            listUsers: vi.fn().mockReturnValue(of([])),
          },
        },
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn().mockReturnValue({
              afterClosed: () => of(undefined),
            }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UsersComponent);
    fixture.detectChanges();
  });

  it("renders Users title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Users");
  });
});
