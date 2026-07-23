import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { vi } from "vitest";
import type { IUser } from "../../../core/models";
import { UserDetailDialogComponent } from "./user-detail-dialog.component";

const USER: IUser = {
  id: "u1",
  tenant_id: "t1",
  email: "alice@example.com",
  role_id: "r1",
  role: "tenant_admin",
  display_name: "Alice",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("UserDetailDialogComponent", () => {
  let fixture: ComponentFixture<UserDetailDialogComponent>;
  let closeSpy: ReturnType<typeof vi.fn>;

  function setup(canDeactivate: boolean): void {
    closeSpy = vi.fn();
    TestBed.configureTestingModule({
      imports: [UserDetailDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close: closeSpy } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            user: USER,
            canDeactivate,
            formatRole: (role: string) => role.toUpperCase(),
            formatCreatedAt: () => "Jan 1, 2026",
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserDetailDialogComponent);
    fixture.detectChanges();
  }

  it("renders user fields via the injected formatters", () => {
    setup(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("alice@example.com");
    expect(el.textContent).toContain("Alice");
    expect(el.textContent).toContain("TENANT_ADMIN");
    expect(el.textContent).toContain("Jan 1, 2026");
  });

  it("shows the Deactivate action when canDeactivate is true", () => {
    setup(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Deactivate user");
  });

  it("hides the Deactivate action when canDeactivate is false", () => {
    setup(false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain("Deactivate user");
  });

  it("closes with a deactivate result carrying the user id", () => {
    setup(true);
    fixture.componentInstance.deactivate();
    expect(closeSpy).toHaveBeenCalledWith({
      action: "deactivate",
      userId: "u1",
    });
  });

  it("closes with no result on plain close", () => {
    setup(true);
    fixture.componentInstance.close();
    expect(closeSpy).toHaveBeenCalledWith();
  });
});
