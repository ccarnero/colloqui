import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { vi } from "vitest";
import { of } from "rxjs";

import { AutoReplyComponent } from "./auto-reply.component";
import { ChannelService } from "../../core/services/channel.service";

describe("AutoReplyComponent", () => {
  let fixture: ComponentFixture<AutoReplyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AutoReplyComponent],
      providers: [
        provideRouter([]),
        {
          provide: ChannelService,
          useValue: {
            listAccounts: vi.fn(() => of([])),
            listAutoReplyRules: vi.fn(() => of([])),
            createAutoReplyRule: vi.fn(() => of({})),
            deleteAutoReplyRule: vi.fn(() => of(undefined)),
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
