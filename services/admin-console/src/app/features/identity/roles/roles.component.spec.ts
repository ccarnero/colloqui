import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { vi } from "vitest";
import { of } from "rxjs";
import { MatDialog } from "@angular/material/dialog";
import { RolesComponent } from "./roles.component";
import { AuthService } from "../../../core/services/auth.service";
import { TenantService } from "../../../core/services/tenant.service";
import { RoleService } from "../../../core/services/role.service";

describe("RolesComponent", () => {
  let fixture: ComponentFixture<RolesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RolesComponent],
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
          provide: RoleService,
          useValue: {
            roles: signal([]),
            loading: signal(false),
            loadRoles: vi.fn(),
            getRole: vi.fn().mockReturnValue(
              of({
                id: "r1",
                name: "Editor",
                description: "",
                permissions: [],
                is_system: false,
                user_count: 0,
              }),
            ),
            deleteRole: vi.fn(),
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

    fixture = TestBed.createComponent(RolesComponent);
    fixture.detectChanges();
  });

  it("renders roles header", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Roles");
  });
});
