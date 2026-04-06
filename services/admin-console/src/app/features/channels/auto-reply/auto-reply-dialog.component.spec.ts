import { ComponentFixture, TestBed } from "@angular/core/testing";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { vi } from "vitest";
import { of } from "rxjs";
import { AutoReplyDialogComponent } from "./auto-reply-dialog.component";
import { ChannelAdminService } from "../../../core/services/channel-admin.service";

describe("AutoReplyDialogComponent", () => {
  let fixture: ComponentFixture<AutoReplyDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AutoReplyDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        {
          provide: ChannelAdminService,
          useValue: {
            listAccountOptions: vi.fn().mockReturnValue(of([])),
            createAutoReplyRule: vi.fn().mockReturnValue(of({})),
            updateAutoReplyRule: vi.fn().mockReturnValue(of({})),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AutoReplyDialogComponent);
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
