import { ComponentFixture, TestBed } from "@angular/core/testing";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { By } from "@angular/platform-browser";
import { vi } from "vitest";
import { of } from "rxjs";
import { AccountDialogComponent } from "./account-dialog.component";
import { ChannelAdminService } from "../../core/services/channel-admin.service";

describe("AccountDialogComponent", () => {
  let fixture: ComponentFixture<AccountDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        {
          provide: ChannelAdminService,
          useValue: {
            createAccount: vi.fn().mockReturnValue(of({})),
            patchAccount: vi.fn().mockReturnValue(of({})),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountDialogComponent);
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it("shows app secret token input for telegram", () => {
    fixture.componentInstance.channel.set("telegram");
    fixture.detectChanges();

    const labels = fixture.debugElement
      .queryAll(By.css("mat-label"))
      .map((element) => (element.nativeElement.textContent as string).trim());

    expect(labels).toContain("App Secret Token (optional)");
  });
});
