import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { vi } from "vitest";
import { of } from "rxjs";

import { ConnectAccountComponent } from "./connect-account.component";
import { ChannelService } from "../../core/services/channel.service";

describe("ConnectAccountComponent", () => {
  let fixture: ComponentFixture<ConnectAccountComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConnectAccountComponent],
      providers: [
        provideRouter([]),
        {
          provide: ChannelService,
          useValue: {
            createAccount: vi.fn(() => of({ id: "new-id" })),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ConnectAccountComponent);
    fixture.detectChanges();
  });

  it("renders Connect Account heading", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Connect Account");
  });

  it("shows channel picker initially", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("WhatsApp Business");
    expect(el.textContent).toContain("Instagram");
    expect(el.textContent).toContain("Telegram");
  });
});
