import { ComponentFixture, TestBed } from "@angular/core/testing";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";
import { MatDialog } from "@angular/material/dialog";
import { vi } from "vitest";
import { of } from "rxjs";
import { AutoReplyComponent } from "./auto-reply.component";
import { ChannelAdminService } from "../../../core/services/channel-admin.service";

describe("AutoReplyComponent", () => {
  let fixture: ComponentFixture<AutoReplyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AutoReplyComponent, NoopAnimationsModule],
      providers: [
        {
          provide: ChannelAdminService,
          useValue: {
            listAutoReplyRules: vi.fn().mockReturnValue(of([])),
            deleteAutoReplyRule: vi.fn().mockReturnValue(of(void 0)),
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

    fixture = TestBed.createComponent(AutoReplyComponent);
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
