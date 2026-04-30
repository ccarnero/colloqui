import { ComponentFixture, TestBed } from "@angular/core/testing";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { vi } from "vitest";
import { of } from "rxjs";
import { RoleDialogComponent } from "./role-dialog.component";
import { RoleService } from "../../../core/services/role.service";

describe("RoleDialogComponent", () => {
  let fixture: ComponentFixture<RoleDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoleDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { tenantId: "t1" } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        {
          provide: RoleService,
          useValue: {
            patchRoleRequest: vi.fn().mockReturnValue(of({})),
            createRoleRequest: vi.fn().mockReturnValue(of({})),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RoleDialogComponent);
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
