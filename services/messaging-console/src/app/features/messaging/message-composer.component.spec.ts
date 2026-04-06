import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { vi } from "vitest";
import { of } from "rxjs";

import { MessageComposerComponent } from "./message-composer.component";
import { ChannelService } from "../../core/services/channel.service";

describe("MessageComposerComponent", () => {
  let fixture: ComponentFixture<MessageComposerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessageComposerComponent],
      providers: [
        provideRouter([]),
        {
          provide: ChannelService,
          useValue: {
            listAccounts: vi.fn(() => of([])),
            sendMessage: vi.fn(() => of({})),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MessageComposerComponent);
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
