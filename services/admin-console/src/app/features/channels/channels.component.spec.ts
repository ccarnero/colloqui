import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { ActivatedRoute, convertToParamMap } from "@angular/router";
import { BehaviorSubject } from "rxjs";
import { of } from "rxjs";
import { vi } from "vitest";
import { MatDialog } from "@angular/material/dialog";
import { ChannelsComponent } from "./channels.component";
import { ChannelAdminService } from "../../core/services/channel-admin.service";
import { AuthService } from "../../core/services/auth.service";

describe("ChannelsComponent", () => {
  let fixture: ComponentFixture<ChannelsComponent>;

  beforeEach(async () => {
    const paramMap$ = new BehaviorSubject(convertToParamMap({ channel: "whatsapp" }));
    await TestBed.configureTestingModule({
      imports: [ChannelsComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable() },
        },
        {
          provide: ChannelAdminService,
          useValue: {
            listAccounts: vi.fn().mockReturnValue(of([])),
            deleteAccount: vi.fn().mockReturnValue(of(undefined)),
          },
        },
        {
          provide: AuthService,
          useValue: { hasPermission: vi.fn().mockReturnValue(true) },
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

    fixture = TestBed.createComponent(ChannelsComponent);
    fixture.detectChanges();
  });

  it("renders channel management header", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toMatch(/Whatsapp|WhatsApp/i);
  });
});
