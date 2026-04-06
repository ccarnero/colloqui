import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { vi } from "vitest";
import { of } from "rxjs";

import { AccountSettingsComponent } from "./account-settings.component";
import { ChannelService } from "../../core/services/channel.service";

const sampleAccount = {
  id: "acc-1",
  tenantId: "t1",
  channel: "whatsapp" as const,
  provider: "meta",
  name: "Test",
  externalId: "ext-1",
  isActive: true,
};

describe("AccountSettingsComponent", () => {
  let fixture: ComponentFixture<AccountSettingsComponent>;
  let getAccount: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getAccount = vi.fn(() => of(sampleAccount));
    await TestBed.configureTestingModule({
      imports: [AccountSettingsComponent],
      providers: [
        provideRouter([]),
        {
          provide: ChannelService,
          useValue: {
            getAccount,
            updateAccount: vi.fn(() => of(undefined)),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AccountSettingsComponent);
    fixture.componentRef.setInput("id", "acc-1");
    fixture.detectChanges();
  });

  it("renders Account Settings heading", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Account Settings");
  });

  it("loads account on init", () => {
    expect(getAccount).toHaveBeenCalledWith("acc-1");
  });
});
