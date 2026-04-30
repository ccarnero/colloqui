import { Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import {
  provideRouter,
  type Routes,
  ActivatedRoute,
  convertToParamMap,
} from "@angular/router";
import { BehaviorSubject } from "rxjs";
import { of } from "rxjs";
import { vi } from "vitest";
import { MatDialog } from "@angular/material/dialog";
import { ChannelsComponent } from "./channels.component";
import { ChannelAdminService } from "../../core/services/channel-admin.service";
import { AuthService } from "../../core/services/auth.service";
import type { IChannelAccount } from "../../core/models/channel-account.model";

const ACCOUNT_ID = "56ecde94-9789-4041-800d-7675ab54eb1e";

const mockWhatsappAccount: IChannelAccount = {
  id: ACCOUNT_ID,
  channel: "whatsapp",
  provider: "meta",
  name: "Test Business",
  externalId: "ext-1",
  accessToken: "token",
  isActive: true,
  createdAt: "2024-01-01T00:00:00.000Z",
};

@Component({ standalone: true, template: "", selector: "app-stub" })
class StubComponent {}

const testRoutes: Routes = [
  { path: "channels/:channel/accounts/:accountId", component: StubComponent },
  { path: "channels/:channel", component: StubComponent },
];

describe("ChannelsComponent", () => {
  let fixture: ComponentFixture<ChannelsComponent>;

  beforeEach(async () => {
    const paramMap$ = new BehaviorSubject(convertToParamMap({ channel: "whatsapp" }));
    await TestBed.configureTestingModule({
      imports: [ChannelsComponent],
      providers: [
        provideRouter(testRoutes),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable() },
        },
        {
          provide: ChannelAdminService,
          useValue: {
            listAccounts: vi.fn().mockReturnValue(of([mockWhatsappAccount])),
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

  it("links account name to channel account metrics route", () => {
    const el = fixture.nativeElement as HTMLElement;
    const link = el.querySelector("a.account-name-link") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.textContent?.trim()).toBe("Test Business");
    expect(link.getAttribute("href")).toBe(
      `/channels/whatsapp/accounts/${ACCOUNT_ID}`,
    );
  });
});
