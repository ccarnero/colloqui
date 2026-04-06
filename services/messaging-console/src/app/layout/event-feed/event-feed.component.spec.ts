import { ComponentFixture, TestBed } from "@angular/core/testing";
import { Subject } from "rxjs";
import { vi } from "vitest";

import { EventFeedComponent } from "./event-feed.component";
import {
  EventStreamService,
  type IChannelStreamEvent,
} from "../../core/services/event-stream.service";

describe("EventFeedComponent", () => {
  let fixture: ComponentFixture<EventFeedComponent>;
  let events$: Subject<IChannelStreamEvent>;

  beforeEach(async () => {
    events$ = new Subject();
    await TestBed.configureTestingModule({
      imports: [EventFeedComponent],
      providers: [
        {
          provide: EventStreamService,
          useValue: {
            connect: () => events$.asObservable(),
            disconnect: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(EventFeedComponent);
    fixture.detectChanges();
  });

  it("shows empty state before events arrive", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Waiting for events");
    expect(el.textContent).toContain("Live Events");
  });

  it("appends stream events to the feed", () => {
    const now = new Date().toISOString();
    events$.next({
      id: "evt-1",
      type: "message",
      subject: "sub",
      channel: "sms",
      kind: "received",
      tenantId: "tenant-1",
      provider: "prov",
      time: now,
      data: {
        messageId: "m1",
        from: "+1",
        timestamp: now,
        type: "text",
        text: "hi",
        accountId: "acc-1",
      },
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("+1: hi");
    expect(el.textContent).toContain("Live Events");
    expect(el.querySelector(".feed-count")?.textContent?.trim()).toBe("1");
  });
});
