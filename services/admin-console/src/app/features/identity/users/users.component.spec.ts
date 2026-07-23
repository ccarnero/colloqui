import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { of } from "rxjs";
import { vi } from "vitest";
import type { IUser } from "../../../core/models";
import { AuthService } from "../../../core/services/auth.service";
import { TenantService } from "../../../core/services/tenant.service";
import { TenantUsersService } from "../../../core/services/tenant-users.service";
import { CreateTenantUserDialogComponent } from "./create-tenant-user-dialog.component";
import { UserDetailDialogComponent } from "./user-detail-dialog.component";
import { UsersComponent } from "./users.component";

const USERS: IUser[] = [
  {
    id: "u1",
    tenant_id: "t1",
    email: "alice@example.com",
    role_id: "r1",
    role: "tenant_admin",
    display_name: "Alice",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "u2",
    tenant_id: "t1",
    email: "bob@example.com",
    role_id: "r2",
    role: "agent",
    display_name: null,
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  },
];

describe("UsersComponent", () => {
  let fixture: ComponentFixture<UsersComponent>;
  let dialogOpenSpy: ReturnType<typeof vi.fn>;
  let hasPermissionSpy: ReturnType<typeof vi.fn>;
  let listUsersSpy: ReturnType<typeof vi.fn>;
  let deleteUserSpy: ReturnType<typeof vi.fn>;
  let afterClosedResult: unknown;

  function setup(options?: {
    users?: IUser[];
    hasPermission?: (perm: string) => boolean;
  }): void {
    listUsersSpy = vi.fn().mockReturnValue(of(options?.users ?? USERS));
    deleteUserSpy = vi.fn().mockReturnValue(of(undefined));
    hasPermissionSpy = vi
      .fn()
      .mockImplementation(options?.hasPermission ?? (() => true));
    afterClosedResult = undefined;
    dialogOpenSpy = vi.fn().mockReturnValue({
      afterClosed: () => of(afterClosedResult),
    });

    TestBed.configureTestingModule({
      imports: [UsersComponent],
      providers: [
        {
          provide: AuthService,
          useValue: {
            hasPermission: hasPermissionSpy,
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
            listUsers: listUsersSpy,
            deleteUser: deleteUserSpy,
          },
        },
      ],
    }).compileComponents();
    // `MatDialog` injects a parent `MatDialog` (`skipSelf`) and delegates
    // `open()` to it when present; registering the mock through the
    // regular `providers` array alone is not reliably picked up by every
    // `open()` call path, so it's applied via `overrideProvider` instead
    // (mirrors the working pattern verified against the real MatDialog
    // implementation, see `@angular/material/dialog`'s `MatDialog.open`).
    TestBed.overrideProvider(MatDialog, {
      useValue: { open: dialogOpenSpy },
    });

    fixture = TestBed.createComponent(UsersComponent);
    fixture.detectChanges();
  }

  it("renders Users title", () => {
    setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Users");
  });

  describe("row mapping from IUser", () => {
    beforeEach(() => setup());

    it("maps email, name, role, and created columns for every row, and no others", () => {
      const columns = fixture.componentInstance.userColumns;
      const keys = columns.map((c) => c.key);
      expect(keys).toEqual(["email", "name", "role", "created"]);

      const [alice, bob] = USERS;
      expect(columns.find((c) => c.key === "email")?.value(alice)).toBe(
        "alice@example.com"
      );
      expect(columns.find((c) => c.key === "name")?.value(alice)).toBe("Alice");
      expect(columns.find((c) => c.key === "name")?.value(bob)).toBe("—");
      expect(columns.find((c) => c.key === "role")?.value(alice)).toBe(
        "Tenant Admin"
      );
      expect(
        columns.find((c) => c.key === "created")?.value(alice) as string
      ).toContain("2026");
    });

    it("passes loaded users as inventory-table rows", () => {
      expect(fixture.componentInstance.users()).toEqual(USERS);
    });
  });

  describe("empty state", () => {
    it("shows the inventory-table empty state with no users", () => {
      setup({ users: [] });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("No users yet");
    });
  });

  describe("permission-gated actions", () => {
    it("shows Add User button when users:create is granted", () => {
      setup({ hasPermission: () => true });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("Add User");
    });

    it("hides Add User button when users:create is denied", () => {
      setup({ hasPermission: () => false });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).not.toContain("Add User");
    });

    it("opens the detail dialog with canDeactivate=true when users:delete is granted", () => {
      setup({ hasPermission: () => true });
      fixture.componentInstance.onUserRowClick(USERS[0]);
      expect(dialogOpenSpy).toHaveBeenCalledWith(
        UserDetailDialogComponent,
        expect.objectContaining({
          data: expect.objectContaining({ canDeactivate: true }),
        })
      );
    });

    it("opens the detail dialog with canDeactivate=false when users:delete is denied", () => {
      setup({ hasPermission: () => false });
      fixture.componentInstance.onUserRowClick(USERS[0]);
      expect(dialogOpenSpy).toHaveBeenCalledWith(
        UserDetailDialogComponent,
        expect.objectContaining({
          data: expect.objectContaining({ canDeactivate: false }),
        })
      );
    });
  });

  describe("action wiring identical to old behavior", () => {
    it("openCreateDialog opens CreateTenantUserDialogComponent with tenantId and reloads on create", () => {
      setup();
      listUsersSpy.mockClear();
      dialogOpenSpy.mockReturnValue({
        afterClosed: () => of(USERS[0]),
      });

      fixture.componentInstance.openCreateDialog();

      expect(dialogOpenSpy).toHaveBeenCalledWith(
        CreateTenantUserDialogComponent,
        expect.objectContaining({ data: { tenantId: "t1" } })
      );
      expect(listUsersSpy).toHaveBeenCalled();
    });

    it("deactivateUser calls TenantUsersService.deleteUser with the same id and reloads", () => {
      setup();
      listUsersSpy.mockClear();

      fixture.componentInstance.deactivateUser("u1");

      expect(deleteUserSpy).toHaveBeenCalledWith("u1");
      expect(listUsersSpy).toHaveBeenCalled();
    });

    it("calls deactivateUser with the dialog result's userId when the detail dialog resolves with a deactivate action", () => {
      setup();
      dialogOpenSpy.mockReturnValue({
        afterClosed: () => of({ action: "deactivate", userId: "u2" }),
      });
      const deactivateSpy = vi.spyOn(
        fixture.componentInstance,
        "deactivateUser"
      );

      fixture.componentInstance.onUserRowClick(USERS[1]);

      expect(deactivateSpy).toHaveBeenCalledWith("u2");
    });

    it("does not call deactivateUser when the detail dialog is closed without an action", () => {
      setup();
      dialogOpenSpy.mockReturnValue({
        afterClosed: () => of(undefined),
      });
      const deactivateSpy = vi.spyOn(
        fixture.componentInstance,
        "deactivateUser"
      );

      fixture.componentInstance.onUserRowClick(USERS[0]);

      expect(deactivateSpy).not.toHaveBeenCalled();
    });
  });
});
