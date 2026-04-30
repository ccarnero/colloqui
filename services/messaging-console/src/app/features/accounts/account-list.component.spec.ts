import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { vi } from "vitest";
import { of } from "rxjs";

import { AccountListComponent } from "./account-list.component";
import { ChannelService } from "../../core/services/channel.service";

describe("AccountListComponent", () => {
  let fixture: ComponentFixture<AccountListComponent>;
  let listAccounts: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    listAccounts = vi.fn(() => of([]));
    await TestBed.configureTestingModule({
      imports: [AccountListComponent],
      providers: [
        provideRouter([]),
        {
          provide: ChannelService,
          useValue: {
            listAccounts,
            deleteAccount: vi.fn(() => of(undefined)),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AccountListComponent);
    fixture.detectChanges();
  });

  it("renders Channel Accounts heading", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Channel Accounts");
  });

  it("loads accounts on init", () => {
    expect(listAccounts).toHaveBeenCalled();
  });
});
